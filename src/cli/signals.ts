import type { TelemetryProperties } from '../telemetry/index.js';

export interface CliSignal {
  event: 'cli_help_checked' | 'cli_invalid_invocation';
  properties: TelemetryProperties;
}

const FLOW_SUBCOMMANDS = new Set(['status', 'next', 'complete']);
const HELP_FLAGS = new Set(['--help', '-h']);

function isHelpFlag(token: string | undefined): boolean {
  return typeof token === 'string' && HELP_FLAGS.has(token);
}

function includesHelpFlag(args: string[]): boolean {
  return args.some(isHelpFlag);
}

function helpTarget(args: string[]): string | undefined {
  if (args.length === 0) return;

  if (args[0] === 'help') {
    return args[1] && !args[1].startsWith('-') ? args[1] : 'root';
  }

  if (args[1] === 'help') {
    return args[0] ?? 'root';
  }

  const helpIndex = args.findIndex(isHelpFlag);
  if (helpIndex === -1) return;
  if (helpIndex === 0) return 'root';

  const commandParts = args.slice(0, helpIndex).filter((part) => !part.startsWith('-'));
  if (commandParts[0] === 'flow' && commandParts[1] && FLOW_SUBCOMMANDS.has(commandParts[1])) {
    return `flow ${commandParts[1]}`;
  }

  return commandParts[0] ?? 'root';
}

function helpInvocation(args: string[]): string {
  if (args[0] === 'help' || args[1] === 'help') return 'help_command';
  return 'help_option';
}

function flowInvalidSignal(args: string[]): CliSignal | undefined {
  if (args[0] !== 'flow') return;

  const subcommand = args[1];
  if (!subcommand) {
    return {
      event: 'cli_invalid_invocation',
      properties: {
        command: 'flow',
        code: 'missing_flow_subcommand',
      },
    };
  }

  if (isHelpFlag(subcommand)) return;

  if (!FLOW_SUBCOMMANDS.has(subcommand)) {
    return {
      event: 'cli_invalid_invocation',
      properties: {
        command: 'flow <unknown>',
        code: 'unknown_flow_subcommand',
      },
    };
  }

  if (includesHelpFlag(args)) return;

  const taskDir = args[2];
  if (!taskDir || taskDir.startsWith('-')) {
    return {
      event: 'cli_invalid_invocation',
      properties: {
        command: `flow ${subcommand}`,
        code: 'missing_task_dir',
      },
    };
  }

  if (subcommand === 'complete' && !args.includes('--step')) {
    return {
      event: 'cli_invalid_invocation',
      properties: {
        command: 'flow complete',
        code: 'missing_step_option',
      },
    };
  }
}

export function collectCliSignals(args: string[]): CliSignal[] {
  const signals: CliSignal[] = [];
  const target = helpTarget(args);
  if (target) {
    signals.push({
      event: 'cli_help_checked',
      properties: {
        command: target,
        invocation: helpInvocation(args),
      },
    });
  }

  const invalidFlow = flowInvalidSignal(args);
  if (invalidFlow) signals.push(invalidFlow);

  return signals;
}
