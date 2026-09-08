import { describe, expect, it } from 'vitest';

import { collectCliSignals } from '../../src/cli/signals.js';

describe('CLI help telemetry signals', () => {
  it.each([
    [['--help'], 'root', 'help_option'],
    [['help'], 'root', 'help_command'],
    [['help', 'skills'], 'skills', 'help_command'],
    [['skills', '--help'], 'skills', 'help_option'],
    [['skills', 'help'], 'skills', 'help_command'],
    [['flow', 'complete', '--help'], 'flow complete', 'help_option'],
    [['flow', 'pause', '--help'], 'flow pause', 'help_option'],
    [['flow', 'answer', '--help'], 'flow answer', 'help_option'],
    [['flow', 'answer', '--question', 'q1', '--help'], 'flow answer', 'help_option'],
  ])('detects help check %j', (args, command, invocation) => {
    expect(collectCliSignals(args)).toContainEqual({
      event: 'cli_help_checked',
      properties: {
        command,
        invocation,
      },
    });
  });
});

describe('CLI invalid invocation telemetry signals', () => {
  it.each([
    [['flow'], 'flow', 'missing_flow_subcommand'],
    [['flow', 'run', '/tmp/task'], 'flow <unknown>', 'unknown_flow_subcommand'],
    [['flow', 'next'], 'flow next', 'missing_task_dir'],
    [['flow', 'next', '--json'], 'flow next', 'missing_task_dir'],
    [['flow', 'complete', '--step', 'implement'], 'flow complete', 'missing_task_dir'],
    [['flow', 'complete', '/tmp/task'], 'flow complete', 'missing_step_option'],
    [['flow', 'complete', '/tmp/task', '--step'], 'flow complete', 'missing_step_option'],
    [['flow', 'complete', '/tmp/task', '--step', 'implement', '--step'], 'flow complete', 'missing_step_option'],
    [['flow', 'complete', '--help', '--step'], 'flow complete', 'missing_step_option'],
    [['flow', 'complete', '/tmp/task', '--', '--step=implement'], 'flow complete', 'missing_step_option'],
    [
      ['flow', 'complete', '--step=implement', '--changed-path', 'src/a.ts', '/tmp/task'],
      'flow complete',
      'missing_task_dir',
    ],
    [['flow', 'pause', '/tmp/task'], 'flow pause', 'missing_step_option'],
    [
      ['flow', 'pause', '/tmp/task', '--step', 'design-discussion'],
      'flow pause',
      'missing_questions_option',
    ],
    [
      ['flow', 'pause', '/tmp/task', '--step=design-discussion', '--questions'],
      'flow pause',
      'missing_questions_option',
    ],
    [['flow', 'answer', '/tmp/task'], 'flow answer', 'missing_question_option'],
    [
      ['flow', 'answer', '/tmp/task', '--answer=webhook', '--question'],
      'flow answer',
      'missing_question_option',
    ],
    [
      ['flow', 'answer', '/tmp/task', '--question', 'q1', '--answer'],
      'flow answer',
      'missing_answer_option',
    ],
    [
      ['flow', 'answer', '/tmp/task', '--answer', '--help'],
      'flow answer',
      'missing_question_option',
    ],
    [
      ['flow', 'answer', '/tmp/task', '--question', 'interface'],
      'flow answer',
      'missing_answer_option',
    ],
  ])('detects invalid flow invocation %j', (args, command, code) => {
    expect(collectCliSignals(args)).toEqual([{
      event: 'cli_invalid_invocation',
      properties: {
        command,
        code,
      },
    }]);
  });

  it('does not store task directory paths in invalid flow signals', () => {
    expect(collectCliSignals(['flow', 'complete', '/tmp/private-task'])).toEqual([
      {
        event: 'cli_invalid_invocation',
        properties: {
          command: 'flow complete',
          code: 'missing_step_option',
        },
      },
    ]);
  });
});

describe('valid CLI invocations', () => {
  it.each([
    ['status task only', ['flow', 'status', '/tmp/task']],
    ['status option first', ['flow', 'status', '--json', '/tmp/task']],
    ['next option first', ['flow', 'next', '--json', '/tmp/task']],
    ['complete option first', ['flow', 'complete', '--step', 'implement', '/tmp/task']],
    ['complete equals', ['flow', 'complete', '/tmp/task', '--step=implement']],
    ['complete empty value', ['flow', 'complete', '/tmp/task', '--step=']],
    ['status delimiter', ['flow', 'status', '--', '--help']],
    ['complete delimiter', ['flow', 'complete', '--step=implement', '--', '-task']],
    [
      'complete variadic paths',
      ['flow', 'complete', '--changed-path', 'src/a.ts', 'src/b.ts', '--step=implement', '/tmp/task'],
    ],
    [
      'complete optional value',
      ['flow', 'complete', '--summary', '--help', '--step=implement', '/tmp/task'],
    ],
    ['pause', ['flow', 'pause', '/tmp/task', '--step', 'design-discussion', '--questions', 'q.json']],
    ['pause equals', ['flow', 'pause', '--step=design-discussion', '--questions=q.json', '/tmp/task']],
    ['answer', ['flow', 'answer', '/tmp/task', '--question', 'interface', '--answer', 'webhook']],
    ['answer equals', ['flow', 'answer', '--question=interface', '--answer=webhook', '/tmp/task']],
    ['answer dash value', ['flow', 'answer', '/tmp/task', '--question', 'q1', '--answer', '-skip']],
    ['answer option value', ['flow', 'answer', '/tmp/task', '--question', 'q1', '--answer', '--json']],
    ['answer help value', ['flow', 'answer', '/tmp/task', '--question', 'q1', '--answer', '--help']],
    ['answer short help value', ['flow', 'answer', '/tmp/task', '--question', 'q1', '--answer', '-h']],
  ])('accepts a valid flow %s invocation', (_label, args) => {
    expect(collectCliSignals(args)).toEqual([]);
  });
});
