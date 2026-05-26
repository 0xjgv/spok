# Spok Scripts

Utility scripts for Spok maintenance and development.

## postinstall.js

Post-installation script that prints a one-line hint about shell completions.
Runs after `bun install` / `npm install` of the published package.

## pack-version-check.mjs

Packs the project with `bun pm pack`, installs the tarball into a throwaway
project, and asserts that the installed CLI's `--version` matches
`package.json`. Used as a release-time guard.
