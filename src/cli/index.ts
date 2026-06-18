import { Command } from 'commander';
import { createRequire } from 'module';
import ora from 'ora';
import path from 'path';
import { promises as fs } from 'fs';
import { AI_TOOLS } from '../core/config.js';
import { doctorCommand } from '../core/doctor.js';
import { UpdateCommand } from '../core/update.js';
import { ListCommand } from '../core/list.js';
import { ArchiveCommand } from '../core/archive.js';
import { resolveCurrentPlanningHomeSync } from '../core/planning-home.js';
import { readProjectConfigWithDiagnostics } from '../core/project-config.js';
import {
  statusCommand,
  instructionsCommand,
  applyInstructionsCommand,
  newChangeCommand,
  flowCompleteCommand,
  flowNextCommand,
  flowStatusCommand,
  DEFAULT_SCHEMA,
  type StatusOptions,
  type InstructionsOptions,
  type NewChangeOptions,
  type FlowCommandOptions,
  type FlowCompleteCommandOptions,
} from '../commands/workflow/index.js';
import { maybeShowTelemetryNotice, trackCommand, shutdown } from '../telemetry/index.js';

const program = new Command();
const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

type CommandVisibility = 'user' | 'skill' | 'internal';

interface CommandArgumentCapability {
  name: string;
  required: boolean;
  description: string;
}

interface CommandOptionCapability {
  flags: string[];
  required: boolean;
  description: string;
}

interface CommandCapability {
  name: string;
  path: string;
  visibility: CommandVisibility;
  description: string;
  arguments: CommandArgumentCapability[];
  options: CommandOptionCapability[];
  emitsJson: boolean;
}

interface SettingCapability {
  path: string;
  type: 'boolean';
  default: boolean;
  description: string;
}

interface CapabilitiesManifest {
  schemaVersion: 1;
  version: string;
  description: string;
  recommendedFlow: string[];
  commands: CommandCapability[];
  settings: SettingCapability[];
}

const DESCRIPTION = 'AI-native system for spec-driven development';
const RECOMMENDED_FLOW = ['/spok-explore', '/spok-propose', '/spok-apply', '/spok-archive'];
const SETTINGS: SettingCapability[] = [
  {
    path: 'flow.self_learn',
    type: 'boolean',
    default: false,
    description: 'Run an advisory post-commit workflow improvement review after each committed flow chunk.',
  },
];
const COMMAND_VISIBILITY: Record<string, CommandVisibility> = {
  version: 'user',
  help: 'user',
  init: 'user',
  doctor: 'user',
  update: 'user',
  skills: 'user',
  'skills install': 'user',
  list: 'user',
  archive: 'user',
  capabilities: 'skill',
  status: 'skill',
  instructions: 'skill',
  new: 'skill',
  'new change': 'skill',
  flow: 'internal',
  'flow status': 'internal',
  'flow next': 'internal',
  'flow complete': 'internal',
};

const COMMAND_ORDER = Object.keys(COMMAND_VISIBILITY);
const CONFIG_WARNING_COMMANDS = new Set([
  'list',
  'archive',
  'status',
  'instructions',
  'new:change',
  'flow:status',
  'flow:next',
  'flow:complete',
]);

/**
 * Get the full command path for nested commands.
 * For example: 'change show' -> 'change:show'
 */
function getCommandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    const name = current.name();
    // Skip the root 'spok' command
    if (name && name !== 'spok') {
      names.unshift(name);
    }
    current = current.parent;
  }

  return names.join(':') || 'spok';
}

function hasJsonOption(command: Command): boolean {
  let current: Command | null = command;
  while (current) {
    if (current.opts<{ json?: boolean }>().json === true) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function splitOptionFlags(flags: string): string[] {
  return flags
    .split(/[,|]+/u)
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0);
}

function getCommandArguments(command: Command): CommandArgumentCapability[] {
  return command.registeredArguments.map((argument) => ({
    name: argument.name(),
    required: argument.required,
    description: argument.description,
  }));
}

function getCommandOptions(command: Command): CommandOptionCapability[] {
  return command.options
    .filter((option) => !option.hidden)
    .map((option) => ({
      flags: splitOptionFlags(option.flags),
      required: option.mandatory,
      description: option.description,
    }));
}

function findCommandByPath(root: Command, commandPath: string): Command | undefined {
  return commandPath
    .split(' ')
    .reduce<Command | undefined>((current, name) => current?.commands.find((command) => command.name() === name), root);
}

function commandEmitsJson(command: Command): boolean {
  return command.options.some((option) => option.long === '--json');
}

function buildCapabilitiesManifest(root: Command): CapabilitiesManifest {
  const commands = COMMAND_ORDER.flatMap((commandPath): CommandCapability[] => {
    const command = findCommandByPath(root, commandPath);
    if (!command) return [];

    return [{
      name: command.name(),
      path: commandPath,
      visibility: COMMAND_VISIBILITY[commandPath],
      description: command.description(),
      arguments: getCommandArguments(command),
      options: getCommandOptions(command),
      emitsJson: commandEmitsJson(command),
    }];
  });

  return {
    schemaVersion: 1,
    version,
    description: DESCRIPTION,
    recommendedFlow: RECOMMENDED_FLOW,
    commands,
    settings: SETTINGS,
  };
}

function maybeWarnProjectConfig(actionCommand: Command): void {
  const commandPath = getCommandPath(actionCommand);
  if (hasJsonOption(actionCommand) || !CONFIG_WARNING_COMMANDS.has(commandPath)) {
    return;
  }

  try {
    const planningHome = resolveCurrentPlanningHomeSync({
      allowImplicitRepoRoot: false,
    });
    const result = readProjectConfigWithDiagnostics(planningHome.root);
    if (result.diagnostics.length === 0) {
      return;
    }

    const configPath = result.configPath
      ? path.relative(planningHome.root, result.configPath)
      : 'Spok config';
    const hasErrors = result.diagnostics.some((diagnostic) => diagnostic.level === 'error');
    const label = hasErrors ? 'invalid' : 'check';

    console.error(`Warning: ${label} Spok config at ${configPath}`);
    for (const diagnostic of result.diagnostics.slice(0, 3)) {
      const location = diagnostic.path ? `${diagnostic.path}: ` : '';
      console.error(`- ${location}${diagnostic.message}`);
    }
    if (result.diagnostics.length > 3) {
      console.error(`- ...and ${result.diagnostics.length - 3} more issue(s)`);
    }
    console.error('Run `spok doctor` for a full configuration report.');
  } catch {
    // Commands can run outside a Spok planning home and report their own errors.
  }
}

function printCapabilitiesText(manifest: CapabilitiesManifest): void {
  console.log(`${manifest.description} ${manifest.version}`);
  console.log();
  for (const visibility of ['user', 'skill', 'internal'] as const) {
    const commands = manifest.commands.filter((command) => command.visibility === visibility);
    console.log(`${visibility}:`);
    for (const command of commands) {
      console.log(`  ${command.path}`);
    }
    console.log();
  }
  console.log('settings:');
  for (const setting of manifest.settings) {
    console.log(`  ${setting.path} (${setting.type}, default: ${setting.default})`);
  }
  console.log();
  console.log('For machine-readable output, run: spok capabilities --json');
}

program
  .name('spok')
  .description(DESCRIPTION)
  .helpCommand(false);

// Apply global flags and telemetry before any command runs
program.hook('preAction', async (_thisCommand, actionCommand) => {
  if (!hasJsonOption(actionCommand)) {
    await maybeShowTelemetryNotice();
    maybeWarnProjectConfig(actionCommand);
  }

  const commandPath = getCommandPath(actionCommand);
  await trackCommand(commandPath, version);
});

program.hook('postAction', async () => {
  await shutdown();
});

program
  .command('version')
  .description('Print Spok version')
  .action(() => {
    console.log(version);
  });

program
  .command('help [command]')
  .description('display help for command')
  .action((commandName?: string) => {
    if (!commandName) {
      program.outputHelp();
      return;
    }

    const command = program.commands.find((subcommand) => subcommand.name() === commandName);
    if (!command) {
      console.error(`error: unknown command '${commandName}'`);
      process.exit(1);
    }

    command.outputHelp();
  });

const availableToolIds = AI_TOOLS.filter((tool) => tool.skillsDir).map((tool) => tool.value);
const toolsOptionDescription = `Configure AI tools non-interactively. Use "all", "none", or a comma-separated list of: ${availableToolIds.join(', ')}`;

program
  .command('init [path]')
  .description('Initialize Spok in your project')
  .option('--tools <tools>', toolsOptionDescription)
  .option('--force', 'Auto-cleanup legacy files without prompting')
  .action(async (targetPath = '.', options?: { tools?: string; force?: boolean }) => {
    try {
      const resolvedPath = path.resolve(targetPath);

      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error(`Path "${targetPath}" is not a directory`);
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          console.log(`Directory "${targetPath}" doesn't exist, it will be created.`);
        } else if (error.message && error.message.includes('not a directory')) {
          throw error;
        } else {
          throw new Error(`Cannot access path "${targetPath}": ${error.message}`);
        }
      }

      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tools,
        force: options?.force,
      });
      await initCommand.execute(targetPath);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Check Spok project configuration and setup')
  .option('--json', 'Output as JSON')
  .action(async (options?: { json?: boolean }) => {
    await doctorCommand(options);
  });

program
  .command('update [path]')
  .description('Update Spok instruction files')
  .option('--force', 'Force update even when tools are up to date')
  .action(async (targetPath = '.', options?: { force?: boolean }) => {
    try {
      const resolvedPath = path.resolve(targetPath);
      const updateCommand = new UpdateCommand({ force: options?.force });
      await updateCommand.execute(resolvedPath);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

const skillsCmd = program
  .command('skills')
  .description('Manage Spok skills')
  .helpCommand(false)
  .addHelpText('after', `
Examples:
  spok skills install --tools claude,codex,factory
  spok skills install --tools all
  spok skills install --tools none

Help:
  spok help skills
  spok skills --help
  spok skills install --help`);

const skillsInstallCmd = skillsCmd
  .command('install')
  .description('Install Spok skills into global home-scoped tool directories')
  .option('--tools <tools>', toolsOptionDescription)
  .action(async (options?: { tools?: string }) => {
    try {
      const { GlobalSkillsInstallCommand } = await import('../core/skills-install.js');
      const installCommand = new GlobalSkillsInstallCommand({
        tools: options?.tools,
      });
      await installCommand.execute();
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

skillsCmd
  .command('help [command]', { hidden: true })
  .description('display help for command')
  .action((commandName?: string) => {
    if (!commandName) {
      skillsCmd.outputHelp();
      return;
    }

    if (commandName === 'install') {
      skillsInstallCmd.outputHelp();
      return;
    }

    console.error(`Unknown skills subcommand: ${commandName}`);
    console.error();
    console.error('Use one of:');
    console.error('  spok help skills');
    console.error('  spok skills --help');
    console.error('  spok skills install --help');
    process.exit(1);
  });

program
  .command('list')
  .description('List items (changes by default). Use --specs to list specs.')
  .option('--specs', 'List specs instead of changes')
  .option('--changes', 'List changes explicitly (default)')
  .option('--sort <order>', 'Sort order: "recent" (default) or "name"', 'recent')
  .option('--json', 'Output as JSON (for programmatic use)')
  .action(async (options?: { specs?: boolean; changes?: boolean; sort?: string; json?: boolean }) => {
    try {
      const listCommand = new ListCommand();
      const mode: 'changes' | 'specs' = options?.specs ? 'specs' : 'changes';
      const sort = options?.sort === 'name' ? 'name' : 'recent';
      await listCommand.execute('.', mode, { sort, json: options?.json });
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('capabilities')
  .description('Describe the current Spok CLI command surface')
  .option('--json', 'Output as JSON')
  .action((options?: { json?: boolean }) => {
    const manifest = buildCapabilitiesManifest(program);
    if (options?.json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    printCapabilitiesText(manifest);
  });

program
  .command('archive [change-name]')
  .description('Archive a completed change and update main specs')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--skip-specs', 'Skip spec update operations (useful for infrastructure, tooling, or doc-only changes)')
  .option('--no-validate', 'Skip validation (not recommended, requires confirmation)')
  .action(async (changeName?: string, options?: { yes?: boolean; skipSpecs?: boolean; noValidate?: boolean; validate?: boolean }) => {
    try {
      const archiveCommand = new ArchiveCommand();
      await archiveCommand.execute(changeName, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════
// Internal plumbing commands (used by skills, not for direct invocation)
// ═══════════════════════════════════════════════════════════

program
  .command('status')
  .description('Display artifact completion status for a change')
  .option('--change <id>', 'Change name to show status for')
  .option('--schema <name>', 'Schema override (auto-detected from project config)')
  .option('--json', 'Output as JSON')
  .action(async (options: StatusOptions) => {
    try {
      await statusCommand(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('instructions [artifact]')
  .description('Output enriched instructions for creating an artifact or applying tasks')
  .option('--change <id>', 'Change name')
  .option('--schema <name>', 'Schema override (auto-detected from project config)')
  .option('--json', 'Output as JSON')
  .action(async (artifactId: string | undefined, options: InstructionsOptions) => {
    try {
      if (artifactId === 'apply') {
        await applyInstructionsCommand(options);
      } else {
        await instructionsCommand(artifactId, options);
      }
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

const flowCmd = program
  .command('flow')
  .description('Internal deterministic flow control for spok-flow');

flowCmd
  .command('status <task-dir>')
  .description('Show deterministic workflow state for a task directory')
  .option('--json', 'Output as JSON')
  .action(async (taskDir: string, options: FlowCommandOptions) => {
    try {
      await flowStatusCommand(taskDir, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

flowCmd
  .command('next <task-dir>')
  .description('Show the next deterministic workflow step for a task directory')
  .option('--json', 'Output as JSON')
  .action(async (taskDir: string, options: FlowCommandOptions) => {
    try {
      await flowNextCommand(taskDir, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

flowCmd
  .command('complete <task-dir>')
  .description('Record completion for a deterministic workflow step')
  .requiredOption('--step <id>', 'Workflow step id to complete')
  .option('--output <path>', 'Artifact output path for file-producing steps')
  .option('--summary <text>', 'Completion summary for no-file steps')
  .option('--commit <sha>', 'Commit SHA for the commit step')
  .option('--json', 'Output as JSON')
  .action(async (taskDir: string, options: FlowCompleteCommandOptions) => {
    try {
      await flowCompleteCommand(taskDir, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

const newCmd = program.command('new').description('Create new items');

newCmd
  .command('change <name>')
  .description('Create a new change directory')
  .option('--description <text>', 'Description to add to README.md')
  .option('--goal <text>', 'Workspace product goal to store with the change')
  .option('--areas <names>', 'Comma-separated affected workspace link names')
  .option('--schema <name>', `Workflow schema to use (default: ${DEFAULT_SCHEMA})`)
  .action(async (name: string, options: NewChangeOptions) => {
    try {
      await newChangeCommand(name, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
