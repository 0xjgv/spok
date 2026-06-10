/**
 * Global Skills Install Command
 *
 * Installs Spok skills into home-scoped AI tool directories.
 */

import path from 'path';
import os from 'os';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { createRequire } from 'module';
import { AI_TOOLS, type AIToolOption } from './config.js';
import { getSkillTemplates, getToolsWithSkillsDir, generateSkillContent } from './shared/index.js';
import { installVendoredSkills } from './skill-vendor.js';
import { FileSystemUtils } from '../utils/file-system.js';
import { transformToHyphenCommands } from '../utils/command-references.js';
import { isInteractive } from '../utils/interactive.js';
import { parseToolsSelectionArg } from './tool-selection.js';
import { checkClaudeSubagents, formatSubagentWarning } from './subagent-check.js';

const SPOK_WORKFLOWS = ['explore', 'propose', 'apply', 'archive'] as const;

const require = createRequire(import.meta.url);
const { version: SPOK_VERSION } = require('../../package.json');

type SkillTool = AIToolOption & { skillsDir: string };

export interface GlobalSkillsInstallOptions {
  tools?: string;
  interactive?: boolean;
  homeDir?: string;
}

interface GlobalToolState {
  tool: SkillTool;
  hasToolDir: boolean;
  hasSpokSkills: boolean;
  spokSkillNames: string[];
}

interface ValidatedGlobalTool {
  value: string;
  name: string;
  skillsDir: string;
  wasInstalled: boolean;
}

interface GlobalInstallResult {
  createdTools: ValidatedGlobalTool[];
  refreshedTools: ValidatedGlobalTool[];
  failedTools: Array<{ name: string; error: Error }>;
}

function getSkillTools(): SkillTool[] {
  return AI_TOOLS.filter((tool): tool is SkillTool => Boolean(tool.skillsDir));
}

function getSpokSkillNames(skillsRoot: string): string[] {
  try {
    return fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('spok-'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function getGlobalToolStates(homeDir: string): Map<string, GlobalToolState> {
  const states = new Map<string, GlobalToolState>();

  for (const tool of getSkillTools()) {
    const toolRoot = path.join(homeDir, tool.skillsDir);
    const skillsRoot = path.join(toolRoot, 'skills');
    const spokSkillNames = getSpokSkillNames(skillsRoot);

    states.set(tool.value, {
      tool,
      hasToolDir: fs.existsSync(toolRoot) && fs.statSync(toolRoot).isDirectory(),
      hasSpokSkills: spokSkillNames.length > 0,
      spokSkillNames,
    });
  }

  return states;
}

async function writeGlobalToolSkills(
  homeDir: string,
  tool: Pick<ValidatedGlobalTool, 'value' | 'skillsDir'>
): Promise<void> {
  const skillsDir = path.join(homeDir, tool.skillsDir, 'skills');
  const skillTemplates = getSkillTemplates([...SPOK_WORKFLOWS]);

  for (const { template, dirName } of skillTemplates) {
    const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
    const transformer =
      tool.value === 'opencode' || tool.value === 'pi' ? transformToHyphenCommands : undefined;
    const skillContent = generateSkillContent(template, SPOK_VERSION, transformer);

    await FileSystemUtils.writeFile(skillFile, skillContent);
  }

  await installVendoredSkills(homeDir, tool.skillsDir);
}

export class GlobalSkillsInstallCommand {
  private readonly toolsArg?: string;
  private readonly interactiveOption?: boolean;
  private readonly homeDir: string;

  constructor(options: GlobalSkillsInstallOptions = {}) {
    this.toolsArg = options.tools;
    this.interactiveOption = options.interactive;
    this.homeDir = path.resolve(options.homeDir ?? os.homedir());
  }

  async execute(): Promise<void> {
    await this.validateHome();

    const toolStates = getGlobalToolStates(this.homeDir);
    const selectedToolIds = await this.getSelectedTools(toolStates);
    const validatedTools = this.validateTools(selectedToolIds, toolStates);

    this.warnBeforeRefreshing(validatedTools);

    const results = await this.installTools(validatedTools);

    this.warnIfClaudeSubagentsMissing(validatedTools);
    this.displaySuccessMessage(results);
  }

  private async validateHome(): Promise<void> {
    if (!(await FileSystemUtils.ensureWritePermissions(this.homeDir))) {
      throw new Error(`Insufficient permissions to write to ${this.homeDir}`);
    }
  }

  private canPromptInteractively(): boolean {
    if (this.interactiveOption === false) return false;
    if (this.toolsArg !== undefined) return false;
    return isInteractive({ interactive: this.interactiveOption });
  }

  private async getSelectedTools(toolStates: Map<string, GlobalToolState>): Promise<string[]> {
    const nonInteractiveSelection = parseToolsSelectionArg(this.toolsArg);
    if (nonInteractiveSelection !== null) {
      return nonInteractiveSelection;
    }

    const validTools = getToolsWithSkillsDir();
    const canPrompt = this.canPromptInteractively();

    if (!canPrompt) {
      throw new Error(
        `Global skills install requires --tools in non-interactive mode because it writes under ${this.homeDir}. Use --tools all, --tools none, or --tools claude,codex,...`
      );
    }

    if (validTools.length === 0) {
      throw new Error('No tools available for global skill installation.');
    }

    const configuredToolIds = new Set(
      [...toolStates.entries()]
        .filter(([, status]) => status.hasSpokSkills)
        .map(([toolId]) => toolId)
    );
    const detectedToolIds = new Set(
      [...toolStates.entries()]
        .filter(([, status]) => status.hasToolDir)
        .map(([toolId]) => toolId)
    );
    const shouldPreselectDetected = configuredToolIds.size === 0;

    const sortedChoices = validTools
      .map((toolId) => {
        const tool = AI_TOOLS.find((t) => t.value === toolId);
        const configured = configuredToolIds.has(toolId);
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
      console.log(`Global Spok skills found: ${configuredNames.join(', ')} (pre-selected for refresh)`);
    }

    const detectedOnlyNames = validTools
      .filter((toolId) => detectedToolIds.has(toolId) && !configuredToolIds.has(toolId))
      .map((toolId) => AI_TOOLS.find((t) => t.value === toolId)?.name || toolId);

    if (detectedOnlyNames.length > 0) {
      const detectionLabel = shouldPreselectDetected
        ? 'pre-selected for first-time global install'
        : 'not pre-selected';
      console.log(`Detected global tool directories: ${detectedOnlyNames.join(', ')} (${detectionLabel})`);
    }

    const { searchableMultiSelect } = await import('../prompts/searchable-multi-select.js');

    const selectedTools = await searchableMultiSelect({
      message: `Select tools to install global Spok skills (${validTools.length} available)`,
      pageSize: 15,
      choices: sortedChoices,
      validate: (selected: string[]) => selected.length > 0 || 'Select at least one tool',
    });

    if (selectedTools.length === 0) {
      throw new Error('At least one tool must be selected');
    }

    return selectedTools;
  }

  private validateTools(
    toolIds: string[],
    toolStates: Map<string, GlobalToolState>
  ): ValidatedGlobalTool[] {
    const validatedTools: ValidatedGlobalTool[] = [];

    for (const toolId of toolIds) {
      const tool = AI_TOOLS.find((t) => t.value === toolId);
      if (!tool) {
        const validToolIds = getToolsWithSkillsDir();
        throw new Error(`Unknown tool '${toolId}'. Valid tools:\n  ${validToolIds.join('\n  ')}`);
      }

      if (!tool.skillsDir) {
        const validToolsWithSkills = getToolsWithSkillsDir();
        throw new Error(
          `Tool '${toolId}' does not support skill generation.\nTools with skill generation support:\n  ${validToolsWithSkills.join('\n  ')}`
        );
      }

      validatedTools.push({
        value: tool.value,
        name: tool.name,
        skillsDir: tool.skillsDir,
        wasInstalled: toolStates.get(tool.value)?.hasSpokSkills ?? false,
      });
    }

    return validatedTools;
  }

  private warnBeforeRefreshing(tools: ValidatedGlobalTool[]): void {
    const refreshedTools = tools.filter((tool) => tool.wasInstalled);
    if (refreshedTools.length === 0) return;

    console.log();
    console.log(
      chalk.yellow(
        `Refreshing existing global Spok skills for: ${refreshedTools.map((tool) => tool.name).join(', ')}`
      )
    );
    console.log(chalk.dim('Existing spok-* skill directories for selected tools will be overwritten.'));
  }

  private async installTools(tools: ValidatedGlobalTool[]): Promise<GlobalInstallResult> {
    const createdTools: ValidatedGlobalTool[] = [];
    const refreshedTools: ValidatedGlobalTool[] = [];
    const failedTools: Array<{ name: string; error: Error }> = [];

    for (const tool of tools) {
      const spinner = ora(`Installing global skills for ${tool.name}...`).start();

      try {
        await writeGlobalToolSkills(this.homeDir, tool);

        spinner.succeed(`Installed global skills for ${tool.name}`);

        if (tool.wasInstalled) {
          refreshedTools.push(tool);
        } else {
          createdTools.push(tool);
        }
      } catch (error) {
        spinner.fail(`Failed for ${tool.name}`);
        failedTools.push({ name: tool.name, error: error as Error });
      }
    }

    return { createdTools, refreshedTools, failedTools };
  }

  private warnIfClaudeSubagentsMissing(tools: ValidatedGlobalTool[]): void {
    if (!tools.some((tool) => tool.value === 'claude')) return;

    const warning = formatSubagentWarning(checkClaudeSubagents(this.homeDir));
    if (warning) {
      console.log();
      console.log(chalk.yellow(warning));
    }
  }

  private displaySuccessMessage(results: GlobalInstallResult): void {
    console.log();
    console.log(chalk.bold('Global Spok Skills Installed'));
    console.log();

    if (results.createdTools.length > 0) {
      console.log(`Created: ${results.createdTools.map((tool) => tool.name).join(', ')}`);
    }
    if (results.refreshedTools.length > 0) {
      console.log(`Refreshed: ${results.refreshedTools.map((tool) => tool.name).join(', ')}`);
    }

    const successfulTools = [...results.createdTools, ...results.refreshedTools];
    if (successfulTools.length > 0) {
      const skillCount = getSkillTemplates([...SPOK_WORKFLOWS]).length;
      const toolDirs = successfulTools
        .map((tool) => path.join('~', tool.skillsDir, 'skills'))
        .join(', ');
      console.log(`${skillCount} skills plus vendored helpers in ${toolDirs}`);
    }

    if (successfulTools.length === 0 && results.failedTools.length === 0) {
      console.log(chalk.dim('No tools selected.'));
    }

    if (results.failedTools.length > 0) {
      console.log(
        chalk.red(
          `Failed: ${results.failedTools.map((failure) => `${failure.name} (${failure.error.message})`).join(', ')}`
        )
      );
    }

    if (successfulTools.length > 0) {
      console.log();
      console.log(chalk.white('Restart your IDE for skills to take effect.'));
    }

    console.log();
  }
}
