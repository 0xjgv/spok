import { execFileSync } from 'node:child_process';
import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as skillVendor from '../../../src/core/skill-vendor.js';
import {
  captureExecution, executionChanges, prepareExecution, validateExecutionScope,
} from '../../../src/commands/workflow/execution-context.js';

let root: string;
let taskDir: string;

function git(...args: string[]): string {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'spok-execution-')));
  git('init', '-b', 'main');
  git('config', 'user.name', 'Spok Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(root, 'tracked.txt'), 'original\n');
  await fs.writeFile(path.join(root, 'other file.txt'), 'other\n');
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored.txt\n.agents/\n.claude/\n');
  git('add', '.');
  git('commit', '-m', 'initial');
  taskDir = path.join(root, 'spok/changes/example/.flow/01-first');
  await fs.mkdir(taskDir, { recursive: true });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('execution skill catalogs', () => {
  it('provisions both catalogs before capturing unignored setup files in the baseline', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored.txt\n');
    git('add', '.gitignore');
    git('commit', '-m', 'Track local tool setup in this fixture');
    const execution = await prepareExecution(taskDir);
    for (const tool of ['.agents', '.claude']) {
      const skill = `${tool}/skills/spok-implement-plan/SKILL.md`;
      expect(await fs.readFile(path.join(execution.workRoot, skill), 'utf8')).toContain('spok-implement-plan');
      expect(Object.hasOwn(execution.baselineChanges, skill)).toBe(true);
      await expect(fs.access(path.join(root, tool))).rejects.toThrow();
    }
    expect(await executionChanges(execution, taskDir)).toEqual([]);
    await fs.writeFile(path.join(execution.workRoot, 'owned.txt'), 'implementation\n');
    expect(await executionChanges(execution, taskDir)).toEqual(['owned.txt']);
  });

  it('preserves an existing linked-worktree catalog and custom skills while filling the missing catalog', async () => {
    const linked = path.join(root, '.git/existing');
    git('worktree', 'add', '-b', 'existing', linked);
    const linkedTask = path.join(linked, 'task');
    await fs.mkdir(linkedTask);
    const catalog = path.join(linked, '.agents/skills');
    await fs.mkdir(path.join(catalog, 'custom'), { recursive: true });
    await fs.mkdir(path.join(catalog, 'spok-flow'));
    await fs.writeFile(path.join(catalog, 'custom/SKILL.md'), 'custom skill\n');
    await fs.writeFile(path.join(catalog, 'spok-flow/SKILL.md'), 'customized flow\n');
    const execution = await prepareExecution(linkedTask);
    expect(await fs.readFile(path.join(catalog, 'custom/SKILL.md'), 'utf8')).toBe('custom skill\n');
    expect(await fs.readFile(path.join(catalog, 'spok-flow/SKILL.md'), 'utf8')).toBe('customized flow\n');
    expect((await fs.readdir(catalog)).sort()).toEqual(['custom', 'spok-flow']);
    await expect(fs.access(path.join(linked, '.claude/skills/spok-implement-plan/SKILL.md'))).resolves.toBeUndefined();
    expect(await executionChanges(execution, linkedTask)).toEqual([]);
  });

  it('surfaces skipped installation instead of dispatching without a catalog', async () => {
    vi.spyOn(skillVendor, 'installVendoredSkills').mockResolvedValue({
      installedSkills: [], skipped: true, reason: 'vendored skills source not found',
    });
    await expect(prepareExecution(taskDir)).rejects.toThrow('vendored skills source not found');
  });

  it('preserves and rejects a non-directory catalog', async () => {
    const linked = path.join(root, '.git/existing');
    git('worktree', 'add', '-b', 'existing', linked);
    const linkedTask = path.join(linked, 'task');
    await fs.mkdir(linkedTask);
    const catalog = path.join(linked, '.agents/skills');
    await fs.mkdir(path.dirname(catalog));
    await fs.writeFile(catalog, 'preserve me\n');
    await expect(prepareExecution(linkedTask)).rejects.toThrow('catalog is not a directory');
    expect(await fs.readFile(catalog, 'utf8')).toBe('preserve me\n');
  });

  it('blocks provisioning a missing catalog through a symlinked tool directory', async () => {
    const linked = path.join(root, '.git/existing');
    git('worktree', 'add', '-b', 'existing', linked);
    const linkedTask = path.join(linked, 'task');
    await fs.mkdir(linkedTask);
    const external = path.join(root, '.git/shared-tool');
    await fs.mkdir(external);
    await fs.symlink(external, path.join(linked, '.agents'), 'junction');
    await expect(prepareExecution(linkedTask)).rejects.toThrow('through symbolic-link directory');
    expect(await fs.readdir(external)).toEqual([]);
    expect(await fs.realpath(path.join(linked, '.agents'))).toBe(external);
    expect((await fs.lstat(path.join(linked, '.agents'))).isSymbolicLink()).toBe(true);
  });
});

describe('execution worktrees', () => {
  it('isolates committed HEAD and leaves staged, unstaged, and untracked source edits untouched', async () => {
    await fs.writeFile(path.join(root, 'tracked.txt'), 'staged\n');
    git('add', 'tracked.txt');
    await fs.writeFile(path.join(root, 'tracked.txt'), 'unstaged\n');
    await fs.writeFile(path.join(root, 'private.txt'), 'untracked\n');
    const before = git('status', '--porcelain');
    const execution = await prepareExecution(taskDir);
    expect(path.dirname(execution.workRoot)).toBe(path.join(root, '.git', 'spok-worktrees'));
    expect(execution.branch).toMatch(/^spok\/example-/);
    expect(execution.baselineHead).toBe(git('rev-parse', 'HEAD'));
    expect(execution.baselineChanges).toEqual({});
    expect(await fs.readFile(path.join(execution.workRoot, 'tracked.txt'), 'utf8')).toBe('original\n');
    expect(await fs.readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('unstaged\n');
    expect(git('show', ':tracked.txt')).toBe('staged');
    expect(git('status', '--porcelain')).toBe(before);
    expect(git('branch', '--show-current')).toBe('main');
  });

  it('reuses one registered worktree across chunks and captures a fresh baseline', async () => {
    const first = await prepareExecution(taskDir);
    await fs.writeFile(path.join(first.workRoot, 'leftover.txt'), 'preserve\n');
    const nextTask = path.join(path.dirname(taskDir), '02-next');
    await fs.mkdir(nextTask);
    const next = await prepareExecution(nextTask);
    expect(next.workRoot).toBe(first.workRoot);
    expect(next.branch).toBe(first.branch);
    expect(Object.keys(next.baselineChanges)).toEqual(['leftover.txt']);
    expect(await executionChanges(next, nextTask)).toEqual([]);
  });

  it('reuses a named linked checkout without touching its existing edits', async () => {
    const linked = path.join(root, '.git/existing');
    git('worktree', 'add', '-b', 'existing', linked);
    const linkedTask = path.join(linked, 'task');
    await fs.mkdir(linkedTask);
    await fs.writeFile(path.join(linked, 'tracked.txt'), 'local\n');
    const execution = await prepareExecution(linkedTask);
    expect(execution.workRoot).toBe(linked);
    expect(execution.branch).toBe('existing');
    expect(Object.keys(execution.baselineChanges)).toEqual(['tracked.txt']);
  });

  it('refuses a detached source checkout', async () => {
    git('checkout', '--detach');
    await expect(prepareExecution(taskDir)).rejects.toThrow('detached HEAD');
  });

  it('refuses an existing branch without its registered worktree', async () => {
    const first = await prepareExecution(taskDir);
    git('worktree', 'remove', first.workRoot);
    await expect(prepareExecution(taskDir)).rejects.toThrow('collision');
    expect(git('branch', '--show-current')).toBe('main');
  });

  it('ignores ambient Git directory and index overrides', async () => {
    vi.stubEnv('GIT_DIR', path.join(root, 'missing-git-dir'));
    vi.stubEnv('GIT_WORK_TREE', path.join(root, 'missing-tree'));
    vi.stubEnv('GIT_COMMON_DIR', path.join(root, 'missing-common'));
    vi.stubEnv('GIT_INDEX_FILE', path.join(root, 'missing-index'));
    const execution = await prepareExecution(taskDir);
    expect(await executionChanges(execution, taskDir)).toEqual([]);
    expect(await fs.readFile(path.join(execution.workRoot, 'tracked.txt'), 'utf8')).toBe('original\n');
  });
});

describe('execution task aliases', () => {
  it.each(['repository', 'task'])('reuses committed work across a %s alias and a canonical sibling chunk', async (target) => {
    const alias = path.join(root, '.git', 'source-alias');
    await fs.symlink(target === 'repository' ? root : taskDir, alias, 'junction');
    const aliasedTask = target === 'repository' ? path.join(alias, path.relative(root, taskDir)) : alias;
    expect(realpathSync.native(aliasedTask)).toBe(realpathSync.native(taskDir));
    const sourceHead = git('rev-parse', 'HEAD');
    const first = await prepareExecution(aliasedTask);
    await fs.writeFile(path.join(first.workRoot, 'chunk-one.txt'), 'first chunk\n');
    git('-C', first.workRoot, 'add', 'chunk-one.txt');
    git('-C', first.workRoot, 'commit', '-m', 'First chunk');
    const firstHead = git('-C', first.workRoot, 'rev-parse', 'HEAD');
    const sibling = path.join(path.dirname(taskDir), '02-next');
    await fs.mkdir(sibling);
    const next = await prepareExecution(sibling);
    expect(realpathSync.native(next.workRoot)).toBe(realpathSync.native(first.workRoot));
    expect(next.branch).toBe(first.branch);
    expect(next.baselineHead).toBe(firstHead);
    expect(await fs.readFile(path.join(next.workRoot, 'chunk-one.txt'), 'utf8')).toBe('first chunk\n');
    expect(await executionChanges(next, sibling)).toEqual([]);
    expect(git('rev-parse', 'HEAD')).toBe(sourceHead);
  });
});

describe('execution ownership', () => {
  it('owns exact new paths and preserves unrelated baseline changes', async () => {
    await fs.writeFile(path.join(root, 'other file.txt'), 'pre-existing\n');
    const execution = await captureExecution(root, taskDir);
    await fs.writeFile(path.join(root, 'tracked.txt'), 'chunk\n');
    await fs.writeFile(path.join(root, 'new file.txt'), 'new\n');
    await fs.writeFile(path.join(root, 'ignored.txt'), 'ignored\n');
    await fs.writeFile(path.join(taskDir, 'workflow-state.json'), '{}');
    expect(await executionChanges(execution, taskDir)).toEqual(['new file.txt', 'tracked.txt']);
    await expect(validateExecutionScope(execution, taskDir, ['tracked.txt', 'new file.txt'])).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(root, 'other file.txt'), 'utf8')).toBe('pre-existing\n');
  });

  it.each(['overwrite', 'restore', 'stage'])('blocks %s of a pre-existing dirty file', async (operation) => {
    await fs.writeFile(path.join(root, 'other file.txt'), 'pre-existing\n');
    const execution = await captureExecution(root, taskDir);
    if (operation === 'overwrite') await fs.writeFile(path.join(root, 'other file.txt'), 'changed\n');
    if (operation === 'restore') git('restore', 'other file.txt');
    if (operation === 'stage') git('add', 'other file.txt');
    await expect(executionChanges(execution, taskDir)).rejects.toThrow('Pre-existing change was modified: other file.txt');
  });

  it('detects index changes even when working bytes remain unchanged', async () => {
    await fs.writeFile(path.join(root, 'tracked.txt'), 'staged\n');
    git('add', 'tracked.txt');
    await fs.writeFile(path.join(root, 'tracked.txt'), 'unstaged\n');
    const execution = await captureExecution(root, taskDir);
    git('reset', 'HEAD', '--', 'tracked.txt');
    await expect(executionChanges(execution, taskDir)).rejects.toThrow('Pre-existing change was modified');
  });

  it.skipIf(process.platform === 'win32')('includes both paths of a staged rename containing spaces and newlines', async () => {
    const execution = await captureExecution(root, taskDir);
    git('mv', 'other file.txt', 'renamed\nfile.txt');
    expect(await executionChanges(execution, taskDir)).toEqual(['other file.txt', 'renamed\nfile.txt']);
    await expect(validateExecutionScope(execution, taskDir, ['renamed\nfile.txt'])).rejects.toThrow('outside execution scope');
  });

  it('preserves staged renames present before execution', async () => {
    git('mv', 'other file.txt', 'renamed file.txt');
    const execution = await captureExecution(root, taskDir);
    expect(Object.keys(execution.baselineChanges).sort()).toEqual(['other file.txt', 'renamed file.txt']);
    expect(await executionChanges(execution, taskDir)).toEqual([]);
    await fs.writeFile(path.join(root, 'renamed file.txt'), 'changed\n');
    await expect(executionChanges(execution, taskDir)).rejects.toThrow('Pre-existing change was modified');
  });

  it('preserves a baseline staged deletion when staging an identical owned file', async () => {
    git('rm', 'other file.txt');
    const execution = await captureExecution(root, taskDir);
    await fs.writeFile(path.join(root, 'owned.txt'), 'other\n');
    expect(await executionChanges(execution, taskDir)).toEqual(['owned.txt']);
    git('add', 'owned.txt');
    expect(git('status', '--porcelain')).toContain('R  "other file.txt" -> owned.txt');
    expect(await executionChanges(execution, taskDir)).toEqual(['owned.txt']);
    await expect(validateExecutionScope(execution, taskDir, ['owned.txt'])).resolves.toBeUndefined();
    expect(git('diff', '--cached', '--name-status', '--no-renames'))
      .toBe('D\tother file.txt\nA\towned.txt');
  });

});

describe('execution scope', () => {
  it('allows simplification to restore owned files while blocking new out-of-scope paths', async () => {
    const execution = await captureExecution(root, taskDir);
    await fs.writeFile(path.join(root, 'tracked.txt'), 'chunk\n');
    execution.ownedPaths = await executionChanges(execution, taskDir);
    git('restore', 'tracked.txt');
    await expect(validateExecutionScope(execution, taskDir, execution.ownedPaths)).resolves.toBeUndefined();
    await fs.writeFile(path.join(root, 'other file.txt'), 'escape\n');
    await expect(validateExecutionScope(execution, taskDir, execution.ownedPaths)).rejects.toThrow('Changes outside execution scope: other file.txt');
  });

  it('accepts Git forward-slash paths for nested owned files on every host', async () => {
    const execution = await captureExecution(root, taskDir);
    await fs.mkdir(path.join(root, 'src/nested'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/nested/owned.ts'), 'export const owned = true;\n');
    expect(await executionChanges(execution, taskDir)).toEqual(['src/nested/owned.ts']);
    await expect(validateExecutionScope(execution, taskDir, ['src/nested/owned.ts'])).resolves.toBeUndefined();
  });

  it.each(['../outside', '/absolute', 'src/../../outside', 'src//file.ts', 'src/./file.ts', ':(glob)*', '.'])('rejects scope escape %s', async (escape) => {
    const execution = await captureExecution(root, taskDir);
    await expect(validateExecutionScope(execution, taskDir, [escape])).rejects.toThrow('exact repository-relative paths');
  });

  it('blocks HEAD changes during an active chunk', async () => {
    const execution = await captureExecution(root, taskDir);
    git('commit', '--allow-empty', '-m', 'unexpected');
    await expect(executionChanges(execution, taskDir)).rejects.toThrow('branch or HEAD changed');
  });

  it('blocks branch changes even when HEAD stays unchanged', async () => {
    const execution = await captureExecution(root, taskDir);
    git('checkout', '-b', 'unexpected');
    await expect(executionChanges(execution, taskDir)).rejects.toThrow('branch or HEAD changed');
  });

  it('excludes corresponding task artifacts created inside a dedicated worktree', async () => {
    const execution = await prepareExecution(taskDir);
    const projectedTask = path.join(execution.workRoot, path.relative(root, taskDir));
    await fs.mkdir(projectedTask, { recursive: true });
    await fs.writeFile(path.join(projectedTask, 'validation.md'), 'PASS');
    expect(await executionChanges(execution, taskDir)).toEqual([]);
  });
});
