import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

interface ArchiveWorld {
  projectDir?: string;
  cliResult?: RunCLIResult;
}

function changesDir(world: ArchiveWorld): string {
  assert.ok(world.projectDir, 'projectDir must be set by Given a Spok workspace');
  return path.join(world.projectDir, 'spok', 'changes');
}

function archiveOutput(world: ArchiveWorld): string {
  assert.ok(world.cliResult, 'cliResult must be set by When I archive change');
  return `${world.cliResult.stdout}${world.cliResult.stderr}`;
}

Given('a Spok workspace', async function (this: ArchiveWorld) {
  this.projectDir = path.join(os.tmpdir(), `spok-archive-acceptance-${randomUUID()}`);
  await fs.mkdir(path.join(this.projectDir, 'spok', 'changes', 'archive'), { recursive: true });
  await fs.mkdir(path.join(this.projectDir, 'spok', 'specs'), { recursive: true });
});

Given('main spec {string} contains:', async function (
  this: ArchiveWorld,
  specName: string,
  contents: string
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a Spok workspace');
  const specDir = path.join(this.projectDir, 'spok', 'specs', specName);
  await fs.mkdir(specDir, { recursive: true });
  await fs.writeFile(path.join(specDir, 'spec.md'), `${contents.trim()}\n`, 'utf-8');
});

Given('change {string} has proposal:', async function (
  this: ArchiveWorld,
  changeName: string,
  contents: string
) {
  const changeDir = path.join(changesDir(this), changeName);
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), `${contents.trim()}\n`, 'utf-8');
});

Given('change {string} has delta spec {string}:', async function (
  this: ArchiveWorld,
  changeName: string,
  specName: string,
  contents: string
) {
  const specDir = path.join(changesDir(this), changeName, 'specs', specName);
  await fs.mkdir(specDir, { recursive: true });
  await fs.writeFile(path.join(specDir, 'spec.md'), `${contents.trim()}\n`, 'utf-8');
});

When('I archive change {string}', async function (this: ArchiveWorld, changeName: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a Spok workspace');
  this.cliResult = await runCLI(['archive', changeName, '--yes'], {
    cwd: this.projectDir,
    timeoutMs: 10_000,
  });
});

Then('the archive output contains {string}', function (this: ArchiveWorld, expected: string) {
  const output = archiveOutput(this);
  assert.ok(output.includes(expected), `archive output should contain: ${expected}\n${output}`);
});

Then('the archive output does not contain {string}', function (
  this: ArchiveWorld,
  unexpected: string
) {
  const output = archiveOutput(this);
  assert.ok(
    !output.includes(unexpected),
    `archive output should not contain: ${unexpected}\n${output}`
  );
});

Then('change {string} is archived', async function (this: ArchiveWorld, changeName: string) {
  const archived = await fs.readdir(path.join(changesDir(this), 'archive'));
  assert.ok(
    archived.some(entry => entry.endsWith(`-${changeName}`)),
    `expected ${changeName} under archive/, found: ${archived.join(', ')}`
  );
});

Then('change {string} is not archived', async function (this: ArchiveWorld, changeName: string) {
  const archived = await fs.readdir(path.join(changesDir(this), 'archive'));
  assert.ok(
    !archived.some(entry => entry.endsWith(`-${changeName}`)),
    `expected ${changeName} to stay active, found under archive/: ${archived.join(', ')}`
  );
});
