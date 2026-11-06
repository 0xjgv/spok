import { Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

interface ReviewQuestion {
  id: string;
  prompt: string;
  options: Array<{ id: string }>;
  recommendedOptionId?: string;
}

interface ReviewStep {
  id: string;
  status: string;
  prompt?: string;
}

interface ReviewResponse {
  state: string;
  question?: ReviewQuestion;
  steps: ReviewStep[];
  nextStep?: ReviewStep;
  execution?: { workRoot: string; ownedPaths?: string[] };
  reason?: string;
}

interface ReviewWorld {
  projectDir: string;
  flowTaskDir: string;
  cliResult?: RunCLIResult;
  reviewWorkRoot?: string;
}

function response(world: ReviewWorld): ReviewResponse {
  assert.ok(world.cliResult, 'A flow CLI response is required');
  return JSON.parse(world.cliResult.stdout) as ReviewResponse;
}

async function tryRun(world: ReviewWorld, args: string[]): Promise<void> {
  world.cliResult = await runCLI(['flow', ...args, '--json'], { cwd: world.projectDir });
  const execution = response(world).execution;
  if (execution) world.reviewWorkRoot = execution.workRoot;
}

async function run(world: ReviewWorld, args: string[]): Promise<void> {
  await tryRun(world, args);
  assert.equal(world.cliResult?.exitCode, 0, world.cliResult!.stdout + world.cliResult!.stderr);
}

function simplifyArgs(world: ReviewWorld): string[] {
  return ['complete', world.flowTaskDir, '--step', 'simplify', '--summary', 'Simplified.'];
}

async function writeReview(world: ReviewWorld, verdict: string): Promise<string[]> {
  const review = `---\ntype: correctness-review\nverdict: ${verdict}\n---\n\n# Review\n`;
  await fs.writeFile(path.join(world.flowTaskDir, 'review.md'), review);
  return ['complete', world.flowTaskDir, '--step', 'review'];
}

function workRoot(world: ReviewWorld): string {
  assert.ok(world.reviewWorkRoot, 'Request the implementation baseline first');
  return world.reviewWorkRoot;
}

When('the review flow completes {string}', async function (this: ReviewWorld, step: string) {
  await fs.writeFile(path.join(this.flowTaskDir, `${step}.md`), `# ${step}\n`);
  await run(this, ['complete', this.flowTaskDir, '--step', step]);
});

When('the review flow answers {string}', async function (this: ReviewWorld, answer: string) {
  const question = response(this).question;
  assert.ok(question, 'A review question is required');
  await run(this, ['answer', this.flowTaskDir, '--question', question.id, '--answer', answer]);
});

When('I request the next review flow step', async function (this: ReviewWorld) {
  await run(this, ['next', this.flowTaskDir]);
});

When('the review flow writes {string} in the work root', async function (this: ReviewWorld, file: string) {
  await fs.writeFile(path.join(workRoot(this), file), `${file}\n`);
});

When(
  'the review flow completes implement with changed paths {string}',
  async function (this: ReviewWorld, paths: string) {
    await run(this, [
      'complete', this.flowTaskDir, '--step', 'implement', '--summary', 'Implemented.',
      '--changed-path', ...paths.split(','),
    ]);
  }
);

When('the review flow completes simplify', async function (this: ReviewWorld) {
  await run(this, simplifyArgs(this));
});

When('the review flow tries to complete simplify', async function (this: ReviewWorld) {
  await tryRun(this, simplifyArgs(this));
});

When('the review flow records a {string} review', async function (this: ReviewWorld, verdict: string) {
  await run(this, await writeReview(this, verdict));
});

When('the review flow tries to record a {string} review', async function (this: ReviewWorld, verdict: string) {
  await tryRun(this, await writeReview(this, verdict));
});

Then('the review flow is blocked with {string}', function (this: ReviewWorld, expected: string) {
  const result = response(this);
  assert.equal(result.state, 'blocked');
  assert.ok(result.reason?.includes(expected), result.reason);
});

When('the review flow commits the owned paths', async function (this: ReviewWorld) {
  const root = workRoot(this);
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8', env }).trim();
  git('add', ...(response(this).execution?.ownedPaths ?? []));
  git('commit', '--no-gpg-sign', '-m', 'chunk');
  await run(this, [
    'complete', this.flowTaskDir, '--step', 'commit', '--commit', git('rev-parse', 'HEAD'), '--summary', 'Committed.',
  ]);
});

Then('the review flow state is {string}', function (this: ReviewWorld, expected: string) {
  assert.equal(response(this).state, expected);
});

Then('the review question id is {string}', function (this: ReviewWorld, expected: string) {
  assert.equal(response(this).question?.id, expected);
});

Then('the review question prompt names {string}', function (this: ReviewWorld, expected: string) {
  assert.ok(response(this).question?.prompt.includes(expected), response(this).question?.prompt);
});

Then(
  'the review question offers {string} and recommends {string}',
  function (this: ReviewWorld, options: string, recommended: string) {
    const question = response(this).question;
    assert.deepEqual(question?.options.map((option) => option.id), options.split(', '));
    assert.equal(question?.recommendedOptionId, recommended);
  }
);

Then('the review flow step {string} is not completed', function (this: ReviewWorld, id: string) {
  assert.notEqual(response(this).steps.find((step) => step.id === id)?.status, 'completed');
});

Then('the review flow step {string} is completed', function (this: ReviewWorld, id: string) {
  assert.equal(response(this).steps.find((step) => step.id === id)?.status, 'completed');
});

Then('the review flow next step is {string}', function (this: ReviewWorld, expected: string) {
  assert.equal(response(this).nextStep?.id, expected);
});

Then('the review flow step prompt contains {string}', function (this: ReviewWorld, expected: string) {
  assert.ok(response(this).nextStep?.prompt?.includes(expected), `prompt should contain: ${expected}`);
});

Then('the review flow artifact {string} still exists', async function (this: ReviewWorld, file: string) {
  await fs.access(path.join(this.flowTaskDir, file));
});

Then('the review flow owned paths are {string}', function (this: ReviewWorld, expected: string) {
  assert.deepEqual(response(this).execution?.ownedPaths, expected.split(','));
});
