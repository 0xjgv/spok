import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { InitCommand } from '../../src/core/init.js';

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

describe('InitCommand', () => {
  let testDir: string;
  let originalXdgConfigHome: string | undefined;
  let originalCodexHome: string | undefined;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `spok-init-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    originalCodexHome = process.env.CODEX_HOME;
    process.env.XDG_CONFIG_HOME = path.join(testDir, 'xdg-config');
    process.env.CODEX_HOME = path.join(testDir, 'codex-home');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('creates Claude and Codex skills without command wrapper directories', async () => {
    const claudeCommandDir = path.join(testDir, '.claude', 'commands');
    const codexPromptDir = path.join(process.env.CODEX_HOME!, 'prompts');
    await fs.mkdir(claudeCommandDir, { recursive: true });
    await fs.writeFile(path.join(claudeCommandDir, 'spok-propose.md'), 'stale command');
    await fs.mkdir(codexPromptDir, { recursive: true });
    await fs.writeFile(path.join(codexPromptDir, 'spok-propose.md'), 'stale prompt');

    await new InitCommand({
      tools: 'claude,codex',
      force: true,
      interactive: false,
    }).execute(testDir);

    await expect(pathExists(path.join(testDir, '.claude', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(testDir, '.claude', 'skills', 'spok-explore', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(testDir, '.agents', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(testDir, '.agents', 'skills', 'spok-explore', 'SKILL.md'))).resolves.toBe(true);

    const exploreSkill = await fs.readFile(
      path.join(testDir, '.claude', 'skills', 'spok-explore', 'SKILL.md'),
      'utf-8'
    );
    expect(exploreSkill).toContain('/spok-explore');
    expect(exploreSkill).toContain('Explore mode is for thinking, not implementing');
    expect(exploreSkill).toContain('must NOT write code or implement features');
    expect(exploreSkill).toContain('spok list --json');
    expect(exploreSkill).toContain('spok status --change "<name>" --json');
    expect(exploreSkill).toContain('Do not auto-capture');
    expect(exploreSkill).not.toContain('/opsx:explore');
    expect(vi.mocked(console.log)).toHaveBeenCalledWith('  /spok-explore  Think through an idea');
    expect(vi.mocked(console.log)).toHaveBeenCalledWith('  /spok-propose  Start a new change');

    await expect(pathExists(path.join(testDir, '.claude', 'commands'))).resolves.toBe(false);
    await expect(pathExists(path.join(testDir, '.codex'))).resolves.toBe(false);
    await expect(pathExists(codexPromptDir)).resolves.toBe(false);
  });
});
