import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

interface ChangeTicketWorld {
  projectDir?: string;
  cliResult?: RunCLIResult;
}

interface ListedChange {
  name: string;
  ticket?: string;
}

function listedChange(world: ChangeTicketWorld, name: string): ListedChange {
  assert.ok(world.cliResult, 'cliResult must be set by a list step');
  const { changes } = JSON.parse(world.cliResult.stdout) as { changes: ListedChange[] };
  const change = changes.find(entry => entry.name === name);
  assert.ok(change, `expected change ${name} in list output`);
  return change;
}

async function listChanges(world: ChangeTicketWorld, args: string[]): Promise<void> {
  assert.ok(world.projectDir, 'projectDir must be set by Given a Spok workspace');
  world.cliResult = await runCLI(args, {
    cwd: world.projectDir,
    timeoutMs: 10_000,
  });
  assert.equal(world.cliResult.exitCode, 0, world.cliResult.stderr);
}

Given('change {string} has metadata:', async function (
  this: ChangeTicketWorld,
  changeName: string,
  contents: string
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a Spok workspace');
  const changeDir = path.join(this.projectDir, 'spok', 'changes', changeName);
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, '.spok.yaml'), `${contents.trim()}\n`, 'utf-8');
});

When('I list the workspace changes', async function (this: ChangeTicketWorld) {
  await listChanges(this, ['list']);
});

When('I list the workspace changes as JSON', async function (this: ChangeTicketWorld) {
  await listChanges(this, ['list', '--json']);
});

Then('the list output contains {string}', function (this: ChangeTicketWorld, expected: string) {
  assert.ok(this.cliResult, 'cliResult must be set by a list step');
  assert.ok(
    this.cliResult.stdout.includes(expected),
    `list output should contain: ${expected}\n${this.cliResult.stdout}`
  );
});

Then('the listed change {string} has ticket {string}', function (
  this: ChangeTicketWorld,
  changeName: string,
  ticket: string
) {
  assert.equal(listedChange(this, changeName).ticket, ticket);
});

Then('the listed change {string} has no ticket', function (
  this: ChangeTicketWorld,
  changeName: string
) {
  assert.ok(
    !('ticket' in listedChange(this, changeName)),
    `expected no ticket field for change ${changeName}`
  );
});
