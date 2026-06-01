/**
 * Init Command
 *
 * Sets up Spok with workflow agent skills.
 * This is the unified setup command that replaces both the old init and experimental commands.
 */

import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import { createRequire } from 'module';
import { FileSystemUtils } from '../utils/file-system.js';
import { transformToHyphenCommands } from '../utils/command-references.js';
import {
  AI_TOOLS,
  SPOK_DIR_NAME,
  AIToolOption,
} from './config.js';
import { PALETTE } from './styles/palette.js';
import { isInteractive } from '../utils/interactive.js';
import { serializeConfig } from './config-prompts.js';
import { CommandAdapterRegistry } from './command-generation/index.js';
import {
  detectLegacyArtifacts,
  cleanupLegacyArtifacts,
  formatCleanupSummary,
  formatDetectionSummary,
  type LegacyDetectionResult,
} from './legacy-cleanup.js';
import {
  getToolsWithSkillsDir,
  getToolStates,
  getSkillTemplates,
  generateSkillContent,
  type ToolSkillStatus,
} from './shared/index.js';
import { getAvailableTools } from './available-tools.js';
import { installVendoredSkills } from './skill-vendor.js';
import { checkClaudeSubagents, formatSubagentWarning } from './subagent-check.js';

const SPOK_WORKFLOWS = ['explore', 'propose', 'apply', 'archive'] as const;

const require = createRequire(import.meta.url);
const { version: SPOK_VERSION } = require('../../package.json');

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_SCHEMA = 'spec-driven';

const PROGRESS_SPINNER = {
  interval: 80,
  frames: ['░░░', '▒░░', '▒▒░', '▒▒▒', '▓▒▒', '▓▓▒', '▓▓▓', '▒▓▓', '░▒▓'],
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type InitCommandOptions = {
  tools?: string;
  force?: boolean;
  interactive?: boolean;
};

// -----------------------------------------------------------------------------
// Init Command Class
// -----------------------------------------------------------------------------

export class InitCommand {
  private readonly toolsArg?: string;
  private readonly force: boolean;
  private readonly interactiveOption?: boolean;

  constructor(options: InitCommandOptions = {}) {
    this.toolsArg = options.tools;
    this.force = options.force ?? false;
    this.interactiveOption = options.interactive;
  }

  async execute(targetPath: string): Promise<void> {
    const projectPath = path.resolve(targetPath);
    const spokDir = SPOK_DIR_NAME;
    const spokPath = path.join(projectPath, spokDir);

    // Validation happens silently in the background
    const extendMode = await this.validate(projectPath, spokPath);

    // Check for legacy artifacts and handle cleanup
    await this.handleLegacyCleanup(projectPath, extendMode);

    // Detect available tools in the project
    const detectedTools = getAvailableTools(projectPath);

    // Show animated welcome screen (interactive mode only)
    const canPrompt = this.canPromptInteractively();
    if (canPrompt) {
      const { showWelcomeScreen } = await import('../ui/welcome-screen.js');
      await showWelcomeScreen();
    }

    // Get tool states before processing
    const toolStates = getToolStates(projectPath);

    // Get tool selection (pass detected tools for pre-selection)
    const selectedToolIds = await this.getSelectedTools(toolStates, extendMode, detectedTools, projectPath);

    // Validate selected tools
    const validatedTools = this.validateTools(selectedToolIds, toolStates);

    // Create directory structure and config
    await this.createDirectoryStructure(spokPath, extendMode);

    // Generate skills for each tool and remove old command wrapper files
    const results = await this.generateSkillsAndCommands(projectPath, validatedTools);

    // Create config.yaml if needed
    const configStatus = await this.createConfig(spokPath, extendMode);

    // Warn if Claude is configured but custom subagents referenced by vendored
    // skills aren't installed in ~/.claude/agents/.
    this.warnIfClaudeSubagentsMissing(validatedTools);

    // Display success message
    this.displaySuccessMessage(projectPath, validatedTools, results, configStatus);
  }

  private warnIfClaudeSubagentsMissing(
    tools: Array<{ value: string }>
  ): void {
    if (!tools.some((tool) => tool.value === 'claude')) return;
    const result = checkClaudeSubagents();
    const warning = formatSubagentWarning(result);
    if (warning) {
      console.log();
      console.log(chalk.yellow(warning));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // VALIDATION & SETUP
  // ═══════════════════════════════════════════════════════════

  private async validate(
    projectPath: string,
    spokPath: string
  ): Promise<boolean> {
    const extendMode = await FileSystemUtils.directoryExists(spokPath);

    // Check write permissions
    if (!(await FileSystemUtils.ensureWritePermissions(projectPath))) {
      throw new Error(`Insufficient permissions to write to ${projectPath}`);
    }
    return extendMode;
  }

  private canPromptInteractively(): boolean {
    if (this.interactiveOption === false) return false;
    if (this.toolsArg !== undefined) return false;
    return isInteractive({ interactive: this.interactiveOption });
  }

  // ═══════════════════════════════════════════════════════════
  // LEGACY CLEANUP
  // ═══════════════════════════════════════════════════════════

  private async handleLegacyCleanup(projectPath: string, extendMode: boolean): Promise<void> {
    // Detect legacy artifacts
    const detection = await detectLegacyArtifacts(projectPath);

    if (!detection.hasLegacyArtifacts) {
      return; // No legacy artifacts found
    }

    // Show what was detected
    console.log();
    console.log(formatDetectionSummary(detection));
    console.log();

    const canPrompt = this.canPromptInteractively();

    if (this.force || !canPrompt) {
      // --force flag or non-interactive mode: proceed with cleanup automatically.
      // Legacy slash commands are 100% Spok-managed, and config file cleanup
      // only removes markers (never deletes files), so auto-cleanup is safe.
      await this.performLegacyCleanup(projectPath, detection);
      return;
    }

    // Interactive mode: prompt for confirmation
    const { confirm } = await import('@inquirer/prompts');
    const shouldCleanup = await confirm({
      message: 'Upgrade and clean up legacy files?',
      default: true,
    });

    if (!shouldCleanup) {
      console.log(chalk.dim('Initialization cancelled.'));
      console.log(chalk.dim('Run with --force to skip this prompt, or manually remove legacy files.'));
      process.exit(0);
    }

    await this.performLegacyCleanup(projectPath, detection);
  }

  private async performLegacyCleanup(projectPath: string, detection: LegacyDetectionResult): Promise<void> {
    const spinner = ora('Cleaning up legacy files...').start();

    const result = await cleanupLegacyArtifacts(projectPath, detection);

    spinner.succeed('Legacy files cleaned up');

    const summary = formatCleanupSummary(result);
    if (summary) {
      console.log();
      console.log(summary);
    }

    console.log();
  }

  // ═══════════════════════════════════════════════════════════
  // TOOL SELECTION
  // ═══════════════════════════════════════════════════════════

  private async getSelectedTools(
    toolStates: Map<string, ToolSkillStatus>,
    extendMode: boolean,
    detectedTools: AIToolOption[],
    projectPath: string
  ): Promise<string[]> {
    // Check for --tools flag first
    const nonInteractiveSelection = this.resolveToolsArg();
    if (nonInteractiveSelection !== null) {
      return nonInteractiveSelection;
    }

    const validTools = getToolsWithSkillsDir();
    const detectedToolIds = new Set(detectedTools.map((t) => t.value));
    const configuredToolIds = new Set(
      [...toolStates.entries()]
        .filter(([, status]) => status.configured)
        .map(([toolId]) => toolId)
    );
    const shouldPreselectDetected = !extendMode && configuredToolIds.size === 0;
    const canPrompt = this.canPromptInteractively();

    // Non-interactive mode: use detected tools as fallback (task 7.8)
    if (!canPrompt) {
      if (detectedToolIds.size > 0) {
        return [...detectedToolIds];
      }
      throw new Error(
        `No tools detected and no --tools flag provided. Valid tools:\n  ${validTools.join('\n  ')}\n\nUse --tools all, --tools none, or --tools claude,cursor,...`
      );
    }

    if (validTools.length === 0) {
      throw new Error(
        `No tools available for skill generation.`
      );
    }

    // Interactive mode: show searchable multi-select
    const { searchableMultiSelect } = await import('../prompts/searchable-multi-select.js');

    // Build choices: pre-select configured tools; keep detected tools visible but unselected.
    const sortedChoices = validTools
      .map((toolId) => {
        const tool = AI_TOOLS.find((t) => t.value === toolId);
        const status = toolStates.get(toolId);
        const configured = status?.configured ?? false;
        const detected = detectedToolIds.has(toolId);

        return {
          name: tool?.name || toolId,
          value: toolId,
          configured,
          detected: detected && !configured,
          preSelected: configured || (shouldPreselectDetected && detected && !configured),
        };
      })
      .sort((a, b) => {
        // Configured tools first, then detected (not configured), then everything else.
        if (a.configured && !b.configured) return -1;
        if (!a.configured && b.configured) return 1;
        if (a.detected && !b.detected) return -1;
        if (!a.detected && b.detected) return 1;
        return 0;
      });

    const configuredNames = validTools
      .filter((toolId) => configuredToolIds.has(toolId))
      .map((toolId) => AI_TOOLS.find((t) => t.value === toolId)?.name || toolId);

    if (configuredNames.length > 0) {
      console.log(`Spok configured: ${configuredNames.join(', ')} (pre-selected)`);
    }

    const detectedOnlyNames = detectedTools
      .filter((tool) => !configuredToolIds.has(tool.value))
      .map((tool) => tool.name);

    if (detectedOnlyNames.length > 0) {
      const detectionLabel = shouldPreselectDetected
        ? 'pre-selected for first-time setup'
        : 'not pre-selected';
      console.log(`Detected tool directories: ${detectedOnlyNames.join(', ')} (${detectionLabel})`);
    }

    const selectedTools = await searchableMultiSelect({
      message: `Select tools to set up (${validTools.length} available)`,
      pageSize: 15,
      choices: sortedChoices,
      validate: (selected: string[]) => selected.length > 0 || 'Select at least one tool',
    });

    if (selectedTools.length === 0) {
      throw new Error('At least one tool must be selected');
    }

    return selectedTools;
  }

  private resolveToolsArg(): string[] | null {
    if (typeof this.toolsArg === 'undefined') {
      return null;
    }

    const raw = this.toolsArg.trim();
    if (raw.length === 0) {
      throw new Error(
        'The --tools option requires a value. Use "all", "none", or a comma-separated list of tool IDs.'
      );
    }

    const availableTools = getToolsWithSkillsDir();
    const availableSet = new Set(availableTools);
    const availableList = ['all', 'none', ...availableTools].join(', ');

    const lowerRaw = raw.toLowerCase();
    if (lowerRaw === 'all') {
      return availableTools;
    }

    if (lowerRaw === 'none') {
      return [];
    }

    const tokens = raw
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    if (tokens.length === 0) {
      throw new Error(
        'The --tools option requires at least one tool ID when not using "all" or "none".'
      );
    }

    const normalizedTokens = tokens.map((token) => token.toLowerCase());

    if (normalizedTokens.some((token) => token === 'all' || token === 'none')) {
      throw new Error('Cannot combine reserved values "all" or "none" with specific tool IDs.');
    }

    const invalidTokens = tokens.filter(
      (_token, index) => !availableSet.has(normalizedTokens[index])
    );

    if (invalidTokens.length > 0) {
      throw new Error(
        `Invalid tool(s): ${invalidTokens.join(', ')}. Available values: ${availableList}`
      );
    }

    // Deduplicate while preserving order
    const deduped: string[] = [];
    for (const token of normalizedTokens) {
      if (!deduped.includes(token)) {
        deduped.push(token);
      }
    }

    return deduped;
  }

  private validateTools(
    toolIds: string[],
    toolStates: Map<string, ToolSkillStatus>
  ): Array<{ value: string; name: string; skillsDir: string; wasConfigured: boolean }> {
    const validatedTools: Array<{ value: string; name: string; skillsDir: string; wasConfigured: boolean }> = [];

    for (const toolId of toolIds) {
      const tool = AI_TOOLS.find((t) => t.value === toolId);
      if (!tool) {
        const validToolIds = getToolsWithSkillsDir();
        throw new Error(
          `Unknown tool '${toolId}'. Valid tools:\n  ${validToolIds.join('\n  ')}`
        );
      }

      if (!tool.skillsDir) {
        const validToolsWithSkills = getToolsWithSkillsDir();
        throw new Error(
          `Tool '${toolId}' does not support skill generation.\nTools with skill generation support:\n  ${validToolsWithSkills.join('\n  ')}`
        );
      }

      const preState = toolStates.get(tool.value);
      validatedTools.push({
        value: tool.value,
        name: tool.name,
        skillsDir: tool.skillsDir,
        wasConfigured: preState?.configured ?? false,
      });
    }

    return validatedTools;
  }

  // ═══════════════════════════════════════════════════════════
  // DIRECTORY STRUCTURE
  // ═══════════════════════════════════════════════════════════

  private async createDirectoryStructure(spokPath: string, extendMode: boolean): Promise<void> {
    if (extendMode) {
      // In extend mode, just ensure directories exist without spinner
      const directories = [
        spokPath,
        path.join(spokPath, 'specs'),
        path.join(spokPath, 'changes'),
        path.join(spokPath, 'changes', 'archive'),
      ];

      for (const dir of directories) {
        await FileSystemUtils.createDirectory(dir);
      }
      return;
    }

    const spinner = this.startSpinner('Creating Spok structure...');

    const directories = [
      spokPath,
      path.join(spokPath, 'specs'),
      path.join(spokPath, 'changes'),
      path.join(spokPath, 'changes', 'archive'),
    ];

    for (const dir of directories) {
      await FileSystemUtils.createDirectory(dir);
    }

    spinner.stopAndPersist({
      symbol: PALETTE.white('▌'),
      text: PALETTE.white('Spok structure created'),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SKILL GENERATION
  // ═══════════════════════════════════════════════════════════

  private async generateSkillsAndCommands(
    projectPath: string,
    tools: Array<{ value: string; name: string; skillsDir: string; wasConfigured: boolean }>
  ): Promise<{
    createdTools: typeof tools;
    refreshedTools: typeof tools;
    failedTools: Array<{ name: string; error: Error }>;
    removedCommandCount: number;
  }> {
    const createdTools: typeof tools = [];
    const refreshedTools: typeof tools = [];
    const failedTools: Array<{ name: string; error: Error }> = [];
    let removedCommandCount = 0;

    const workflows = [...SPOK_WORKFLOWS];
    const skillTemplates = getSkillTemplates(workflows);

    // Process each tool
    for (const tool of tools) {
      const spinner = ora(`Setting up ${tool.name}...`).start();

      try {
        const skillsDir = path.join(projectPath, tool.skillsDir, 'skills');

        // Create skill directories and SKILL.md files
        for (const { template, dirName } of skillTemplates) {
          const skillDir = path.join(skillsDir, dirName);
          const skillFile = path.join(skillDir, 'SKILL.md');

          // Generate SKILL.md content with YAML frontmatter including generatedBy
          // Use hyphen-based command references for tools where filename = command name
          const transformer = (tool.value === 'opencode' || tool.value === 'pi') ? transformToHyphenCommands : undefined;
          const skillContent = generateSkillContent(template, SPOK_VERSION, transformer);

          // Write the skill file
          await FileSystemUtils.writeFile(skillFile, skillContent);
        }

        // Copy vendored helper skills (spok-flow, spok-create-scoped-chunks,
        // and their transitive helpers) into the same skills directory.
        await installVendoredSkills(projectPath, tool.skillsDir);

        // Command wrappers are legacy/generated artifacts now. Keep init idempotent
        // by removing only Spok-managed wrappers for the selected tool.
        removedCommandCount += await this.removeCommandFiles(projectPath, tool.value);

        spinner.succeed(`Setup complete for ${tool.name}`);

        if (tool.wasConfigured) {
          refreshedTools.push(tool);
        } else {
          createdTools.push(tool);
        }
      } catch (error) {
        spinner.fail(`Failed for ${tool.name}`);
        failedTools.push({ name: tool.name, error: error as Error });
      }
    }

    return {
      createdTools,
      refreshedTools,
      failedTools,
      removedCommandCount,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // CONFIG FILE
  // ═══════════════════════════════════════════════════════════

  private async createConfig(spokPath: string, extendMode: boolean): Promise<'created' | 'exists' | 'skipped'> {
    const configPath = path.join(spokPath, 'config.yaml');
    const configYmlPath = path.join(spokPath, 'config.yml');
    const configYamlExists = fs.existsSync(configPath);
    const configYmlExists = fs.existsSync(configYmlPath);

    if (configYamlExists || configYmlExists) {
      return 'exists';
    }

    // In non-interactive mode without --force, skip config creation
    if (!this.canPromptInteractively() && !this.force) {
      return 'skipped';
    }

    try {
      const yamlContent = serializeConfig({ schema: DEFAULT_SCHEMA });
      await FileSystemUtils.writeFile(configPath, yamlContent);
      return 'created';
    } catch {
      return 'skipped';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // UI & OUTPUT
  // ═══════════════════════════════════════════════════════════

  private displaySuccessMessage(
    projectPath: string,
    tools: Array<{ value: string; name: string; skillsDir: string; wasConfigured: boolean }>,
    results: {
      createdTools: typeof tools;
      refreshedTools: typeof tools;
      failedTools: Array<{ name: string; error: Error }>;
      removedCommandCount: number;
    },
    configStatus: 'created' | 'exists' | 'skipped'
  ): void {
    console.log();
    console.log(chalk.bold('Spok Setup Complete'));
    console.log();

    // Show created vs refreshed tools
    if (results.createdTools.length > 0) {
      console.log(`Created: ${results.createdTools.map((t) => t.name).join(', ')}`);
    }
    if (results.refreshedTools.length > 0) {
      console.log(`Refreshed: ${results.refreshedTools.map((t) => t.name).join(', ')}`);
    }

    // Show counts
    const successfulTools = [...results.createdTools, ...results.refreshedTools];
    if (successfulTools.length > 0) {
      const workflows = [...SPOK_WORKFLOWS];
      const toolDirs = [...new Set(successfulTools.map((t) => t.skillsDir))].join(', ');
      const skillCount = getSkillTemplates(workflows).length;
      console.log(`${skillCount} skills in ${toolDirs}/`);
    }

    // Show failures
    if (results.failedTools.length > 0) {
      console.log(chalk.red(`Failed: ${results.failedTools.map((f) => `${f.name} (${f.error.message})`).join(', ')}`));
    }

    if (results.removedCommandCount > 0) {
      console.log(chalk.dim(`Removed: ${results.removedCommandCount} command files`));
    }

    // Config status
    if (configStatus === 'created') {
      console.log(`Config: spok/config.yaml (schema: ${DEFAULT_SCHEMA})`);
    } else if (configStatus === 'exists') {
      // Show actual filename (config.yaml or config.yml)
      const configYaml = path.join(projectPath, SPOK_DIR_NAME, 'config.yaml');
      const configYml = path.join(projectPath, SPOK_DIR_NAME, 'config.yml');
      const configName = fs.existsSync(configYaml) ? 'config.yaml' : fs.existsSync(configYml) ? 'config.yml' : 'config.yaml';
      console.log(`Config: spok/${configName} (exists)`);
    } else {
      console.log(chalk.dim(`Config: skipped (non-interactive mode)`));
    }

    console.log();
    console.log(chalk.bold('Getting started:'));
    console.log('  /spok-explore  Think through an idea');
    console.log('  /spok-propose  Start a new change');
    console.log('  /spok-apply    Ship the next chunk');
    console.log('  /spok-archive  Finalize the change');

    // Links
    console.log();
    console.log(`Learn more: ${chalk.cyan('https://github.com/Fission-AI/Spok')}`);
    console.log(`Feedback:   ${chalk.cyan('https://github.com/Fission-AI/Spok/issues')}`);

    // Restart instruction if any tools were configured
    if (results.createdTools.length > 0 || results.refreshedTools.length > 0) {
      console.log();
      console.log(chalk.white('Restart your IDE for skills to take effect.'));
    }

    console.log();
  }

  private startSpinner(text: string) {
    return ora({
      text,
      stream: process.stdout,
      color: 'gray',
      spinner: PROGRESS_SPINNER,
    }).start();
  }

  private async removeCommandFiles(projectPath: string, toolId: string): Promise<number> {
    let removed = 0;
    const adapter = CommandAdapterRegistry.get(toolId);
    if (!adapter) return 0;

    const commandDirs = new Set<string>();

    for (const workflow of SPOK_WORKFLOWS) {
      const cmdPath = adapter.getFilePath(workflow);
      const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
      commandDirs.add(path.dirname(fullPath));

      try {
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
          removed++;
        }
      } catch {
        // Ignore errors
      }
    }

    for (const commandDir of commandDirs) {
      try {
        await fs.promises.rmdir(commandDir);
      } catch {
        // Ignore non-empty or missing directories.
      }
    }

    return removed;
  }
}
