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
  readonly taskDir: string;
  completeFileStep(step: string, filename: string): Promise<void>;
  completeSummaryStep(step: string, summary: string): Promise<void>;
  completeThroughValidation(): Promise<void>;
}

const EXPECTED_STEP_MODELS = [
  { id: 'research-questions', model: 'fable' },
  { id: 'research', model: 'sonnet' },
  { id: 'design-discussion', model: 'fable' },
  { id: 'structure-outline', model: 'opus' },
  { id: 'plan', model: 'fable' },
  { id: 'implement', model: 'opus' },
  { id: 'simplify', model: 'sonnet' },
  { id: 'validate', model: 'fable' },
  { id: 'commit', model: 'haiku' },
];

function expectStepModels(steps: Array<{ id: string; model?: string }>) {
  expect(steps.map(({ id, model }) => ({ id, model }))).toEqual(EXPECTED_STEP_MODELS);
}

function useFlowHarness(): FlowHarness {
  let tempDir: string;
  let taskDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `spok-flow-${randomUUID()}`);
    taskDir = path.join(tempDir, 'spok', 'changes', 'demo', '.flow', 'chunk-one');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, 'ticket.md'), '# Chunk One\n', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

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
    get taskDir() {
      return taskDir;
    },
    completeFileStep,
    completeSummaryStep,
    completeThroughValidation,
  };
}

describe('deterministic workflow step state', () => {
  const flow = useFlowHarness();

  it('returns research questions as the first step when only ticket.md exists', async () => {
    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step).toMatchObject({
      id: 'research-questions',
      skill: 'spok-create-research-questions',
      model: 'fable',
      argument: path.join(flow.taskDir, 'ticket.md'),
      expectedOutput: path.join(flow.taskDir, 'research-questions.md'),
      status: 'ready',
    });
    expectStepModels(result.steps);

    const statePath = path.join(flow.taskDir, WORKFLOW_STATE_FILE);
    await expect(fs.stat(statePath)).resolves.toBeTruthy();
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expectStepModels(state.steps);
  });

  it('does not create the state file on a status query', async () => {
    const result = await getFlowStatus(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.nextStep?.id).toBe('research-questions');
    expectStepModels(result.steps);
    await expect(fs.stat(path.join(flow.taskDir, WORKFLOW_STATE_FILE))).rejects.toThrow();
  });

  it('completes a file step without --output when the expected file exists', async () => {
    await getFlowNext(flow.taskDir);
    await fs.writeFile(path.join(flow.taskDir, 'research-questions.md'), '# RQ\n', 'utf-8');

    const result = await completeFlowStep(flow.taskDir, { step: 'research-questions' });

    expect(result.state).toBe('ready');
    expect(result.completedStep?.status).toBe('completed');
    expect(result.nextStep?.id).toBe('research');
  });

  it('validates the expected output before advancing to the next step', async () => {
    await getFlowNext(flow.taskDir);
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
    await flow.completeFileStep('research-questions', 'research-questions.md');
    await flow.completeFileStep('research', 'research.md');

    const result = await getFlowNext(flow.taskDir);

    expect(result.state).toBe('ready');
    expect(result.step).toMatchObject({
      id: 'design-discussion',
      skill: 'spok-create-design-discussion',
      model: 'fable',
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
      status: 'ready',
    });
    expectStepModels(result.steps);
    const normalizedState = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expectStepModels(normalizedState.steps);
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

  it('blocks completion for a wrong step id', async () => {
    await getFlowNext(flow.taskDir);

    const result = await completeFlowStep(flow.taskDir, {
      step: 'research',
      output: path.join(flow.taskDir, 'research.md'),
    });

    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Expected step research-questions');
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
      'Skill: spok-create-research-questions',
      'Model: fable',
      `Argument: ${path.join(flow.taskDir, 'ticket.md')}`,
      `Expected output: ${path.join(flow.taskDir, 'research-questions.md')}`,
    ]);
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
      nextStep: { id: 'research-questions', model: 'fable' },
    });
    expectStepModels(response.steps);
  });
});
