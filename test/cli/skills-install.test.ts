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

describe('global Spok skills CLI', () => {
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

  it('installs selected global skills and native agents from the CLI', async () => {
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
    await expect(pathExists(path.join(homeDir, '.claude', 'agents', 'spok-codebase-locator.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.claude', 'agents', 'spok-implementer-agent.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.codex', 'agents', 'spok-codebase-locator.toml'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.codex', 'agents', 'spok-implementer-agent.toml'))).resolves.toBe(true);
    await expect(pathExists(path.join(homeDir, '.factory', 'agents'))).resolves.toBe(false);
    expect(result.stdout).toContain('5 Spok agents in ~/.claude/agents');
    expect(result.stdout).toContain('5 Spok agents in ~/.codex/agents');
    await expect(pathExists(path.join(projectDir, 'spok'))).resolves.toBe(false);
  }, 30_000);

  it('requires force to adopt an exact unmarked Claude agent collision', async () => {
    const collisionPath = path.join(
      homeDir,
      '.claude',
      'agents',
      'spok-codebase-locator.md'
    );
    const installedSkill = path.join(
      homeDir,
      '.claude',
      'skills',
      'spok-explore',
      'SKILL.md'
    );
    const unmarkedContent = '# User-owned agent\n';
    await fs.mkdir(path.dirname(collisionPath), { recursive: true });
    await fs.writeFile(collisionPath, unmarkedContent);

    const env = {
      HOME: homeDir,
      SPOK_TELEMETRY: '0',
      USERPROFILE: homeDir,
      XDG_CONFIG_HOME: path.join(testDir, 'xdg-config'),
    };
    const collisionResult = await runCLI(['skills', 'install', '--tools', 'claude'], {
      cwd: projectDir,
      env,
      timeoutMs: 20_000,
    });

    expect(collisionResult.exitCode).not.toBe(0);
    expect(`${collisionResult.stdout}${collisionResult.stderr}`).toContain(collisionPath);
    expect(`${collisionResult.stdout}${collisionResult.stderr}`).toContain('--force');
    await expect(fs.readFile(collisionPath, 'utf8')).resolves.toBe(unmarkedContent);
    await expect(pathExists(installedSkill)).resolves.toBe(false);
    await expect(pathExists(path.join(projectDir, 'spok'))).resolves.toBe(false);

    const forcedResult = await runCLI(
      ['skills', 'install', '--tools', 'claude', '--force'],
      {
        cwd: projectDir,
        env,
        timeoutMs: 20_000,
      }
    );

    expect(forcedResult.exitCode).toBe(0);
    await expect(fs.readFile(collisionPath, 'utf8')).resolves.toContain('spok-managed-agent');
    await expect(pathExists(installedSkill)).resolves.toBe(true);
    await expect(pathExists(path.join(projectDir, 'spok'))).resolves.toBe(false);
  }, 30_000);

  it('routes forced global updates without creating project state', async () => {
    const installedSkill = path.join(homeDir, '.agents', 'skills', 'spok-explore', 'SKILL.md');
    await fs.mkdir(path.dirname(installedSkill), { recursive: true });
    await fs.writeFile(installedSkill, 'old skill');

    const result = await runCLI(['update', '--global', '--force'], {
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
    expect(result.stdout).toContain('Global Spok Skills Updated');
    await expect(fs.readFile(installedSkill, 'utf-8')).resolves.not.toBe('old skill');
    await expect(pathExists(path.join(homeDir, '.agents', 'skills', 'spok-flow', 'SKILL.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(projectDir, 'spok'))).resolves.toBe(false);
  }, 30_000);

  it('documents global skills and native agent commands without changing project update routing', async () => {
    const helpEnv = {
      HOME: homeDir,
      SPOK_TELEMETRY: '0',
      USERPROFILE: homeDir,
    };
    const skillsHelpResult = await runCLI(['skills', '--help'], {
      env: helpEnv,
    });
    expect(skillsHelpResult.exitCode).toBe(0);
    expect(skillsHelpResult.stdout).toContain('Manage global Spok skills and native agents');
    expect(skillsHelpResult.stdout).toContain(
      'spok skills install --tools claude,codex --force'
    );

    const installHelpResult = await runCLI(['skills', 'install', '--help'], {
      env: helpEnv,
    });
    expect(installHelpResult.exitCode).toBe(0);
    expect(installHelpResult.stdout).toContain('--force');
    expect(installHelpResult.stdout).toContain('Install global Spok skills and native agents');

    const helpResult = await runCLI(['update', '--help'], {
      env: helpEnv,
    });
    expect(helpResult.exitCode).toBe(0);
    expect(helpResult.stdout).toContain('--global');
    expect(helpResult.stdout).toContain('globally installed Spok skills and native agents');

    const updateResult = await runCLI(['update', projectDir, '--global'], {
      env: {
        HOME: homeDir,
        SPOK_TELEMETRY: '0',
        USERPROFILE: homeDir,
      },
    });
    expect(updateResult.exitCode).not.toBe(0);
    expect(`${updateResult.stdout}${updateResult.stderr}`).toContain(
      'The [path] argument cannot be used with --global.'
    );

    const dotResult = await runCLI(['update', '.', '--global'], {
      env: {
        HOME: homeDir,
        SPOK_TELEMETRY: '0',
        USERPROFILE: homeDir,
      },
    });
    expect(dotResult.exitCode).not.toBe(0);
    expect(`${dotResult.stdout}${dotResult.stderr}`).toContain(
      'The [path] argument cannot be used with --global.'
    );
  });
});
