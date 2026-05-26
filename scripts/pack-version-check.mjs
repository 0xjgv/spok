#!/usr/bin/env bun
// Guard: Ensure the packed tarball's CLI `--version` matches package.json.
//
// Uses `bun pm pack` to create the tarball and `bun add` to install it
// into a throwaway project, then runs the installed CLI to verify
// the version matches what package.json claims.

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function log(msg) {
  if (process.env.CI) return; // keep CI logs quiet by default
  console.log(msg);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function bunPack() {
  // `bun pm pack` writes a .tgz to the current directory and prints the
  // filename on the last line of stdout.
  const out = run('bun', ['pm', 'pack']).trim();
  const last = out.split(/\r?\n/).pop().trim();
  if (last.endsWith('.tgz')) return last;
  // Fallback: pick the most recently modified .tgz in cwd.
  const tgzs = readdirSync(process.cwd()).filter((f) => f.endsWith('.tgz'));
  if (tgzs.length === 0) throw new Error('bun pm pack did not produce a .tgz');
  return tgzs.sort().pop();
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
  const expected = pkg.version;
  const pkgName = pkg.name;

  let work;
  let tgzPath;

  try {
    log(`Packing ${pkgName}@${expected}...`);
    const filename = bunPack();
    tgzPath = path.resolve(filename);
    log(`Created: ${tgzPath}`);

    work = mkdtempSync(path.join(tmpdir(), 'spok-pack-check-'));
    log(`Temp dir: ${work}`);

    writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify({ name: 'pack-check', private: true }, null, 2)
    );

    run('bun', ['add', tgzPath], { cwd: work });

    const binRel = path.join('node_modules', pkgName, 'bin', 'spok.js');
    const actual = run('bun', [binRel, '--version'], { cwd: work }).trim();

    if (actual !== expected) {
      throw new Error(
        `Packed CLI version mismatch: expected ${expected}, got ${actual}. ` +
          'Ensure the dist is built and the CLI reads version from package.json.'
      );
    }

    log('Version check passed.');
  } finally {
    if (work) {
      try { rmSync(work, { recursive: true, force: true }); } catch {}
    }
    if (tgzPath) {
      try { rmSync(tgzPath, { force: true }); } catch {}
    }
  }
}

try {
  main();
  console.log('✅ pack-version-check: OK');
} catch (err) {
  console.error(`❌ pack-version-check: ${err.message}`);
  process.exit(1);
}
