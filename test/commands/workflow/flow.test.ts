import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/commands/workflow/harness-routing.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/commands/workflow/harness-routing.js')>()),
  probeHarnesses: vi.fn(),
}));

import {
  probeHarnesses,
  type CapabilityReport,
} from '../../../src/commands/workflow/harness-routing.js';
import {
  completeFlowStep,
  flowCompleteCommand,
  flowNextCommand,
  flowStatusCommand,
  getFlowEventLogPath,
  getFlowNext,
  getFlowStatus,
  type FlowStep,
  WORKFLOW_STATE_FILE,
} from '../../../src/commands/workflow/flow.js';

const OMP_THINKING = ['low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_HARNESS_ENV = [
  'CODEX_HOME',
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
  'CODEX_SHELL',
] as const;
type CodexHarnessEnv = (typeof CODEX_HARNESS_ENV)[number];

const ALL_HARNESSES_AVAILABLE: CapabilityReport[] = [
  { runner: 'codex', available: true },
  { runner: 'claude', available: true },
  {
    runner: 'omp',
    available: true,
    models: new Map([
      ['openai-codex/gpt-5.6-sol', OMP_THINKING],
      ['openai-codex/gpt-5.6-terra', OMP_THINKING],
    ]),
  },
];
const CODEX_LOGGED_OUT: CapabilityReport = {
  runner: 'codex',
  available: false,
  code: 'not_authenticated',
  reason: 'codex login status reported: Not logged in',
};
const CLAUDE_LOGGED_OUT: CapabilityReport = {
  runner: 'claude',
  available: false,
  code: 'not_authenticated',
  reason: 'claude auth status --json reports loggedIn is not true.',
};
const NOTHING_AVAILABLE: CapabilityReport[] = [
  {
    runner: 'codex',
    available: false,
    code: 'executable_missing',
    reason: 'codex is not installed or not on PATH.',
  },
  {
    runner: 'omp',
    available: false,
    code: 'executable_missing',
    reason: 'omp is not installed or not on PATH.',
  },
  {
    runner: 'claude',
    available: false,
    code: 'not_authenticated',
    reason: 'claude auth status --json reports loggedIn is not true.',
  },
];

function withCapabilityReports(overrides: CapabilityReport[]): CapabilityReport[] {
  return ALL_HARNESSES_AVAILABLE.map(
    (report) => overrides.find((override) => override.runner === report.runner) ?? report
  );
}

interface FlowHarness {
  readonly projectRoot: string;
  readonly taskDir: string;
  enableSelfLearn(): Promise<void>;
  completeProblemValidation(decision?: string): Promise<void>;
  completeFileStep(step: string, filename: string): Promise<void>;
  completeSummaryStep(step: string, summary: string): Promise<void>;
  advanceToDesignReview(): Promise<void>;
  completeDesignReview(content?: string): ReturnType<typeof completeFlowStep>;
  advanceToValidate(): Promise<void>;
  completeValidate(content: string): ReturnType<typeof completeFlowStep>;
  completeThroughValidation(): Promise<void>;
  completeRepair(summary?: string): Promise<void>;
}

const PASS_VALIDATION = '---\nverdict: PASS\n---\n\n# Validation\n';
const FAIL_VALIDATION =
  '---\nverdict: FAIL\n---\n\n# Validation\n\n## Blocking Findings\n\n- something broke\n';
const PASS_DESIGN_REVIEW = '---\ntype: design-review\nverdict: PASS\n---\n\n# Design Review\n';
const FAIL_DESIGN_REVIEW = '---\ntype: design-review\nverdict: FAIL\n---\n\n# Design Review\n\n- revise the design\n';

const EXPECTED_STEP_ROUTING = [
  { id: 'validate-problem', model: 'opus', effort: 'medium' },
  { id: 'research-questions', model: 'opus', effort: 'medium' },
  { id: 'research', model: 'sonnet', effort: 'medium' },
  { id: 'design-discussion', model: 'fable', effort: 'xhigh' },
  { id: 'structure-outline', model: 'fable', effort: 'xhigh' },
  { id: 'design-review', model: 'opus', effort: 'medium' },
  { id: 'plan', model: 'fable', effort: 'xhigh' },
  { id: 'implement', model: 'opus', effort: 'medium' },
  { id: 'simplify', model: 'opus', effort: undefined },
  { id: 'validate', model: 'fable', effort: 'high' },
  { id: 'commit', model: 'haiku', effort: 'low' },
];

const EXPECTED_SELF_LEARN_STEP_ROUTING = [
  ...EXPECTED_STEP_ROUTING,
  { id: 'self-learn', model: 'sonnet', effort: 'xhigh' },
];

const EXPECTED_HYBRID_STEP_ROUTING = [
  { id: 'validate-problem', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  { id: 'research-questions', runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  { id: 'research', runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  { id: 'design-discussion', runner: 'claude', model: 'fable', effort: 'xhigh' },
  { id: 'structure-outline', runner: 'claude', model: 'fable', effort: 'xhigh' },
  { id: 'design-review', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  { id: 'plan', runner: 'claude', model: 'fable', effort: 'xhigh' },
  { id: 'implement', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  { id: 'simplify', runner: 'claude', model: 'opus', effort: undefined },
  { id: 'validate', runner: 'claude', model: 'opus', effort: 'medium' },
  { id: 'commit', runner: 'codex', model: 'gpt-5.6-terra', effort: 'low' },
];

function expectStepRouting(steps: Array<{ id: string; model?: string; effort?: string }>) {
  expect(steps.map(({ id, model, effort }) => ({ id, model, effort }))).toEqual(
    EXPECTED_STEP_ROUTING
  );
}

function expectSelfLearnStepRouting(steps: Array<{ id: string; model?: string; effort?: string }>) {
  expect(steps.map(({ id, model, effort }) => ({ id, model, effort }))).toEqual(
    EXPECTED_SELF_LEARN_STEP_ROUTING
  );
}

async function readFlowEvents(taskDir: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(getFlowEventLogPath(taskDir), 'utf-8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function routing(step: FlowStep | undefined) {
  return { runner: step?.runner, model: step?.model, effort: step?.effort, route: step?.route };
}

async function writeMemory(projectRoot: string, text: string): Promise<void> {
  const configDir = path.join(projectRoot, 'spok');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n', 'utf-8');
  await fs.writeFile(path.join(configDir, 'MEMORY.md'), text, 'utf-8');
}

function useFlowHarness(options: { linkedWorktree?: boolean } = {}): FlowHarness {
  let tempDir: string;
  let taskDir: string;
  let originalCodexHarnessEnv: Record<CodexHarnessEnv, string | undefined>;
  let originalFlowProfile: string | undefined;

  beforeEach(async () => {
    originalCodexHarnessEnv = Object.fromEntries(
      CODEX_HARNESS_ENV.map((name) => [name, process.env[name]])
    ) as Record<CodexHarnessEnv, string | undefined>;
    originalFlowProfile = process.env.SPOK_FLOW_PROFILE;
    for (const name of CODEX_HARNESS_ENV) delete process.env[name];
    delete process.env.SPOK_FLOW_PROFILE;
    vi.mocked(probeHarnesses).mockReset().mockResolvedValue(ALL_HARNESSES_AVAILABLE);
    tempDir = path.join(os.tmpdir(), `spok-flow-${randomUUID()}`);
    let routingRoot = tempDir;
    if (options.linkedWorktree) {
      const primary = path.join(tempDir, 'primary');
      await fs.mkdir(primary, { recursive: true });
      execFileSync('git', ['init', '-b', 'main', primary]);
      const git = (args: string[]) => execFileSync('git', ['-C', primary, ...args]);
      git(['config', 'user.email', 'flow@example.com']);
      git(['config', 'user.name', 'Flow Test']);
      await fs.writeFile(path.join(primary, 'seed.txt'), 'seed\n', 'utf-8');
      git(['add', 'seed.txt']);
      git(['commit', '--no-gpg-sign', '-m', 'seed']);
      routingRoot = path.join(tempDir, 'worktree');
      git(['worktree', 'add', routingRoot]);
    }
    taskDir = path.join(routingRoot, 'spok', 'changes', 'demo', '.flow', 'chunk-one');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, 'ticket.md'), '# Chunk One\n', 'utf-8');
  });

  afterEach(async () => {
    for (const name of CODEX_HARNESS_ENV) {
      const value = originalCodexHarnessEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (originalFlowProfile === undefined) {
      delete process.env.SPOK_FLOW_PROFILE;
    } else {
      process.env.SPOK_FLOW_PROFILE = originalFlowProfile;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function enableSelfLearn() {
    await fs.mkdir(path.join(tempDir, 'spok'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'spok', 'config.yaml'),
      'schema: spec-driven\nflow:\n  self_learn: true\n',
      'utf-8'
    );
  }

  async function completeProblemValidation(decision = 'proceed') {
    await getFlowNext(taskDir);
    const output = path.join(taskDir, 'problem-validation.md');
    await fs.writeFile(
      output,
      `# Problem Validation\n\n## Flow Decision\n\n${decision}\n`,
      'utf-8'
    );
    const result = await completeFlowStep(taskDir, { step: 'validate-problem', output });
    expect(result.state).not.toBe('blocked');
  }

  async function completeFileStep(step: string, filename: string) {
    await getFlowNext(taskDir);
    const output = path.join(taskDir, filename);
    await fs.writeFile(output, `# ${step}\n`, 'utf-8');
    const result = await completeFlowStep(taskDir, { step, output });
    expect(result.state).not.toBe('blocked');
  }

  async function completeSummaryStep(step: string, summary: string) {
    await getFlowNext(taskDir);
    const result = await completeFlowStep(taskDir, { step, summary });
    expect(result.state).not.toBe('blocked');
  }

  async function advanceToDesignReview() {
    await completeProblemValidation();
    await completeFileStep('research-questions', 'research-questions.md');
    await completeFileStep('research', 'research.md');
    await completeFileStep('design-discussion', 'design-discussion.md');
    await completeFileStep('structure-outline', 'structure-outline.md');
  }

  async function completeDesignReview(content = PASS_DESIGN_REVIEW) {
    await getFlowNext(taskDir);
    const output = path.join(taskDir, 'design-review.md');
    await fs.writeFile(output, content, 'utf-8');
    return completeFlowStep(taskDir, { step: 'design-review', output });
  }

  async function advanceToValidate() {
    await advanceToDesignReview();
    const designReview = await completeDesignReview();
    expect(designReview.state).not.toBe('blocked');
    await completeFileStep('plan', 'plan.md');
    await completeSummaryStep('implement', 'Implemented the plan.');
    await completeSummaryStep('simplify', 'Simplified the implementation.');
  }

  async function completeValidate(content: string) {
    await getFlowNext(taskDir);
    const output = path.join(taskDir, 'validation.md');
    await fs.writeFile(output, content, 'utf-8');
    return completeFlowStep(taskDir, { step: 'validate', output });
  }

  async function completeThroughValidation() {
    await advanceToValidate();
    const result = await completeValidate(PASS_VALIDATION);
    expect(result.state).not.toBe('blocked');
  }

  async function completeRepair(summary = 'Fixed the blocking findings.') {
    await getFlowNext(taskDir);
    const result = await completeFlowStep(taskDir, { step: 'repair', summary });
    expect(result.state).not.toBe('blocked');
  }

  return {
    get projectRoot() {
      return tempDir;
    },
    get taskDir() {
      return taskDir;
    },
    enableSelfLearn,
    completeProblemValidation,
    completeFileStep,
    completeSummaryStep,
    advanceToDesignReview,
    completeDesignReview,
    advanceToValidate,
    completeValidate,
    completeThroughValidation,
    completeRepair,
  };
}

describe('deterministic workflow step state', () => {
  const flow = useFlowHarness();

  it('returns problem validation as the first step when only ticket.md exists', async () => {
    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.profile).toBe('claude');
    expect(result.step).toMatchObject({
      id: 'validate-problem',
      skill: 'spok-validate-problem',
      runner: 'claude',
      model: 'opus',
      effort: 'medium',
      argument: path.join(flow.taskDir, 'ticket.md'),
      expectedOutput: path.join(flow.taskDir, 'problem-validation.md'),
      status: 'ready',
    });
    expectStepRouting(result.steps);

    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    await expect(fs.stat(statePath)).resolves.toBeTruthy();
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expectStepRouting(state.steps);
  });

  it('records a hidden event when flow next is requested', async () => {
    await getFlowNext(flow.taskDir);

    const events = await readFlowEvents(flow.taskDir);

    expect(events.at(-1)).toMatchObject({
      schemaVersion: 1,
      event: 'flow_next',
      state: 'ready',
      step: 'validate-problem',
    });
    expect(events.at(-1)?.timestamp).toEqual(expect.any(String));
  });

  it('routes every step to GPT-5.6 models with Codex efforts when CODEX_HOME is set', async () => {
    process.env.CODEX_HOME = path.join(os.tmpdir(), `codex-${randomUUID()}`);

    const result = await getFlowNext(flow.taskDir);

    expect(result.profile).toBe('codex');
    expect(result.steps.map(({ id, runner, model, effort }) => ({ id, runner, model, effort }))).toEqual([
      { id: 'validate-problem', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'research-questions', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'research', runner: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
      { id: 'design-discussion', runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
      { id: 'structure-outline', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'design-review', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'plan', runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
      { id: 'implement', runner: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
      { id: 'simplify', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'validate', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'commit', runner: 'codex', model: 'gpt-5.6-terra', effort: 'low' },
    ]);
  });

  it('detects Codex Desktop from CODEX_THREAD_ID without CODEX_HOME', async () => {
    process.env.CODEX_THREAD_ID = `thread-${randomUUID()}`;

    const result = await getFlowNext(flow.taskDir);

    expect(result.profile).toBe('codex');
    expect(result.step).toMatchObject({
      id: 'validate-problem',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
    });
  });

  it('reroutes unfinished default steps when resuming on another primary harness', async () => {
    await flow.completeProblemValidation();
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await flow.completeFileStep('research', 'research.md');

    process.env.CODEX_THREAD_ID = `thread-${randomUUID()}`;
    const result = await getFlowNext(flow.taskDir);

    expect(result.profile).toBe('codex');
    expect(result.steps[0]).toMatchObject({
      id: 'validate-problem',
      status: 'completed',
      runner: 'claude',
      model: 'opus',
    });
    expect(result.step).toMatchObject({
      id: 'design-discussion',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'max',
    });
  });

  it('routes hybrid steps across Codex and Claude', async () => {
    process.env.SPOK_FLOW_PROFILE = 'hybrid';

    const result = await getFlowNext(flow.taskDir);

    expect(result.profile).toBe('hybrid');
    expect(
      result.steps.map(({ id, runner, model, effort }) => ({ id, runner, model, effort }))
    ).toEqual(EXPECTED_HYBRID_STEP_ROUTING);
  });

  it('keeps the stored hybrid profile when the live harness changes', async () => {
    process.env.SPOK_FLOW_PROFILE = 'hybrid';
    await getFlowNext(flow.taskDir);

    delete process.env.SPOK_FLOW_PROFILE;
    process.env.CODEX_HOME = path.join(os.tmpdir(), `codex-${randomUUID()}`);
    const resumed = await getFlowStatus(flow.taskDir);

    expect(resumed.profile).toBe('hybrid');
    expect(resumed.nextStep).toMatchObject({ runner: 'codex', model: 'gpt-5.6-sol' });
  });

  it('blocks an explicit profile change after state creation', async () => {
    process.env.SPOK_FLOW_PROFILE = 'hybrid';
    await getFlowNext(flow.taskDir);
    process.env.SPOK_FLOW_PROFILE = 'claude';

    const result = await getFlowStatus(flow.taskDir);

    expect(result.state).toBe('blocked');
    expect(result.reason).toBe('Flow profile mismatch: state uses hybrid, requested claude.');
  });

});

describe('auto flow profile state', () => {
  const flow = useFlowHarness();

  it('leaves auto-profile steps unrouted on status and writes no state file', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';

    const result = await getFlowStatus(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.profile).toBe('auto');
    expect(result.nextStep?.id).toBe('validate-problem');
    for (const step of result.steps) {
      expect(step).not.toHaveProperty('runner');
      expect(step).not.toHaveProperty('model');
      expect(step).not.toHaveProperty('route');
    }
    expect(probeHarnesses).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(flow.taskDir, WORKFLOW_STATE_FILE))).rejects.toThrow();
  });

  it('persists profile auto and leaves pending steps unrouted', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';

    await getFlowNext(flow.taskDir);

    const state = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    expect(state.profile).toBe('auto');
    for (const step of state.steps.slice(1)) {
      expect(step).not.toHaveProperty('runner');
      expect(step).not.toHaveProperty('model');
      expect(step).not.toHaveProperty('route');
    }
  });

  it('rejects an unknown profile and lists auto among the options', async () => {
    process.env.SPOK_FLOW_PROFILE = 'foo';

    const result = await getFlowStatus(flow.taskDir);

    expect(result.state).toBe('blocked');
    expect(result.reason).toBe(
      'Unknown flow profile: foo. Expected claude, codex, hybrid, or auto.'
    );
  });

  it('loads a stored auto profile and blocks a mismatched explicit request', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await getFlowNext(flow.taskDir);

    delete process.env.SPOK_FLOW_PROFILE;
    expect((await getFlowStatus(flow.taskDir)).profile).toBe('auto');

    process.env.SPOK_FLOW_PROFILE = 'hybrid';
    const mismatch = await getFlowStatus(flow.taskDir);
    expect(mismatch.state).toBe('blocked');
    expect(mismatch.reason).toBe('Flow profile mismatch: state uses auto, requested hybrid.');
  });

  it('keeps explicit-profile step keys in the original order', async () => {
    await getFlowNext(flow.taskDir);

    const state = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    expect(Object.keys(state.steps[0])).toEqual([
      'id',
      'skill',
      'runner',
      'model',
      'effort',
      'argument',
      'expectedOutput',
      'status',
    ]);
    expect(probeHarnesses).not.toHaveBeenCalled();
  });

});

describe('deterministic workflow completion state', () => {
  const flow = useFlowHarness();

  it('appends self-learn when project config enables it', async () => {
    await flow.enableSelfLearn();

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step?.id).toBe('validate-problem');
    expectSelfLearnStepRouting(result.steps);
    expect(result.steps.at(-1)).toMatchObject({
      id: 'self-learn',
      skill: 'spok-self-learn',
      model: 'sonnet',
      argument: flow.taskDir,
      expectedOutput: path.join(flow.taskDir, 'self-learn.md'),
      status: 'pending',
    });
  });

  it('does not create the state file on a status query', async () => {
    const result = await getFlowStatus(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.nextStep?.id).toBe('validate-problem');
    expectStepRouting(result.steps);
    await expect(fs.stat(path.join(flow.taskDir, WORKFLOW_STATE_FILE))).rejects.toThrow();
  });

  it('completes problem validation without --output when the expected file can proceed', async () => {
    await getFlowNext(flow.taskDir);
    await fs.writeFile(
      path.join(flow.taskDir, 'problem-validation.md'),
      '# Problem Validation\n\n## Flow Decision\n\nproceed\n',
      'utf-8'
    );

    const result = await completeFlowStep(flow.taskDir, { step: 'validate-problem' });

    expect(result.state).toBe('ready');
    expect(result.completedStep?.status).toBe('completed');
    expect(result.nextStep?.id).toBe('research-questions');
  });

  it('completes validate and advances to commit on a PASS frontmatter verdict', async () => {
    await flow.advanceToValidate();

    const result = await flow.completeValidate(PASS_VALIDATION);

    expect(result.state).toBe('ready');
    expect(result.completedStep?.id).toBe('validate');
    expect(result.completedStep?.status).toBe('completed');
    expect(result.nextStep?.id).toBe('commit');
  });

  it('completes validate via the Validation Verdict body section when frontmatter is absent', async () => {
    await flow.advanceToValidate();

    const result = await flow.completeValidate(
      '# Validation\n\n## Validation Verdict\n\n**Verdict**: `PASS`\n\nAll required behavior is present.\n'
    );

    expect(result.state).toBe('ready');
    expect(result.nextStep?.id).toBe('commit');
  });
});

describe('auto flow profile', () => {
  const flow = useFlowHarness();

  it('resolves the ready step with the first eligible candidate and persists only that step', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step).toMatchObject({
      id: 'validate-problem',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
      route: { policy: 'auto-v1', rejected: [] },
    });
    expect(probeHarnesses).toHaveBeenCalledTimes(1);
    expect(probeHarnesses).toHaveBeenCalledWith(['codex', 'omp', 'claude']);
    const stored = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    expect(stored.steps[0]).toMatchObject({
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
      route: { policy: 'auto-v1', rejected: [] },
    });
    expect(Object.keys(stored.steps[0])).toEqual([
      'id',
      'skill',
      'argument',
      'expectedOutput',
      'status',
      'runner',
      'model',
      'effort',
      'route',
    ]);
    expect(stored.steps[1]).not.toHaveProperty('runner');
  });
});

describe('auto flow OMP eligibility', () => {
  const flow = useFlowHarness({ linkedWorktree: true });

  it('falls back to OMP and records the Codex rejection', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));

    const result = await getFlowNext(flow.taskDir);

    expect(result.step).toMatchObject({
      runner: 'omp',
      model: 'openai-codex/gpt-5.6-sol',
      effort: 'xhigh',
      route: {
        policy: 'auto-v1',
        rejected: [
          {
            runner: 'codex',
            model: 'gpt-5.6-sol',
            effort: 'xhigh',
            code: 'not_authenticated',
            reason: CODEX_LOGGED_OUT.reason,
          },
        ],
      },
    });
  });

  it('returns the persisted route on later next and status calls without probing again', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));
    const first = await getFlowNext(flow.taskDir);
    const firstState = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    vi.mocked(probeHarnesses).mockResolvedValue(NOTHING_AVAILABLE);

    const second = await getFlowNext(flow.taskDir);
    const status = await getFlowStatus(flow.taskDir);
    const secondState = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );

    expect(routing(second.step)).toEqual(routing(first.step));
    expect(routing(status.nextStep)).toEqual(routing(first.step));
    expect(second.step?.runner).toBe('omp');
    expect(probeHarnesses).toHaveBeenCalledTimes(1);
    expect(secondState).toEqual({ ...firstState, updatedAt: secondState.updatedAt });
    expect(secondState.updatedAt >= firstState.updatedAt).toBe(true);
  });
});

describe('auto flow OMP inherited environment', () => {
  const flow = useFlowHarness();

  it('ignores inherited Git repository variables when checking a primary checkout', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    execFileSync('git', ['init', '-b', 'main', flow.projectRoot]);
    execFileSync('git', ['-C', flow.projectRoot, 'config', 'user.email', 'flow@example.com']);
    execFileSync('git', ['-C', flow.projectRoot, 'config', 'user.name', 'Flow Test']);
    execFileSync('git', [
      '-C',
      flow.projectRoot,
      'commit',
      '--allow-empty',
      '--no-gpg-sign',
      '-m',
      'seed',
    ]);
    const spoofWorktree = path.join(os.tmpdir(), `spok-flow-spoof-${randomUUID()}`);
    execFileSync('git', ['-C', flow.projectRoot, 'worktree', 'add', '--detach', spoofWorktree]);
    const [gitDir, commonDir] = execFileSync(
      'git',
      [
        '-C',
        spoofWorktree,
        'rev-parse',
        '--path-format=absolute',
        '--git-dir',
        '--git-common-dir',
      ],
      { encoding: 'utf-8' }
    )
      .trim()
      .split('\n');
    vi.stubEnv('GIT_DIR', gitDir!);
    vi.stubEnv('GIT_COMMON_DIR', commonDir!);
    vi.stubEnv('GIT_WORK_TREE', spoofWorktree);
    vi.mocked(probeHarnesses).mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));

    try {
      const spoofedPaths = execFileSync(
        'git',
        [
          '-C',
          flow.projectRoot,
          'rev-parse',
          '--path-format=absolute',
          '--git-dir',
          '--git-common-dir',
        ],
        { encoding: 'utf-8' }
      )
        .trim()
        .split('\n');
      expect(spoofedPaths[0]).not.toBe(spoofedPaths[1]);

      const result = await getFlowNext(flow.taskDir);

      expect(result.step).toMatchObject({
        id: 'validate-problem',
        runner: 'claude',
        model: 'opus',
      });
      expect(result.step?.route?.rejected[1]).toMatchObject({
        runner: 'omp',
        code: 'work_root_not_isolated',
      });
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(spoofWorktree, { recursive: true, force: true });
    }
  });
});

describe('auto flow OMP isolation', () => {
  const flow = useFlowHarness();

  it('rejects authenticated OMP in a primary checkout and selects the next candidate', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    execFileSync('git', ['init', '-b', 'main', flow.projectRoot]);
    vi.mocked(probeHarnesses).mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));

    const result = await getFlowNext(flow.taskDir);

    expect(result.step).toMatchObject({
      id: 'validate-problem',
      runner: 'claude',
      model: 'opus',
    });
    expect(result.step?.route?.rejected[1]).toMatchObject({
      runner: 'omp',
      code: 'work_root_not_isolated',
      reason: expect.stringContaining('is not a provably linked Git worktree'),
    });
  });

  it('rejects OMP when git metadata cannot be resolved but keeps later candidates', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    // tempDir is intentionally not a git repository.
    vi.mocked(probeHarnesses).mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));

    const result = await getFlowNext(flow.taskDir);

    expect(result.step).toMatchObject({ runner: 'claude', model: 'opus' });
    expect(
      result.step?.route?.rejected.map((rejection) => `${rejection.runner}:${rejection.code}`)
    ).toEqual(['codex:not_authenticated', 'omp:work_root_not_isolated']);
  });

  it('does not re-evaluate a persisted OMP route in a primary checkout', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    execFileSync('git', ['init', '-b', 'main', flow.projectRoot]);
    await fs.writeFile(
      path.join(flow.taskDir, WORKFLOW_STATE_FILE),
      `${JSON.stringify(
        {
          version: 2,
          profile: 'auto',
          taskDir: flow.taskDir,
          status: 'ready',
          steps: [
            {
              id: 'validate-problem',
              skill: 'spok-validate-problem',
              argument: path.join(flow.taskDir, 'ticket.md'),
              expectedOutput: path.join(flow.taskDir, 'problem-validation.md'),
              status: 'ready',
              runner: 'omp',
              model: 'openai-codex/gpt-5.6-sol',
              effort: 'xhigh',
              route: { policy: 'auto-v1', modelControl: 'selectable', rejected: [] },
            },
          ],
          repairAttempts: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        null,
        2
      )}\n`,
      'utf-8'
    );
    vi.mocked(probeHarnesses).mockClear();

    const result = await getFlowNext(flow.taskDir);

    // The route is immutable: the CLI neither reroutes nor blocks it; the skill halts at dispatch.
    expect(result.step).toMatchObject({
      runner: 'omp',
      model: 'openai-codex/gpt-5.6-sol',
    });
    expect(probeHarnesses).not.toHaveBeenCalled();
  });

  it('never probes or degrades explicit-profile routing in a primary checkout', async () => {
    process.env.SPOK_FLOW_PROFILE = 'hybrid';
    execFileSync('git', ['init', '-b', 'main', flow.projectRoot]);

    const result = await getFlowNext(flow.taskDir);

    expect(result.step).toMatchObject({
      id: 'validate-problem',
      runner: 'codex',
      model: 'gpt-5.6-sol',
    });
    expect(result.step?.route).toBeUndefined();
    expect(probeHarnesses).not.toHaveBeenCalled();
  });
});

describe('auto flow current fallback', () => {
  const flow = useFlowHarness();

  it('falls back to the current harness and writes state when nothing is eligible', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(NOTHING_AVAILABLE);

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step).toMatchObject({
      id: 'validate-problem',
      runner: 'current',
      route: {
        policy: 'auto-v1',
        modelControl: 'fixed-unknown',
        degraded: {
          code: 'model_identity_unavailable',
          reason:
            'No explicit auto candidate is eligible; running on the current harness whose model identity is unavailable.',
        },
      },
    });
    expect(result.step).not.toHaveProperty('model');
    expect(result.step).not.toHaveProperty('effort');
    expect(
      result.step?.route?.rejected.map((rejection) => `${rejection.runner}:${rejection.code}`)
    ).toEqual(['codex:executable_missing', 'omp:executable_missing', 'claude:not_authenticated']);
    const stored = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    expect(Object.keys(stored.steps[0])).toEqual([
      'id',
      'skill',
      'argument',
      'expectedOutput',
      'status',
      'runner',
      'route',
    ]);
    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({
      event: 'flow_next',
      state: 'ready',
      step: 'validate-problem',
    });
    expect(events.at(-1)).not.toHaveProperty('code');
  });

  it('keeps the current route on later calls and records it without a model on completion', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(NOTHING_AVAILABLE);
    await getFlowNext(flow.taskDir);
    vi.mocked(probeHarnesses).mockClear();

    const again = await getFlowNext(flow.taskDir);
    expect(again.step).toMatchObject({ id: 'validate-problem', runner: 'current' });
    expect(probeHarnesses).not.toHaveBeenCalled();

    await flow.completeProblemValidation();
    const events = await readFlowEvents(flow.taskDir);
    const completion = events.find(
      (event) => event.event === 'flow_complete' && event.completedStep === 'validate-problem'
    );
    expect(completion).toMatchObject({ runner: 'current' });
    expect(completion).not.toHaveProperty('model');
  });
});

describe('auto flow route persistence', () => {
  const flow = useFlowHarness();

  it('does not re-probe a persisted auto step with runner and model but no route', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await getFlowNext(flow.taskDir);
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    delete state.steps[0].route;
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    vi.mocked(probeHarnesses).mockReset().mockResolvedValue(NOTHING_AVAILABLE);

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step).toMatchObject({
      id: 'validate-problem',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
    });
    expect(result.step?.route).toBeUndefined();
    expect(probeHarnesses).not.toHaveBeenCalled();
    const persisted = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(persisted.steps[0]).not.toHaveProperty('route');
  });

  it('resolves the next step with a fresh probe after completing the first', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await getFlowNext(flow.taskDir);
    await flow.completeProblemValidation();

    const result = await getFlowNext(flow.taskDir);

    expect(result.step).toMatchObject({
      id: 'research-questions',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'medium',
    });
    expect(probeHarnesses).toHaveBeenCalledTimes(2);
  });
});

describe('auto flow completed route persistence', () => {
  const flow = useFlowHarness({ linkedWorktree: true });

  it('keeps every completed auto route by occurrence through completion, splicing, and reload', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await flow.advanceToValidate();
    const failed = await flow.completeValidate(FAIL_VALIDATION);
    expect(failed.state).toBe('ready');
    const validateBefore = failed.steps.filter((step) => step.id === 'validate')[0];
    expect(validateBefore).toMatchObject({ status: 'completed', runner: 'claude', model: 'opus' });

    const status = await getFlowStatus(flow.taskDir);

    for (const step of status.steps.filter((candidate) => candidate.status === 'completed')) {
      expect(step.runner, step.id).toBeDefined();
      expect(step.model, step.id).toBeDefined();
      expect(step.route, step.id).toMatchObject({ policy: 'auto-v1' });
    }
    const [validate0, validate1] = status.steps.filter((step) => step.id === 'validate');
    expect(routing(validate0)).toEqual(routing(validateBefore));
    expect(validate1).not.toHaveProperty('runner');
    expect(status.steps.find((step) => step.id === 'repair')).not.toHaveProperty('runner');

    vi.mocked(probeHarnesses).mockClear().mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));
    const next = await getFlowNext(flow.taskDir);

    expect(next.step).toMatchObject({ id: 'repair', runner: 'omp', model: 'openai-codex/gpt-5.6-sol' });
    expect(probeHarnesses).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    const [stored0, stored1] = persisted.steps.filter((step: FlowStep) => step.id === 'validate');
    expect(routing(stored0)).toEqual(routing(validateBefore));
    expect(stored1).toMatchObject({ status: 'pending' });
    expect(stored1).not.toHaveProperty('runner');
  });

  it('never rewrites a completed auto route when harness availability changes', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await flow.completeProblemValidation();
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const before = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(before.steps[0]).toMatchObject({ status: 'completed', runner: 'codex' });

    vi.mocked(probeHarnesses).mockClear().mockResolvedValue(NOTHING_AVAILABLE);
    const status = await getFlowStatus(flow.taskDir);
    expect(routing(status.steps[0])).toEqual(routing(before.steps[0]));
    expect(probeHarnesses).not.toHaveBeenCalled();

    vi.mocked(probeHarnesses).mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));
    const next = await getFlowNext(flow.taskDir);
    expect(next.step).toMatchObject({ id: 'research-questions', runner: 'omp' });
    const after = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(routing(after.steps[0])).toEqual(routing(before.steps[0]));
  });
});

describe('auto flow route compatibility', () => {
  const flow = useFlowHarness();

  it('treats a persisted current runner without a model as resolved and never probes it', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await getFlowNext(flow.taskDir);
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    delete state.steps[0].model;
    delete state.steps[0].effort;
    state.steps[0] = { ...state.steps[0], runner: 'current', route: { policy: 'auto-v1', rejected: [] } };
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    vi.mocked(probeHarnesses).mockClear().mockResolvedValue(ALL_HARNESSES_AVAILABLE);

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step).toMatchObject({ id: 'validate-problem', runner: 'current' });
    expect(result.step).not.toHaveProperty('model');
    expect(result.step).not.toHaveProperty('effort');
    expect(probeHarnesses).not.toHaveBeenCalled();
  });

  it('reads a chunk-1 route without modelControl back as selectable', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await getFlowNext(flow.taskDir);
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    delete state.steps[0].route.modelControl;
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    vi.mocked(probeHarnesses).mockClear();

    const status = await getFlowStatus(flow.taskDir);

    expect(status.nextStep?.route).toMatchObject({ policy: 'auto-v1', modelControl: 'selectable' });
    expect(probeHarnesses).not.toHaveBeenCalled();
  });

  it('keeps explicit-profile state and responses free of route data', async () => {
    process.env.SPOK_FLOW_PROFILE = 'hybrid';

    const result = await getFlowNext(flow.taskDir);
    const firstState = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    await getFlowNext(flow.taskDir);
    const secondState = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );

    expect(JSON.stringify(result)).not.toContain('"route"');
    expect(
      result.steps.map(({ id, runner, model, effort }) => ({ id, runner, model, effort }))
    ).toEqual(EXPECTED_HYBRID_STEP_ROUTING);
    expect(secondState).toEqual({ ...firstState, updatedAt: secondState.updatedAt });
    expect(JSON.stringify(secondState)).not.toContain('"route"');
    expect(probeHarnesses).not.toHaveBeenCalled();
  });
});

describe('auto flow judge anti-affinity', () => {
  const flow = useFlowHarness({ linkedWorktree: true });

  it('reviews a Fable design on Codex Sol and records the producer family', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await flow.advanceToDesignReview();

    const next = await getFlowNext(flow.taskDir);

    expect(next.steps.find((step) => step.id === 'design-discussion')).toMatchObject({
      runner: 'claude',
      model: 'fable',
    });
    expect(next.step).toMatchObject({
      id: 'design-review',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      route: { producer: { step: 'design-discussion', family: 'fable' } },
    });
    expect(next.step?.route).not.toHaveProperty('degraded');
  });

  it('marks same_family_as_producer when only OMP Sol is available for design and review', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(
      withCapabilityReports([CODEX_LOGGED_OUT, CLAUDE_LOGGED_OUT])
    );
    await flow.advanceToDesignReview();

    const next = await getFlowNext(flow.taskDir);

    expect(next.steps.find((step) => step.id === 'design-discussion')).toMatchObject({
      runner: 'omp',
      model: 'openai-codex/gpt-5.6-sol',
    });
    expect(next.step).toMatchObject({
      id: 'design-review',
      runner: 'omp',
      model: 'openai-codex/gpt-5.6-sol',
      route: {
        producer: { step: 'design-discussion', family: 'sol' },
        degraded: { code: 'same_family_as_producer' },
      },
    });
    expect(next.step?.route?.rejected.map((rejection) => rejection.runner)).toEqual([
      'claude',
      'codex',
    ]);
  });
});

describe('auto flow judge repair anti-affinity', () => {
  const flow = useFlowHarness();

  it('validates each occurrence against its own latest producer across a repair cycle', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await flow.advanceToValidate();

    const first = await getFlowNext(flow.taskDir);
    expect(first.step).toMatchObject({
      id: 'validate',
      runner: 'claude',
      model: 'opus',
      route: { producer: { step: 'implement', family: 'sol' } },
    });
    const validate0Route = routing(first.step);

    await flow.completeValidate(FAIL_VALIDATION);
    const repair = await getFlowNext(flow.taskDir);
    expect(repair.step).toMatchObject({ id: 'repair', runner: 'codex', model: 'gpt-5.6-sol' });
    await flow.completeRepair();

    const second = await getFlowNext(flow.taskDir);
    expect(second.step).toMatchObject({
      id: 'validate',
      runner: 'claude',
      model: 'opus',
      route: { producer: { step: 'repair', family: 'sol' } },
    });
    expect(second.step?.route).not.toHaveProperty('degraded');
    const [validate0] = second.steps.filter((step) => step.id === 'validate');
    expect(routing(validate0)).toEqual(validate0Route);
  });

  it('marks producer_family_unknown when the implementation ran on current', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await flow.advanceToDesignReview();
    await flow.completeDesignReview();
    await flow.completeFileStep('plan', 'plan.md');
    vi.mocked(probeHarnesses).mockResolvedValue(NOTHING_AVAILABLE);
    await flow.completeSummaryStep('implement', 'Implemented the plan.');
    vi.mocked(probeHarnesses).mockResolvedValue(ALL_HARNESSES_AVAILABLE);
    await flow.completeSummaryStep('simplify', 'Simplified the implementation.');

    const next = await getFlowNext(flow.taskDir);

    expect(next.steps.find((step) => step.id === 'implement')).toMatchObject({ runner: 'current' });
    expect(next.step).toMatchObject({
      id: 'validate',
      runner: 'claude',
      model: 'opus',
      route: {
        producer: { step: 'implement' },
        degraded: { code: 'producer_family_unknown' },
      },
    });
    expect(next.step?.route?.producer).not.toHaveProperty('family');
  });
});

describe('design review gate', () => {
  const flow = useFlowHarness();

  it('runs after structure-outline with the task directory and advances to plan on PASS', async () => {
    await flow.advanceToDesignReview();

    const next = await getFlowNext(flow.taskDir);
    expect(next.step).toMatchObject({
      id: 'design-review',
      skill: 'spok-review-design',
      runner: 'claude',
      model: 'opus',
      effort: 'medium',
      argument: flow.taskDir,
      expectedOutput: path.join(flow.taskDir, 'design-review.md'),
      status: 'ready',
    });

    const result = await flow.completeDesignReview();
    expect(result.state).toBe('ready');
    expect(result.completedStep).toMatchObject({
      id: 'design-review',
      status: 'completed',
    });
    expect(result.nextStep?.id).toBe('plan');
  });

  it('accepts CRLF frontmatter and body content after the closing delimiter', async () => {
    await flow.advanceToDesignReview();

    const result = await flow.completeDesignReview(PASS_DESIGN_REVIEW.replaceAll('\n', '\r\n'));

    expect(result.state).toBe('ready');
    expect(result.nextStep?.id).toBe('plan');
  });

  it.each([
    ['wrong type', '---\ntype: architecture-review\nverdict: PASS\n---\n'],
    ['missing type', '---\nverdict: PASS\n---\n'],
    ['missing verdict', '---\ntype: design-review\n---\n'],
    ['unknown verdict', '---\ntype: design-review\nverdict: MAYBE\n---\n'],
    ['reordered fields', '---\nverdict: PASS\ntype: design-review\n---\n'],
    ['extra field', '---\ntype: design-review\nverdict: PASS\nreviewer: codex\n---\n'],
    ['body fallback', '# Design Review\n\n## Verdict\n\nPASS\n'],
    ['frontmatter after body content', '# Design Review\n\n---\ntype: design-review\nverdict: PASS\n---\n'],
    ['type case deviation', '---\ntype: Design-Review\nverdict: PASS\n---\n'],
    ['verdict case deviation', '---\ntype: design-review\nverdict: pass\n---\n'],
    ['quoted type', '---\ntype: "design-review"\nverdict: PASS\n---\n'],
    ['quoted verdict', "---\ntype: design-review\nverdict: 'PASS'\n---\n"],
    ['extra field with FAIL verdict', '---\ntype: design-review\nverdict: FAIL\nreviewer: codex\n---\n'],
    ['reordered fields with FAIL verdict', '---\nverdict: FAIL\ntype: design-review\n---\n'],
    ['type case deviation with FAIL verdict', '---\ntype: Design-Review\nverdict: FAIL\n---\n'],
    ['quoted verdict FAIL', "---\ntype: design-review\nverdict: 'FAIL'\n---\n"],
  ])('rejects %s', async (_caseName, content) => {
    await flow.advanceToDesignReview();

    const result = await flow.completeDesignReview(content);

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('has no readable verdict');
    expect(result.nextStep).toMatchObject({
      id: 'design-review',
      status: 'ready',
    });
  });

  it('keeps a FAIL review ready without adding repair steps, then accepts a rewritten PASS', async () => {
    await flow.advanceToDesignReview();

    const failed = await flow.completeDesignReview(FAIL_DESIGN_REVIEW);
    expect(failed.state).toBe('blocked');
    expect(failed.reason).toContain('recorded a FAIL verdict');
    expect(failed.completedStep).toBeUndefined();
    expect(failed.nextStep).toMatchObject({
      id: 'design-review',
      status: 'ready',
    });
    expect(failed.steps.some((step) => step.id === 'repair')).toBe(false);
    const state = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    expect(state.repairAttempts).toBe(0);

    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({
      event: 'flow_complete',
      state: 'blocked',
      step: 'design-review',
      code: 'design_review_verdict_fail',
    });

    const retried = await flow.completeDesignReview(PASS_DESIGN_REVIEW);
    expect(retried.state).toBe('ready');
    expect(retried.completedStep).toMatchObject({
      id: 'design-review',
      status: 'completed',
    });
    expect(retried.nextStep?.id).toBe('plan');
  });

  it('records design_review_verdict_unreadable for an unreadable review', async () => {
    await flow.advanceToDesignReview();

    const result = await flow.completeDesignReview('# Design Review\n');

    expect(result.state).toBe('blocked');
    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({
      event: 'flow_complete',
      state: 'blocked',
      step: 'design-review',
      code: 'design_review_verdict_unreadable',
    });
  });
});

describe('deterministic workflow state resumption', () => {
  const flow = useFlowHarness();
  const legacyStepOrder = [
    'validate-problem',
    'research-questions',
    'research',
    'design-discussion',
    'structure-outline',
    'plan',
    'implement',
    'simplify',
    'validate',
    'commit',
  ];
  const legacyFileByStep: Record<string, string> = {
    'validate-problem': 'problem-validation.md',
    'research-questions': 'research-questions.md',
    research: 'research.md',
    'design-discussion': 'design-discussion.md',
    'structure-outline': 'structure-outline.md',
    plan: 'plan.md',
    validate: 'validation.md',
  };

  async function writeLegacyState(completedIds: string[], readyId?: string) {
    const completed = new Set(completedIds);
    const createdAt = '2026-01-01T00:00:00.000Z';

    for (const id of completed) {
      const filename = legacyFileByStep[id];
      if (!filename) continue;
      const content =
        id === 'validate-problem'
          ? '# Problem Validation\n\n## Flow Decision\n\nproceed\n'
          : id === 'validate'
          ? PASS_VALIDATION
          : `# ${id}\n`;
      await fs.writeFile(path.join(flow.taskDir, filename), content, 'utf-8');
    }

    const steps = legacyStepOrder.map((id) => {
      const status = completed.has(id) ? 'completed' : id === readyId ? 'ready' : 'pending';
      if (status !== 'completed') return { id, status };

      const filename = legacyFileByStep[id];
      if (filename) {
        return {
          id,
          status,
          result: {
            output: path.join(flow.taskDir, filename),
            completedAt: createdAt,
          },
        };
      }
      if (id === 'commit') {
        return {
          id,
          status,
          result: { commit: 'abc123', completedAt: createdAt },
        };
      }
      return {
        id,
        status,
        result: { summary: `Completed ${id}.`, completedAt: createdAt },
      };
    });

    await fs.writeFile(
      path.join(flow.taskDir, WORKFLOW_STATE_FILE),
      `${JSON.stringify(
        {
          version: 2,
          profile: 'claude',
          taskDir: flow.taskDir,
          status: 'ready',
          steps,
          repairAttempts: 0,
          createdAt,
          updatedAt: createdAt,
        },
        null,
        2
      )}\n`,
      'utf-8'
    );
  }

  it('validates the expected output before advancing to the next step', async () => {
    await flow.completeProblemValidation();
    const output = path.join(flow.taskDir, 'research-questions.md');
    await fs.writeFile(output, '# Research Questions\n', 'utf-8');

    const result = await completeFlowStep(flow.taskDir, {
      step: 'research-questions',
      output,
    });

    expect(result.state).toBe('ready');
    expect(result.completedStep?.status).toBe('completed');
    expect(result.nextStep).toMatchObject({
      id: 'research',
      skill: 'spok-create-research',
      model: 'sonnet',
      argument: output,
      expectedOutput: path.join(flow.taskDir, 'research.md'),
      status: 'ready',
    });
  });

  it('resumes from workflow-state.json after completed artifacts are present', async () => {
    await flow.completeProblemValidation();
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await flow.completeFileStep('research', 'research.md');

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.profile).toBe('claude');
    expect(result.step).toMatchObject({
      id: 'design-discussion',
      runner: 'claude',
      skill: 'spok-create-design-discussion',
      model: 'fable',
      effort: 'xhigh',
      argument: flow.taskDir,
      expectedOutput: path.join(flow.taskDir, 'design-discussion.md'),
    });
  });

  it('normalizes legacy workflow-state.json with model values', async () => {
    const createdAt = '2026-01-01T00:00:00.000Z';
    const researchQuestions = path.join(flow.taskDir, 'research-questions.md');
    const research = path.join(flow.taskDir, 'research.md');
    await fs.writeFile(researchQuestions, '# Research Questions\n', 'utf-8');
    await fs.writeFile(research, '# Research\n', 'utf-8');

    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    await fs.writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 1,
          taskDir: flow.taskDir,
          status: 'ready',
          steps: [
            {
              id: 'research-questions',
              skill: 'spok-create-research-questions',
              argument: path.join(flow.taskDir, 'ticket.md'),
              expectedOutput: researchQuestions,
              status: 'completed',
              result: { output: researchQuestions, completedAt: createdAt },
            },
            {
              id: 'research',
              skill: 'spok-create-research',
              argument: researchQuestions,
              expectedOutput: research,
              status: 'completed',
              result: { output: research, completedAt: createdAt },
            },
          ],
          createdAt,
          updatedAt: createdAt,
        },
        null,
        2
      )}\n`,
      'utf-8'
    );

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step).toMatchObject({
      id: 'design-discussion',
      model: 'fable',
      effort: 'xhigh',
      status: 'ready',
    });
    expectStepRouting(result.steps);
    const normalizedState = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(normalizedState).toMatchObject({ version: 2, profile: 'claude' });
    expectStepRouting(normalizedState.steps);
  });

  it('loads a pre-repair-cycle state file as repairAttempts 0 with the linear graph', async () => {
    const createdAt = '2026-01-01T00:00:00.000Z';
    const researchQuestions = path.join(flow.taskDir, 'research-questions.md');
    const research = path.join(flow.taskDir, 'research.md');
    const problemValidation = path.join(flow.taskDir, 'problem-validation.md');
    await fs.writeFile(problemValidation, '# Problem Validation\n\n## Flow Decision\n\nproceed\n', 'utf-8');
    await fs.writeFile(researchQuestions, '# Research Questions\n', 'utf-8');
    await fs.writeFile(research, '# Research\n', 'utf-8');

    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    await fs.writeFile(
      statePath,
      `${JSON.stringify({
        version: 1,
        taskDir: flow.taskDir,
        status: 'ready',
        steps: [
          {
            id: 'validate-problem',
            skill: 'spok-validate-problem',
            argument: path.join(flow.taskDir, 'ticket.md'),
            expectedOutput: problemValidation,
            status: 'completed',
            result: { output: problemValidation, completedAt: createdAt },
          },
          {
            id: 'research-questions',
            skill: 'spok-create-research-questions',
            argument: path.join(flow.taskDir, 'ticket.md'),
            expectedOutput: researchQuestions,
            status: 'completed',
            result: { output: researchQuestions, completedAt: createdAt },
          },
        ],
        createdAt,
        updatedAt: createdAt,
      }, null, 2)}\n`,
      'utf-8'
    );

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step?.id).toBe('research');
    expect(result.steps.some((step) => step.id === 'repair')).toBe(false);
    expectStepRouting(result.steps); // the linear eleven-step graph, routing intact

    const normalizedState = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(normalizedState.repairAttempts).toBe(0);
    expectStepRouting(normalizedState.steps);
  });

  it('runs design-review for a plan-ready legacy state that has not completed plan', async () => {
    const completedBeforeReview = legacyStepOrder.slice(0, legacyStepOrder.indexOf('plan'));
    await writeLegacyState(completedBeforeReview, 'plan');

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step).toMatchObject({
      id: 'design-review',
      skill: 'spok-review-design',
      argument: flow.taskDir,
      expectedOutput: path.join(flow.taskDir, 'design-review.md'),
      status: 'ready',
    });
    const state = JSON.parse(await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8'));
    expect(state.version).toBe(2);
    expect(state.steps.find((step: { id: string }) => step.id === 'plan').status).toBe('pending');
  });

  it('inserts a synthetic completed review when a legacy state completed plan', async () => {
    const completedThroughPlan = legacyStepOrder.slice(0, legacyStepOrder.indexOf('plan') + 1);
    await writeLegacyState(completedThroughPlan, 'implement');

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step?.id).toBe('implement');
    const review = result.steps.find((step) => step.id === 'design-review');
    expect(review).toMatchObject({ id: 'design-review', status: 'completed' });
    expect(review?.result?.completedAt).toEqual(expect.any(String));
    expect(review?.result?.output).toBeUndefined();

    const state = JSON.parse(await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8'));
    expect(state.version).toBe(2);
  });

  it('preserves later legacy progress when plan itself is not recorded complete', async () => {
    const completedBeforeReview = legacyStepOrder.slice(0, legacyStepOrder.indexOf('plan'));

    for (const laterStep of ['implement', 'simplify', 'validate', 'commit']) {
      await writeLegacyState([...completedBeforeReview, laterStep], 'plan');

      const result = await getFlowStatus(flow.taskDir);
      expect(result.state).toBe('ready');
      expect(result.nextStep?.id).toBe('plan');
      expect(result.steps.find((step) => step.id === 'design-review')).toMatchObject({
        status: 'completed',
        result: { completedAt: expect.any(String) },
      });
      expect(result.steps.find((step) => step.id === laterStep)?.status).toBe('completed');

      const state = JSON.parse(await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8'));
      expect(state.version).toBe(2);
    }
  });
});

describe('deterministic workflow blockers', () => {
  const flow = useFlowHarness();

  it('blocks when a completed prior artifact is missing', async () => {
    await flow.completeProblemValidation();
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await fs.rm(path.join(flow.taskDir, 'research-questions.md'));

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Missing completed artifact');
    expect(result.reason).toContain('research-questions.md');
  });

  it('blocks completion for a wrong step id', async () => {
    await getFlowNext(flow.taskDir);

    const result = await completeFlowStep(flow.taskDir, {
      step: 'research',
      output: path.join(flow.taskDir, 'research.md'),
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Expected step validate-problem');
  });

  it('records a hidden event when flow complete is called for the wrong step', async () => {
    await getFlowNext(flow.taskDir);

    await completeFlowStep(flow.taskDir, {
      step: 'research',
      output: path.join(flow.taskDir, 'research.md'),
    });

    const events = await readFlowEvents(flow.taskDir);

    expect(events.at(-1)).toMatchObject({
      schemaVersion: 1,
      event: 'flow_complete',
      state: 'blocked',
      step: 'validate-problem',
      code: 'wrong_step',
    });
    expect(events.at(-1)?.reason).toEqual(expect.stringContaining('Expected step validate-problem'));
  });

  it('blocks completion when the expected output file is empty', async () => {
    await getFlowNext(flow.taskDir);
    await fs.writeFile(path.join(flow.taskDir, 'problem-validation.md'), '', 'utf-8');

    const result = await completeFlowStep(flow.taskDir, { step: 'validate-problem' });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('missing or empty');
  });

  it('blocks problem validation completion when the flow decision is not proceed', async () => {
    await getFlowNext(flow.taskDir);
    await fs.writeFile(
      path.join(flow.taskDir, 'problem-validation.md'),
      '# Problem Validation\n\n## Flow Decision\n\npending user decision\n',
      'utf-8'
    );

    const result = await completeFlowStep(flow.taskDir, { step: 'validate-problem' });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Flow Decision to proceed');
  });

  it('leaves the state file unchanged by a blocked completion and recovers', async () => {
    await getFlowNext(flow.taskDir);
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const before = await fs.readFile(statePath, 'utf-8');

    const blocked = await completeFlowStep(flow.taskDir, { step: 'research' });
    expect(blocked.state).toBe('blocked');
    await expect(fs.readFile(statePath, 'utf-8')).resolves.toBe(before);

    const recovered = await getFlowNext(flow.taskDir);
    expect(recovered.state).toBe('ready');
    expect(recovered.step?.id).toBe('validate-problem');
  });

  it('blocks completion for a wrong output path', async () => {
    await getFlowNext(flow.taskDir);
    const wrongOutput = path.join(flow.taskDir, 'wrong.md');
    await fs.writeFile(wrongOutput, '# Wrong\n', 'utf-8');

    const result = await completeFlowStep(flow.taskDir, {
      step: 'validate-problem',
      output: wrongOutput,
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Expected output path');
    expect(result.reason).toContain('problem-validation.md');
  });
});

describe('deterministic workflow completion blockers', () => {
  const flow = useFlowHarness();

  it('blocks commit completion without a commit SHA', async () => {
    await flow.completeThroughValidation();

    const status = await getFlowStatus(flow.taskDir);
    expect(status.nextStep?.id).toBe('commit');

    const result = await completeFlowStep(flow.taskDir, {
      step: 'commit',
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('commit SHA');
  });

  it('advances from commit to self-learn when enabled', async () => {
    await flow.enableSelfLearn();
    await flow.completeThroughValidation();

    const result = await completeFlowStep(flow.taskDir, {
      step: 'commit',
      commit: 'abc123',
      summary: 'Committed the chunk.',
    });

    expect(result.state).toBe('ready');
    expect(result.completedStep?.id).toBe('commit');
    expect(result.nextStep).toMatchObject({
      id: 'self-learn',
      skill: 'spok-self-learn',
      model: 'sonnet',
      argument: flow.taskDir,
      expectedOutput: path.join(flow.taskDir, 'self-learn.md'),
      status: 'ready',
    });
    expectSelfLearnStepRouting(result.steps);
  });

  it('blocks self-learn completion when its artifact is missing or empty', async () => {
    await flow.enableSelfLearn();
    await flow.completeThroughValidation();
    await completeFlowStep(flow.taskDir, {
      step: 'commit',
      commit: 'abc123',
    });

    const result = await completeFlowStep(flow.taskDir, { step: 'self-learn' });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Expected output file is missing or empty');
    expect(result.reason).toContain('self-learn.md');
  });

  it('completes self-learn and marks the flow complete', async () => {
    await flow.enableSelfLearn();
    await flow.completeThroughValidation();
    await completeFlowStep(flow.taskDir, {
      step: 'commit',
      commit: 'abc123',
    });
    const output = path.join(flow.taskDir, 'self-learn.md');
    await fs.writeFile(output, '# Self Learn\n\nNo blocking findings.\n', 'utf-8');

    const result = await completeFlowStep(flow.taskDir, {
      step: 'self-learn',
      output,
    });

    expect(result.state).toBe('complete');
    expect(result.completedStep?.id).toBe('self-learn');
    expect(result.nextStep).toBeUndefined();
  });

  it('completes validate (not a block) on a FAIL with repair attempts remaining', async () => {
    await flow.advanceToValidate();

    const result = await flow.completeValidate(
      '---\nverdict: FAIL\n---\n\n## Validation Verdict\n\n**Verdict**: `FAIL`\n'
    );

    expect(result.state).toBe('ready');
    expect(result.completedStep).toMatchObject({ id: 'validate', status: 'completed' });
    expect(result.nextStep?.id).toBe('repair');

    const next = await getFlowNext(flow.taskDir);
    expect(next.state).toBe('ready');
    expect(next.step?.id).toBe('repair');
  });

  it('blocks validate completion when no verdict is readable', async () => {
    await flow.advanceToValidate();

    const result = await flow.completeValidate('# validate\n');

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('has no readable verdict (expected PASS or FAIL)');
    expect(result.reason).toContain(path.join(flow.taskDir, 'validation.md'));
  });

  it('blocks when the frontmatter verdict is unrecognized even if the body says PASS', async () => {
    await flow.advanceToValidate();

    const result = await flow.completeValidate(
      '---\nverdict: MAYBE\n---\n\n## Validation Verdict\n\n**Verdict**: `PASS`\n'
    );

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('has no readable verdict');
  });

  it('records a ready flow_complete event (no block code) when a FAIL routes to repair', async () => {
    await flow.advanceToValidate();

    await flow.completeValidate('---\nverdict: FAIL\n---\n\n# Validation\n');

    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({
      schemaVersion: 1,
      event: 'flow_complete',
      state: 'ready',
      step: 'repair',
      completedStep: 'validate',
      runner: 'claude',
      model: 'fable',
    });
    expect(events.at(-1)?.code).toBeUndefined();
  });
});

describe('bounded repair cycle', () => {
  const flow = useFlowHarness();

  it('completes validate on a FAIL with attempts remaining and routes to repair', async () => {
    await flow.advanceToValidate();

    const result = await flow.completeValidate(FAIL_VALIDATION);

    expect(result.state).toBe('ready');
    expect(result.completedStep).toMatchObject({ id: 'validate', status: 'completed' });
    expect(result.nextStep).toMatchObject({
      id: 'repair',
      skill: 'spok-repair',
      model: 'opus',
      effort: 'high',
      argument: path.join(flow.taskDir, 'validation.md'),
      status: 'ready',
      attempt: 1,
    });
    expect(result.reason).toBeUndefined();
  });

  it('persists repairAttempts and the spliced pair, and the first validate never satisfies the second', async () => {
    await flow.advanceToValidate();
    await flow.completeValidate(FAIL_VALIDATION);

    const state = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    expect(state.repairAttempts).toBe(1);
    expect(state.steps.map((step: { id: string }) => step.id)).toEqual([
      'validate-problem', 'research-questions', 'research', 'design-discussion',
      'structure-outline', 'design-review', 'plan', 'implement', 'simplify',
      'validate', 'repair', 'validate', 'commit',
    ]);

    // Re-derive through the public surface: the completed first validate must
    // not mark the spliced second validate completed.
    const next = await getFlowNext(flow.taskDir);
    expect(next.state).toBe('ready');
    expect(next.step?.id).toBe('repair');
    const validates = next.steps.filter((step) => step.id === 'validate');
    expect(validates.map((step) => step.status)).toEqual(['completed', 'pending']);
  });

  it('does not re-block mid-cycle on the completed first validate FAIL artifact', async () => {
    await flow.advanceToValidate();
    await flow.completeValidate(FAIL_VALIDATION);

    const status = await getFlowStatus(flow.taskDir);
    expect(status.state).toBe('ready');
    expect(status.nextStep?.id).toBe('repair');
  });

  it('composes the repair prompt with the validation path and summary contract', async () => {
    await flow.advanceToValidate();
    await flow.completeValidate(FAIL_VALIDATION);

    const next = await getFlowNext(flow.taskDir);
    expect(next.step?.prompt).toContain('`spok-repair`');
    expect(next.step?.prompt).toContain(path.join(flow.taskDir, 'validation.md'));
    expect(next.step?.prompt).toContain('return a concise summary');
  });

  it('blocks repair completion on an empty summary with missing_summary', async () => {
    await flow.advanceToValidate();
    await flow.completeValidate(FAIL_VALIDATION);
    await getFlowNext(flow.taskDir);

    const result = await completeFlowStep(flow.taskDir, { step: 'repair', summary: '   ' });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('non-empty --summary');
    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({ code: 'missing_summary', step: 'repair' });
  });

  it('returns validate after repair and advances to commit on a PASS', async () => {
    await flow.advanceToValidate();
    await flow.completeValidate(FAIL_VALIDATION);
    await flow.completeRepair();

    const next = await getFlowNext(flow.taskDir);
    expect(next.step?.id).toBe('validate');

    const result = await flow.completeValidate(PASS_VALIDATION);
    expect(result.state).toBe('ready');
    expect(result.nextStep?.id).toBe('commit');
  });

  it('routes repair to gpt-5.6-sol xhigh when CODEX_HOME is set', async () => {
    process.env.CODEX_HOME = path.join(os.tmpdir(), `codex-${randomUUID()}`);
    await flow.advanceToValidate();

    const result = await flow.completeValidate(FAIL_VALIDATION);

    expect(result.nextStep).toMatchObject({ id: 'repair', model: 'gpt-5.6-sol', effort: 'xhigh' });
  });

  it('routes hybrid repair to gpt-5.6-sol max', async () => {
    process.env.SPOK_FLOW_PROFILE = 'hybrid';
    await flow.advanceToValidate();

    const result = await flow.completeValidate(FAIL_VALIDATION);

    expect(result.nextStep).toMatchObject({
      id: 'repair',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'max',
    });
  });

  it('re-blocks a completed final validate whose artifact is edited to FAIL after the cycle', async () => {
    await flow.advanceToValidate();
    await flow.completeValidate(FAIL_VALIDATION);
    await flow.completeRepair();
    await flow.completeValidate(PASS_VALIDATION);
    await fs.writeFile(path.join(flow.taskDir, 'validation.md'), FAIL_VALIDATION, 'utf-8');

    const status = await getFlowStatus(flow.taskDir);
    expect(status.state).toBe('blocked');
    expect(status.reason).toContain('recorded a FAIL verdict');
  });
});

describe('repair attempt exhaustion', () => {
  const flow = useFlowHarness();

  async function burnBothAttempts() {
    await flow.advanceToValidate();
    await flow.completeValidate(FAIL_VALIDATION);   // attempt 1 spliced
    await flow.completeRepair();
    await flow.completeValidate(FAIL_VALIDATION);   // attempt 2 spliced
    await flow.completeRepair();
  }

  it('still dispatches the final validate after the last repair despite the stale FAIL', async () => {
    await burnBothAttempts();
    // Deterministically stale: recorded before the last repair completed.
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(flow.taskDir, 'validation.md'), past, past);

    const next = await getFlowNext(flow.taskDir);

    expect(next.state).toBe('ready');
    expect(next.step).toMatchObject({ id: 'validate', attempt: 2 });
  });

  it('blocks the third FAIL completion with repair_attempts_exhausted and writes nothing', async () => {
    await burnBothAttempts();
    // Written directly (not through the flow.completeValidate harness helper,
    // which drives its own settling getFlowNext first) so the snapshot below
    // brackets exactly the completion call this test is verifying.
    const output = path.join(flow.taskDir, 'validation.md');
    await fs.writeFile(output, FAIL_VALIDATION, 'utf-8');
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const before = await fs.readFile(statePath, 'utf-8');

    const result = await completeFlowStep(flow.taskDir, { step: 'validate', output });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('exhausted 2 repair attempts');
    expect(result.reason).toContain(output);
    await expect(fs.readFile(statePath, 'utf-8')).resolves.toBe(before);

    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({
      event: 'flow_complete',
      state: 'blocked',
      step: 'validate',
      code: 'repair_attempts_exhausted',
    });
    expect(events.at(-1)?.code).not.toBe('validation_verdict_fail');
  });

  it('re-derives the exhausted block on subsequent flow next and flow status', async () => {
    await burnBothAttempts();
    await flow.completeValidate(FAIL_VALIDATION); // fresh FAIL, recorded after the last repair

    const next = await getFlowNext(flow.taskDir);
    expect(next.state).toBe('blocked');
    expect(next.reason).toContain('exhausted 2 repair attempts');

    const status = await getFlowStatus(flow.taskDir);
    expect(status.state).toBe('blocked');
    expect(status.reason).toContain('exhausted 2 repair attempts');

    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({ event: 'flow_status', code: 'repair_attempts_exhausted' });
  });

  it('advances to commit on a PASS on the final attempt', async () => {
    await burnBothAttempts();

    const result = await flow.completeValidate(PASS_VALIDATION);

    expect(result.state).toBe('ready');
    expect(result.nextStep?.id).toBe('commit');
  });
});

/** Gates run again on every read: an artifact edited after completion must re-block. */
describe('completed artifact revalidation', () => {
  const flow = useFlowHarness();

  it.each(['status', 'next', 'plan completion'])('revalidates a completed design review on %s', async (operation) => {
    await flow.advanceToDesignReview();
    const completed = await flow.completeDesignReview();
    expect(completed.state).toBe('ready');
    await fs.writeFile(path.join(flow.taskDir, 'design-review.md'), FAIL_DESIGN_REVIEW, 'utf-8');

    const result =
      operation === 'status'
        ? await getFlowStatus(flow.taskDir)
        : operation === 'next'
        ? await getFlowNext(flow.taskDir)
        : await completeFlowStep(flow.taskDir, {
            step: 'plan',
            output: path.join(flow.taskDir, 'plan.md'),
          });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('recorded a FAIL verdict');
    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({
      code: 'design_review_verdict_fail',
    });
  });

  it('re-blocks a completed design review whose verdict becomes unreadable', async () => {
    await flow.advanceToDesignReview();
    const completed = await flow.completeDesignReview();
    expect(completed.state).toBe('ready');
    await fs.writeFile(path.join(flow.taskDir, 'design-review.md'), '# Design Review\n', 'utf-8');

    const result = await getFlowStatus(flow.taskDir);

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('has no readable verdict');
    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({
      event: 'flow_status',
      code: 'design_review_verdict_unreadable',
    });
  });

  it('re-blocks a completed validate step whose verdict is edited to FAIL', async () => {
    await flow.completeThroughValidation();
    await fs.writeFile(
      path.join(flow.taskDir, 'validation.md'),
      '---\nverdict: FAIL\n---\n\n# Validation\n',
      'utf-8'
    );

    const status = await getFlowStatus(flow.taskDir);
    expect(status.state).toBe('blocked');
    expect(status.reason).toContain('recorded a FAIL verdict');

    const next = await getFlowNext(flow.taskDir);
    expect(next.state).toBe('blocked');

    const commit = await completeFlowStep(flow.taskDir, { step: 'commit', commit: 'abc123' });
    expect(commit.state).toBe('blocked');
    expect(commit.reason).toContain('recorded a FAIL verdict');
  });

  it('re-blocks a completed validate step whose verdict becomes unreadable', async () => {
    await flow.completeThroughValidation();
    await fs.writeFile(path.join(flow.taskDir, 'validation.md'), '# Validation\n', 'utf-8');

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('has no readable verdict (expected PASS or FAIL)');
  });

  it('keeps the flow dispatchable when MEMORY.md cannot be read', async () => {
    const configDir = path.join(flow.projectRoot, 'spok');
    await fs.mkdir(path.join(configDir, 'MEMORY.md'), { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n', 'utf-8');

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step?.prompt).toContain('`spok-validate-problem`');
    expect(result.step?.prompt).not.toContain('MEMORY.md');
    expect(result.memoryRuleCount).toBe(0);
    expect(result.memoryWarning).toContain('could not be read; no rules were applied.');
  });
});

describe('flow step prompt composition', () => {
  const flow = useFlowHarness();

  const MEMORY_HEADER = '# Memory\n\nProse for humans only.\n\n## Rules\n\n';

  it('composes a dispatchable prompt without a memory file', async () => {
    const result = await getFlowNext(flow.taskDir);

    expect(result.step?.prompt).toContain('`spok-validate-problem`');
    expect(result.step?.prompt).toContain(path.join(flow.taskDir, 'ticket.md'));
    expect(result.step?.prompt).toContain('return the absolute path');
    expect(result.step?.prompt).not.toContain('MEMORY.md');
    expect(result.memoryPath).toBeUndefined();
    expect(result.memoryWarning).toBeUndefined();
  });

  it('inlines conforming rules and drops surrounding prose', async () => {
    await writeMemory(flow.projectRoot, `${MEMORY_HEADER}- \`flow-ts-first\` — Read flow.ts before editing steps.\n`);

    const result = await getFlowNext(flow.taskDir);

    expect(result.step?.prompt).toContain('- Read flow.ts before editing steps.');
    expect(result.step?.prompt).not.toContain('Prose for humans only.');
    expect(result.step?.prompt).not.toContain('flow-ts-first');
    expect(result.memoryPath).toBe(path.join(flow.projectRoot, 'spok', 'MEMORY.md'));
    expect(result.memoryRuleCount).toBe(1);
    expect(result.memoryRuleTotal).toBe(1);
    expect(result.memoryWarning).toBeUndefined();
  });

  it('caps inlined rules at 20 and reports the remainder', async () => {
    const rules = Array.from(
      { length: 25 },
      (_, index) => `- \`rule-${index}\` — Rule number ${index}.`
    ).join('\n');
    await writeMemory(flow.projectRoot, `${MEMORY_HEADER}${rules}\n`);

    const result = await getFlowNext(flow.taskDir);

    expect(result.step?.prompt).toContain('Rule number 19.');
    expect(result.step?.prompt).not.toContain('Rule number 20.');
    expect(result.memoryRuleCount).toBe(20);
    expect(result.memoryRuleTotal).toBe(25);
    expect(result.memoryWarning).toContain('5 rule(s) past the 20-rule cap ignored');
  });

  it('counts malformed rule bullets in the warning and keeps them out of the prompt', async () => {
    await writeMemory(flow.projectRoot, 
      `${MEMORY_HEADER}- \`good\` — A conforming rule.\n- \`broken\` missing the dash entirely.\n`
    );

    const result = await getFlowNext(flow.taskDir);

    expect(result.step?.prompt).toContain('- A conforming rule.');
    expect(result.step?.prompt).not.toContain('missing the dash entirely');
    expect(result.memoryRuleCount).toBe(1);
    expect(result.memoryWarning).toContain(
      '1 bullet(s) dropped for not matching the rule grammar'
    );
  });

  it('carries the no-commit clause on the implement prompt and asks for a summary', async () => {
    await flow.completeProblemValidation();
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await flow.completeFileStep('research', 'research.md');
    await flow.completeFileStep('design-discussion', 'design-discussion.md');
    await flow.completeFileStep('structure-outline', 'structure-outline.md');
    const designReview = await flow.completeDesignReview();
    expect(designReview.state).not.toBe('blocked');
    await flow.completeFileStep('plan', 'plan.md');

    const result = await getFlowNext(flow.taskDir);

    expect(result.step?.id).toBe('implement');
    expect(result.step?.prompt).toContain('do NOT create any commits');
    expect(result.step?.prompt).toContain('return a concise summary');
    expect(result.step?.prompt).not.toContain(
      'return the absolute path of the document that was created'
    );
  });

  it('never persists the prompt into the state file', async () => {
    await writeMemory(flow.projectRoot, `${MEMORY_HEADER}- \`probe\` — Probe rule text.\n`);

    await getFlowNext(flow.taskDir);

    const raw = await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8');
    expect(raw).not.toContain('"prompt"');
    expect(raw).not.toContain('Probe rule text');
  });
});

describe('flow command output', () => {
  const flow = useFlowHarness();
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message = '') => {
      logs.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('prints text details for the next ready step', async () => {
    await flowNextCommand(flow.taskDir);

    expect(logs).toEqual([
      'Next step: validate-problem',
      'Profile: claude',
      'Runner: claude',
      'Skill: spok-validate-problem',
      'Model: opus',
      'Effort: medium',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'problem-validation.md')}`,
    ]);
  });

});

describe('auto flow command output', () => {
  const flow = useFlowHarness({ linkedWorktree: true });
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message = '') => {
      logs.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('prints the unresolved route for an auto-profile status', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';

    await flowStatusCommand(flow.taskDir);

    expect(logs).toEqual([
      'Next step: validate-problem',
      'Profile: auto',
      'Route: unresolved until spok flow next',
      'Skill: spok-validate-problem',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'problem-validation.md')}`,
    ]);
  });

  it('prints policy and rejections for a resolved auto step', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));

    await flowNextCommand(flow.taskDir);

    expect(logs).toEqual([
      'Next step: validate-problem',
      'Profile: auto',
      'Runner: omp',
      'Skill: spok-validate-problem',
      'Model: openai-codex/gpt-5.6-sol',
      'Effort: xhigh',
      'Policy: auto-v1',
      'Rejected: codex gpt-5.6-sol xhigh — codex login status reported: Not logged in',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'problem-validation.md')}`,
    ]);
  });

  it('prints Degraded only for degraded judge routes', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await flow.advanceToDesignReview();
    logs.length = 0;

    await flowNextCommand(flow.taskDir);

    expect(logs.slice(0, 4)).toEqual([
      'Next step: design-review',
      'Profile: auto',
      'Runner: codex',
      'Skill: spok-review-design',
    ]);
    expect(logs.some((line) => line.startsWith('Degraded:'))).toBe(false);
  });
});

describe('auto flow current route output', () => {
  const flow = useFlowHarness();
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message = '') => {
      logs.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('prints a persisted current route without model or effort lines', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await getFlowNext(flow.taskDir);
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    delete state.steps[0].model;
    delete state.steps[0].effort;
    state.steps[0].runner = 'current';
    state.steps[0].route = { policy: 'auto-v1', rejected: [] };
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    logs.length = 0;

    await flowStatusCommand(flow.taskDir);

    expect(logs).toEqual([
      'Next step: validate-problem',
      'Profile: auto',
      'Runner: current',
      'Skill: spok-validate-problem',
      'Policy: auto-v1',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'problem-validation.md')}`,
    ]);
  });

  it('prints the degraded current route in text mode', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(NOTHING_AVAILABLE);

    await flowNextCommand(flow.taskDir);

    expect(logs).toEqual([
      'Next step: validate-problem',
      'Profile: auto',
      'Runner: current',
      'Skill: spok-validate-problem',
      'Policy: auto-v1',
      'Degraded: No explicit auto candidate is eligible; running on the current harness whose model identity is unavailable.',
      'Rejected: codex gpt-5.6-sol xhigh — codex is not installed or not on PATH.',
      'Rejected: omp openai-codex/gpt-5.6-sol xhigh — omp is not installed or not on PATH.',
      'Rejected: claude opus medium — claude auth status --json reports loggedIn is not true.',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'problem-validation.md')}`,
    ]);
    expect(process.exitCode).not.toBe(1);
  });
});

describe('auto flow JSON output', () => {
  const flow = useFlowHarness();
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message = '') => {
      logs.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('carries route in JSON output for auto', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';

    await flowNextCommand(flow.taskDir, { json: true });

    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.step.route).toEqual({
      policy: 'auto-v1',
      modelControl: 'selectable',
      rejected: [],
    });
    expect(parsed.steps[0].route).toEqual({
      policy: 'auto-v1',
      modelControl: 'selectable',
      rejected: [],
    });
    expect(parsed.steps[1]).not.toHaveProperty('route');
  });

  it('carries modelControl and degraded in JSON output for a current route', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(NOTHING_AVAILABLE);

    await flowNextCommand(flow.taskDir, { json: true });

    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.step).toMatchObject({
      runner: 'current',
      route: { modelControl: 'fixed-unknown', degraded: { code: 'model_identity_unavailable' } },
    });
    expect(parsed.step).not.toHaveProperty('model');
  });
});

describe('flow command output details', () => {
  const flow = useFlowHarness();
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message = '') => {
      logs.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('prints the memory summary and warning in text mode', async () => {
    await writeMemory(flow.projectRoot, '# Memory\n\n## Rules\n\n- `probe` — Probe rule text.\n- `bad` no dash.\n');

    await flowNextCommand(flow.taskDir);

    expect(logs).toContain(
      `Memory: ${path.join(flow.projectRoot, 'spok', 'MEMORY.md')} (1 of 1 rules)`
    );
    expect(logs.some((line) => line.startsWith('Memory warning:'))).toBe(true);
  });

  it('prints blocked reasons in text mode', async () => {
    await getFlowNext(flow.taskDir);

    await flowCompleteCommand(flow.taskDir, {
      step: 'research',
      output: path.join(flow.taskDir, 'research.md'),
    });

    expect(logs).toEqual(['Blocked: Expected step validate-problem, got research.']);
  });

  it('sets a nonzero exit code for blocked outcomes', async () => {
    await getFlowNext(flow.taskDir);

    await flowCompleteCommand(flow.taskDir, { step: 'research' });

    expect(process.exitCode).toBe(1);
  });

  it('prints completion in text mode', async () => {
    await flow.completeThroughValidation();

    await flowCompleteCommand(flow.taskDir, {
      step: 'commit',
      commit: 'abc123',
    });

    expect(logs).toEqual([`Flow complete: ${flow.taskDir}`]);
  });

  it('prints JSON output when requested', async () => {
    await flowStatusCommand(flow.taskDir, { json: true });

    const response = JSON.parse(logs[0]);
    expect(response).toMatchObject({
      state: 'ready',
      profile: 'claude',
      nextStep: {
        id: 'validate-problem',
        runner: 'claude',
        model: 'opus',
        effort: 'medium',
      },
    });
    expectStepRouting(response.steps);
  });
});

interface WorkRootRepo {
  readonly path: string;
  readonly aliasPath: string;
  readonly headSha: string;
  /** A real commit object in the repository that HEAD cannot reach. */
  readonly unreachableSha: string;
}

function useWorkRootRepo(): WorkRootRepo {
  let rootPath: string;
  let repoPath: string;
  let aliasPath: string;
  let headSha: string;
  let unreachableSha: string;

  function git(args: string[]): string {
    return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf-8' }).trim();
  }

  beforeEach(async () => {
    rootPath = path.join(os.tmpdir(), `spok-work-root-${randomUUID()}`);
    repoPath = path.join(rootPath, 'repo');
    aliasPath = path.join(rootPath, 'alias');
    await fs.mkdir(repoPath, { recursive: true });
    execFileSync('git', ['init', '-b', 'main', repoPath], { encoding: 'utf-8' });
    git(['config', 'user.email', 'flow@example.com']);
    git(['config', 'user.name', 'Flow Test']);
    await fs.writeFile(path.join(repoPath, 'a.txt'), 'one\n', 'utf-8');
    git(['add', 'a.txt']);
    git(['commit', '--no-gpg-sign', '-m', 'first']);
    headSha = git(['rev-parse', 'HEAD']);

    await fs.writeFile(path.join(repoPath, 'a.txt'), 'two\n', 'utf-8');
    git(['add', 'a.txt']);
    git(['commit', '--no-gpg-sign', '-m', 'second']);
    unreachableSha = git(['rev-parse', 'HEAD']);
    git(['reset', '--hard', headSha]);
    await fs.symlink(repoPath, aliasPath, process.platform === 'win32' ? 'junction' : 'dir');
  });

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  return {
    get path() {
      return repoPath;
    },
    get aliasPath() {
      return aliasPath;
    },
    get headSha() {
      return headSha;
    },
    get unreachableSha() {
      return unreachableSha;
    },
  };
}

async function advanceToImplement(flow: FlowHarness): Promise<void> {
  await flow.advanceToDesignReview();
  const designReview = await flow.completeDesignReview();
  expect(designReview.state).not.toBe('blocked');
  await flow.completeFileStep('plan', 'plan.md');
  await getFlowNext(flow.taskDir);
}

async function advanceToCommit(flow: FlowHarness, workRoot: string): Promise<void> {
  await advanceToImplement(flow);
  const implemented = await completeFlowStep(flow.taskDir, {
    step: 'implement',
    summary: 'Implemented the plan.',
    workRoot,
  });
  expect(implemented.state).not.toBe('blocked');
  await flow.completeSummaryStep('simplify', 'Simplified the implementation.');
  const validated = await flow.completeValidate(PASS_VALIDATION);
  expect(validated.state).not.toBe('blocked');
}

describe('work root attribution', () => {
  const flow = useFlowHarness();
  const repo = useWorkRootRepo();

  it('asks the implement subagent to report the repository it edited', async () => {
    await advanceToImplement(flow);
    const atImplement = await getFlowStatus(flow.taskDir);

    expect(atImplement.nextStep?.id).toBe('implement');
    expect(atImplement.nextStep?.prompt).toContain('`Work root: <absolute path>`');
    expect(atImplement.nextStep?.prompt).toContain(
      '`git -C <directory containing an edited file> rev-parse --show-toplevel`'
    );
  });

  it('persists the implement work root in workflow state', async () => {
    await advanceToCommit(flow, repo.path);

    const state = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    const implement = state.steps.find((step: { id: string }) => step.id === 'implement');
    expect(implement.result.workRoot).toBe(repo.path);

    // Reloading state must not drop it: the commit prompt is built from it.
    expect((await getFlowStatus(flow.taskDir)).workRoot).toBe(repo.path);
  });

  it('preserves an aliased work-root spelling while verifying its repository identity', async () => {
    await advanceToCommit(flow, repo.aliasPath);

    const recordedRoot = (await getFlowStatus(flow.taskDir)).workRoot;
    expect(recordedRoot).toBe(repo.aliasPath);
    expect(realpathSync.native(recordedRoot!)).toBe(realpathSync.native(repo.path));

    const result = await completeFlowStep(flow.taskDir, {
      step: 'commit',
      commit: repo.headSha,
      workRoot: repo.path,
    });
    expect(result.state).toBe('complete');
  });

  it('names the recorded work root in the simplify step prompt', async () => {
    await advanceToImplement(flow);

    const implemented = await completeFlowStep(flow.taskDir, {
      step: 'implement',
      summary: 'Implemented the plan.',
      workRoot: repo.path,
    });

    expect(implemented.nextStep?.id).toBe('simplify');
    expect(implemented.nextStep?.prompt).toContain(
      `The implementation repository is \`${repo.path}\``
    );
  });

  it('names the recorded work root in the repair step prompt', async () => {
    await advanceToImplement(flow);
    const implemented = await completeFlowStep(flow.taskDir, {
      step: 'implement',
      summary: 'Implemented the plan.',
      workRoot: repo.path,
    });
    expect(implemented.state).not.toBe('blocked');
    await flow.completeSummaryStep('simplify', 'Simplified the implementation.');

    const failedValidation = await flow.completeValidate(FAIL_VALIDATION);

    expect(failedValidation.nextStep?.id).toBe('repair');
    expect(failedValidation.nextStep?.prompt).toContain(
      `The implementation repository is \`${repo.path}\``
    );
  });

  it('names the work root in the commit step prompt', async () => {
    await advanceToCommit(flow, repo.path);

    const next = await getFlowNext(flow.taskDir);

    expect(next.step?.id).toBe('commit');
    expect(next.step?.prompt).toContain(`Run every git command with \`-C ${repo.path}\``);
    expect(next.step?.prompt).toContain('do not search other directories');
    expect(next.workRootWarning).toBeUndefined();
  });

  it('blocks a relative or missing work root at record time', async () => {
    await advanceToImplement(flow);

    const blank = await completeFlowStep(flow.taskDir, {
      step: 'implement',
      summary: 'Implemented the plan.',
      workRoot: '   ',
    });
    expect(blank.state).toBe('blocked');
    expect(blank.reason).toContain('absolute --work-root');

    const relative = await completeFlowStep(flow.taskDir, {
      step: 'implement',
      summary: 'Implemented the plan.',
      workRoot: 'some/relative/path',
    });
    expect(relative.state).toBe('blocked');
    expect(relative.reason).toContain('absolute --work-root');

    const missing = await completeFlowStep(flow.taskDir, {
      step: 'implement',
      summary: 'Implemented the plan.',
      workRoot: path.join(repo.path, 'not-here'),
    });
    expect(missing.state).toBe('blocked');
    expect(missing.reason).toContain('Work root directory does not exist');
  });
});

describe('commit SHA verification', () => {
  const flow = useFlowHarness();
  const repo = useWorkRootRepo();

  it('accepts a commit reachable from HEAD in the recorded work root', async () => {
    await advanceToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, { step: 'commit', commit: repo.headSha });

    expect(result.state).toBe('complete');
    expect(result.completedStep?.result).toMatchObject({
      commit: repo.headSha,
      workRoot: repo.path,
    });
  });

  it('resolves a revision expression before recording the commit', async () => {
    await advanceToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, { step: 'commit', commit: 'HEAD' });

    expect(result.state).toBe('complete');
    expect(result.completedStep?.result?.commit).toBe(repo.headSha);
  });

  it('blocks a SHA that names no commit object in the recorded work root', async () => {
    await advanceToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, { step: 'commit', commit: 'abc123' });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('is not a commit object in');
  });

  it('blocks a real commit that HEAD cannot reach', async () => {
    await advanceToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, {
      step: 'commit',
      commit: repo.unreachableSha,
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('is not reachable from HEAD in');
  });

  it('warns and accepts any SHA when no work root was recorded', async () => {
    await flow.completeThroughValidation();

    const next = await getFlowNext(flow.taskDir);
    expect(next.step?.id).toBe('commit');
    expect(next.step?.prompt).not.toContain('Run every git command with');
    expect(next.workRootWarning).toContain('No work root was recorded');

    const result = await completeFlowStep(flow.taskDir, { step: 'commit', commit: 'abc123' });
    expect(result.state).toBe('complete');
  });

  it('verifies and records an explicitly supplied work root for legacy state', async () => {
    await flow.completeThroughValidation();

    const result = await completeFlowStep(flow.taskDir, {
      step: 'commit',
      commit: repo.headSha,
      workRoot: repo.path,
    });

    expect(result.state).toBe('complete');
    expect(result.completedStep?.result).toMatchObject({
      commit: repo.headSha,
      workRoot: repo.path,
    });
  });

  it('blocks an explicitly supplied work root that conflicts with recorded state', async () => {
    await advanceToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, {
      step: 'commit',
      commit: repo.headSha,
      workRoot: flow.projectRoot,
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('conflicts with recorded work root');
  });
});
