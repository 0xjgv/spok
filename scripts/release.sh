#!/bin/sh
# make release [BUMP=patch|minor|major]
# Tag the next version on main and push it; the Release workflow publishes it.
# Idempotent: when HEAD already carries a release tag, rerunning only re-pushes
# that tag, so an interrupted release resumes instead of skipping a number.
set -eu

root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
remote=${RELEASE_REMOTE:-origin}
bump=${BUMP:-patch}

die() {
    echo "release: $*" >&2
    exit 1
}

case $bump in patch | minor | major) ;; *) die "BUMP must be patch, minor, or major" ;; esac
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "run from the main branch"
[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted changes"
git fetch --quiet --tags "$remote" main
git merge-base --is-ancestor "$remote/main" HEAD || die "main is behind $remote/main; pull first"

package_version() {
    bun -e 'console.log(require("./package.json").version)'
}

next_version() {
    echo "$1" | awk -F. -v bump="$2" '
        bump == "major" {print $1 + 1 ".0.0"; exit}
        bump == "minor" {print $1 "." $2 + 1 ".0"; exit}
        {print $1 "." $2 "." $3 + 1}'
}

tag=$(git tag --points-at HEAD --list 'v[0-9]*.[0-9]*.[0-9]*' | sort -V | tail -n 1)
if [ -n "$tag" ]; then
    echo "HEAD is already $tag; resuming its release."
else
    latest=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | sed 's/^v//' | sort -V | tail -n 1)
    current=$(printf '%s\n%s\n' "$latest" "$(package_version)" | sed '/^$/d' | sort -V | tail -n 1)
    version=$(next_version "$current" "$bump")
    tag=v$version
    git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "$tag already exists on another commit"
    VERSION=$version bun -e '
        const fs = require("fs");
        const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
        pkg.version = process.env.VERSION;
        fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");'
    git commit --quiet -m "chore(release): $tag" -- package.json
    git tag -a "$tag" -m "spok $tag"
    echo "Tagged $tag ($current -> $version)."
fi

[ "$(package_version)" = "${tag#v}" ] || die "package.json version does not match $tag"
git push --quiet --atomic "$remote" HEAD:refs/heads/main "refs/tags/$tag"
echo "Pushed $tag. The Release workflow publishes https://github.com/0xjgv/spok/releases/tag/$tag"
