import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { UpdateCommand } from '../../src/core/update.js';

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

describe('UpdateCommand', () => {
  let testDir: string;
  let originalXdgConfigHome: string | undefined;
  let originalCodexHome: string | undefined;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `spok-update-${randomUUID()}`);
    await fs.mkdir(path.join(testDir, 'spok'), { recursive: true });
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

  it('refreshes Claude and Codex skills while removing command wrapper directories', async () => {
    await fs.mkdir(path.join(testDir, '.claude', 'skills', 'spok-propose'), { recursive: true });
    await fs.writeFile(path.join(testDir, '.claude', 'skills', 'spok-propose', 'SKILL.md'), 'old skill');
    await fs.mkdir(path.join(testDir, '.agents', 'skills', 'spok-propose'), { recursive: true });
    await fs.writeFile(path.join(testDir, '.agents', 'skills', 'spok-propose', 'SKILL.md'), 'old skill');

    const claudeCommandDir = path.join(testDir, '.claude', 'commands');
    const codexPromptDir = path.join(process.env.CODEX_HOME!, 'prompts');
    await fs.mkdir(claudeCommandDir, { recursive: true });
    await fs.writeFile(path.join(claudeCommandDir, 'spok-propose.md'), 'stale command');
    await fs.mkdir(codexPromptDir, { recursive: true });
    await fs.writeFile(path.join(codexPromptDir, 'spok-propose.md'), 'stale prompt');

    await new UpdateCommand({ force: true }).execute(testDir);

    await expect(pathExists(path.join(testDir, '.claude', 'skills', 'spok-archive', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(testDir, '.agents', 'skills', 'spok-archive', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(testDir, '.claude', 'commands'))).resolves.toBe(false);
    await expect(pathExists(path.join(testDir, '.codex'))).resolves.toBe(false);
    await expect(pathExists(codexPromptDir)).resolves.toBe(false);
  });
});
