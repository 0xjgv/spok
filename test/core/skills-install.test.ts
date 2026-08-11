import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

const promptMock = vi.hoisted(() => ({
  calls: [] as Array<{
    choices: Array<{
      value: string;
      configured?: boolean;
      detected?: boolean;
      preSelected?: boolean;
    }>;
  }>,
  selected: undefined as string[] | undefined,
}));

vi.mock('../../src/utils/interactive.js', () => ({
  isInteractive: () => true,
}));

vi.mock('../../src/prompts/searchable-multi-select.js', () => ({
  searchableMultiSelect: vi.fn(async (options) => {
    promptMock.calls.push(options);
    return promptMock.selected ?? options.choices
      .filter((choice: { preSelected?: boolean }) => choice.preSelected)
      .map((choice: { value: string }) => choice.value);
  }),
}));

import { GlobalSkillsInstallCommand } from '../../src/core/skills-install.js';
import { MANAGED_AGENT_MARKER } from '../../src/core/agent-vendor.js';

const TEST_AGENT_NAME = 'spok-codebase-locator';

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function loggedText(): string {
  return vi.mocked(console.log).mock.calls
    .map((call) => call.map(String).join(' '))
    .join('\n');
}

function globalAgentPath(homeDir: string, toolId: 'claude' | 'codex'): string {
  const extension = toolId === 'claude' ? '.md' : '.toml';
  return path.join(homeDir, `.${toolId}`, 'agents', `${TEST_AGENT_NAME}${extension}`);
}

async function installGlobalTools(
  homeDir: string,
  tools: string,
  force = false
): Promise<void> {
  await new GlobalSkillsInstallCommand({
    tools,
    force,
    interactive: false,
    homeDir,
  }).execute();
}

async function updateExistingGlobalSkills(homeDir: string, projectDir: string): Promise<void> {
  process.chdir(projectDir);
  await installGlobalTools(homeDir, 'codex');
  await fs.rm(path.join(homeDir, '.agents', 'skills'), {
    recursive: true,
    force: true,
  });
  await fs.rm(globalAgentPath(homeDir, 'codex'));
  await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true });

  await new GlobalSkillsInstallCommand({
    mode: 'update',
    interactive: false,
    homeDir,
  }).execute();

  await expect(pathExists(path.join(homeDir, '.agents', 'skills', 'spok-flow', 'SKILL.md'))).resolves.toBe(true);
  await expect(pathExists(globalAgentPath(homeDir, 'codex'))).resolves.toBe(true);
  await expect(pathExists(path.join(homeDir, '.claude', 'skills', 'spok-flow', 'SKILL.md'))).resolves.toBe(false);
  await expect(pathExists(path.join(projectDir, 'spok'))).resolves.toBe(false);
  expect(loggedText()).toContain('Global Spok Skills Updated');
  expect(loggedText()).toContain('Refreshing existing global Spok skills for: Codex');
}

async function forceGlobalSkillsUpdate(homeDir: string): Promise<void> {
  await installGlobalTools(homeDir, 'codex');
  const flowSkill = path.join(homeDir, '.agents', 'skills', 'spok-flow', 'SKILL.md');
  const agentFile = globalAgentPath(homeDir, 'codex');
  const originalSkill = await fs.readFile(flowSkill, 'utf-8');
  const originalAgent = await fs.readFile(agentFile, 'utf-8');

  vi.mocked(console.log).mockClear();
  await new GlobalSkillsInstallCommand({
    mode: 'update',
    interactive: false,
    homeDir,
  }).execute();
  await expect(fs.readFile(flowSkill, 'utf-8')).resolves.toBe(originalSkill);
  await expect(fs.readFile(agentFile, 'utf-8')).resolves.toBe(originalAgent);
  expect(loggedText()).toContain('Global Spok skills are up to date.');

  await fs.writeFile(flowSkill, 'local customization');

  vi.mocked(console.log).mockClear();
  await new GlobalSkillsInstallCommand({
    mode: 'update',
    interactive: false,
    homeDir,
  }).execute();
  await expect(fs.readFile(flowSkill, 'utf-8')).resolves.toBe('local customization');
  expect(loggedText()).toContain('Global Spok skills are up to date.');

  await new GlobalSkillsInstallCommand({
    mode: 'update',
    force: true,
    interactive: false,
    homeDir,
  }).execute();
  await expect(fs.readFile(flowSkill, 'utf-8')).resolves.not.toBe('local customization');
}

describe('GlobalSkillsInstallCommand', () => {
  let testDir: string;
  let homeDir: string;
  let projectDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `spok-skills-install-${randomUUID()}`);
    homeDir = path.join(testDir, 'home');
    projectDir = path.join(testDir, 'project');
    originalCwd = process.cwd();
    promptMock.calls = [];
    promptMock.selected = undefined;
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('installs selected global skills under home directories without creating project state', async () => {
    process.chdir(projectDir);

    await installGlobalTools(homeDir, 'claude,codex,factory');

    await expect(pathExists(path.join(homeDir, '.claude', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.claude', 'skills', 'spok-flow', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.agents', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.factory', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
    const claudeAgentsDir = path.join(homeDir, '.claude', 'agents');
    const codexAgentsDir = path.join(homeDir, '.codex', 'agents');
    await expect(fs.readdir(claudeAgentsDir)).resolves.toHaveLength(16);
    await expect(fs.readdir(codexAgentsDir)).resolves.toHaveLength(16);
    await expect(fs.readFile(globalAgentPath(homeDir, 'claude'), 'utf-8'))
      .resolves.toContain(MANAGED_AGENT_MARKER);
    await expect(fs.readFile(globalAgentPath(homeDir, 'codex'), 'utf-8'))
      .resolves.toContain(MANAGED_AGENT_MARKER);
    await expect(pathExists(path.join(homeDir, '.factory', 'agents'))).resolves.toBe(false);
    await expect(pathExists(path.join(projectDir, 'spok'))).resolves.toBe(false);

    const output = loggedText();
    expect(output).toContain('16 Spok agents in ~/.claude/agents');
    expect(output).toContain('16 Spok agents in ~/.codex/agents');
    expect(output).toContain('fresh tool session');
  });

  it('preselects existing global Spok skills and warns before refreshing them', async () => {
    const staleSkill = path.join(homeDir, '.claude', 'skills', 'spok-explore', 'SKILL.md');
    await fs.mkdir(path.dirname(staleSkill), { recursive: true });
    await fs.writeFile(staleSkill, 'old skill');
    await fs.mkdir(path.join(homeDir, '.agents'), { recursive: true });

    await new GlobalSkillsInstallCommand({
      interactive: true,
      homeDir,
    }).execute();

    expect(promptMock.calls).toHaveLength(1);
    const choices = promptMock.calls[0].choices;
    const claudeChoice = choices.find((choice) => choice.value === 'claude');
    const codexChoice = choices.find((choice) => choice.value === 'codex');
    expect(claudeChoice).toMatchObject({
      configured: true,
      preSelected: true,
    });
    expect(codexChoice).toMatchObject({
      detected: true,
      preSelected: false,
    });

    const output = loggedText();
    expect(output).toContain('Global Spok skills found: Claude Code (pre-selected for refresh)');
    expect(output).toContain('Refreshing existing global Spok skills for: Claude Code');
    await expect(fs.readFile(staleSkill, 'utf-8')).resolves.toContain('Explore mode is for thinking');
  });

  it('discovers an agent-only installation and repairs its skills and agents', async () => {
    await updateExistingGlobalSkills(homeDir, projectDir);
  });

  it('repairs missing agents when installed skills are current', async () => {
    await installGlobalTools(homeDir, 'codex');
    const missingAgent = globalAgentPath(homeDir, 'codex');
    await expect(pathExists(path.join(homeDir, '.claude', 'agents'))).resolves.toBe(false);
    await fs.rm(missingAgent);

    vi.mocked(console.log).mockClear();
    await new GlobalSkillsInstallCommand({
      mode: 'update',
      interactive: false,
      homeDir,
    }).execute();

    await expect(pathExists(missingAgent)).resolves.toBe(true);
    expect(loggedText()).toContain('Global Spok Skills Updated');
  });

  it('skips a complete global installation unless forced', async () => {
    await forceGlobalSkillsUpdate(homeDir);
  });

  it('fails non-interactive global install without --tools', async () => {
    await expect(
      new GlobalSkillsInstallCommand({
        interactive: false,
        homeDir,
      }).execute()
    ).rejects.toThrow('Global skills install requires --tools in non-interactive mode');
  });

  it('rejects a cross-tool agent collision before writing any selected skills', async () => {
    const collision = globalAgentPath(homeDir, 'codex');
    await fs.mkdir(path.dirname(collision), { recursive: true });
    await fs.writeFile(collision, `name = "${TEST_AGENT_NAME}"\n# user-owned\n`);

    await expect(installGlobalTools(homeDir, 'claude,codex,factory')).rejects.toThrow(
      /Managed agent destination collision.*--force/su
    );

    await expect(fs.readFile(collision, 'utf-8'))
      .resolves.toBe(`name = "${TEST_AGENT_NAME}"\n# user-owned\n`);
    await expect(pathExists(path.join(homeDir, '.claude', 'skills'))).resolves.toBe(false);
    await expect(pathExists(path.join(homeDir, '.agents', 'skills'))).resolves.toBe(false);
    await expect(pathExists(path.join(homeDir, '.factory', 'skills'))).resolves.toBe(false);
    await expect(pathExists(path.join(homeDir, '.claude', 'agents'))).resolves.toBe(false);
  });

  it('passes force through to adopt an exact-name unmarked agent', async () => {
    const collision = globalAgentPath(homeDir, 'codex');
    await fs.mkdir(path.dirname(collision), { recursive: true });
    await fs.writeFile(collision, `name = "${TEST_AGENT_NAME}"\n# user-owned\n`);

    await installGlobalTools(homeDir, 'codex', true);

    await expect(fs.readFile(collision, 'utf-8')).resolves.toContain(MANAGED_AGENT_MARKER);
    await expect(pathExists(path.join(homeDir, '.agents', 'skills', 'spok-flow', 'SKILL.md')))
      .resolves.toBe(true);
  });
});
