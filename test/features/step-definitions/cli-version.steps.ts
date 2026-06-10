import { When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runCLI, type RunCLIResult, cliProjectRoot } from '../../helpers/run-cli.js';

interface CliVersionWorld {
  cliResult?: RunCLIResult;
}

When('I run the Spok CLI with {string}', async function (this: CliVersionWorld, args: string) {
  this.cliResult = await runCLI(args.split(' '), {
    env: {
      SPOK_TELEMETRY: '0',
    },
    timeoutMs: 10_000,
  });
});

Then('the Spok CLI output matches {string} version', async function (
  this: CliVersionWorld,
  packageFile: string
) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  const packageJson = JSON.parse(
    await readFile(path.join(cliProjectRoot, packageFile), 'utf-8')
  ) as { version: string };

  assert.equal(this.cliResult.exitCode, 0);
  assert.equal(this.cliResult.stderr, '');
  assert.equal(this.cliResult.stdout.trim(), packageJson.version);
});

Then('the Spok CLI rejects the unknown option {string}', function (
  this: CliVersionWorld,
  option: string
) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.notEqual(this.cliResult.exitCode, 0);
  assert.match(this.cliResult.stderr, new RegExp(`unknown option '${option}'`));
});

Then('the Spok CLI commands start with:', function (
  this: CliVersionWorld,
  table: DataTable
) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.equal(this.cliResult.exitCode, 0);

  const lines = this.cliResult.stdout.split('\n');
  const commandsIndex = lines.findIndex((line) => line.trim() === 'Commands:');
  assert.notEqual(commandsIndex, -1);

  const commandNames: string[] = [];
  for (const line of lines.slice(commandsIndex + 1)) {
    if (line.trim() === '') break;
    if (/^  \S/u.test(line)) {
      commandNames.push(line.trim().split(/\s+/)[0]);
    }
  }

  assert.deepEqual(commandNames.slice(0, table.raw().length), table.raw().map(([name]) => name));
});

Then('the Spok CLI commands are:', function (
  this: CliVersionWorld,
  table: DataTable
) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.equal(this.cliResult.exitCode, 0);

  const lines = this.cliResult.stdout.split('\n');
  const commandsIndex = lines.findIndex((line) => line.trim() === 'Commands:');
  assert.notEqual(commandsIndex, -1);

  const commandNames: string[] = [];
  for (const line of lines.slice(commandsIndex + 1)) {
    if (line.trim() === '') break;
    if (/^  \S/u.test(line)) {
      commandNames.push(line.trim().split(/\s+/)[0]);
    }
  }

  assert.deepEqual(commandNames, table.raw().map(([name]) => name));
});

Then('the Spok CLI output contains {string}', function (
  this: CliVersionWorld,
  expected: string
) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.match(this.cliResult.stdout, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

Then('the Spok CLI error contains {string}', function (
  this: CliVersionWorld,
  expected: string
) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.match(this.cliResult.stderr, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

Then('the Spok CLI output rejects skills help form {string}', function (
  this: CliVersionWorld,
  subcommand: string
) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.notEqual(this.cliResult.exitCode, 0);
  assert.match(this.cliResult.stderr, new RegExp(`Unknown skills subcommand: ${subcommand}`));
  assert.match(this.cliResult.stderr, /Use one of:/);
});
