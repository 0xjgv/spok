import { Command, CommanderError } from 'commander';
import type { TelemetryProperties } from '../telemetry/index.js';

export interface CliSignal {
  event: 'cli_help_checked' | 'cli_invalid_invocation';
  properties: TelemetryProperties;
}

const FLOW_SUBCOMMANDS = new Set(['status', 'next', 'pause', 'answer', 'complete']);
const HELP_FLAGS = new Set(['--help', '-h']);
const REQUIRED_FLOW_OPTIONS: Partial<
  Record<string, ReadonlyArray<readonly [flag: string, code: string]>>
> = {
  complete: [['--step', 'missing_step_option']],
  pause: [
    ['--step', 'missing_step_option'],
    ['--questions', 'missing_questions_option'],
  ],
  answer: [
    ['--question', 'missing_question_option'],
    ['--answer', 'missing_answer_option'],
  ],
};

function isHelpFlag(token: string | undefined): boolean {
  return typeof token === 'string' && HELP_FLAGS.has(token);
}

interface FlowArguments {
  operands: string[];
  options: Record<string, unknown>;
  unknown: string[];
  missingValue?: string;
}

function parseFlowArguments(subcommand: string, args: string[]): FlowArguments {
  const command = new Command().exitOverride().configureOutput({ writeErr: () => {} });
  command.option('-h, --help').option('--json');
  for (const [flag] of REQUIRED_FLOW_OPTIONS[subcommand] ?? []) {
    command.option(`${flag} <value>`);
  }
  if (subcommand === 'complete') {
    for (const flag of ['--output', '--summary', '--commit', '--work-root']) {
      command.option(`${flag} <value>`);
    }
    command.option('--changed-path <paths...>');
  }

  try {
    return { ...command.parseOptions(args), options: command.opts() };
  } catch (error) {
    if (!(error instanceof CommanderError) || error.code !== 'commander.optionMissingArgument') throw error;
    return { operands: [], unknown: [], options: command.opts(), missingValue: args.at(-1) };
  }
}

function helpTarget(args: string[], flowArgs?: FlowArguments): string | undefined {
  if (flowArgs) return !flowArgs.missingValue && flowArgs.options.help ? `flow ${args[1]}` : undefined;
  return generalHelpTarget(args);
}

function generalHelpTarget(args: string[]): string | undefined {
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

function missingFlowOptionSignal(subcommand: string, args: FlowArguments): CliSignal | undefined {
  const missing = REQUIRED_FLOW_OPTIONS[subcommand]?.find(([flag]) =>
    args.missingValue ? flag === args.missingValue : args.options[flag.slice(2)] === undefined);
  if (!missing) return;
  return {
    event: 'cli_invalid_invocation',
    properties: { command: `flow ${subcommand}`, code: missing[1] },
  };
}

function flowInvalidSignal(args: string[], flowArgs?: FlowArguments): CliSignal | undefined {
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

  if (!flowArgs) return;
  if (flowArgs.missingValue) return missingFlowOptionSignal(subcommand, flowArgs);
  if (flowArgs.options.help) return;
  if (flowArgs.unknown.length > 0) return;

  if (flowArgs.operands.length === 0) {
    return {
      event: 'cli_invalid_invocation',
      properties: {
        command: `flow ${subcommand}`,
        code: 'missing_task_dir',
      },
    };
  }

  return missingFlowOptionSignal(subcommand, flowArgs);
}

export function collectCliSignals(args: string[]): CliSignal[] {
  const signals: CliSignal[] = [];
  const flowArgs = args[0] === 'flow' && FLOW_SUBCOMMANDS.has(args[1])
    ? parseFlowArguments(args[1], args.slice(2))
    : undefined;
  const target = helpTarget(args, flowArgs);
  if (target) {
    signals.push({
      event: 'cli_help_checked',
      properties: {
        command: target,
        invocation: helpInvocation(args),
      },
    });
  }

  const invalidFlow = flowInvalidSignal(args, flowArgs);
  if (invalidFlow) signals.push(invalidFlow);

  return signals;
}
