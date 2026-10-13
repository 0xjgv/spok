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
  answerFlowQuestion,
  completeFlowStep,
  flowCompleteCommand,
  flowNextCommand,
  flowStatusCommand,
  getFlowEventLogPath,
  getFlowNext,
  getFlowStatus,
  pauseFlowStep,
  type FlowCompleteInput,
  type FlowStep,
  type FlowInteraction,
  WORKFLOW_STATE_FILE,
} from '../../../src/commands/workflow/flow.js';

// Git hooks export these into the test run; fixture repos must not inherit the outer repository's index.
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete process.env[key];

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
  completeFileStep(step: string, filename: string): Promise<void>;
  completeSummaryStep(step: string, summary: string): Promise<void>;
  /** Completes research-questions through structure-outline; implement is next. */
  advanceToImplement(): Promise<void>;
  /** Gives the task a git work repository so implement can record its execution baseline. */
  seedRepository(): Promise<void>;
  /** Seeds the work repository and completes implement; commit is next. */
  completeImplement(): Promise<void>;
  completeThroughImplement(): Promise<void>;
}

const OPEN_QUESTIONS = {
  questions: [
    {
      id: 'interface',
      prompt: 'Choose the public interface',
      kind: 'choice',
      options: [
        { id: 'webhook', label: 'Webhook', consequence: 'Send asynchronous updates.' },
        { id: 'polling', label: 'Polling', consequence: 'Request updates on demand.' },
      ],
      recommendedOptionId: 'webhook',
    },
    {
      id: 'failure-policy',
      prompt: 'Choose the failure policy',
      kind: 'choice',
      options: [
        { id: 'retry', label: 'Retry', consequence: 'Attempt transient failures again.' },
        { id: 'fail-fast', label: 'Fail fast', consequence: 'Stop at the first failure.' },
      ],
      recommendedOptionId: 'retry',
    },
  ],
} as const;

const EXPECTED_STEP_ROUTING = [
  { id: 'research-questions', model: 'opus', effort: 'medium' },
  { id: 'research', model: 'sonnet', effort: 'medium' },
  { id: 'design-discussion', model: 'fable', effort: 'xhigh' },
  { id: 'structure-outline', model: 'fable', effort: 'xhigh' },
  { id: 'implement', model: 'opus', effort: 'medium' },
  { id: 'commit', model: 'haiku', effort: 'low' },
];

const EXPECTED_HYBRID_STEP_ROUTING = [
  { id: 'research-questions', runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  { id: 'research', runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  { id: 'design-discussion', runner: 'claude', model: 'fable', effort: 'xhigh' },
  { id: 'structure-outline', runner: 'claude', model: 'fable', effort: 'xhigh' },
  { id: 'implement', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  { id: 'commit', runner: 'codex', model: 'gpt-5.6-terra', effort: 'low' },
];

function expectStepRouting(steps: Array<{ id: string; model?: string; effort?: string }>) {
  expect(steps.map(({ id, model, effort }) => ({ id, model, effort }))).toEqual(
    EXPECTED_STEP_ROUTING
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

type FlowResponse = Awaited<ReturnType<typeof completeFlowStep>>;

/** Approves the review gate a completed phase raised; returns the answer response. */
async function approveGate(taskDir: string, gated: FlowResponse): Promise<FlowResponse> {
  expect(gated.state, gated.reason).toBe('needs-input');
  return answerFlowQuestion(taskDir, { question: gated.question!.id, answer: 'approve' });
}

function completeAndApprove(taskDir: string, input: FlowCompleteInput): Promise<FlowResponse> {
  return completeFlowStep(taskDir, input).then((gated) => approveGate(taskDir, gated));
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

async function writeQuestionPacket(taskDir: string, packet: unknown = OPEN_QUESTIONS): Promise<string> {
  const packetPath = path.join(taskDir, 'open-questions.json');
  await fs.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf-8');
  return packetPath;
}

async function seedFlowRepository(root: string): Promise<void> {
  if (await fs.stat(path.join(root, '.git')).catch(() => undefined)) return;
  execFileSync('git', ['init', '-b', 'main', root]);
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args]);
  git(['config', 'user.email', 'flow@example.com']);
  git(['config', 'user.name', 'Flow Test']);
  await fs.writeFile(path.join(root, 'seed.txt'), 'seed\n', 'utf-8');
  git(['add', 'seed.txt']);
  git(['commit', '--no-gpg-sign', '-m', 'seed']);
}

async function seedLegacyImplementation(taskDir: string, workRoot?: string): Promise<void> {
  const statePath = path.join(taskDir, WORKFLOW_STATE_FILE);
  const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
  // Older completed implementations predate execution baselines and root freezing.
  delete state.execution;
  const implement = state.steps.find((step: FlowStep) => step.id === 'implement');
  implement.status = 'completed';
  implement.result = {
    summary: 'Implemented the plan.',
    completedAt: new Date().toISOString(),
    workRoot,
  };
  await fs.writeFile(statePath, JSON.stringify(state), 'utf-8');
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
      await seedFlowRepository(primary);
      routingRoot = path.join(tempDir, 'worktree');
      execFileSync('git', ['-C', primary, 'worktree', 'add', routingRoot]);
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

  async function approveReview(gated: FlowResponse) {
    const approved = await approveGate(taskDir, gated);
    expect(approved.state, approved.reason).toBe('ready');
  }

  async function completeFileStep(step: string, filename: string) {
    await getFlowNext(taskDir);
    const output = path.join(taskDir, filename);
    await fs.writeFile(output, `# ${step}\n`, 'utf-8');
    await approveReview(await completeFlowStep(taskDir, { step, output }));
  }

  async function completeSummaryStep(step: string, summary: string) {
    const next = await getFlowNext(taskDir);
    expect(next.state, next.reason).toBe('ready');
    expect(next.step?.id).toBe(step);
    await approveReview(await completeFlowStep(taskDir, { step, summary }));
  }

  async function advanceToImplement() {
    await completeFileStep('research-questions', 'research-questions.md');
    await completeFileStep('research', 'research.md');
    await completeFileStep('design-discussion', 'design-discussion.md');
    await completeFileStep('structure-outline', 'structure-outline.md');
  }

  async function seedRepository() {
    await seedFlowRepository(path.resolve(taskDir, '../../../../..'));
  }

  async function completeImplement() {
    await seedRepository();
    await completeSummaryStep('implement', 'Implemented the plan.');
  }

  async function completeThroughImplement() {
    await advanceToImplement();
    await completeImplement();
  }

  return {
    get projectRoot() {
      return tempDir;
    },
    get taskDir() {
      return taskDir;
    },
    completeFileStep,
    completeSummaryStep,
    advanceToImplement,
    seedRepository,
    completeImplement,
    completeThroughImplement,
  };
}

describe('deterministic workflow step state', () => {
  const flow = useFlowHarness();

  it('returns research questions as the first step when only ticket.md exists', async () => {
    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.profile).toBe('claude');
    expect(result.step).toMatchObject({
      id: 'research-questions',
      skill: 'spok-create-research-questions',
      runner: 'claude',
      model: 'opus',
      effort: 'medium',
      argument: path.join(flow.taskDir, 'ticket.md'),
      expectedOutput: path.join(flow.taskDir, 'research-questions.md'),
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
      step: 'research-questions',
    });
    expect(events.at(-1)?.timestamp).toEqual(expect.any(String));
  });

  it('records the completed step routing in the approving flow_answer event', async () => {
    await flow.completeFileStep('research-questions', 'research-questions.md');

    const events = await readFlowEvents(flow.taskDir);
    expect(events.at(-1)).toMatchObject({
      event: 'flow_answer',
      completedStep: 'research-questions',
      step: 'research',
      runner: 'claude',
      model: 'opus',
    });
    expect(events.at(-2)).toMatchObject({
      event: 'flow_complete',
      state: 'needs-input',
      step: 'research-questions',
    });
    expect(events.at(-2)).not.toHaveProperty('completedStep');
  });

  it('routes every step to GPT-5.6 models with Codex efforts when CODEX_HOME is set', async () => {
    process.env.CODEX_HOME = path.join(os.tmpdir(), `codex-${randomUUID()}`);

    const result = await getFlowNext(flow.taskDir);

    expect(result.profile).toBe('codex');
    expect(result.steps.map(({ id, runner, model, effort }) => ({ id, runner, model, effort }))).toEqual([
      { id: 'research-questions', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'research', runner: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
      { id: 'design-discussion', runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
      { id: 'structure-outline', runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'implement', runner: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
      { id: 'commit', runner: 'codex', model: 'gpt-5.6-terra', effort: 'low' },
    ]);
  });

});

describe('deterministic workflow profile detection', () => {
  const flow = useFlowHarness();

  it('detects Codex Desktop from CODEX_THREAD_ID without CODEX_HOME', async () => {
    process.env.CODEX_THREAD_ID = `thread-${randomUUID()}`;

    const result = await getFlowNext(flow.taskDir);

    expect(result.profile).toBe('codex');
    expect(result.step).toMatchObject({
      id: 'research-questions',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
    });
  });

  it('reroutes unfinished default steps when resuming on another primary harness', async () => {
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await flow.completeFileStep('research', 'research.md');

    process.env.CODEX_THREAD_ID = `thread-${randomUUID()}`;
    const result = await getFlowNext(flow.taskDir);

    expect(result.profile).toBe('codex');
    expect(result.steps[0]).toMatchObject({
      id: 'research-questions',
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

});

describe('flow profile routing', () => {
  const flow = useFlowHarness();

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
    expect(result.nextStep?.id).toBe('research-questions');
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

  it('does not create the state file on a status query', async () => {
    const result = await getFlowStatus(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.nextStep?.id).toBe('research-questions');
    expectStepRouting(result.steps);
    await expect(fs.stat(path.join(flow.taskDir, WORKFLOW_STATE_FILE))).rejects.toThrow();
  });

});

describe('auto flow profile', () => {
  const flow = useFlowHarness();

  it('resolves the ready step with the first eligible candidate and persists only that step', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step).toMatchObject({
      id: 'research-questions',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'medium',
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
      effort: 'medium',
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
      effort: 'medium',
      route: {
        policy: 'auto-v1',
        rejected: [
          {
            runner: 'codex',
            model: 'gpt-5.6-sol',
            effort: 'medium',
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
        id: 'research-questions',
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
      id: 'research-questions',
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
              id: 'research-questions',
              skill: 'spok-create-research-questions',
              argument: path.join(flow.taskDir, 'ticket.md'),
              expectedOutput: path.join(flow.taskDir, 'research-questions.md'),
              status: 'ready',
              runner: 'omp',
              model: 'openai-codex/gpt-5.6-sol',
              effort: 'xhigh',
              route: { policy: 'auto-v1', modelControl: 'selectable', rejected: [] },
            },
          ],
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
      id: 'research-questions',
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
      id: 'research-questions',
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
      step: 'research-questions',
    });
    expect(events.at(-1)).not.toHaveProperty('code');
  });

  it('keeps the current route on later calls and records it without a model on completion', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(NOTHING_AVAILABLE);
    await getFlowNext(flow.taskDir);
    vi.mocked(probeHarnesses).mockClear();

    const again = await getFlowNext(flow.taskDir);
    expect(again.step).toMatchObject({ id: 'research-questions', runner: 'current' });
    expect(probeHarnesses).not.toHaveBeenCalled();

    await flow.completeFileStep('research-questions', 'research-questions.md');
    const events = await readFlowEvents(flow.taskDir);
    const completion = events.find(
      (event) => event.event === 'flow_answer' && event.completedStep === 'research-questions'
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
      id: 'research-questions',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'medium',
    });
    expect(result.step?.route).toBeUndefined();
    expect(probeHarnesses).not.toHaveBeenCalled();
    const persisted = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(persisted.steps[0]).not.toHaveProperty('route');
  });

  it('resolves the next step with a fresh probe after completing the first', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await getFlowNext(flow.taskDir);
    await flow.completeFileStep('research-questions', 'research-questions.md');

    const result = await getFlowNext(flow.taskDir);

    expect(result.step).toMatchObject({
      id: 'research',
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'medium',
    });
    expect(probeHarnesses).toHaveBeenCalledTimes(2);
  });
});

describe('auto flow completed route persistence', () => {
  const flow = useFlowHarness({ linkedWorktree: true });

  it('never rewrites a completed auto route when harness availability changes', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    await flow.completeFileStep('research-questions', 'research-questions.md');
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const before = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(before.steps[0]).toMatchObject({ status: 'completed', runner: 'codex' });

    vi.mocked(probeHarnesses).mockClear().mockResolvedValue(NOTHING_AVAILABLE);
    const status = await getFlowStatus(flow.taskDir);
    expect(routing(status.steps[0])).toEqual(routing(before.steps[0]));
    expect(probeHarnesses).not.toHaveBeenCalled();

    vi.mocked(probeHarnesses).mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));
    const next = await getFlowNext(flow.taskDir);
    expect(next.step).toMatchObject({ id: 'research', runner: 'omp' });
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
    expect(result.step).toMatchObject({ id: 'research-questions', runner: 'current' });
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

describe('deterministic workflow state resumption', () => {
  const flow = useFlowHarness();

  it('validates the expected output before advancing to the next step', async () => {
    await getFlowNext(flow.taskDir);
    const output = path.join(flow.taskDir, 'research-questions.md');
    await fs.writeFile(output, '# Research Questions\n', 'utf-8');

    const result = await completeAndApprove(flow.taskDir, {
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

});

describe('deterministic workflow legacy state', () => {
  const flow = useFlowHarness();

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

});

describe('removed workflow steps', () => {
  const flow = useFlowHarness();

  it.each(['next', 'status'])('reports a finished legacy flow as complete on %s without writing', async (operation) => {
    const completedAt = '2026-01-01T00:00:00.000Z';
    const execution = {
      workRoot: flow.projectRoot,
      branch: 'main',
      baselineHead: 'a'.repeat(40),
      baselineChanges: {},
      ownedPaths: [],
    };
    const ids = [
      'validate-problem', 'research-questions', 'research', 'design-discussion', 'structure-outline',
      'design-review', 'implement', 'simplify', 'validate', 'repair', 'commit', 'self-learn',
    ];
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const original = `${JSON.stringify({
      version: 2,
      profile: 'claude',
      taskDir: flow.taskDir,
      status: 'complete',
      steps: ids.map((id) => ({ id, status: 'completed', result: { summary: 'Done.', completedAt } })),
      repairAttempts: 1,
      execution,
      createdAt: completedAt,
      updatedAt: completedAt,
    }, null, 2)}\n`;
    await fs.writeFile(statePath, original);

    const result = operation === 'next' ? await getFlowNext(flow.taskDir) : await getFlowStatus(flow.taskDir);

    expect(result.state).toBe('complete');
    expect(result.execution).toEqual(execution);
    expect(result.workRoot).toBe(flow.projectRoot);
    expect(result.nextStep).toBeUndefined();
    expect(await fs.readFile(statePath, 'utf-8')).toBe(original);
  });

  it('still blocks a legacy flow that is not finished', async () => {
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const original = `${JSON.stringify({
      version: 2,
      profile: 'claude',
      taskDir: flow.taskDir,
      status: 'ready',
      steps: [
        { id: 'validate-problem', status: 'completed', result: { completedAt: '2026-01-01T00:00:00.000Z' } },
        { id: 'research-questions', status: 'ready' },
      ],
    })}\n`;
    await fs.writeFile(statePath, original);

    const result = await getFlowStatus(flow.taskDir);

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('the validate-problem step has been removed');
    expect(await fs.readFile(statePath, 'utf-8')).toBe(original);
  });

  const removedIds = ['plan', 'validate-problem', 'design-review', 'simplify', 'validate', 'repair', 'self-learn'];
  const removedCases = removedIds.flatMap((id) =>
    ['next', 'status', 'complete'].map((operation) => [id, operation])
  );

  it.each(removedCases)('rejects a saved %s step on %s without rewriting state', async (id, operation) => {
    await getFlowNext(flow.taskDir);
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    state.steps.splice(4, 0, { id, status: 'pending' });
    const original = `${JSON.stringify(state, null, 2)}\n`;
    await fs.writeFile(statePath, original);

    const result = operation === 'next'
      ? await getFlowNext(flow.taskDir)
      : operation === 'status'
      ? await getFlowStatus(flow.taskDir)
      : await completeFlowStep(flow.taskDir, { step: id, summary: 'Done.' });

    expect(result.state).toBe('blocked');
    expect(result.reason).toBe(
      `Unsupported workflow state: the ${id} step has been removed. Start a new task directory with ticket.md.`
    );
    expect(await fs.readFile(statePath, 'utf-8')).toBe(original);
  });

});

const MEMORY_HEADER = '# Memory\n\nProse for humans only.\n\n## Rules\n\n';

async function completeResearchQuestions(taskDir: string): Promise<FlowResponse> {
  await getFlowNext(taskDir);
  const output = path.join(taskDir, 'research-questions.md');
  await fs.writeFile(output, '# Research Questions\n', 'utf-8');
  return completeFlowStep(taskDir, { step: 'research-questions', output });
}

describe('phase review gate', () => {
  const flow = useFlowHarness();

  it('asks one review question instead of completing a gated step', async () => {
    const gated = await completeResearchQuestions(flow.taskDir);

    expect(gated.state).toBe('needs-input');
    expect(gated.completedStep).toBeUndefined();
    expect(gated.nextStep).toMatchObject({ id: 'research-questions', status: 'ready' });
    expect(gated.questions).toHaveLength(1);
    expect(gated.question).toEqual({
      id: 'research-questions-review-1',
      prompt: expect.stringContaining(path.join(flow.taskDir, 'research-questions.md')),
      kind: 'choice',
      options: [
        { id: 'approve', label: 'Approve', consequence: 'Continue to the next phase.' },
        { id: 'revise', label: 'Request changes', consequence: 'The phase reruns with your feedback.' },
      ],
      recommendedOptionId: 'approve',
    });
    const status = await getFlowStatus(flow.taskDir);
    expect(status.state).toBe('needs-input');
    expect(status.question?.id).toBe('research-questions-review-1');
    expect(status.steps[0]?.status).not.toBe('completed');
  });

  it('keeps the flow on the gated step until the reviewer answers', async () => {
    await completeResearchQuestions(flow.taskDir);

    const again = await completeFlowStep(flow.taskDir, { step: 'research-questions' });
    expect(again.state).toBe('blocked');
    expect(again.reason).toContain('unanswered questions');
    const wrong = await answerFlowQuestion(flow.taskDir, { question: 'other', answer: 'approve' });
    expect(wrong.state).toBe('blocked');
    const next = await getFlowNext(flow.taskDir);
    expect(next.state).toBe('needs-input');
    expect(next.step?.id).toBe('research-questions');
  });

  it.each(['approve', '  Approve  ', 'APPROVE'])('treats %j as approval and advances', async (answer) => {
    const gated = await completeResearchQuestions(flow.taskDir);

    const approved = await answerFlowQuestion(flow.taskDir, { question: gated.question!.id, answer });

    expect(approved.state).toBe('ready');
    expect(approved.completedStep).toMatchObject({
      id: 'research-questions',
      status: 'completed',
      result: { output: path.join(flow.taskDir, 'research-questions.md') },
    });
    expect(approved.nextStep?.id).toBe('research');
  });

  it('blocks approval when the reviewed artifact has disappeared, writing nothing', async () => {
    const gated = await completeResearchQuestions(flow.taskDir);
    await fs.rm(path.join(flow.taskDir, 'research-questions.md'));
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const before = await fs.readFile(statePath, 'utf-8');

    const approved = await answerFlowQuestion(flow.taskDir, { question: gated.question!.id, answer: 'approve' });

    expect(approved.state).toBe('blocked');
    expect(approved.reason).toContain('Expected output file is missing or empty');
    expect(await fs.readFile(statePath, 'utf-8')).toBe(before);
  });

});

describe('phase review revision', () => {
  const flow = useFlowHarness();

  it('reruns the step with the feedback and revises the existing artifact in place', async () => {
    const gated = await completeResearchQuestions(flow.taskDir);
    const output = path.join(flow.taskDir, 'research-questions.md');

    const revised = await answerFlowQuestion(flow.taskDir, {
      question: gated.question!.id,
      answer: 'Tighten the scope section',
    });

    expect(revised.state).toBe('ready');
    expect(revised.completedStep).toBeUndefined();
    expect(revised.nextStep).toMatchObject({ id: 'research-questions', status: 'ready' });
    const next = await getFlowNext(flow.taskDir);
    expect(next.step?.prompt).toContain('Human answers to earlier open questions');
    expect(next.step?.prompt).toContain('Tighten the scope section');
    expect(next.step?.prompt).toContain(
      `A reviewer requested changes to ${output}. Revise it in place to address the feedback; keep settled decisions unless the feedback changes them.`
    );
    expect(next.step?.prompt).not.toContain('Regenerate the stage output');
    expect(await fs.readFile(output, 'utf-8')).toBe('# Research Questions\n');
    const stored = JSON.parse(await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8'));
    expect(stored.steps[0].interactions[0]).not.toHaveProperty('outputInvalidated');
    expect(stored.steps[0].interactions[0]).not.toHaveProperty('outputDraft');

    const regated = await completeFlowStep(flow.taskDir, { step: 'research-questions', output });
    expect(regated.state).toBe('needs-input');
    expect(regated.question?.id).toBe('research-questions-review-2');
  });

  it('keeps archiving the artifact for a child-raised round after a review revision', async () => {
    const gated = await completeResearchQuestions(flow.taskDir);
    const output = path.join(flow.taskDir, 'research-questions.md');
    await answerFlowQuestion(flow.taskDir, { question: gated.question!.id, answer: 'More detail' });
    await getFlowNext(flow.taskDir);
    const packetPath = await writeQuestionPacket(flow.taskDir, { questions: [OPEN_QUESTIONS.questions[0]] });
    await pauseFlowStep(flow.taskDir, { step: 'research-questions', questions: packetPath });

    await answerFlowQuestion(flow.taskDir, { question: 'interface', answer: 'webhook' });
    const next = await getFlowNext(flow.taskDir);

    await expect(fs.stat(output)).rejects.toThrow();
    expect(next.step?.prompt).toContain('Regenerate the stage output');
    expect(next.step?.prompt).not.toContain('A reviewer requested changes');
    const regated = await completeFlowStep(flow.taskDir, { step: 'research-questions' });
    expect(regated.state).toBe('blocked');
    await fs.writeFile(output, '# Regenerated\n', 'utf-8');
    const final = await completeFlowStep(flow.taskDir, { step: 'research-questions' });
    expect(final.question?.id).toBe('research-questions-review-3');
  });

});

describe('phase review child rounds', () => {
  const flow = useFlowHarness();

  it('rejects a child question id that claims a review gate id, writing nothing', async () => {
    const gated = await completeResearchQuestions(flow.taskDir);
    await answerFlowQuestion(flow.taskDir, { question: gated.question!.id, answer: 'More detail' });
    await getFlowNext(flow.taskDir);
    const packet = await writeQuestionPacket(flow.taskDir, {
      questions: [{ id: 'research-questions-review-3', prompt: 'Sneaky?', kind: 'input' }],
    });
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const before = await fs.readFile(statePath, 'utf-8');

    const paused = await pauseFlowStep(flow.taskDir, { step: 'research-questions', questions: packet });

    expect(paused.state).toBe('blocked');
    expect(paused.reason).toContain('research-questions-review-3');
    expect(paused.reason).toContain('reserved');
    expect(await fs.readFile(statePath, 'utf-8')).toBe(before);
  });

  it('blocks a child pause while the review question is pending', async () => {
    await completeResearchQuestions(flow.taskDir);
    const packet = await writeQuestionPacket(flow.taskDir);
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const before = await fs.readFile(statePath, 'utf-8');

    const paused = await pauseFlowStep(flow.taskDir, { step: 'research-questions', questions: packet });

    expect(paused.state).toBe('blocked');
    expect(paused.reason).toContain('already has unanswered questions');
    expect(await fs.readFile(statePath, 'utf-8')).toBe(before);
  });

  it.each(['revise', '  Revise  ', 'REVISE'])('rejects the bare option id %j as empty feedback', async (answer) => {
    const gated = await completeResearchQuestions(flow.taskDir);
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const before = await fs.readFile(statePath, 'utf-8');

    const result = await answerFlowQuestion(flow.taskDir, { question: gated.question!.id, answer });

    expect(result.state).toBe('blocked');
    expect(result.reason).toBe(
      'Question research-questions-review-1 needs feedback text to request changes.'
    );
    expect(await fs.readFile(statePath, 'utf-8')).toBe(before);
    const retried = await answerFlowQuestion(flow.taskDir, { question: gated.question!.id, answer: 'Add examples' });
    expect(retried.state).toBe('ready');
  });

  it('does not tell the child a reviewer requested changes while the gate is pending', async () => {
    await getFlowNext(flow.taskDir);
    const packet = await writeQuestionPacket(flow.taskDir, { questions: [OPEN_QUESTIONS.questions[0]] });
    await pauseFlowStep(flow.taskDir, { step: 'research-questions', questions: packet });
    await answerFlowQuestion(flow.taskDir, { question: 'interface', answer: 'webhook' });
    await getFlowNext(flow.taskDir);
    await fs.writeFile(path.join(flow.taskDir, 'research-questions.md'), '# Answered\n', 'utf-8');
    const gated = await completeFlowStep(flow.taskDir, { step: 'research-questions' });
    expect(gated.question?.id).toBe('research-questions-review-2');

    const pending = await getFlowStatus(flow.taskDir);

    expect(pending.state).toBe('needs-input');
    expect(pending.nextStep?.prompt).toContain('interface: webhook');
    expect(pending.nextStep?.prompt).not.toContain('A reviewer requested changes');
  });

});

describe('phase review end to end', () => {
  const flow = useFlowHarness();

  it('does not complete the step when approve answers a child-raised choice question', async () => {
    await completeResearchQuestions(flow.taskDir);
    await answerFlowQuestion(flow.taskDir, { question: 'research-questions-review-1', answer: 'Add examples' });
    await getFlowNext(flow.taskDir);
    const packet = await writeQuestionPacket(flow.taskDir, {
      questions: [{
        id: 'scope',
        prompt: 'Pick a scope',
        kind: 'choice',
        options: [
          { id: 'approve', label: 'Approve scope', consequence: 'Use the narrow scope.' },
          { id: 'broad', label: 'Broad', consequence: 'Use the broad scope.' },
        ],
      }],
    });
    await pauseFlowStep(flow.taskDir, { step: 'research-questions', questions: packet });

    const answered = await answerFlowQuestion(flow.taskDir, { question: 'scope', answer: 'approve' });

    expect(answered.state).toBe('ready');
    expect(answered.completedStep).toBeUndefined();
    expect(answered.nextStep).toMatchObject({ id: 'research-questions', status: 'ready' });
    expect(answered.steps[0]?.status).not.toBe('completed');
  });

  it('carries a revision, a child round, and the final approval end to end', async () => {
    const output = path.join(flow.taskDir, 'research-questions.md');
    const first = await completeResearchQuestions(flow.taskDir);
    await answerFlowQuestion(flow.taskDir, { question: first.question!.id, answer: 'Add examples' });
    await getFlowNext(flow.taskDir);
    const packet = await writeQuestionPacket(flow.taskDir, { questions: [OPEN_QUESTIONS.questions[0]] });
    await pauseFlowStep(flow.taskDir, { step: 'research-questions', questions: packet });
    await answerFlowQuestion(flow.taskDir, { question: 'interface', answer: 'webhook' });
    const rerun = await getFlowNext(flow.taskDir);
    expect(rerun.step?.prompt).toContain('Add examples');
    expect(rerun.step?.prompt).toContain('interface: webhook');
    expect(rerun.step?.prompt).toContain('Regenerate the stage output');
    expect(rerun.step?.prompt).not.toContain('A reviewer requested changes');
    await fs.writeFile(output, '# Revised\n', 'utf-8');

    const regated = await completeFlowStep(flow.taskDir, { step: 'research-questions', output });
    expect(regated.question?.id).toBe('research-questions-review-3');
    const approved = await answerFlowQuestion(flow.taskDir, { question: regated.question!.id, answer: 'approve' });

    expect(approved.state).toBe('ready');
    expect(approved.completedStep).toMatchObject({ id: 'research-questions', status: 'completed' });
    expect(approved.nextStep?.id).toBe('research');
  });

  it('does not gate the commit step', async () => {
    await flow.completeThroughImplement();

    const done = await completeFlowStep(flow.taskDir, { step: 'commit', commit: 'HEAD' });

    expect(done.state).toBe('complete');
    expect(done.completedStep?.id).toBe('commit');
  });
});

describe('deterministic workflow blockers', () => {
  const flow = useFlowHarness();

  it('blocks when a completed prior artifact is missing', async () => {
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await fs.rm(path.join(flow.taskDir, 'research-questions.md'));

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Missing completed artifact');
    expect(result.reason).toContain('research-questions.md');
  });

});

describe('deterministic workflow completion input blockers', () => {
  const flow = useFlowHarness();

  it.each(['status', 'complete'])('blocks %s when a completed prior artifact is missing', async (operation) => {
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await fs.rm(path.join(flow.taskDir, 'research-questions.md'));

    const result = operation === 'status'
      ? await getFlowStatus(flow.taskDir)
      : await completeFlowStep(flow.taskDir, { step: 'research', output: path.join(flow.taskDir, 'research.md') });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Missing completed artifact for step research-questions');
    expect((await readFlowEvents(flow.taskDir)).at(-1)).toMatchObject({
      state: 'blocked',
      code: 'missing_completed_artifact',
    });
  });

  it('blocks completion for a wrong step id', async () => {
    await getFlowNext(flow.taskDir);

    const result = await completeFlowStep(flow.taskDir, {
      step: 'research',
      output: path.join(flow.taskDir, 'research.md'),
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Expected step research-questions');
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
      step: 'research-questions',
      code: 'wrong_step',
    });
    expect(events.at(-1)?.reason).toEqual(expect.stringContaining('Expected step research-questions'));
  });

  it('blocks completion when the expected output file is empty', async () => {
    await getFlowNext(flow.taskDir);
    await fs.writeFile(path.join(flow.taskDir, 'research-questions.md'), '', 'utf-8');

    const result = await completeFlowStep(flow.taskDir, { step: 'research-questions' });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('missing or empty');
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
    expect(recovered.step?.id).toBe('research-questions');
  });

  it('blocks completion for a wrong output path', async () => {
    await getFlowNext(flow.taskDir);
    const wrongOutput = path.join(flow.taskDir, 'wrong.md');
    await fs.writeFile(wrongOutput, '# Wrong\n', 'utf-8');

    const result = await completeFlowStep(flow.taskDir, {
      step: 'research-questions',
      output: wrongOutput,
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Expected output path');
    expect(result.reason).toContain('research-questions.md');
  });
});

describe('deterministic workflow completion blockers', () => {
  const flow = useFlowHarness();

  it('blocks implement completion on a blank summary with missing_summary', async () => {
    await flow.advanceToImplement();
    await flow.seedRepository();
    await getFlowNext(flow.taskDir);

    const result = await completeFlowStep(flow.taskDir, { step: 'implement', summary: '   ' });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('non-empty --summary');
    expect((await readFlowEvents(flow.taskDir)).at(-1)).toMatchObject({
      event: 'flow_complete',
      step: 'implement',
      code: 'missing_summary',
    });
  });

  it('blocks commit completion without a commit SHA', async () => {
    await flow.completeThroughImplement();

    const status = await getFlowStatus(flow.taskDir);
    expect(status.nextStep?.id).toBe('commit');

    const result = await completeFlowStep(flow.taskDir, {
      step: 'commit',
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('commit SHA');
  });
});

describe('flow dispatch with unreadable memory', () => {
  const flow = useFlowHarness();

  it('keeps the flow dispatchable when MEMORY.md cannot be read', async () => {
    const configDir = path.join(flow.projectRoot, 'spok');
    await fs.mkdir(path.join(configDir, 'MEMORY.md'), { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n', 'utf-8');

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step?.prompt).toContain('`spok-create-research-questions`');
    expect(result.step?.prompt).not.toContain('MEMORY.md');
    expect(result.memoryRuleCount).toBe(0);
    expect(result.memoryWarning).toContain('could not be read; no rules were applied.');
  });
});

describe('flow open questions', () => {
  const flow = useFlowHarness();

  async function advanceToDesignDiscussion(): Promise<void> {
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await flow.completeFileStep('research', 'research.md');
  }

  it('persists questions without completing or rerouting the current step', async () => {
    await advanceToDesignDiscussion();
    const ready = await getFlowNext(flow.taskDir);
    const packetPath = await writeQuestionPacket(flow.taskDir);

    const paused = await pauseFlowStep(flow.taskDir, {
      step: 'design-discussion',
      questions: packetPath,
    });

    expect(paused.state).toBe('needs-input');
    expect(paused.question).toMatchObject({ id: 'interface', prompt: 'Choose the public interface' });
    expect(paused.nextStep).toMatchObject({ id: 'design-discussion', status: 'ready' });
    expect(paused.completedStep).toBeUndefined();
    expect(routing(paused.nextStep)).toEqual(routing(ready.step));

    process.env.CODEX_THREAD_ID = `thread-${randomUUID()}`;
    const resumed = await getFlowStatus(flow.taskDir);
    expect(resumed.state).toBe('needs-input');
    expect(resumed.profile).toBe('codex');
    expect(resumed.question?.id).toBe('interface');
    expect(routing(resumed.nextStep)).toEqual(routing(ready.step));

    const output = path.join(flow.taskDir, 'design-discussion.md');
    await fs.writeFile(output, '# Design Discussion\n', 'utf-8');
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const beforeCompletion = await fs.readFile(statePath, 'utf-8');
    const prematureCompletion = await completeFlowStep(flow.taskDir, {
      step: 'design-discussion',
      output,
    });
    expect(prematureCompletion.state).toBe('blocked');
    expect(prematureCompletion.reason).toBe(
      'Step design-discussion has unanswered questions.'
    );
    expect((await getFlowStatus(flow.taskDir)).state).toBe('needs-input');
    expect(await fs.readFile(statePath, 'utf-8')).toBe(beforeCompletion);

    const stored = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    const storedStep = stored.steps.find((step: FlowStep) => step.id === 'design-discussion');
    expect(storedStep).toMatchObject({
      status: 'ready',
      interactions: [{ round: 1, questions: OPEN_QUESTIONS.questions, answers: [] }],
    });
    expect(storedStep).not.toHaveProperty('prompt');
  });

  it('answers questions in order and reruns the same step with durable answers', async () => {
    await advanceToDesignDiscussion();
    const initial = await getFlowNext(flow.taskDir);
    expect(initial.step?.prompt).toContain(
      path.join(flow.taskDir, 'open-questions', 'design-discussion-round-1.json')
    );
    const packetPath = await writeQuestionPacket(flow.taskDir);
    await pauseFlowStep(flow.taskDir, { step: 'design-discussion', questions: packetPath });

    const first = await answerFlowQuestion(flow.taskDir, {
      question: 'interface',
      answer: 'webhook',
    });
    expect(first.state).toBe('needs-input');
    expect(first.question?.id).toBe('failure-policy');
    expect(first.nextStep?.id).toBe('design-discussion');

    const second = await answerFlowQuestion(flow.taskDir, {
      question: 'failure-policy',
      answer: 'retry',
    });
    expect(second.state).toBe('ready');
    expect(second.question).toBeUndefined();
    expect(second.nextStep?.id).toBe('design-discussion');
    expect(second.nextStep?.prompt).toContain('interface: webhook');
    expect(second.nextStep?.prompt).toContain('failure-policy: retry');
    expect(second.nextStep?.prompt).toContain('Regenerate the stage output after applying these answers.');
    expect(second.nextStep?.prompt).toContain(
      path.join(flow.taskDir, 'open-questions', 'design-discussion-round-2.json')
    );

    const resumed = await getFlowNext(flow.taskDir);
    expect(resumed.step?.id).toBe('design-discussion');
    expect(resumed.step?.prompt).toContain('interface: webhook');
    expect(resumed.step?.prompt).toContain('failure-policy: retry');
  });

  it('rejects a stage artifact created before the final answer', async () => {
    await advanceToDesignDiscussion();
    await getFlowNext(flow.taskDir);
    const packetPath = await writeQuestionPacket(flow.taskDir);
    await pauseFlowStep(flow.taskDir, { step: 'design-discussion', questions: packetPath });
    const output = path.join(flow.taskDir, 'design-discussion.md');
    await fs.writeFile(output, '# Stale Design Discussion\n', 'utf-8');

    await answerFlowQuestion(flow.taskDir, { question: 'interface', answer: 'webhook' });
    await answerFlowQuestion(flow.taskDir, { question: 'failure-policy', answer: 'retry' });

    const stale = await completeFlowStep(flow.taskDir, { step: 'design-discussion', output });
    expect(stale.state).toBe('blocked');
    expect(stale.reason).toContain('must regenerate its output after answering questions');

    await fs.writeFile(output, '# Answered Design Discussion\n', 'utf-8');
    const gated = await completeFlowStep(flow.taskDir, { step: 'design-discussion', output });
    expect(gated.question?.id).toBe('design-discussion-review-2');
    const completed = await approveGate(flow.taskDir, gated);
    expect(completed.state).toBe('ready');
    expect(completed.completedStep?.id).toBe('design-discussion');
  });

  it.each(['alias', '..questions.json'])('accepts a contained packet through %s', async (kind) => {
    await advanceToDesignDiscussion();
    const packet = await writeQuestionPacket(flow.taskDir);
    let inputPath = path.join(flow.taskDir, '..questions.json');
    if (kind === 'alias') {
      const alias = path.join(flow.projectRoot, 'task-alias');
      await fs.symlink(flow.taskDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
      inputPath = path.join(alias, path.basename(packet));
    } else {
      await fs.rename(packet, inputPath);
    }

    const result = await pauseFlowStep(flow.taskDir, {
      step: 'design-discussion', questions: inputPath,
    });
    expect(result.state).toBe('needs-input');
  });

  async function pauseForFinalAnswer(): Promise<string> {
    await advanceToDesignDiscussion();
    const packet = await writeQuestionPacket(flow.taskDir, { questions: [OPEN_QUESTIONS.questions[0]] });
    await pauseFlowStep(flow.taskDir, { step: 'design-discussion', questions: packet });
    return path.join(flow.taskDir, 'design-discussion.md');
  }

  async function storedAnsweredInteraction(): Promise<FlowInteraction> {
    const stored = JSON.parse(await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8'));
    return stored.steps.find((step: FlowStep) => step.id === 'design-discussion').interactions.at(-1);
  }

  it('archives a future-dated pre-answer output and names the draft in the resumed prompt', async () => {
    const output = await pauseForFinalAnswer();
    const draftContent = '# Prior design decisions\n';
    await fs.writeFile(output, draftContent);
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(output, future, future);

    const answered = await answerFlowQuestion(flow.taskDir, { question: 'interface', answer: 'webhook' });
    const interaction = await storedAnsweredInteraction();
    expect(answered.state).toBe('ready');
    expect(interaction.outputInvalidated).toBe(true);
    expect(await fs.readFile(interaction.outputDraft!, 'utf-8')).toBe(draftContent);
    expect(answered.nextStep?.prompt).toContain(interaction.outputDraft);
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    const completed = await completeFlowStep(flow.taskDir, { step: 'design-discussion', output });
    expect(completed.state).toBe('blocked');
    expect(completed.reason).toContain('must regenerate its output after answering questions');
  });

  it('accepts identical regenerated bytes with mtime equal to the final answer', async () => {
    const output = await pauseForFinalAnswer();
    const content = '# Design with the selected interface\n';
    await fs.writeFile(output, content);
    await answerFlowQuestion(flow.taskDir, { question: 'interface', answer: 'webhook' });
    const interaction = await storedAnsweredInteraction();
    await fs.writeFile(output, content);
    const answeredAt = new Date(interaction.resolvedAt!);
    await fs.utimes(output, answeredAt, answeredAt);

    await getFlowStatus(flow.taskDir);
    await getFlowNext(flow.taskDir);
    await getFlowNext(flow.taskDir);
    expect(await fs.readFile(output, 'utf-8')).toBe(content);
    const completed = await completeAndApprove(flow.taskDir, { step: 'design-discussion', output });
    expect(completed.completedStep?.id).toBe('design-discussion');
  });

  it('recovers a final answer after draft rename but before the invalidation flag was saved', async () => {
    const output = await pauseForFinalAnswer();
    await fs.writeFile(output, '# Pre-answer draft\n');
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const writeFile = fs.writeFile.bind(fs);
    let stateWrites = 0;
    const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      if (args[0] === statePath && ++stateWrites === 2) throw new Error('simulated state write failure');
      return writeFile(...args);
    });
    const answered = await answerFlowQuestion(flow.taskDir, { question: 'interface', answer: 'webhook' });
    writeSpy.mockRestore();
    expect(answered.state).toBe('blocked');
    expect(answered.reason).toContain('Retry spok flow next');
    expect((await storedAnsweredInteraction()).resolvedAt).toBeDefined();
    expect((await storedAnsweredInteraction()).outputInvalidated).toBeUndefined();
    await fs.writeFile(output, '# Regenerated design\n');
    const pendingState = await fs.readFile(statePath, 'utf-8');
    expect((await getFlowStatus(flow.taskDir)).state).toBe('ready');
    expect(await fs.readFile(statePath, 'utf-8')).toBe(pendingState);

    expect((await getFlowNext(flow.taskDir)).state).toBe('ready');
    const interaction = await storedAnsweredInteraction();
    expect(interaction.outputInvalidated).toBe(true);
    expect(await fs.readFile(interaction.outputDraft!, 'utf-8')).toBe('# Pre-answer draft\n');
    expect(await fs.readFile(output, 'utf-8')).toBe('# Regenerated design\n');
    expect((await completeAndApprove(flow.taskDir, { step: 'design-discussion', output })).completedStep?.id)
      .toBe('design-discussion');
  });

  it('retains a final answer when archiving fails and retries through next', async () => {
    const output = await pauseForFinalAnswer();
    await fs.writeFile(output, '# Pre-answer draft\n');
    const renameSpy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated rename failure'));
    const answered = await answerFlowQuestion(flow.taskDir, { question: 'interface', answer: 'webhook' });
    renameSpy.mockRestore();
    expect(answered.state).toBe('blocked');
    expect((await storedAnsweredInteraction()).answers[0].answer).toBe('webhook');
    expect(await fs.readFile(output, 'utf-8')).toBe('# Pre-answer draft\n');

    expect((await getFlowNext(flow.taskDir)).state).toBe('ready');
    const interaction = await storedAnsweredInteraction();
    expect(interaction.outputInvalidated).toBe(true);
    expect(await fs.readFile(interaction.outputDraft!, 'utf-8')).toBe('# Pre-answer draft\n');
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['next', 'complete'])('safely upgrades legacy answered state through %s', async (command) => {
    const output = await pauseForFinalAnswer();
    await answerFlowQuestion(flow.taskDir, { question: 'interface', answer: 'webhook' });
    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    const stored = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    delete stored.steps.find((step: FlowStep) => step.id === 'design-discussion').interactions[0].outputInvalidated;
    await fs.writeFile(statePath, JSON.stringify(stored));
    await fs.writeFile(output, '# Legacy pre-answer draft\n');
    const stateBeforeStatus = await fs.readFile(statePath, 'utf-8');
    expect((await getFlowStatus(flow.taskDir)).state).toBe('ready');
    expect(await fs.readFile(statePath, 'utf-8')).toBe(stateBeforeStatus);
    expect(await fs.readFile(output, 'utf-8')).toBe('# Legacy pre-answer draft\n');

    if (command === 'next') {
      expect((await getFlowNext(flow.taskDir)).state).toBe('ready');
    } else {
      const result = await completeFlowStep(flow.taskDir, { step: 'design-discussion', output });
      expect(result.state).toBe('blocked');
      expect(result.reason).toContain('must regenerate');
    }
    const interaction = await storedAnsweredInteraction();
    expect(await fs.readFile(interaction.outputDraft!, 'utf-8')).toBe('# Legacy pre-answer draft\n');
    await fs.writeFile(output, '# Regenerated legacy draft\n');
    await getFlowNext(flow.taskDir);
    expect(await fs.readFile(output, 'utf-8')).toBe('# Regenerated legacy draft\n');
  });

  it('rejects a task-local packet symlink that resolves outside the task directory', async () => {
    if (process.platform === 'win32') return;
    await advanceToDesignDiscussion();
    await getFlowNext(flow.taskDir);
    const outsidePacket = path.join(flow.projectRoot, 'outside-questions.json');
    await fs.writeFile(outsidePacket, JSON.stringify(OPEN_QUESTIONS), 'utf-8');
    const packetLink = path.join(flow.taskDir, 'linked-questions.json');
    await fs.symlink(outsidePacket, packetLink);

    const result = await pauseFlowStep(flow.taskDir, {
      step: 'design-discussion',
      questions: packetLink,
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('must be inside the task directory');
    expect((await getFlowStatus(flow.taskDir)).state).toBe('ready');
  });

  it('blocks malformed packets and out-of-order answers without changing state', async () => {
    await advanceToDesignDiscussion();
    await getFlowNext(flow.taskDir);
    const malformedPath = await writeQuestionPacket(flow.taskDir, {
      questions: [{ id: 'interface', prompt: 'Choose', kind: 'choice', options: [] }],
    });

    const malformed = await pauseFlowStep(flow.taskDir, {
      step: 'design-discussion',
      questions: malformedPath,
    });
    expect(malformed.state).toBe('blocked');
    expect(malformed.reason).toContain('Invalid questions packet');
    expect((await getFlowStatus(flow.taskDir)).state).toBe('ready');

    const packetPath = await writeQuestionPacket(flow.taskDir);
    await pauseFlowStep(flow.taskDir, { step: 'design-discussion', questions: packetPath });
    const before = await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8');

    const outOfOrder = await answerFlowQuestion(flow.taskDir, {
      question: 'failure-policy',
      answer: 'retry',
    });
    expect(outOfOrder.state).toBe('blocked');
    expect(outOfOrder.reason).toBe('Expected question interface, got failure-policy.');
    expect(await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')).toBe(before);
  });
});

describe('flow step prompt composition', () => {
  const flow = useFlowHarness();

  it('composes a dispatchable prompt without a memory file', async () => {
    const result = await getFlowNext(flow.taskDir);

    expect(result.step?.prompt).toContain('`spok-create-research-questions`');
    expect(result.step?.prompt).toContain(path.join(flow.taskDir, 'ticket.md'));
    expect(result.step?.prompt).toContain('return the absolute path');
    expect(result.step?.prompt).toContain('`NEEDS_INPUT: <absolute-question-packet-path>`');
    expect(result.step?.prompt).toContain('normal completion are mutually exclusive');
    expect(result.step?.prompt).toContain(
      path.join(flow.taskDir, 'open-questions', 'research-questions-round-1.json')
    );
    expect(result.step?.prompt).toContain('Do not ask the user directly');
    expect(result.step?.prompt).not.toContain('approval between stages');
    expect(result.step?.prompt).not.toContain('stays OPEN for the user');
    expect(result.step?.prompt).not.toContain('do not require human review');
    expect(result.step?.prompt).not.toContain('MEMORY.md');
    expect(result.memoryPath).toBeUndefined();
    expect(result.memoryWarning).toBeUndefined();
  });

  it('keeps every consequential design question open for the user in the design-discussion prompt', async () => {
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await flow.completeFileStep('research', 'research.md');

    const result = await getFlowNext(flow.taskDir);

    expect(result.step?.id).toBe('design-discussion');
    expect(result.step?.prompt).toContain('Every consequential design question stays OPEN for the user');
    expect(result.step?.prompt).toContain('never resolve one yourself');
    expect(result.step?.prompt).toContain('only the user\'s answers resolve them');
    expect(result.step?.prompt).toContain('`NEEDS_INPUT: <absolute-question-packet-path>`');
    expect(result.step?.prompt).not.toContain('Resolve decisions autonomously');
  });

});

describe('flow step prompt memory rules', () => {
  const flow = useFlowHarness();

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
    await flow.advanceToImplement();
    await flow.seedRepository();

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

describe('outline artifact selection', () => {
  const flow = useFlowHarness();

  it('keeps the outline selector across every execution stage despite a stray plan', async () => {
    await flow.advanceToImplement();
    await flow.seedRepository();
    await fs.writeFile(path.join(flow.taskDir, 'plan.md'), '# Stray plan\n');
    const selected = `Implementation artifact: ${path.join(flow.taskDir, 'structure-outline.md')}`;
    const expectSelected = async (id: string) => {
      const next = await getFlowNext(flow.taskDir);
      expect(next.step?.id).toBe(id);
      expect(next.step?.prompt?.split('\n')).toContain(selected);
      expect(next.steps.some((step) => step.id === 'plan')).toBe(false);
    };
    await expectSelected('implement');
    await expectSelected('implement');
    await flow.completeSummaryStep('implement', 'Implemented the outline.');
    await expectSelected('commit');
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
      'Next step: research-questions',
      'Profile: claude',
      'Runner: claude',
      'Skill: spok-create-research-questions',
      'Model: opus',
      'Effort: medium',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'research-questions.md')}`,
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
      'Next step: research-questions',
      'Profile: auto',
      'Route: unresolved until spok flow next',
      'Skill: spok-create-research-questions',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'research-questions.md')}`,
    ]);
  });

  it('prints policy and rejections for a resolved auto step', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(withCapabilityReports([CODEX_LOGGED_OUT]));

    await flowNextCommand(flow.taskDir);

    expect(logs).toEqual([
      'Next step: research-questions',
      'Profile: auto',
      'Runner: omp',
      'Skill: spok-create-research-questions',
      'Model: openai-codex/gpt-5.6-sol',
      'Effort: medium',
      'Policy: auto-v1',
      'Rejected: codex gpt-5.6-sol medium — codex login status reported: Not logged in',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'research-questions.md')}`,
    ]);
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
      'Next step: research-questions',
      'Profile: auto',
      'Runner: current',
      'Skill: spok-create-research-questions',
      'Policy: auto-v1',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'research-questions.md')}`,
    ]);
  });

  it('prints the degraded current route in text mode', async () => {
    process.env.SPOK_FLOW_PROFILE = 'auto';
    vi.mocked(probeHarnesses).mockResolvedValue(NOTHING_AVAILABLE);

    await flowNextCommand(flow.taskDir);

    expect(logs).toEqual([
      'Next step: research-questions',
      'Profile: auto',
      'Runner: current',
      'Skill: spok-create-research-questions',
      'Policy: auto-v1',
      'Degraded: No explicit auto candidate is eligible; running on the current harness whose model identity is unavailable.',
      'Rejected: codex gpt-5.6-sol medium — codex is not installed or not on PATH.',
      'Rejected: omp openai-codex/gpt-5.6-sol medium — omp is not installed or not on PATH.',
      'Rejected: claude opus medium — claude auth status --json reports loggedIn is not true.',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'research-questions.md')}`,
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

    expect(logs).toEqual(['Blocked: Expected step research-questions, got research.']);
  });

  it('sets a nonzero exit code for blocked outcomes', async () => {
    await getFlowNext(flow.taskDir);

    await flowCompleteCommand(flow.taskDir, { step: 'research' });

    expect(process.exitCode).toBe(1);
  });

  it('prints completion in text mode', async () => {
    await flow.completeThroughImplement();

    await flowCompleteCommand(flow.taskDir, {
      step: 'commit',
      commit: 'HEAD',
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
        id: 'research-questions',
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
  await flow.advanceToImplement();
  await flow.seedRepository();
  const next = await getFlowNext(flow.taskDir);
  expect(next.state, next.reason).toBe('ready');
  expect(next.step?.id).toBe('implement');
}

async function advanceLegacyToCommit(flow: FlowHarness, workRoot: string): Promise<void> {
  await advanceToImplement(flow);
  await seedLegacyImplementation(flow.taskDir, workRoot);
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

  it('preserves the implement work root in legacy workflow state', async () => {
    await advanceLegacyToCommit(flow, repo.path);

    const state = JSON.parse(
      await fs.readFile(path.join(flow.taskDir, WORKFLOW_STATE_FILE), 'utf-8')
    );
    const implement = state.steps.find((step: { id: string }) => step.id === 'implement');
    expect(implement.result.workRoot).toBe(repo.path);

    // Reloading state must not drop it: the commit prompt is built from it.
    expect((await getFlowStatus(flow.taskDir)).workRoot).toBe(repo.path);
  });

  it('preserves an aliased work-root spelling while verifying its repository identity', async () => {
    await advanceLegacyToCommit(flow, repo.aliasPath);

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

  it('names the work root in the commit step prompt', async () => {
    await advanceLegacyToCommit(flow, repo.path);

    const next = await getFlowNext(flow.taskDir);

    expect(next.step?.id).toBe('commit');
    expect(next.step?.prompt).toContain(`Run every git command with \`-C ${repo.path}\``);
    expect(next.step?.prompt).toContain('Do not search other directories');
    expect(next.workRootWarning).toBeUndefined();
  });

  it('blocks supplied roots that differ from the prepared execution root', async () => {
    await advanceToImplement(flow);

    const blank = await completeFlowStep(flow.taskDir, {
      step: 'implement',
      summary: 'Implemented the plan.',
      workRoot: '   ',
    });
    expect(blank.state).toBe('blocked');
    expect(blank.reason).toContain('conflicts with recorded execution root');

    const relative = await completeFlowStep(flow.taskDir, {
      step: 'implement',
      summary: 'Implemented the plan.',
      workRoot: 'some/relative/path',
    });
    expect(relative.state).toBe('blocked');
    expect(relative.reason).toContain('conflicts with recorded execution root');

    const missing = await completeFlowStep(flow.taskDir, {
      step: 'implement',
      summary: 'Implemented the plan.',
      workRoot: path.join(repo.path, 'not-here'),
    });
    expect(missing.state).toBe('blocked');
    expect(missing.reason).toContain('conflicts with recorded execution root');
  });
});

describe('commit SHA verification', () => {
  const flow = useFlowHarness();
  const repo = useWorkRootRepo();

  it('accepts a commit reachable from HEAD in the recorded work root', async () => {
    await advanceLegacyToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, { step: 'commit', commit: repo.headSha });

    expect(result.state).toBe('complete');
    expect(result.completedStep?.result).toMatchObject({
      commit: repo.headSha,
      workRoot: repo.path,
    });
  });

  it('resolves a revision expression before recording the commit', async () => {
    await advanceLegacyToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, { step: 'commit', commit: 'HEAD' });

    expect(result.state).toBe('complete');
    expect(result.completedStep?.result?.commit).toBe(repo.headSha);
  });

  it('blocks a SHA that names no commit object in the recorded work root', async () => {
    await advanceLegacyToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, { step: 'commit', commit: 'abc123' });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('is not a commit object in');
  });

  it('blocks a real commit that HEAD cannot reach', async () => {
    await advanceLegacyToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, {
      step: 'commit',
      commit: repo.unreachableSha,
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('is not reachable from HEAD in');
  });

  it('warns and accepts any SHA when legacy state recorded no work root', async () => {
    await flow.completeThroughImplement();
    await seedLegacyImplementation(flow.taskDir);

    const next = await getFlowNext(flow.taskDir);
    expect(next.step?.id).toBe('commit');
    expect(next.step?.prompt).not.toContain('Run every git command with');
    expect(next.workRootWarning).toContain('No work root was recorded');

    const result = await completeFlowStep(flow.taskDir, { step: 'commit', commit: 'abc123' });
    expect(result.state).toBe('complete');
  });

  it('verifies and records an explicitly supplied work root for legacy state', async () => {
    await flow.completeThroughImplement();
    await seedLegacyImplementation(flow.taskDir);

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
    await advanceLegacyToCommit(flow, repo.path);

    const result = await completeFlowStep(flow.taskDir, {
      step: 'commit',
      commit: repo.headSha,
      workRoot: flow.projectRoot,
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('conflicts with recorded work root');
  });
});
