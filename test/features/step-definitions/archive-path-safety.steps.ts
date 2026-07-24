import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

const MARKER_CONTENT = 'leave this marker in place\n';

interface ArchivePathSafetyWorld {
  projectDir?: string;
  markerPath?: string;
  cliResult?: RunCLIResult;
}

function cliOutput(world: ArchivePathSafetyWorld): string {
  assert.ok(world.cliResult, 'cliResult must be set by the archive step');
  return `${world.cliResult.stdout}\n${world.cliResult.stderr}`;
}

Given('a Spok project with a sibling victim marker', async function (
  this: ArchivePathSafetyWorld
) {
  this.projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spok-archive-path-safety-'));
  await fs.mkdir(path.join(this.projectDir, 'spok', 'changes'), { recursive: true });

  this.markerPath = path.join(this.projectDir, 'victim', 'marker.txt');
  await fs.mkdir(path.dirname(this.markerPath), { recursive: true });
  await fs.writeFile(this.markerPath, MARKER_CONTENT, 'utf-8');
});

When('I archive the explicit change {string}', async function (
  this: ArchivePathSafetyWorld,
  changeName: string
) {
  assert.ok(this.projectDir, 'projectDir must be set by the project setup step');
  this.cliResult = await runCLI(['archive', changeName, '--yes', '--skip-specs'], {
    cwd: this.projectDir,
    env: { SPOK_TELEMETRY: '0' },
    timeoutMs: 10_000,
  });
});

Then('the archive command rejects the change name {string}', function (
  this: ArchivePathSafetyWorld,
  changeName: string
) {
  assert.ok(this.cliResult, 'cliResult must be set by the archive step');
  assert.notEqual(
    this.cliResult.exitCode,
    0,
    `Expected archive to reject '${changeName}', but it exited successfully`
  );
  assert.ok(
    cliOutput(this).includes(`Invalid change name '${changeName}'`),
    `Expected archive output to reject '${changeName}'`
  );
});

Then('the sibling victim marker remains unchanged', async function (
  this: ArchivePathSafetyWorld
) {
  assert.ok(this.projectDir, 'projectDir must be set by the project setup step');
  assert.ok(this.markerPath, 'markerPath must be set by the project setup step');
  assert.equal(await fs.readFile(this.markerPath, 'utf-8'), MARKER_CONTENT);

  const archivedMarker = path.join(
    this.projectDir,
    'spok',
    'changes',
    'archive',
    'victim',
    'marker.txt'
  );
  await assert.rejects(fs.access(archivedMarker));
});

After({ tags: '@archive-path-safety' }, async function (this: ArchivePathSafetyWorld) {
  if (this.projectDir) {
    await fs.rm(this.projectDir, { recursive: true, force: true });
  }
});
