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

async function updateExistingGlobalSkills(homeDir: string, projectDir: string): Promise<void> {
  process.chdir(projectDir);
  await new GlobalSkillsInstallCommand({
    tools: 'codex',
    interactive: false,
    homeDir,
  }).execute();
  await fs.rm(path.join(homeDir, '.agents', 'skills', 'spok-flow'), {
    recursive: true,
    force: true,
  });
  await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true });

  await new GlobalSkillsInstallCommand({
    mode: 'update',
    interactive: false,
    homeDir,
  }).execute();

  await expect(pathExists(path.join(homeDir, '.agents', 'skills', 'spok-flow', 'SKILL.md'))).resolves.toBe(true);
  await expect(pathExists(path.join(homeDir, '.claude', 'skills', 'spok-flow', 'SKILL.md'))).resolves.toBe(false);
  await expect(pathExists(path.join(projectDir, 'spok'))).resolves.toBe(false);
  expect(loggedText()).toContain('Global Spok Skills Updated');
}

async function forceGlobalSkillsUpdate(homeDir: string): Promise<void> {
  await new GlobalSkillsInstallCommand({
    tools: 'codex',
    interactive: false,
    homeDir,
  }).execute();
  const flowSkill = path.join(homeDir, '.agents', 'skills', 'spok-flow', 'SKILL.md');
  await fs.writeFile(flowSkill, 'local customization');

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

    await new GlobalSkillsInstallCommand({
      tools: 'claude,codex,factory',
      interactive: false,
      homeDir,
    }).execute();

    await expect(pathExists(path.join(homeDir, '.claude', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.claude', 'skills', 'spok-flow', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.agents', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.factory', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(projectDir, 'spok'))).resolves.toBe(false);
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

  it('updates existing global skills and repairs a missing vendored helper', async () => {
    await updateExistingGlobalSkills(homeDir, projectDir);
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
});
