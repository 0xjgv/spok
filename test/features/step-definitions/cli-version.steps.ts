import { When, Then } from '@cucumber/cucumber';
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
