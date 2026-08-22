import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getFlowNext, WORKFLOW_STATE_FILE } from '../../../src/commands/workflow/flow.js';
import {
  parseCommitCompletion,
  parseSummaryCompletion,
  runCommand,
} from '../../../src/commands/workflow/run.js';
import type {
  HarnessRunRequest,
  HarnessRunResult,
  RunnerLookup,
} from '../../../src/commands/workflow/harness-runners.js';

const PASS_DESIGN_REVIEW = '---\ntype: design-review\nverdict: PASS\n---\n\n# Design Review\n';
const FAIL_DESIGN_REVIEW =
  '---\ntype: design-review\nverdict: FAIL\n---\n\n# Design Review\n\n- revise the design\n';
const FAIL_DESIGN_REVIEW_WITH_DECISIONS =
  '---\ntype: design-review\nverdict: FAIL\n---\n\n# Design Review\n\n' +
  '## Human Decisions Required\n\n- Choose between approach A and approach B.\n';
const PASS_VALIDATION = '---\nverdict: PASS\n---\n\n# Validation\n';
const FAIL_VALIDATION =
  '---\nverdict: FAIL\n---\n\n# Validation\n\n## Blocking Findings\n\n- something broke\n';

const BASE_SKILL_SEQUENCE = [
  'spok-validate-problem',
  'spok-create-research-questions',
  'spok-create-research',
  'spok-create-design-discussion',
  'spok-create-structure-outline',
  'spok-review-design',
  'spok-create-plan',
  'spok-implement-plan',
  'spok-simplify',
  'spok-validate-implementation',
  'spok-ci-commit',
];

const HYBRID_RUNNER_SEQUENCE = [
  'codex',
  'codex',
  'codex',
  'claude',
  'claude',
  'codex',
  'claude',
  'codex',
  'claude',
  'claude',
  'codex',
];

const FILE_OUTPUT_BY_SKILL: Record<string, string> = {
  'spok-validate-problem': 'problem-validation.md',
  'spok-create-research-questions': 'research-questions.md',
  'spok-create-research': 'research.md',
  'spok-create-design-discussion': 'design-discussion.md',
  'spok-create-structure-outline': 'structure-outline.md',
  'spok-review-design': 'design-review.md',
  'spok-create-plan': 'plan.md',
  'spok-validate-implementation': 'validation.md',
};

interface Dispatch {
  skill: string;
  runner: 'claude' | 'codex';
  request: HarnessRunRequest;
}

/** Skill name from the prompt's `Call the \`<skill>\` skill ...` sentence. */
function skillFromPrompt(prompt: string): string {
  const match = prompt.match(/Call the `([a-z-]+)` skill/);
  if (!match) throw new Error(`No skill found in prompt: ${prompt.slice(0, 120)}`);
  return match[1]!;
}

function defaultArtifact(skill: string): string {
  if (skill === 'spok-validate-problem') {
    return '# Problem Validation\n\n## Flow Decision\n\nproceed\n';
  }
  if (skill === 'spok-review-design') return PASS_DESIGN_REVIEW;
  if (skill === 'spok-validate-implementation') return PASS_VALIDATION;
  return `# ${skill}\n`;
}

interface FakeHarnessOptions {
  taskDir: string;
  workRoot: string;
  /** Per-skill overrides: return the final message, or a failure. */
  overrides?: Record<string, (request: HarnessRunRequest) => Promise<HarnessRunResult>>;
  /** Artifact content overrides keyed by skill (e.g. a FAIL design review). */
  artifactBySkill?: Record<string, string | string[]>;
}

/**
 * A fake harness that performs each step's side effects the way a real
 * subagent would: writes the expected artifact for file steps, replies with
 * summary/Work root/Commit lines for the others. Records every dispatch.
 */
function createFakeHarness(options: FakeHarnessOptions) {
  const dispatches: Dispatch[] = [];
  const artifactUse = new Map<string, number>();

  const run =
    (runner: 'claude' | 'codex') =>
    async (request: HarnessRunRequest): Promise<HarnessRunResult> => {
      const skill = skillFromPrompt(request.prompt);
      dispatches.push({ skill, runner, request });

      const override = options.overrides?.[skill];
      if (override) return override(request);

      const fileName = FILE_OUTPUT_BY_SKILL[skill];
      if (fileName) {
        const configured = options.artifactBySkill?.[skill];
        const useIndex = artifactUse.get(skill) ?? 0;
        artifactUse.set(skill, useIndex + 1);
        const content = Array.isArray(configured)
          ? configured[Math.min(useIndex, configured.length - 1)]!
          : (configured ?? defaultArtifact(skill));
        await fs.writeFile(path.join(options.taskDir, fileName), content, 'utf-8');
        return { ok: true, finalMessage: path.join(options.taskDir, fileName) };
      }

      if (skill === 'spok-implement-plan') {
        return { ok: true, finalMessage: `Implemented the plan.\nWork root: ${options.workRoot}` };
      }
      if (skill === 'spok-simplify') {
        return { ok: true, finalMessage: 'Simplified the implementation.' };
      }
      if (skill === 'spok-repair') {
        return { ok: true, finalMessage: 'Fixed the blocking findings.' };
      }
      if (skill === 'spok-ci-commit') {
        const sha = execFileSync('git', ['-C', options.workRoot, 'rev-parse', 'HEAD'], {
          encoding: 'utf-8',
        }).trim();
        return { ok: true, finalMessage: `Committed the chunk.\nCommit: ${sha}` };
      }
      throw new Error(`Fake harness has no behavior for skill ${skill}`);
    };

  const lookup: RunnerLookup = (runner) => ({ run: run(runner) });
  return { lookup, dispatches };
}

/** Captures console.log lines; JSONL assertions parse them per line. */
function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, restore: () => spy.mockRestore() };
}

function parseEvents(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('spok run loop', () => {
  let tempDir: string;
  let taskDir: string;
  let workRoot: string;
  let headSha: string;
  let originalCodexHome: string | undefined;
  let originalFlowProfile: string | undefined;

  function git(args: string[]): string {
    return execFileSync('git', ['-C', workRoot, ...args], { encoding: 'utf-8' }).trim();
  }

  function fakeHarness(options: Omit<FakeHarnessOptions, 'taskDir' | 'workRoot'> = {}) {
    return createFakeHarness({ taskDir, workRoot, ...options });
  }

  async function readState(): Promise<{
    steps: Array<{ id: string; status: string; result?: Record<string, string> }>;
  }> {
    return JSON.parse(await fs.readFile(path.join(taskDir, WORKFLOW_STATE_FILE), 'utf-8'));
  }

  const MEMORY_WITH_MALFORMED_BULLET =
    '# Memory\n\n- `good` — A conforming rule.\n- `broken` missing the dash entirely.\n';

  /** Enables memory reading: the project root is found via spok/config.yaml. */
  async function writeMemoryFixture(text: string): Promise<void> {
    const configDir = path.join(tempDir, 'spok');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n', 'utf-8');
    await fs.writeFile(path.join(configDir, 'MEMORY.md'), text, 'utf-8');
  }

  beforeEach(async () => {
    originalCodexHome = process.env.CODEX_HOME;
    originalFlowProfile = process.env.SPOK_FLOW_PROFILE;
    delete process.env.CODEX_HOME;
    delete process.env.SPOK_FLOW_PROFILE;

    tempDir = path.join(os.tmpdir(), `spok-run-${randomUUID()}`);
    taskDir = path.join(tempDir, 'spok', 'changes', 'demo', '.flow', 'chunk-one');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, 'ticket.md'), '# Chunk One\n', 'utf-8');

    workRoot = path.join(tempDir, 'work-repo');
    await fs.mkdir(workRoot, { recursive: true });
    execFileSync('git', ['init', '-b', 'main', workRoot], { encoding: 'utf-8' });
    git(['config', 'user.email', 'flow@example.com']);
    git(['config', 'user.name', 'Flow Test']);
    await fs.writeFile(path.join(workRoot, 'work.txt'), 'one\n', 'utf-8');
    git(['add', 'work.txt']);
    git(['commit', '--no-gpg-sign', '-m', 'first']);
    headSha = git(['rev-parse', 'HEAD']);
  });

  afterEach(async () => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    if (originalFlowProfile === undefined) {
      delete process.env.SPOK_FLOW_PROFILE;
    } else {
      process.env.SPOK_FLOW_PROFILE = originalFlowProfile;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('drives every step in order and exits 0', async () => {
    const fake = fakeHarness();

    const code = await runCommand(taskDir, {}, fake.lookup);

    expect(code).toBe(0);
    expect(fake.dispatches.map((dispatch) => dispatch.skill)).toEqual(BASE_SKILL_SEQUENCE);

    const state = await readState();
    expect(state.steps.every((step) => step.status === 'completed')).toBe(true);
    const recordedWorkRoot = state.steps.find((step) => step.id === 'implement')?.result?.workRoot;
    expect(recordedWorkRoot && realpathSync.native(recordedWorkRoot)).toBe(
      realpathSync.native(workRoot)
    );
    expect(state.steps.find((step) => step.id === 'commit')?.result?.commit).toBe(headSha);
  });

  it('dispatches each step to the runner its profile routing selects', async () => {
    const fake = fakeHarness();

    const code = await runCommand(taskDir, { profile: 'hybrid' }, fake.lookup);

    expect(code).toBe(0);
    expect(fake.dispatches.map((dispatch) => dispatch.runner)).toEqual(HYBRID_RUNNER_SEQUENCE);
  });

  it('asks the commit step for a parseable commit line', async () => {
    const fake = fakeHarness();

    await runCommand(taskDir, {}, fake.lookup);

    const commit = fake.dispatches.find((dispatch) => dispatch.skill === 'spok-ci-commit');
    expect(commit?.request.prompt).toContain('`Commit: <sha>`');
  });

  it('restores the flow profile environment variable after a run', async () => {
    const fake = fakeHarness();

    await runCommand(taskDir, { profile: 'hybrid' }, fake.lookup);

    expect(process.env.SPOK_FLOW_PROFILE).toBeUndefined();
  });

  it('exits 2 without dispatching when the state machine blocks the first query', async () => {
    await getFlowNext(taskDir); // Persists state under the detected claude profile.
    const fake = fakeHarness();

    const code = await runCommand(taskDir, { profile: 'codex' }, fake.lookup);

    expect(code).toBe(2);
    expect(fake.dispatches).toEqual([]);
  });

  it('exits 2 and stops when recording a completion blocks the flow', async () => {
    const fake = fakeHarness({
      artifactBySkill: { 'spok-review-design': FAIL_DESIGN_REVIEW },
    });

    const code = await runCommand(taskDir, {}, fake.lookup);

    expect(code).toBe(2);
    expect(fake.dispatches.filter((dispatch) => dispatch.skill === 'spok-review-design')).toHaveLength(1);
    expect(fake.dispatches.at(-1)?.skill).toBe('spok-review-design');
  });

  it('exits 3 and resumes when a file step exits 0 without writing its artifact', async () => {
    const fake = fakeHarness({
      overrides: {
        'spok-create-research': async () => ({ ok: true, finalMessage: 'claimed done' }),
      },
    });

    expect(await runCommand(taskDir, {}, fake.lookup)).toBe(3);
    expect((await getFlowNext(taskDir)).nextStep?.id).toBe('research');

    const resumed = fakeHarness();
    expect(await runCommand(taskDir, {}, resumed.lookup)).toBe(0);
    expect(resumed.dispatches[0]?.skill).toBe('spok-create-research');
  });

  it('exits 3 on a harness failure and resumes at the same step', async () => {
    const failing = fakeHarness({
      overrides: {
        'spok-create-research': async () => ({ ok: false, reason: 'boom' }),
      },
    });

    expect(await runCommand(taskDir, {}, failing.lookup)).toBe(3);
    expect((await getFlowNext(taskDir)).nextStep?.id).toBe('research');

    const resumed = fakeHarness();
    expect(await runCommand(taskDir, {}, resumed.lookup)).toBe(0);
    expect(resumed.dispatches[0]?.skill).toBe('spok-create-research');
  });

  it('exits 3 when a summary step returns no summary text', async () => {
    const fake = fakeHarness({
      overrides: {
        'spok-implement-plan': async () => ({ ok: true, finalMessage: '   ' }),
      },
    });

    expect(await runCommand(taskDir, {}, fake.lookup)).toBe(3);
    expect((await getFlowNext(taskDir)).nextStep?.id).toBe('implement');
  });

  it('exits 3 when the commit step returns no commit line', async () => {
    const fake = fakeHarness({
      overrides: {
        'spok-ci-commit': async () => ({ ok: true, finalMessage: 'Committed the chunk.' }),
      },
    });

    expect(await runCommand(taskDir, {}, fake.lookup)).toBe(3);
    expect((await getFlowNext(taskDir)).nextStep?.id).toBe('commit');
  });

  it('emits a parseable JSONL event stream for a full --json run', async () => {
    const fake = fakeHarness();
    const capture = captureStdout();
    try {
      const code = await runCommand(taskDir, { profile: 'hybrid', json: true }, fake.lookup);
      expect(code).toBe(0);

      const events = parseEvents(capture.lines); // Throws if any line is not JSON.
      expect(events.every((event) => event.schemaVersion === 1)).toBe(true);
      expect(events[0]).toMatchObject({ event: 'run_started', taskDir, profile: 'hybrid' });
      const names = events.map((event) => event.event);
      expect(names.filter((name) => name === 'step_started')).toHaveLength(11);
      expect(names.filter((name) => name === 'step_completed')).toHaveLength(11);
      expect(events.at(-1)).toMatchObject({ event: 'complete', commit: headSha });
    } finally {
      capture.restore();
    }
  });

  it('emits step_failed with the failing step and reason on a harness failure', async () => {
    const fake = fakeHarness({
      overrides: { 'spok-create-research': async () => ({ ok: false, reason: 'boom' }) },
    });
    const capture = captureStdout();
    try {
      expect(await runCommand(taskDir, { json: true }, fake.lookup)).toBe(3);
      expect(parseEvents(capture.lines).at(-1)).toMatchObject({
        event: 'step_failed',
        step: 'research',
        reason: 'Step research failed: boom',
      });
    } finally {
      capture.restore();
    }
  });

  it('emits step_failed on a completion-contract violation', async () => {
    const fake = fakeHarness({
      overrides: {
        'spok-ci-commit': async () => ({ ok: true, finalMessage: 'Committed the chunk.' }),
      },
    });
    const capture = captureStdout();
    try {
      expect(await runCommand(taskDir, { json: true }, fake.lookup)).toBe(3);
      const last = parseEvents(capture.lines).at(-1);
      expect(last).toMatchObject({ event: 'step_failed', step: 'commit' });
      expect(last?.reason).toContain('Commit: <sha>');
    } finally {
      capture.restore();
    }
  });

  it('emits run_started then blocked with a code when the first query blocks', async () => {
    await getFlowNext(taskDir); // Persists state under the detected claude profile.
    const fake = fakeHarness();
    const capture = captureStdout();
    try {
      expect(await runCommand(taskDir, { profile: 'codex', json: true }, fake.lookup)).toBe(2);
      const events = parseEvents(capture.lines);
      expect(events[0]?.event).toBe('run_started');
      expect(events[1]).toMatchObject({ event: 'blocked', code: 'flow_profile_mismatch' });
    } finally {
      capture.restore();
    }
  });

  it('keeps the human-readable output free of JSON without --json', async () => {
    const fake = fakeHarness();
    const capture = captureStdout();
    try {
      expect(await runCommand(taskDir, {}, fake.lookup)).toBe(0);
      expect(capture.lines[0]).toMatch(/^\[1\/11\] validate-problem /);
      expect(capture.lines.at(-1)).toBe(`Flow complete: ${taskDir}`);
      expect(capture.lines.some((line) => line.startsWith('{'))).toBe(false);
    } finally {
      capture.restore();
    }
  });

  it('attaches humanDecisions to a design-review FAIL blocked event', async () => {
    const fake = fakeHarness({
      artifactBySkill: { 'spok-review-design': FAIL_DESIGN_REVIEW_WITH_DECISIONS },
    });
    const capture = captureStdout();
    try {
      expect(await runCommand(taskDir, { json: true }, fake.lookup)).toBe(2);
      expect(parseEvents(capture.lines).at(-1)).toMatchObject({
        event: 'blocked',
        code: 'design_review_verdict_fail',
        humanDecisions: '- Choose between approach A and approach B.',
      });
    } finally {
      capture.restore();
    }
  });

  it('omits humanDecisions when the design review has no such section', async () => {
    const fake = fakeHarness({
      artifactBySkill: { 'spok-review-design': FAIL_DESIGN_REVIEW },
    });
    const capture = captureStdout();
    try {
      expect(await runCommand(taskDir, { json: true }, fake.lookup)).toBe(2);
      const last = parseEvents(capture.lines).at(-1);
      expect(last).toMatchObject({ event: 'blocked', code: 'design_review_verdict_fail' });
      expect(last).not.toHaveProperty('humanDecisions');
    } finally {
      capture.restore();
    }
  });

  it('omits humanDecisions for non-design-review block codes', async () => {
    await fs.writeFile(
      path.join(taskDir, 'design-review.md'),
      FAIL_DESIGN_REVIEW_WITH_DECISIONS,
      'utf-8'
    );
    await getFlowNext(taskDir); // Persists claude-profile state; next run mismatches.
    const capture = captureStdout();
    try {
      expect(await runCommand(taskDir, { profile: 'codex', json: true }, fakeHarness().lookup)).toBe(
        2
      );
      const last = parseEvents(capture.lines).at(-1);
      expect(last).toMatchObject({ event: 'blocked', code: 'flow_profile_mismatch' });
      expect(last).not.toHaveProperty('humanDecisions');
    } finally {
      capture.restore();
    }
  });

  describe('warning relay', () => {
    it('emits one warning JSONL event per distinct warning text across the run', async () => {
      await writeMemoryFixture(MEMORY_WITH_MALFORMED_BULLET);
      const fake = fakeHarness();
      const capture = captureStdout();
      try {
        expect(await runCommand(taskDir, { json: true }, fake.lookup)).toBe(0);
        const events = parseEvents(capture.lines);
        expect(events[0]).toMatchObject({ event: 'run_started' });
        const warnings = events.filter((event) => event.event === 'warning');
        expect(warnings).toHaveLength(1); // Deduped across every loop iteration.
        expect(warnings[0]).toMatchObject({ schemaVersion: 1, event: 'warning' });
        expect(String(warnings[0]?.message)).toContain(
          '1 bullet(s) dropped for not matching the rule grammar'
        );
      } finally {
        capture.restore();
      }
    });

    it('prints one Warning line in human mode', async () => {
      await writeMemoryFixture(MEMORY_WITH_MALFORMED_BULLET);
      const fake = fakeHarness();
      const capture = captureStdout();
      try {
        expect(await runCommand(taskDir, {}, fake.lookup)).toBe(0);
        const warningLines = capture.lines.filter((line) => line.startsWith('Warning: '));
        expect(warningLines).toHaveLength(1);
        expect(warningLines[0]).toContain('bullet(s) dropped');
        expect(capture.lines.some((line) => line.startsWith('{'))).toBe(false);
      } finally {
        capture.restore();
      }
    });

    it('relays the work-root warning when no work root reaches the commit step', async () => {
      const fake = fakeHarness({
        overrides: {
          // No trailing `Work root:` line: the commit step arrives unsteered.
          'spok-implement-plan': async () => ({ ok: true, finalMessage: 'Implemented the plan.' }),
        },
      });
      const capture = captureStdout();
      try {
        expect(await runCommand(taskDir, { json: true }, fake.lookup)).toBe(0);
        const warnings = parseEvents(capture.lines).filter((event) => event.event === 'warning');
        expect(warnings).toHaveLength(1);
        expect(String(warnings[0]?.message)).toContain('No work root was recorded');
      } finally {
        capture.restore();
      }
    });

    it('emits no warning events when responses carry no warnings', async () => {
      const fake = fakeHarness();
      const capture = captureStdout();
      try {
        expect(await runCommand(taskDir, { json: true }, fake.lookup)).toBe(0);
        expect(parseEvents(capture.lines).some((event) => event.event === 'warning')).toBe(false);
      } finally {
        capture.restore();
      }
    });
  });

  it('continues into the repair cycle when validation records a FAIL with budget left', async () => {
    const fake = fakeHarness({
      artifactBySkill: {
        'spok-validate-implementation': [FAIL_VALIDATION, PASS_VALIDATION],
      },
    });

    const code = await runCommand(taskDir, {}, fake.lookup);

    expect(code).toBe(0);
    expect(fake.dispatches.map((dispatch) => dispatch.skill)).toEqual([
      ...BASE_SKILL_SEQUENCE.slice(0, 10),
      'spok-repair',
      'spok-validate-implementation',
      'spok-ci-commit',
    ]);
  });
});

describe('harness completion contract parsing', () => {
  it('records a plain reply as the summary', () => {
    expect(parseSummaryCompletion('Did the work.')).toEqual({ summary: 'Did the work.' });
  });

  it('splits a trailing work root line from the summary', () => {
    expect(parseSummaryCompletion('Did the work.\n\nWork root: /tmp/repo')).toEqual({
      summary: 'Did the work.',
      workRoot: '/tmp/repo',
    });
  });

  it('rejects a reply that is only a work root line', () => {
    expect(parseSummaryCompletion('Work root: /tmp/repo')).toBeUndefined();
  });

  it('rejects an empty reply', () => {
    expect(parseSummaryCompletion('   \n  ')).toBeUndefined();
  });

  it('caps an oversized summary at 4000 characters', () => {
    expect(parseSummaryCompletion('x'.repeat(5000))?.summary).toHaveLength(4000);
  });

  it('reads a trailing commit line with the body as its summary', () => {
    expect(parseCommitCompletion('Committed the chunk.\nCommit: abc123')).toEqual({
      commit: 'abc123',
      summary: 'Committed the chunk.',
    });
  });

  it('reads a bare commit line without a summary', () => {
    expect(parseCommitCompletion('Commit: abc123')).toEqual({
      commit: 'abc123',
      summary: undefined,
    });
  });

  it('rejects a reply with no commit line', () => {
    expect(parseCommitCompletion('Committed the chunk.')).toBeUndefined();
  });

  it('tolerates markdown decoration around the commit token', () => {
    expect(parseCommitCompletion('Done.\n**Commit:** `abc123`.')).toEqual({
      commit: 'abc123',
      summary: 'Done.',
    });
  });

  it('tolerates backticks around the work root path', () => {
    expect(parseSummaryCompletion('Did the work.\nWork root: `/repo/path`')).toEqual({
      summary: 'Did the work.',
      workRoot: '/repo/path',
    });
  });
});
