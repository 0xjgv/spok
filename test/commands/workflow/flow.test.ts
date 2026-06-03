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
      argument: path.join(flow.taskDir, 'ticket.md'),
      expectedOutput: path.join(flow.taskDir, 'research-questions.md'),
      status: 'ready',
    });

    await expect(fs.stat(path.join(flow.taskDir, WORKFLOW_STATE_FILE))).resolves.toBeTruthy();
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
      argument: flow.taskDir,
      expectedOutput: path.join(flow.taskDir, 'design-discussion.md'),
    });
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
  });

  it('prints text details for the next ready step', async () => {
    await flowNextCommand(flow.taskDir);

    expect(logs).toEqual([
      'Next step: research-questions',
      'Skill: spok-create-research-questions',
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
      nextStep: { id: 'research-questions' },
    });
  });
});
