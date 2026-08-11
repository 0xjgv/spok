import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { getManagedAgentNames } from '../../src/core/agent-vendor.js';
import { InitCommand } from '../../src/core/init.js';
import { resolveGitCheckout } from '../../src/core/worktree-link.js';
import { searchableMultiSelect } from '../../src/prompts/searchable-multi-select.js';

vi.mock('../../src/prompts/searchable-multi-select.js', () => ({
  searchableMultiSelect: vi.fn(async () => ['claude']),
}));

vi.mock('../../src/ui/welcome-screen.js', () => ({
  showWelcomeScreen: vi.fn(async () => {}),
}));

vi.mock('../../src/utils/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/interactive.js')>()),
  isInteractive: vi.fn(() => true),
}));

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function runGit(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE;
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', env }).trim();
}

async function expectToolSkillFiles(testDir: string): Promise<void> {
  await expect(pathExists(path.join(testDir, '.claude', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
  await expect(pathExists(path.join(testDir, '.claude', 'skills', 'spok-explore', 'SKILL.md'))).resolves.toBe(true);
  await expect(pathExists(path.join(testDir, '.agents', 'skills', 'spok-propose', 'SKILL.md'))).resolves.toBe(true);
  await expect(pathExists(path.join(testDir, '.agents', 'skills', 'spok-explore', 'SKILL.md'))).resolves.toBe(true);
}

async function expectExploreSkillContent(testDir: string): Promise<void> {
  const exploreSkill = await fs.readFile(
    path.join(testDir, '.claude', 'skills', 'spok-explore', 'SKILL.md'),
    'utf-8'
  );
  expect(exploreSkill).toContain('/spok-explore');
  expect(exploreSkill).toContain('Explore mode is for thinking, not implementing');
  expect(exploreSkill).toContain('must NOT write code or implement features');
  expect(exploreSkill).toContain('spok list --json');
  expect(exploreSkill).toContain('spok status --change "<name>" --json');
  expect(exploreSkill).toContain('spok capabilities --json');
  expect(exploreSkill).toContain('Do not auto-capture');
}

async function writeHomeAgentFiles(homeDir: string): Promise<void> {
  const agentNames = await getManagedAgentNames();
  const tools = [
    { directory: '.claude', extension: '.md' },
    { directory: '.codex', extension: '.toml' },
  ] as const;

  for (const tool of tools) {
    const agentDir = path.join(homeDir, tool.directory, 'agents');
    await fs.mkdir(agentDir, { recursive: true });
    await Promise.all(agentNames.map((name) =>
      fs.writeFile(path.join(agentDir, `${name}${tool.extension}`), 'present\n')
    ));
  }
}

function consoleOutput(): string {
  return vi.mocked(console.log).mock.calls.flat().join('\n');
}

let testDir: string;
let originalHome: string | undefined;
let originalXdgConfigHome: string | undefined;
let originalCodexHome: string | undefined;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `spok-init-${randomUUID()}`);
  await fs.mkdir(testDir, { recursive: true });
  originalHome = process.env.HOME;
  originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  originalCodexHome = process.env.CODEX_HOME;
  process.env.HOME = path.join(testDir, 'home');
  process.env.XDG_CONFIG_HOME = path.join(testDir, 'xdg-config');
  process.env.CODEX_HOME = path.join(testDir, 'codex-home');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
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

describe('InitCommand skill setup', () => {
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

    await expectToolSkillFiles(testDir);
    await expectExploreSkillContent(testDir);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith('  /spok-explore  Think through an idea');
    expect(vi.mocked(console.log)).toHaveBeenCalledWith('  /spok-propose  Start a new change');

    await expect(pathExists(path.join(testDir, '.claude', 'commands'))).resolves.toBe(false);
    await expect(pathExists(path.join(testDir, '.codex'))).resolves.toBe(false);
    await expect(pathExists(codexPromptDir)).resolves.toBe(false);
  });
});

describe('InitCommand subagent readiness warning', () => {
  it('warns for missing Claude and Codex agents when both tools are selected', async () => {
    await new InitCommand({
      tools: 'claude,codex',
      force: true,
      interactive: false,
    }).execute(testDir);

    expect(consoleOutput()).toContain('Missing Spok agents for Claude Code');
    expect(consoleOutput()).toContain('Missing Spok agents for Codex');
  });

  it('does not warn for tools without managed agents', async () => {
    await new InitCommand({
      tools: 'cursor',
      force: true,
      interactive: false,
    }).execute(testDir);

    expect(consoleOutput()).not.toContain('Missing Spok agents for');
  });

  it('suppresses warnings when selected tool agents are complete', async () => {
    await writeHomeAgentFiles(process.env.HOME!);

    await new InitCommand({
      tools: 'claude,codex',
      force: true,
      interactive: false,
    }).execute(testDir);

    expect(consoleOutput()).not.toContain('Missing Spok agents for');
  });

  it('does not create home-level agent directories while checking readiness', async () => {
    const claudeAgentDir = path.join(process.env.HOME!, '.claude', 'agents');
    const codexAgentDir = path.join(process.env.HOME!, '.codex', 'agents');

    await new InitCommand({
      tools: 'claude,codex',
      force: true,
      interactive: false,
    }).execute(testDir);

    await expect(pathExists(claudeAgentDir)).resolves.toBe(false);
    await expect(pathExists(codexAgentDir)).resolves.toBe(false);
  });
});

describe('InitCommand worktree link registration', () => {
  it('registers spok/ in .worktreelink and excludes it from git, idempotently', async () => {
    runGit(testDir, 'init', '--quiet');
    await fs.writeFile(path.join(testDir, '.worktreelink'), 'docs/\n');
    await fs.writeFile(path.join(testDir, '.git', 'info', 'exclude'), '# git ls-files --others\n');

    const options = { tools: 'claude', force: true, interactive: false };
    await new InitCommand(options).execute(testDir);
    await new InitCommand(options).execute(testDir);

    const linkFile = await fs.readFile(path.join(testDir, '.worktreelink'), 'utf-8');
    expect(linkFile.split('\n').filter((line) => line === 'spok/')).toHaveLength(1);
    expect(linkFile).toContain('docs/');

    const exclude = await fs.readFile(path.join(testDir, '.git', 'info', 'exclude'), 'utf-8');
    expect(exclude.split('\n').filter((line) => line === '.worktreelink')).toHaveLength(1);
    expect(exclude).toContain('# git ls-files --others');
  });

  it('registers an aliased nested project in the current linked worktree', async () => {
    const mainDir = path.join(testDir, 'main');
    const linkedDir = path.join(testDir, 'linked');
    const aliasedLinkedDir = path.join(testDir, 'linked-alias');
    await fs.mkdir(mainDir, { recursive: true });
    runGit(mainDir, 'init', '--quiet');
    await fs.writeFile(path.join(mainDir, 'README.md'), '# Test\n');
    runGit(mainDir, 'add', 'README.md');
    runGit(
      mainDir,
      '-c',
      'user.name=Spok Tests',
      '-c',
      'user.email=spok@example.com',
      'commit',
      '--quiet',
      '-m',
      'Initial commit'
    );
    runGit(mainDir, 'worktree', 'add', '--quiet', '--detach', linkedDir);
    await fs.symlink(linkedDir, aliasedLinkedDir, process.platform === 'win32' ? 'junction' : 'dir');

    const projectDir = path.join(aliasedLinkedDir, 'packages', 'app');
    await fs.mkdir(projectDir, { recursive: true });
    await new InitCommand({ tools: 'claude', force: true, interactive: false }).execute(projectDir);

    const linkFilePath = path.join(linkedDir, '.worktreelink');
    await expect(fs.readFile(linkFilePath, 'utf-8')).resolves.toBe('packages/app/spok/\n');
    await expect(pathExists(path.join(mainDir, '.worktreelink'))).resolves.toBe(false);

    const exclude = await fs.readFile(path.join(mainDir, '.git', 'info', 'exclude'), 'utf-8');
    expect(exclude.split('\n').filter((line) => line === '.worktreelink')).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32')(
    'preserves literal backslashes in a nested project path',
    async () => {
      runGit(testDir, 'init', '--quiet');
      const projectDir = path.join(testDir, 'packages', 'app\\alias');

      await new InitCommand({ tools: 'claude', force: true, interactive: false }).execute(projectDir);

      await expect(fs.readFile(path.join(testDir, '.worktreelink'), 'utf-8')).resolves.toBe(
        'packages/app\\alias/spok/\n'
      );
    }
  );

  it('skips registration when enclosing Git metadata is invalid', async () => {
    await fs.writeFile(path.join(testDir, '.git'), 'invalid git metadata\n');
    const projectDir = path.join(testDir, 'packages', 'app');

    await new InitCommand({ tools: 'claude', force: true, interactive: false }).execute(projectDir);

    await expect(pathExists(path.join(testDir, '.worktreelink'))).resolves.toBe(false);
    await expect(pathExists(path.join(projectDir, '.worktreelink'))).resolves.toBe(false);
  });

  it.each([
    { name: '.git directory', pointer: false },
    { name: 'gitdir pointer target', pointer: true },
  ])('skips registration when the $name is empty', async ({ pointer }) => {
    const gitDir = path.join(testDir, pointer ? '.git-data' : '.git');
    await fs.mkdir(gitDir);
    if (pointer) {
      await fs.writeFile(path.join(testDir, '.git'), 'gitdir: .git-data\n');
    }
    const projectDir = path.join(testDir, 'packages', 'app');

    await new InitCommand({ tools: 'claude', force: true, interactive: false }).execute(projectDir);

    await expect(pathExists(path.join(testDir, '.worktreelink'))).resolves.toBe(false);
    await expect(pathExists(path.join(projectDir, '.worktreelink'))).resolves.toBe(false);
  });

  it('reports a missing HEAD as invalid Git metadata', async () => {
    await fs.mkdir(path.join(testDir, '.git'));
    const canonicalTestDir = await fs.realpath(testDir);

    expect(() => resolveGitCheckout(testDir)).toThrow(
      `Invalid Git HEAD at ${path.join(canonicalTestDir, '.git', 'HEAD')}`
    );
  });

  it('creates .worktreelink and skips git exclude outside a git repo', async () => {
    await new InitCommand({ tools: 'claude', force: true, interactive: false }).execute(testDir);

    await expect(fs.readFile(path.join(testDir, '.worktreelink'), 'utf-8')).resolves.toBe('spok/\n');
    await expect(pathExists(path.join(testDir, '.git'))).resolves.toBe(false);
  });
});

describe('InitCommand interactive setup', () => {
  it('preselects detected tools in interactive first-time setup', async () => {
    await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });
    await fs.mkdir(path.join(testDir, '.agents'), { recursive: true });
    vi.mocked(searchableMultiSelect).mockResolvedValueOnce(['claude']);

    await new InitCommand({
      force: true,
      interactive: true,
    }).execute(testDir);

    expect(searchableMultiSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Select tools to set up'),
      })
    );
    const choices = vi.mocked(searchableMultiSelect).mock.calls[0][0].choices;
    expect(choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'claude',
          detected: true,
          preSelected: true,
        }),
        expect.objectContaining({
          value: 'codex',
          detected: true,
          preSelected: true,
        }),
      ])
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('Detected tool directories:')
    );
    await expect(pathExists(path.join(testDir, '.claude', 'skills', 'spok-explore', 'SKILL.md'))).resolves.toBe(true);
  });
});
