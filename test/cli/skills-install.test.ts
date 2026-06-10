import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { runCLI } from '../helpers/run-cli.js';

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

describe('spok skills install', () => {
  let testDir: string;
  let homeDir: string;
  let projectDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `spok-cli-skills-install-${randomUUID()}`);
    homeDir = path.join(testDir, 'home');
    projectDir = path.join(testDir, 'project');
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('installs selected global skills from the CLI', async () => {
    const result = await runCLI(['skills', 'install', '--tools', 'claude,codex,factory'], {
      cwd: projectDir,
      env: {
        HOME: homeDir,
        SPOK_TELEMETRY: '0',
        USERPROFILE: homeDir,
        XDG_CONFIG_HOME: path.join(testDir, 'xdg-config'),
      },
      timeoutMs: 20_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Global Spok Skills Installed');
    await expect(pathExists(path.join(homeDir, '.claude', 'skills', 'spok-explore', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.agents', 'skills', 'spok-explore', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.factory', 'skills', 'spok-explore', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(projectDir, 'spok'))).resolves.toBe(false);
  }, 30_000);
});
