import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

interface OutlineStep {
  id: string;
  status: string;
  prompt?: string;
  result?: { summary: string; completedAt: string };
}

interface OutlineResponse {
  state?: string;
  reason?: string;
  steps: OutlineStep[];
  nextStep?: OutlineStep;
  step?: OutlineStep;
}

interface OutlineWorld {
  projectDir: string;
  flowTaskDir: string;
  cliResult?: RunCLIResult;
  savedTaskFiles?: Record<string, string>;
}

function response(world: OutlineWorld): OutlineResponse {
  assert.ok(world.cliResult, 'A flow CLI response is required');
  return JSON.parse(world.cliResult.stdout) as OutlineResponse;
}

async function request(world: OutlineWorld, action: string, args: string[] = []): Promise<void> {
  world.cliResult = await runCLI(['flow', action, world.flowTaskDir, ...args, '--json'], {
    cwd: world.projectDir,
  });
}

async function command(world: OutlineWorld, action: string, args: string[] = []): Promise<void> {
  await request(world, action, args);
  assert.ok(world.cliResult);
  assert.equal(world.cliResult.exitCode, 0, world.cliResult.stdout + world.cliResult.stderr);
}

async function completeArtifact(world: OutlineWorld, step: string, filename: string, content: string): Promise<void> {
  const output = path.join(world.flowTaskDir, filename);
  await fs.writeFile(output, content);
  await command(world, 'complete', ['--step', step, '--output', output]);
}

Given('the outline flow has {string} plan content', async function (this: OutlineWorld, plan: string) {
  if (plan === 'stale') {
    await fs.writeFile(path.join(this.flowTaskDir, 'plan.md'), '# Obsolete plan\n');
  }
});

Given('the outline flow saved graph contains a plan step', async function (this: OutlineWorld) {
  const statePath = path.join(this.flowTaskDir, 'workflow-state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf-8')) as OutlineResponse;
  const index = state.steps.findIndex((step) => step.id === 'implement');
  state.steps.splice(index, 0, { id: 'plan', status: 'pending' });
  await fs.writeFile(statePath, JSON.stringify(state));
  this.savedTaskFiles = {};
  for (const filename of await fs.readdir(this.flowTaskDir)) {
    if (filename.endsWith('.md') || filename === 'workflow-state.json') {
      this.savedTaskFiles[filename] = await fs.readFile(path.join(this.flowTaskDir, filename), 'utf-8');
    }
  }
});

When('I pass the outline flow design review', async function (this: OutlineWorld) {
  await completeArtifact(this, 'design-review', 'design-review.md',
    '---\ntype: design-review\nverdict: PASS\n---\n\n# Design Review\n');
});

When('I request the unsupported outline flow status', async function (this: OutlineWorld) {
  await request(this, 'status');
});

Then('the outline flow is blocked because the plan step was removed', function (this: OutlineWorld) {
  const result = response(this);
  assert.equal(result.state, 'blocked');
  assert.match(result.reason ?? '', /plan step.*removed/i);
  assert.match(result.reason ?? '', /new task directory.*ticket\.md/i);
  assert.equal(result.nextStep, undefined);
  assert.equal(result.step, undefined);
});

Then('the outline flow task files are unchanged', async function (this: OutlineWorld) {
  assert.ok(this.savedTaskFiles);
  const filenames = (await fs.readdir(this.flowTaskDir))
    .filter((filename) => filename.endsWith('.md') || filename === 'workflow-state.json');
  assert.deepEqual(filenames.sort(), Object.keys(this.savedTaskFiles).sort());
  for (const [filename, content] of Object.entries(this.savedTaskFiles)) {
    assert.equal(await fs.readFile(path.join(this.flowTaskDir, filename), 'utf-8'), content, filename);
  }
});

Then('the outline flow next step is {string}', function (this: OutlineWorld, expected: string) {
  assert.equal(response(this).nextStep?.id, expected);
});

Then('the outline flow explicitly selects {string}', async function (this: OutlineWorld, filename: string) {
  const prompt = response(this).nextStep?.prompt;
  assert.ok(prompt, 'The next step must include its dispatch prompt');
  const match = /^Implementation artifact: (.+)$/m.exec(prompt);
  assert.ok(match, 'The prompt must explicitly name the implementation artifact');
  assert.equal(await fs.realpath(match[1]), await fs.realpath(path.join(this.flowTaskDir, filename)));
});

Then('the outline flow graph has {string} planning step', function (this: OutlineWorld, expected: string) {
  assert.equal(response(this).steps.some((step) => step.id === 'plan'), expected === 'a');
});

When('implementation is recorded as completed in the outline flow fixture', async function (this: OutlineWorld) {
  const statePath = path.join(this.flowTaskDir, 'workflow-state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf-8')) as OutlineResponse;
  const implementation = state.steps.find((step) => step.id === 'implement');
  assert.ok(implementation);
  implementation.status = 'completed';
  implementation.result = { summary: 'Fixture implementation complete.', completedAt: new Date().toISOString() };
  await fs.writeFile(statePath, JSON.stringify(state));
  await command(this, 'status');
});

When('I complete the outline flow summary step {string}', async function (this: OutlineWorld, step: string) {
  await command(this, 'complete', ['--step', step, '--summary', 'Completed fixture work.']);
});

When('I complete outline flow validation with {string}', async function (this: OutlineWorld, verdict: string) {
  await completeArtifact(this, 'validate', 'validation.md', `---\nverdict: ${verdict}\n---\n\n# Validation\n`);
});
