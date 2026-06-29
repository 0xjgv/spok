import { describe, expect, it } from 'vitest';

import { collectCliSignals } from '../../src/cli/signals.js';

describe('CLI telemetry signals', () => {
  it.each([
    [['--help'], 'root', 'help_option'],
    [['help'], 'root', 'help_command'],
    [['help', 'skills'], 'skills', 'help_command'],
    [['skills', '--help'], 'skills', 'help_option'],
    [['skills', 'help'], 'skills', 'help_command'],
    [['flow', 'complete', '--help'], 'flow complete', 'help_option'],
  ])('detects help check %j', (args, command, invocation) => {
    expect(collectCliSignals(args)).toContainEqual({
      event: 'cli_help_checked',
      properties: {
        command,
        invocation,
      },
    });
  });

  it.each([
    [['flow'], 'flow', 'missing_flow_subcommand'],
    [['flow', 'run', '/tmp/task'], 'flow <unknown>', 'unknown_flow_subcommand'],
    [['flow', 'next'], 'flow next', 'missing_task_dir'],
    [['flow', 'complete', '/tmp/task'], 'flow complete', 'missing_step_option'],
  ])('detects invalid flow invocation %j', (args, command, code) => {
    expect(collectCliSignals(args)).toContainEqual({
      event: 'cli_invalid_invocation',
      properties: {
        command,
        code,
      },
    });
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
