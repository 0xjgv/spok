import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  completeFlowStep,
  flowCompleteCommand,
  flowNextCommand,
  flowStatusCommand,
  getFlowEventLogPath,
  getFlowNext,
  getFlowStatus,
  WORKFLOW_STATE_FILE,
} from '../../../src/commands/workflow/flow.js';

interface FlowHarness {
  readonly projectRoot: string;
  readonly taskDir: string;
  enableSelfLearn(): Promise<void>;
  completeProblemValidation(decision?: string): Promise<void>;
  completeFileStep(step: string, filename: string): Promise<void>;
  completeSummaryStep(step: string, summary: string): Promise<void>;
  advanceToValidate(): Promise<void>;
  completeValidate(content: string): ReturnType<typeof completeFlowStep>;
  completeThroughValidation(): Promise<void>;
  completeRepair(summary?: string): Promise<void>;
}

const PASS_VALIDATION = '---\nverdict: PASS\n---\n\n# Validation\n';
const FAIL_VALIDATION =
  '---\nverdict: FAIL\n---\n\n# Validation\n\n## Blocking Findings\n\n- something broke\n';

const EXPECTED_STEP_ROUTING = [
  { id: 'validate-problem', model: 'opus', effort: 'xhigh' },
  { id: 'research-questions', model: 'opus', effort: 'xhigh' },
  { id: 'research', model: 'sonnet', effort: 'xhigh' },
  { id: 'design-discussion', model: 'fable', effort: 'high' },
  { id: 'structure-outline', model: 'fable', effort: 'high' },
  { id: 'plan', model: 'fable', effort: 'high' },
  { id: 'implement', model: 'sonnet', effort: 'xhigh' },
  { id: 'simplify', model: 'opus', effort: 'xhigh' },
  { id: 'validate', model: 'opus', effort: 'xhigh' },
  { id: 'commit', model: 'haiku', effort: undefined },
];

const EXPECTED_SELF_LEARN_STEP_ROUTING = [
  ...EXPECTED_STEP_ROUTING,
  { id: 'self-learn', model: 'sonnet', effort: 'xhigh' },
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

async function writeMemory(projectRoot: string, text: string): Promise<void> {
  const configDir = path.join(projectRoot, 'spok');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n', 'utf-8');
  await fs.writeFile(path.join(configDir, 'MEMORY.md'), text, 'utf-8');
}

function useFlowHarness(): FlowHarness {
  let tempDir: string;
  let taskDir: string;
  let originalCodexHome: string | undefined;

  beforeEach(async () => {
    originalCodexHome = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    tempDir = path.join(os.tmpdir(), `spok-flow-${randomUUID()}`);
    taskDir = path.join(tempDir, 'spok', 'changes', 'demo', '.flow', 'chunk-one');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, 'ticket.md'), '# Chunk One\n', 'utf-8');
  });

  afterEach(async () => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
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

  async function advanceToValidate() {
    await completeProblemValidation();
    await completeFileStep('research-questions', 'research-questions.md');
    await completeFileStep('research', 'research.md');
    await completeFileStep('design-discussion', 'design-discussion.md');
    await completeFileStep('structure-outline', 'structure-outline.md');
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
    expect(result.step).toMatchObject({
      id: 'validate-problem',
      skill: 'spok-validate-problem',
      model: 'opus',
      effort: 'xhigh',
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

    expect(result.steps.map(({ id, model, effort }) => ({ id, model, effort }))).toEqual([
      { id: 'validate-problem', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'research-questions', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'research', model: 'gpt-5.6-terra', effort: 'xhigh' },
      { id: 'design-discussion', model: 'gpt-5.6-sol', effort: 'max' },
      { id: 'structure-outline', model: 'gpt-5.6-sol', effort: 'max' },
      { id: 'plan', model: 'gpt-5.6-sol', effort: 'max' },
      { id: 'implement', model: 'gpt-5.6-terra', effort: 'xhigh' },
      { id: 'simplify', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'validate', model: 'gpt-5.6-sol', effort: 'xhigh' },
      { id: 'commit', model: 'gpt-5.6-terra', effort: 'low' },
    ]);
  });

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

describe('deterministic workflow state resumption', () => {
  const flow = useFlowHarness();

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
    expect(result.step).toMatchObject({
      id: 'design-discussion',
      skill: 'spok-create-design-discussion',
      model: 'fable',
      effort: 'high',
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
      effort: 'high',
      status: 'ready',
    });
    expectStepRouting(result.steps);
    const normalizedState = JSON.parse(await fs.readFile(statePath, 'utf-8'));
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
    expectStepRouting(result.steps); // the linear ten-step graph, routing intact

    const normalizedState = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(normalizedState.repairAttempts).toBe(0);
    expectStepRouting(normalizedState.steps);
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
      effort: 'xhigh',
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
      'structure-outline', 'plan', 'implement', 'simplify',
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
    await flow.completeFileStep('plan', 'plan.md');

    const result = await getFlowNext(flow.taskDir);

    expect(result.step?.id).toBe('implement');
    expect(result.step?.prompt).toContain('do NOT create any commits');
    expect(result.step?.prompt).toContain('return a concise summary');
    expect(result.step?.prompt).not.toContain('absolute path');
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
      'Skill: spok-validate-problem',
      'Model: opus',
      'Effort: xhigh',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'problem-validation.md')}`,
    ]);
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
      nextStep: { id: 'validate-problem', model: 'opus', effort: 'xhigh' },
    });
    expectStepRouting(response.steps);
  });
});
