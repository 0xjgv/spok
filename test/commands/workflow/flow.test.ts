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
  completeThroughValidation(): Promise<void>;
}

const EXPECTED_STEP_ROUTING = [
  { id: 'validate-problem', model: 'opus', effort: 'xhigh' },
  { id: 'research-questions', model: 'opus', effort: 'xhigh' },
  { id: 'research', model: 'sonnet', effort: undefined },
  { id: 'design-discussion', model: 'opus', effort: 'xhigh' },
  { id: 'structure-outline', model: 'opus', effort: 'xhigh' },
  { id: 'plan', model: 'opus', effort: 'xhigh' },
  { id: 'implement', model: 'opus', effort: 'xhigh' },
  { id: 'simplify', model: 'sonnet', effort: undefined },
  { id: 'validate', model: 'opus', effort: 'xhigh' },
  { id: 'commit', model: 'haiku', effort: undefined },
];

const EXPECTED_SELF_LEARN_STEP_ROUTING = [
  ...EXPECTED_STEP_ROUTING,
  { id: 'self-learn', model: 'sonnet', effort: undefined },
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

  async function completeThroughValidation() {
    await completeProblemValidation();
    await completeFileStep('research-questions', 'research-questions.md');
    await completeFileStep('research', 'research.md');
    await completeFileStep('design-discussion', 'design-discussion.md');
    await completeFileStep('structure-outline', 'structure-outline.md');
    await completeFileStep('plan', 'plan.md');
    await completeSummaryStep('implement', 'Implemented the plan.');
    await completeSummaryStep('simplify', 'Simplified the implementation.');
    await completeFileStep('validate', 'validation.md');
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
    completeThroughValidation,
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

  it('routes every step to gpt-5.5 with codex efforts when CODEX_HOME is set', async () => {
    process.env.CODEX_HOME = path.join(os.tmpdir(), `codex-${randomUUID()}`);

    const result = await getFlowNext(flow.taskDir);

    expect(result.steps.map(({ id, model, effort }) => ({ id, model, effort }))).toEqual([
      { id: 'validate-problem', model: 'gpt-5.5', effort: 'xhigh' },
      { id: 'research-questions', model: 'gpt-5.5', effort: 'xhigh' },
      { id: 'research', model: 'gpt-5.5', effort: 'medium' },
      { id: 'design-discussion', model: 'gpt-5.5', effort: 'xhigh' },
      { id: 'structure-outline', model: 'gpt-5.5', effort: 'xhigh' },
      { id: 'plan', model: 'gpt-5.5', effort: 'xhigh' },
      { id: 'implement', model: 'gpt-5.5', effort: 'xhigh' },
      { id: 'simplify', model: 'gpt-5.5', effort: 'medium' },
      { id: 'validate', model: 'gpt-5.5', effort: 'xhigh' },
      { id: 'commit', model: 'gpt-5.5', effort: 'low' },
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
      model: 'opus',
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
      model: 'opus',
      effort: 'xhigh',
      status: 'ready',
    });
    expectStepRouting(result.steps);
    const normalizedState = JSON.parse(await fs.readFile(statePath, 'utf-8'));
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
