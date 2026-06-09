/**
 * Update Command
 *
 * Refreshes Spok skills for configured tools.
 */

import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import { createRequire } from 'module';
import { FileSystemUtils } from '../utils/file-system.js';
import { transformToHyphenCommands } from '../utils/command-references.js';
import { AI_TOOLS, SPOK_DIR_NAME } from './config.js';
import { CommandAdapterRegistry } from './command-generation/index.js';
import {
  getToolVersionStatus,
  getSkillTemplates,
  generateSkillContent,
  getToolsWithSkillsDir,
  type ToolVersionStatus,
} from './shared/index.js';
import {
  detectLegacyArtifacts,
  cleanupLegacyArtifacts,
  formatCleanupSummary,
  formatDetectionSummary,
  getToolsFromLegacyArtifacts,
  type LegacyDetectionResult,
} from './legacy-cleanup.js';
import { isInteractive } from '../utils/interactive.js';
import { getAvailableTools } from './available-tools.js';
import { installVendoredSkills } from './skill-vendor.js';
import { checkClaudeSubagents, formatSubagentWarning } from './subagent-check.js';

const SPOK_WORKFLOWS = ['explore', 'propose', 'apply', 'archive'] as const;
type SpokWorkflow = (typeof SPOK_WORKFLOWS)[number];

const WORKFLOW_TO_SKILL_DIR: Record<SpokWorkflow, string> = {
  explore: 'spok-explore',
  propose: 'spok-propose',
  apply: 'spok-apply',
  archive: 'spok-archive',
};

const require = createRequire(import.meta.url);
const { version: SPOK_VERSION } = require('../../package.json');

/**
 * Options for the update command.
 */
export interface UpdateCommandOptions {
  /** Force update even when tools are up to date */
  force?: boolean;
}

/** Outcome of refreshing skills across a set of tools. */
interface UpdateResult {
  updatedTools: string[];
  failedTools: Array<{ name: string; error: string }>;
  removedCommandCount: number;
}

/**
 * Scans installed workflow artifacts (skills and managed commands) across configured tools.
 * Returns the union of detected workflow IDs that belong to SPOK_WORKFLOWS.
 */
export function scanInstalledWorkflows(projectPath: string, toolIds: string[]): string[] {
  const installed = new Set<SpokWorkflow>();

  for (const toolId of toolIds) {
    const tool = AI_TOOLS.find((t) => t.value === toolId);
    if (!tool?.skillsDir) continue;
    const skillsDir = path.join(projectPath, tool.skillsDir, 'skills');

    for (const workflow of SPOK_WORKFLOWS) {
      const dirName = WORKFLOW_TO_SKILL_DIR[workflow];
      if (fs.existsSync(path.join(skillsDir, dirName, 'SKILL.md'))) {
        installed.add(workflow);
      }
    }

    const adapter = CommandAdapterRegistry.get(toolId);
    if (!adapter) continue;
    for (const workflow of SPOK_WORKFLOWS) {
      const commandPath = adapter.getFilePath(workflow);
      const fullPath = path.isAbsolute(commandPath)
        ? commandPath
        : path.join(projectPath, commandPath);
      if (fs.existsSync(fullPath)) {
        installed.add(workflow);
      }
    }
  }

  return SPOK_WORKFLOWS.filter((workflow) => installed.has(workflow));
}

function toolHasAnyConfiguredCommand(projectPath: string, toolId: string): boolean {
  const adapter = CommandAdapterRegistry.get(toolId);
  if (!adapter) return false;
  for (const workflow of SPOK_WORKFLOWS) {
    const cmdPath = adapter.getFilePath(workflow);
    const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
    if (fs.existsSync(fullPath)) return true;
  }
  return false;
}

function getCommandConfiguredTools(projectPath: string): string[] {
  return AI_TOOLS
    .filter((tool) => {
      if (!tool.skillsDir) return false;
      const toolDir = path.join(projectPath, tool.skillsDir);
      try {
        return fs.statSync(toolDir).isDirectory();
      } catch {
        return false;
      }
    })
    .map((tool) => tool.value)
    .filter((toolId) => toolHasAnyConfiguredCommand(projectPath, toolId));
}

function getSkillConfiguredTools(projectPath: string): string[] {
  return AI_TOOLS
    .filter((tool) => Boolean(tool.skillsDir))
    .map((tool) => tool.value)
    .filter((toolId) => {
      const tool = AI_TOOLS.find((t) => t.value === toolId);
      if (!tool?.skillsDir) return false;
      const skillsDir = path.join(projectPath, tool.skillsDir, 'skills');
      for (const workflow of SPOK_WORKFLOWS) {
        const skillFile = path.join(skillsDir, WORKFLOW_TO_SKILL_DIR[workflow], 'SKILL.md');
        if (fs.existsSync(skillFile)) return true;
      }
      return false;
    });
}

function getConfiguredTools(projectPath: string): string[] {
  return [...new Set([
    ...getSkillConfiguredTools(projectPath),
    ...getCommandConfiguredTools(projectPath),
  ])];
}

function hasToolDeliveryDrift(projectPath: string, toolId: string): boolean {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool?.skillsDir) return false;

  const skillsDir = path.join(projectPath, tool.skillsDir, 'skills');
  const adapter = CommandAdapterRegistry.get(toolId);

  for (const workflow of SPOK_WORKFLOWS) {
    const skillFile = path.join(skillsDir, WORKFLOW_TO_SKILL_DIR[workflow], 'SKILL.md');
    if (!fs.existsSync(skillFile)) return true;
  }

  if (adapter) {
    for (const workflow of SPOK_WORKFLOWS) {
      const cmdPath = adapter.getFilePath(workflow);
      const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
      if (fs.existsSync(fullPath)) return true;
    }
  }

  return false;
}

function getToolsNeedingDeliverySync(
  projectPath: string,
  configuredTools: readonly string[]
): string[] {
  return [...configuredTools].filter((toolId) => hasToolDeliveryDrift(projectPath, toolId));
}

/**
 * Writes all skill files for a single tool and refreshes its vendored helper skills.
 */
async function writeToolSkills(
  projectPath: string,
  tool: { value: string; skillsDir: string },
  skillTemplates: ReturnType<typeof getSkillTemplates>
): Promise<void> {
  const skillsDir = path.join(projectPath, tool.skillsDir, 'skills');

  for (const { template, dirName } of skillTemplates) {
    const skillFile = path.join(skillsDir, dirName, 'SKILL.md');

    // Use hyphen-based command references for OpenCode
    const transformer =
      tool.value === 'opencode' || tool.value === 'pi' ? transformToHyphenCommands : undefined;
    const skillContent = generateSkillContent(template, SPOK_VERSION, transformer);
    await FileSystemUtils.writeFile(skillFile, skillContent);
  }

  // Refresh vendored helper skills (idempotent overwrite).
  await installVendoredSkills(projectPath, tool.skillsDir);
}

export class UpdateCommand {
  private readonly force: boolean;

  constructor(options: UpdateCommandOptions = {}) {
    this.force = options.force ?? false;
  }

  async execute(projectPath: string): Promise<void> {
    const resolvedProjectPath = path.resolve(projectPath);
    const spokPath = path.join(resolvedProjectPath, SPOK_DIR_NAME);

    // 1. Check spok directory exists
    if (!await FileSystemUtils.directoryExists(spokPath)) {
      throw new Error(`No Spok directory found. Run 'spok init' first.`);
    }

    // 3. Detect and handle legacy artifacts + upgrade legacy tools
    const newlyConfiguredTools = await this.handleLegacyCleanup(resolvedProjectPath);

    // 4. Find configured tools
    const configuredTools = getConfiguredTools(resolvedProjectPath);

    if (configuredTools.length === 0 && newlyConfiguredTools.length === 0) {
      console.log(chalk.yellow('No configured tools found.'));
      console.log(chalk.dim('Run "spok init" to set up tools.'));
      return;
    }

    // 6. Check version status for all configured tools
    const plan = this.buildUpdatePlan(resolvedProjectPath, configuredTools);

    // 7. Nothing to do unless forced: report and bail out early
    if (!this.force && plan.toolsToUpdate.size === 0) {
      this.displayUpToDateMessage(plan.toolStatuses);
      this.detectNewTools(resolvedProjectPath, configuredTools);
      return;
    }

    // 8. Display update plan
    if (this.force) {
      console.log(`Force updating ${configuredTools.length} tool(s): ${configuredTools.join(', ')}`);
    } else {
      this.displayUpdatePlan([...plan.toolsToUpdate], plan.statusByTool, plan.toolsUpToDate);
    }
    console.log();

    // 9-11. Update the selected tools and report the outcome
    const toolsToUpdate = this.force ? configuredTools : [...plan.toolsToUpdate];
    const result = await this.updateTools(resolvedProjectPath, toolsToUpdate);
    this.displayUpdateSummary(result);

    // 12. Show onboarding message for newly configured tools from legacy upgrade
    this.displayOnboarding(newlyConfiguredTools);

    const configuredAndNewTools = [...new Set([...configuredTools, ...newlyConfiguredTools])];

    // 13. Detect new tool directories not currently configured
    this.detectNewTools(resolvedProjectPath, configuredAndNewTools);

    // 14. List affected tools
    if (result.updatedTools.length > 0) {
      console.log(chalk.dim(`Tools: ${result.updatedTools.join(', ')}`));
    }

    // 15. Warn if Claude is configured but referenced subagents are missing
    this.warnMissingClaudeSubagents(configuredAndNewTools);

    console.log();
    console.log(chalk.dim('Restart your IDE for changes to take effect.'));
  }

  /**
   * Computes version status for configured tools and the set of tools that need
   * updating (either a version bump or a delivery/config sync).
   */
  private buildUpdatePlan(projectPath: string, configuredTools: string[]) {
    const commandConfiguredSet = new Set(getCommandConfiguredTools(projectPath));
    const toolStatuses = configuredTools.map((toolId) => {
      const status = getToolVersionStatus(projectPath, toolId, SPOK_VERSION);
      if (!status.configured && commandConfiguredSet.has(toolId)) {
        return { ...status, configured: true };
      }
      return status;
    });

    const toolsToUpdate = new Set<string>([
      ...toolStatuses.filter((s) => s.needsUpdate).map((s) => s.toolId),
      ...getToolsNeedingDeliverySync(projectPath, configuredTools),
    ]);

    return {
      toolStatuses,
      statusByTool: new Map(toolStatuses.map((status) => [status.toolId, status] as const)),
      toolsToUpdate,
      toolsUpToDate: toolStatuses.filter((s) => !toolsToUpdate.has(s.toolId)),
    };
  }

  /**
   * Refreshes skills for each tool, removing legacy command wrappers, and
   * collects the updated/failed tools plus the count of removed command files.
   */
  private async updateTools(projectPath: string, toolIds: string[]): Promise<UpdateResult> {
    const skillTemplates = getSkillTemplates([...SPOK_WORKFLOWS]);
    const updatedTools: string[] = [];
    const failedTools: Array<{ name: string; error: string }> = [];
    let removedCommandCount = 0;

    for (const toolId of toolIds) {
      const tool = AI_TOOLS.find((t) => t.value === toolId);
      if (!tool?.skillsDir) continue;

      const spinner = ora(`Updating ${tool.name}...`).start();

      try {
        await writeToolSkills(projectPath, { value: tool.value, skillsDir: tool.skillsDir }, skillTemplates);

        // Command wrappers are legacy/generated artifacts now.
        removedCommandCount += await this.removeCommandFiles(projectPath, toolId);

        spinner.succeed(`Updated ${tool.name}`);
        updatedTools.push(tool.name);
      } catch (error) {
        spinner.fail(`Failed to update ${tool.name}`);
        failedTools.push({
          name: tool.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { updatedTools, failedTools, removedCommandCount };
  }

  /**
   * Display the results of an update run.
   */
  private displayUpdateSummary(result: UpdateResult): void {
    const { updatedTools, failedTools, removedCommandCount } = result;
    console.log();
    if (updatedTools.length > 0) {
      console.log(chalk.green(`✓ Updated: ${updatedTools.join(', ')} (v${SPOK_VERSION})`));
    }
    if (failedTools.length > 0) {
      console.log(chalk.red(`✗ Failed: ${failedTools.map(f => `${f.name} (${f.error})`).join(', ')}`));
    }
    if (removedCommandCount > 0) {
      console.log(chalk.dim(`Removed: ${removedCommandCount} command files`));
    }
  }

  /**
   * Show the getting-started message after newly configuring tools via a legacy upgrade.
   */
  private displayOnboarding(newlyConfiguredTools: string[]): void {
    if (newlyConfiguredTools.length === 0) return;

    console.log();
    console.log(chalk.bold('Getting started:'));
    console.log('  /spok-explore  Think through an idea');
    console.log('  /spok-propose  Start a new change');
    console.log('  /spok-apply    Implement the next chunk');
    console.log('  /spok-archive  Finalize the change');
    console.log();
    console.log(`Learn more: ${chalk.cyan('https://github.com/Fission-AI/Spok')}`);
  }

  /**
   * Warn if Claude is configured but custom subagents referenced by vendored
   * skills aren't installed in ~/.claude/agents/.
   */
  private warnMissingClaudeSubagents(configuredTools: string[]): void {
    if (!configuredTools.includes('claude')) return;

    const subagentWarning = formatSubagentWarning(checkClaudeSubagents());
    if (subagentWarning) {
      console.log();
      console.log(chalk.yellow(subagentWarning));
    }
  }

  /**
   * Display message when all tools are up to date.
   */
  private displayUpToDateMessage(toolStatuses: ToolVersionStatus[]): void {
    const toolNames = toolStatuses.map((s) => s.toolId);
    console.log(chalk.green(`✓ All ${toolStatuses.length} tool(s) up to date (v${SPOK_VERSION})`));
    console.log(chalk.dim(`  Tools: ${toolNames.join(', ')}`));
    console.log();
    console.log(chalk.dim('Use --force to refresh files anyway.'));
  }

  /**
   * Display the update plan showing which tools need updating.
   */
  private displayUpdatePlan(
    toolsToUpdate: string[],
    statusByTool: Map<string, ToolVersionStatus>,
    upToDate: ToolVersionStatus[]
  ): void {
    const updates = toolsToUpdate.map((toolId) => {
      const status = statusByTool.get(toolId);
      if (status?.needsUpdate) {
        const fromVersion = status.generatedByVersion ?? 'unknown';
        return `${status.toolId} (${fromVersion} → ${SPOK_VERSION})`;
      }
      return `${toolId} (config sync)`;
    });

    console.log(`Updating ${toolsToUpdate.length} tool(s): ${updates.join(', ')}`);

    if (upToDate.length > 0) {
      const upToDateNames = upToDate.map((s) => s.toolId);
      console.log(chalk.dim(`Already up to date: ${upToDateNames.join(', ')}`));
    }
  }

  /**
   * Detects new tool directories that aren't currently configured and displays a hint.
   */
  private detectNewTools(projectPath: string, configuredTools: string[]): void {
    const availableTools = getAvailableTools(projectPath);
    const configuredSet = new Set(configuredTools);

    const newTools = availableTools.filter((t) => !configuredSet.has(t.value));

    if (newTools.length > 0) {
      const newToolNames = newTools.map((tool) => tool.name);
      const isSingleTool = newToolNames.length === 1;
      const toolNoun = isSingleTool ? 'tool' : 'tools';
      const pronoun = isSingleTool ? 'it' : 'them';
      console.log();
      console.log(
        chalk.yellow(
          `Detected new ${toolNoun}: ${newToolNames.join(', ')}. Run 'spok init' to add ${pronoun}.`
        )
      );
    }
  }

  /**
   * Removes Spok-managed command files for workflows.
   */
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

  /**
   * Detect and handle legacy Spok artifacts.
   * Unlike init, update warns but continues if legacy files found in non-interactive mode.
   * Returns array of tool IDs that were newly configured during legacy upgrade.
   */
  private async handleLegacyCleanup(
    projectPath: string,
  ): Promise<string[]> {
    // Detect legacy artifacts
    const detection = await detectLegacyArtifacts(projectPath);

    if (!detection.hasLegacyArtifacts) {
      return []; // No legacy artifacts found
    }

    // Show what was detected
    console.log();
    console.log(formatDetectionSummary(detection));
    console.log();

    const canPrompt = isInteractive();

    if (this.force) {
      // --force flag: proceed with cleanup automatically
      await this.performLegacyCleanup(projectPath, detection);
      // Then upgrade legacy tools to new skills
      return this.upgradeLegacyTools(projectPath, detection, canPrompt);
    }

    if (!canPrompt) {
      // Non-interactive mode without --force: warn and continue
      // (Unlike init, update doesn't abort - user may just want to update skills)
      console.log(chalk.yellow('⚠ Run with --force to auto-cleanup legacy files, or run interactively.'));
      console.log();
      return [];
    }

    // Interactive mode: prompt for confirmation
    const { confirm } = await import('@inquirer/prompts');
    const shouldCleanup = await confirm({
      message: 'Upgrade and clean up legacy files?',
      default: true,
    });

    if (shouldCleanup) {
      await this.performLegacyCleanup(projectPath, detection);
      // Then upgrade legacy tools to new skills
      return this.upgradeLegacyTools(projectPath, detection, canPrompt);
    } else {
      console.log(chalk.dim('Skipping legacy cleanup. Continuing with skill update...'));
      console.log();
      return [];
    }
  }

  /**
   * Perform cleanup of legacy artifacts.
   */
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

  /**
   * Upgrade legacy tools to new skills system.
   * Returns array of tool IDs that were newly configured.
   */
  private async upgradeLegacyTools(
    projectPath: string,
    detection: LegacyDetectionResult,
    canPrompt: boolean
  ): Promise<string[]> {
    const desiredWorkflows = [...SPOK_WORKFLOWS];
    // Get tools that had legacy artifacts
    const legacyTools = getToolsFromLegacyArtifacts(detection);

    if (legacyTools.length === 0) {
      return [];
    }

    // Get currently configured tools
    const configuredTools = getConfiguredTools(projectPath);
    const configuredSet = new Set(configuredTools);

    // Filter to tools that aren't already configured
    const unconfiguredLegacyTools = legacyTools.filter((t) => !configuredSet.has(t));

    if (unconfiguredLegacyTools.length === 0) {
      return [];
    }

    // Get valid tools (those with skillsDir)
    const validToolIds = new Set(getToolsWithSkillsDir());
    const validUnconfiguredTools = unconfiguredLegacyTools.filter((t) => validToolIds.has(t));

    if (validUnconfiguredTools.length === 0) {
      return [];
    }

    // Show what tools were detected from legacy artifacts
    console.log(chalk.bold('Tools detected from legacy artifacts:'));
    for (const toolId of validUnconfiguredTools) {
      const tool = AI_TOOLS.find((t) => t.value === toolId);
      console.log(`  • ${tool?.name || toolId}`);
    }
    console.log();

    let selectedTools: string[];

    if (this.force || !canPrompt) {
      // Non-interactive with --force: auto-select detected tools
      selectedTools = validUnconfiguredTools;
      console.log(`Setting up skills for: ${selectedTools.join(', ')}`);
    } else {
      // Interactive mode: prompt for tool selection with detected tools pre-selected
      const { searchableMultiSelect } = await import('../prompts/searchable-multi-select.js');

      const sortedChoices = validUnconfiguredTools.map((toolId) => {
        const tool = AI_TOOLS.find((t) => t.value === toolId);
        return {
          name: tool?.name || toolId,
          value: toolId,
          configured: false,
          preSelected: true, // Pre-select all detected legacy tools
        };
      });

      selectedTools = await searchableMultiSelect({
        message: 'Select tools to set up with the new skill system:',
        pageSize: 15,
        choices: sortedChoices,
        validate: (_selected: string[]) => true, // Allow empty selection (user can skip)
      });

      if (selectedTools.length === 0) {
        console.log(chalk.dim('Skipping tool setup.'));
        console.log();
        return [];
      }
    }

    // Create skills for selected tools.
    const newlyConfigured: string[] = [];
    const skillTemplates = getSkillTemplates(desiredWorkflows);

    for (const toolId of selectedTools) {
      const tool = AI_TOOLS.find((t) => t.value === toolId);
      if (!tool?.skillsDir) continue;

      const spinner = ora(`Setting up ${tool.name}...`).start();

      try {
        await writeToolSkills(projectPath, { value: tool.value, skillsDir: tool.skillsDir }, skillTemplates);

        // Remove old command wrappers for this tool if any remain after cleanup.
        await this.removeCommandFiles(projectPath, toolId);

        spinner.succeed(`Setup complete for ${tool.name}`);
        newlyConfigured.push(toolId);
      } catch (error) {
        spinner.fail(`Failed to set up ${tool.name}`);
        console.log(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    if (newlyConfigured.length > 0) {
      console.log();
    }

    return newlyConfigured;
  }
}
