# Spok Scripts

Utility scripts for Spok maintenance and development.

## postinstall.js

Post-installation script that prints a one-line getting-started hint after
`bun install` / `npm install` of the published package. Skipped in CI and when
`SPOK_NO_INSTALL_TIP=1` is set.

## pack-version-check.mjs

Packs the project with `bun pm pack`, installs the tarball into a throwaway
project, and asserts that the installed CLI's `--version` matches
`package.json`. Used as a release-time guard.
