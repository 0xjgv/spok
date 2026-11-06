#!/bin/sh
# Build the release assets into dist-release/: spok-<version>.tgz, install.sh,
# and checksums.txt. The same assets serve GitHub Releases and `make install`.
set -eu

root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
out=dist-release
version=$(bun -e 'console.log(require("./package.json").version)')

rm -rf "$out"
mkdir -p "$out"
bun run build >/dev/null
bun pm pack --destination "$out" >/dev/null
archive=spok-$version.tgz
[ -f "$out/$archive" ] || { echo "release: bun pm pack did not write $out/$archive" >&2; exit 1; }
cp install.sh "$out/install.sh"
if command -v sha256sum >/dev/null 2>&1; then
    (cd "$out" && sha256sum "$archive" install.sh > checksums.txt)
else
    (cd "$out" && shasum -a 256 "$archive" install.sh > checksums.txt)
fi
echo "$out/$archive"
