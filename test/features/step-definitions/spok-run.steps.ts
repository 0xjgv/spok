import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

interface SpokRunWorld {
  projectDir?: string;
  flowTaskDir?: string;
  flowWorkRoot?: string;
  flowHeadCommit?: string;
  runBinDir?: string;
  runDesignReview?: string;
  runFailMarker?: string;
  cliResult?: RunCLIResult;
}

const EXPECTED_STEP_ORDER = [
  'validate-problem',
  'research-questions',
  'research',
  'design-discussion',
  'structure-outline',
  'design-review',
  'plan',
  'implement',
  'simplify',
  'validate',
  'commit',
];

/**
 * Stands in for a real harness: reads the composed prompt on stdin, writes the
 * artifact the step's gate requires, and replies with the completion contract.
 * The research-questions arm must precede the research arm — the shorter skill
 * name is a substring of the longer one.
 */
const STUB_HARNESS = String.raw`#!/bin/sh
prompt=$(cat)

if [ -n "$STUB_FAIL_MARKER" ]; then
  case "$prompt" in
    *"$STUB_FAIL_MARKER"*)
      echo "stub harness failure" >&2
      exit 1
      ;;
  esac
fi

case "$prompt" in
  *spok-validate-problem*)
    printf '# Problem Validation\n\n## Flow Decision\n\nproceed\n' > "$STUB_TASK_DIR/problem-validation.md"
    echo "$STUB_TASK_DIR/problem-validation.md"
    ;;
  *spok-create-research-questions*)
    printf '# Research Questions\n' > "$STUB_TASK_DIR/research-questions.md"
    echo "$STUB_TASK_DIR/research-questions.md"
    ;;
  *spok-create-research*)
    printf '# Research\n' > "$STUB_TASK_DIR/research.md"
    echo "$STUB_TASK_DIR/research.md"
    ;;
  *spok-create-design-discussion*)
    printf '# Design Discussion\n' > "$STUB_TASK_DIR/design-discussion.md"
    echo "$STUB_TASK_DIR/design-discussion.md"
    ;;
  *spok-create-structure-outline*)
    printf '# Structure Outline\n' > "$STUB_TASK_DIR/structure-outline.md"
    echo "$STUB_TASK_DIR/structure-outline.md"
    ;;
  *spok-review-design*)
    if [ "$STUB_DESIGN_REVIEW" = "FAIL" ]; then
      printf -- '---\ntype: design-review\nverdict: FAIL\n---\n\n# Design Review\n\n## Human Decisions Required\n\n- Pick a direction for the API.\n' > "$STUB_TASK_DIR/design-review.md"
    else
      printf -- '---\ntype: design-review\nverdict: PASS\n---\n\n# Design Review\n' > "$STUB_TASK_DIR/design-review.md"
    fi
    echo "$STUB_TASK_DIR/design-review.md"
    ;;
  *spok-create-plan*)
    printf '# Plan\n' > "$STUB_TASK_DIR/plan.md"
    echo "$STUB_TASK_DIR/plan.md"
    ;;
  *spok-implement-plan*)
    echo "Implemented the plan."
    echo "Work root: $STUB_WORK_ROOT"
    ;;
  *spok-simplify*)
    echo "Simplified the implementation."
    ;;
  *spok-validate-implementation*)
    printf -- '---\nverdict: PASS\n---\n\n# Validation\n' > "$STUB_TASK_DIR/validation.md"
    echo "$STUB_TASK_DIR/validation.md"
    ;;
  *spok-ci-commit*)
    echo "Committed the chunk."
    echo "Commit: $(git -C "$STUB_WORK_ROOT" rev-parse HEAD)"
    ;;
  *)
    echo "stub harness cannot handle this prompt" >&2
    exit 1
    ;;
esac
`;

function stubEnv(world: SpokRunWorld): NodeJS.ProcessEnv {
  return {
    PATH: `${world.runBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    SPOK_FLOW_PROFILE: 'claude',
    STUB_TASK_DIR: world.flowTaskDir,
    STUB_WORK_ROOT: world.flowWorkRoot,
    STUB_DESIGN_REVIEW: world.runDesignReview ?? 'PASS',
    STUB_FAIL_MARKER: world.runFailMarker ?? '',
  };
}

async function invokeRun(world: SpokRunWorld, args: string[]): Promise<void> {
  assert.ok(world.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(world.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  world.cliResult = await runCLI(['run', world.flowTaskDir, ...args], {
    cwd: world.projectDir,
    env: stubEnv(world),
    timeoutMs: 60_000,
  });
}

/** Step ids in the order the run reported dispatching them. */
function dispatchedSteps(world: SpokRunWorld): string[] {
  assert.ok(world.cliResult, 'cliResult must be set by a spok run step');
  return world.cliResult.stdout
    .split('\n')
    .map((line) => line.match(/^\[\d+\/\d+\] (\S+) /))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1]!);
}

/** Parsed JSONL events from the run's stdout; throws on a non-JSON line. */
function stdoutEvents(world: SpokRunWorld): Array<Record<string, unknown>> {
  assert.ok(world.cliResult, 'cliResult must be set by a spok run step');
  return world.cliResult.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

Given('a stub harness on PATH', async function (this: SpokRunWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  this.runBinDir = path.join(this.projectDir, 'stub-bin');
  await fs.mkdir(this.runBinDir, { recursive: true });
  const stubPath = path.join(this.runBinDir, 'claude');
  await fs.writeFile(stubPath, STUB_HARNESS, 'utf-8');
  await fs.chmod(stubPath, 0o755);
});

Given('the stub harness records a FAIL design review', function (this: SpokRunWorld) {
  this.runDesignReview = 'FAIL';
});

Given('the stub harness fails on the research step', function (this: SpokRunWorld) {
  this.runFailMarker = 'Call the `spok-create-research` skill';
});

Given('the stub harness is repaired', function (this: SpokRunWorld) {
  this.runFailMarker = undefined;
});

Given(
  'the staged flow task has persisted workflow state under the claude profile',
  async function (this: SpokRunWorld) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
    const result = await runCLI(['flow', 'next', this.flowTaskDir, '--json'], {
      cwd: this.projectDir,
      env: stubEnv(this),
    });
    assert.equal(result.exitCode, 0, result.stderr);
  }
);

When(
  'I run spok run on the staged flow task',
  { timeout: 90_000 },
  async function (this: SpokRunWorld) {
    await invokeRun(this, []);
  }
);

When(
  'I run spok run on the staged flow task with profile {string}',
  { timeout: 90_000 },
  async function (this: SpokRunWorld, profile: string) {
    await invokeRun(this, ['--profile', profile]);
  }
);

When(
  'I run spok run on the staged flow task with the --json flag',
  { timeout: 90_000 },
  async function (this: SpokRunWorld) {
    await invokeRun(this, ['--json']);
  }
);

Then('the spok run exits with code {int}', function (this: SpokRunWorld, expected: number) {
  assert.ok(this.cliResult, 'cliResult must be set by a spok run step');
  assert.equal(
    this.cliResult.exitCode,
    expected,
    `stdout:\n${this.cliResult.stdout}\nstderr:\n${this.cliResult.stderr}`
  );
});

Then('the spok run reports each dispatched step in order', function (this: SpokRunWorld) {
  assert.deepEqual(dispatchedSteps(this), EXPECTED_STEP_ORDER);
});

Then('the spok run resumed at the research step', function (this: SpokRunWorld) {
  assert.equal(dispatchedSteps(this)[0], 'research');
});

Then('the spok run reports a blocked reason containing {string}', function (
  this: SpokRunWorld,
  expected: string
) {
  assert.ok(this.cliResult, 'cliResult must be set by a spok run step');
  const blocked = this.cliResult.stdout
    .split('\n')
    .find((line) => line.startsWith('Blocked: '));
  assert.ok(blocked, `stdout should carry a blocked line:\n${this.cliResult.stdout}`);
  assert.ok(blocked.includes(expected), `blocked reason should contain: ${expected}\n${blocked}`);
});

Then('every spok run stdout line is JSON with schema version 1', function (this: SpokRunWorld) {
  const events = stdoutEvents(this);
  assert.ok(events.length > 0, 'stdout should carry at least one event line');
  for (const event of events) {
    assert.equal(event.schemaVersion, 1);
  }
});

Then('the spok run event stream reports the full flow lifecycle', function (this: SpokRunWorld) {
  const events = stdoutEvents(this);
  assert.equal(events[0]?.event, 'run_started');
  const started = events.filter((e) => e.event === 'step_started').map((e) => e.step);
  const completed = events.filter((e) => e.event === 'step_completed').map((e) => e.step);
  assert.deepEqual(started, EXPECTED_STEP_ORDER);
  assert.deepEqual(completed, EXPECTED_STEP_ORDER);
  const last = events.at(-1);
  assert.equal(last?.event, 'complete');
  assert.equal(last?.commit, this.flowHeadCommit);
});

Then(
  'the spok run event stream ends with a blocked event carrying code {string}',
  function (this: SpokRunWorld, code: string) {
    const last = stdoutEvents(this).at(-1);
    assert.equal(last?.event, 'blocked');
    assert.equal(last?.code, code);
    assert.ok(typeof last?.reason === 'string' && last.reason.includes('recorded a FAIL verdict'));
  }
);

Then('the blocked event carries the human decisions from the design review', function (
  this: SpokRunWorld
) {
  const last = stdoutEvents(this).at(-1);
  assert.equal(last?.humanDecisions, '- Pick a direction for the API.');
});

Then('the workflow state records the commit step as completed', async function (this: SpokRunWorld) {
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  const state = JSON.parse(
    await fs.readFile(path.join(this.flowTaskDir, 'workflow-state.json'), 'utf-8')
  ) as { steps: Array<{ id: string; status: string; result?: { commit?: string } }> };
  const commit = state.steps.find((step) => step.id === 'commit');
  assert.equal(commit?.status, 'completed');
  assert.equal(commit?.result?.commit, this.flowHeadCommit);
});

Then('the staged flow task has no workflow state file', async function (this: SpokRunWorld) {
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  await assert.rejects(fs.access(path.join(this.flowTaskDir, 'workflow-state.json')));
});
