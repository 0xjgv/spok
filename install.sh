#!/bin/sh
# Install or update spok from a checksummed GitHub release.
# SPOK_VERSION        release version, e.g. v1.4.1 (default: latest)
# SPOK_DOWNLOAD_BASE  release base URL, or an absolute directory holding
#                     checksums.txt and the package archive (local testing)
# SPOK_HOME           where release archives are kept (default: $HOME/.local/share/spok)
# The release repository is private-friendly: when an anonymous download fails
# and the GitHub CLI is installed and logged in, it downloads through `gh`.
set -eu

REPO=0xjgv/spok

die() {
    echo "spok install: $*" >&2
    exit 1
}

command -v bun >/dev/null 2>&1 || die "Bun 1.3.0 or newer is required: https://bun.sh"

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        die "sha256sum or shasum is required"
    fi
}

curl_get() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$1" -o "$2" 2>/dev/null
    elif command -v wget >/dev/null 2>&1; then
        wget -q -O "$2" "$1"
    else
        return 1
    fi
}

version=${SPOK_VERSION:-}
version=${version#v}
if [ -n "$version" ]; then
    printf '%s\n' "$version" | awk '/^[0-9]+\.[0-9]+\.[0-9]+$/ {valid=1} END {exit !valid}' ||
        die "SPOK_VERSION must be a version such as v1.4.1"
fi

base=${SPOK_DOWNLOAD_BASE:-https://github.com/$REPO/releases}
base=${base%/}
case $base in
/*) release=$base ;;
*) if [ -n "$version" ]; then release=$base/download/v$version; else release=$base/latest/download; fi ;;
esac

# fetch <file> <dest>: local directory, anonymous HTTPS, then the GitHub CLI.
fetch() {
    case $release in
    /*) cp "$release/$1" "$2" 2>/dev/null && return 0 ;;
    *)
        curl_get "$release/$1" "$2" && return 0
        if command -v gh >/dev/null 2>&1; then
            gh release download ${version:+"v$version"} -R "$REPO" -p "$1" -O "$2" --clobber >/dev/null 2>&1 && return 0
        fi
        ;;
    esac
    die "download failed: $release/$1 (private repository? log in with: gh auth login)"
}

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' 0
trap 'exit 1' HUP INT TERM

fetch checksums.txt "$tmpdir/checksums.txt"
archive=$(awk -v version="$version" '
    {sub(/^\*/, "", $2)}
    $2 ~ /^spok-[0-9]+[.][0-9]+[.][0-9]+[.]tgz$/ && (version == "" || $2 == "spok-" version ".tgz") {
        found=$2; count++
    }
    END {if (count == 1) print found}
' "$tmpdir/checksums.txt")
[ -n "$archive" ] || die "expected one spok package in $release/checksums.txt"
expected=$(awk -v name="$archive" '{sub(/^\*/, "", $2)} $2 == name {print $1}' "$tmpdir/checksums.txt")
fetch "$archive" "$tmpdir/$archive"
[ "$(sha256 "$tmpdir/$archive")" = "$expected" ] || die "checksum mismatch for $archive"
archive_version=${archive#spok-}
archive_version=${archive_version%.tgz}

# Bun's global manifest records the archive path, so keep it at a stable location.
store=${SPOK_HOME:-$HOME/.local/share/spok}/releases
mkdir -p "$store"
cp "$tmpdir/$archive" "$store/$archive"

bin_dir=$(bun pm bin -g)
previous=
if [ -x "$bin_dir/spok" ]; then
    previous=$(DO_NOT_TRACK=1 "$bin_dir/spok" version 2>/dev/null || true)
fi
SPOK_NO_INSTALL_TIP=1 bun add -g "$store/$archive" >/dev/null || die "bun add -g failed for $archive"
current=$(DO_NOT_TRACK=1 "$bin_dir/spok" version 2>/dev/null) || die "installed spok does not run"
[ "$current" = "$archive_version" ] || die "installed spok reported an unexpected version: $current"

if [ -n "$previous" ] && [ "$previous" != "$current" ]; then
    echo "Updated $bin_dir/spok: $previous -> $current"
else
    echo "Installed $bin_dir/spok: $current"
fi
case :$PATH: in
*":$bin_dir:"*) ;;
*) echo "Add $bin_dir to PATH: export PATH=\"$bin_dir:\$PATH\"" ;;
esac
