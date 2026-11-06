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
  execution?: { workRoot: string; branch: string };
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

Given('the outline flow has {string} plan content', async function (this: OutlineWorld, plan: string) {
  if (plan === 'stale') {
    await fs.writeFile(path.join(this.flowTaskDir, 'plan.md'), '# Obsolete plan\n');
  }
});

async function snapshotTaskFiles(world: OutlineWorld): Promise<void> {
  world.savedTaskFiles = {};
  for (const filename of await fs.readdir(world.flowTaskDir)) {
    if (filename.endsWith('.md') || filename === 'workflow-state.json') {
      world.savedTaskFiles[filename] = await fs.readFile(path.join(world.flowTaskDir, filename), 'utf-8');
    }
  }
}

Given('the outline flow saved graph contains the {string} step', async function (this: OutlineWorld, removed: string) {
  const statePath = path.join(this.flowTaskDir, 'workflow-state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf-8')) as OutlineResponse;
  const index = state.steps.findIndex((step) => step.id === 'implement');
  state.steps.splice(index, 0, { id: removed, status: 'pending' });
  await fs.writeFile(statePath, JSON.stringify(state));
  await snapshotTaskFiles(this);
});

async function writeFinishedFlow(world: OutlineWorld, ids: string[]): Promise<void> {
  const completedAt = new Date().toISOString();
  const state = {
    version: 2,
    profile: 'claude',
    taskDir: world.flowTaskDir,
    status: 'complete',
    steps: ids.map((id) => ({ id, status: 'completed', result: { summary: 'Done.', completedAt } })),
    repairAttempts: 0,
    execution: {
      workRoot: world.projectDir,
      branch: 'main',
      baselineHead: 'a'.repeat(40),
      baselineChanges: {},
      ownedPaths: [],
    },
    createdAt: completedAt,
    updatedAt: completedAt,
  };
  await fs.writeFile(path.join(world.flowTaskDir, 'workflow-state.json'), JSON.stringify(state));
  await snapshotTaskFiles(world);
}

Given('the outline flow saved graph is a finished legacy flow', async function (this: OutlineWorld) {
  await writeFinishedFlow(this, [
    'validate-problem', 'research-questions', 'research', 'design-discussion', 'structure-outline',
    'design-review', 'implement', 'simplify', 'validate', 'commit', 'self-learn',
  ]);
});

Given('the outline flow saved graph is a finished six-step flow', async function (this: OutlineWorld) {
  await writeFinishedFlow(this, [
    'research-questions', 'research', 'design-discussion', 'structure-outline', 'implement', 'commit',
  ]);
});

When('I request the outline flow status', async function (this: OutlineWorld) {
  await request(this, 'status');
});

When('I request the outline flow next step', async function (this: OutlineWorld) {
  await request(this, 'next');
});

Then('the outline flow state is {string} with its recorded execution', function (this: OutlineWorld, expected: string) {
  assert.ok(this.cliResult);
  assert.equal(this.cliResult.exitCode, 0, this.cliResult.stdout + this.cliResult.stderr);
  const result = response(this);
  assert.equal(result.state, expected);
  assert.equal(result.execution?.workRoot, this.projectDir);
  assert.equal(result.execution?.branch, 'main');
});

Then('the outline flow is blocked because the {string} step was removed', function (this: OutlineWorld, removed: string) {
  const result = response(this);
  assert.equal(result.state, 'blocked');
  assert.match(result.reason ?? '', new RegExp(`the ${removed} step has been removed`));
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

Then('the outline flow graph is {string}', function (this: OutlineWorld, expected: string) {
  assert.equal(response(this).steps.map((step) => step.id).join(', '), expected);
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
