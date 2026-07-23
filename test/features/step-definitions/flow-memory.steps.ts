import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

interface FlowMemoryWorld {
  projectDir?: string;
  flowTaskDir?: string;
  cliResult?: RunCLIResult;
}

function stepPrompt(world: FlowMemoryWorld): string {
  assert.ok(world.cliResult, 'cliResult must be set by a flow next step');
  const response = JSON.parse(world.cliResult.stdout) as { step?: { prompt?: string } };
  assert.ok(response.step?.prompt, 'flow next must return step.prompt');
  return response.step.prompt;
}

Given('{string} contains:', async function (
  this: FlowMemoryWorld,
  relativePath: string,
  contents: string
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  const filePath = path.join(this.projectDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${contents.trim()}\n`, 'utf-8');
});

Given('{string} is a directory', async function (this: FlowMemoryWorld, relativePath: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  await fs.mkdir(path.join(this.projectDir, relativePath), { recursive: true });
});

When('I request the next flow step as JSON', async function (this: FlowMemoryWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  this.cliResult = await runCLI(['flow', 'next', this.flowTaskDir, '--json'], {
    cwd: this.projectDir,
  });
  assert.equal(this.cliResult.exitCode, 0, this.cliResult.stderr);
});

Then('the step prompt contains {string}', function (this: FlowMemoryWorld, expected: string) {
  assert.ok(stepPrompt(this).includes(expected), `step prompt should contain: ${expected}`);
});

Then('the step prompt does not contain {string}', function (
  this: FlowMemoryWorld,
  unexpected: string
) {
  assert.ok(
    !stepPrompt(this).includes(unexpected),
    `step prompt should not contain: ${unexpected}`
  );
});

Then('the step prompt names the step skill and its argument', function (this: FlowMemoryWorld) {
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  const prompt = stepPrompt(this);
  assert.ok(prompt.includes('spok-validate-problem'), 'step prompt should name the skill');
  assert.ok(
    prompt.includes(path.join(this.flowTaskDir, 'ticket.md')),
    'step prompt should name the argument'
  );
});

Then('the step prompt contains no rules section', function (this: FlowMemoryWorld) {
  assert.ok(!stepPrompt(this).includes('MEMORY.md'), 'step prompt should carry no rules section');
});

Then('the flow response warns that memory could not be read', function (this: FlowMemoryWorld) {
  assert.ok(this.cliResult, 'cliResult must be set by a flow next step');
  const response = JSON.parse(this.cliResult.stdout) as { memoryWarning?: string };
  assert.match(response.memoryWarning ?? '', /could not be read/);
});
