import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { installVendoredSkills } from '../../core/skill-vendor.js';

const execFileAsync = promisify(execFile);

export interface FlowExecution {
  workRoot: string;
  branch: string;
  baselineHead: string;
  baselineChanges: Record<string, string>;
  ownedPaths?: string[];
}

async function git(root: string, args: string[]): Promise<string> {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) {
    delete env[key];
  }
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    env, maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function repository(root: string) {
  const result = await git(root, [
    'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir',
  ]);
  const [workRoot, gitDir, commonDir] = await Promise.all(
    result.trimEnd().split('\n').map((entry) => fs.realpath(entry))
  );
  let branch: string;
  try {
    branch = (await git(workRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch {
    throw new Error(`Execution requires a named branch; detached HEAD at ${workRoot}.`);
  }
  return { workRoot, gitDir, commonDir, branch };
}

function changeKey(taskDir: string, sourceRoot: string): string {
  let current = path.resolve(taskDir);
  while (current !== path.dirname(current)) {
    if (path.basename(current) === '.flow') {
      return path.relative(sourceRoot, path.dirname(current));
    }
    current = path.dirname(current);
  }
  return path.relative(sourceRoot, path.resolve(taskDir));
}

function worktreeName(key: string): string {
  const slug = path.basename(key).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
  return `${slug.slice(0, 48) || 'flow'}-${hash}`;
}

async function dedicatedWorktree(sourceRoot: string, commonDir: string, key: string) {
  const name = worktreeName(key);
  const workRoot = path.join(commonDir, 'spok-worktrees', name);
  const branch = `spok/${name}`;
  const registrations = (await git(sourceRoot, ['worktree', 'list', '--porcelain', '-z']))
    .split('\0\0').map((entry) => entry.split('\0'));
  const registration = registrations.find((entry) => {
    const registeredRoot = entry.find((field) => field.startsWith('worktree '));
    return registeredRoot !== undefined && path.normalize(registeredRoot.slice(9)) === workRoot;
  });
  if (registration) {
    const existing = await repository(workRoot);
    if (existing.commonDir !== commonDir || existing.workRoot !== workRoot ||
        existing.branch !== branch || !registration.includes(`branch refs/heads/${branch}`)) {
      throw new Error(`Execution worktree collision at ${workRoot}.`);
    }
    return workRoot;
  }
  const branches = await git(sourceRoot, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`]);
  const occupied = await fs.lstat(workRoot).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (occupied || branches.trim()) throw new Error(`Execution worktree collision at ${workRoot}.`);
  await fs.mkdir(path.dirname(workRoot), { recursive: true });
  await git(sourceRoot, ['worktree', 'add', '-b', branch, workRoot, 'HEAD']);
  return workRoot;
}

async function existingEntry(file: string) {
  return fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function provisionExecutionSkills(workRoot: string): Promise<void> {
  for (const tool of ['.agents', '.claude']) {
    const catalog = path.join(workRoot, tool, 'skills');
    const existing = await existingEntry(catalog);
    if (existing) {
      if (!(await fs.stat(catalog)).isDirectory()) {
        throw new Error(`Execution skills catalog is not a directory: ${catalog}`);
      }
      continue;
    }
    if ((await existingEntry(path.dirname(catalog)))?.isSymbolicLink()) {
      throw new Error(`Cannot provision execution skills through symbolic-link directory: ${path.dirname(catalog)}`);
    }
    const installed = await installVendoredSkills(workRoot, tool);
    if (installed.skipped || installed.installedSkills.length === 0) {
      throw new Error(`Cannot provision execution skills at ${catalog}: ${installed.reason ?? 'no skills installed'}`);
    }
  }
}

/** Reuse an explicit linked checkout; otherwise isolate this change from the main checkout. */
export async function prepareExecution(taskDir: string): Promise<FlowExecution> {
  const canonicalTaskDir = await fs.realpath(taskDir);
  const source = await repository(canonicalTaskDir);
  const workRoot = source.gitDir === source.commonDir
    ? await dedicatedWorktree(source.workRoot, source.commonDir, changeKey(canonicalTaskDir, source.workRoot))
    : source.workRoot;
  await provisionExecutionSkills(workRoot);
  return captureExecution(workRoot, taskDir);
}

function isInside(relative: string): boolean {
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function taskArtifactPrefix(taskDir: string): Promise<string | undefined> {
  const sourceRoot = (await git(taskDir, ['rev-parse', '--show-toplevel'])).trimEnd();
  const relative = path.relative(sourceRoot, await fs.realpath(taskDir));
  if (!relative || !isInside(relative)) return;
  return relative.split(path.sep).join('/') + '/';
}

function statusPaths(status: string): Map<string, string> {
  const paths = new Map<string, string>();
  for (const entry of status.split('\0')) {
    if (!entry) continue;
    paths.set(entry.slice(3), entry.slice(0, 2));
  }
  return paths;
}

function indexEntries(output: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const entry of output.split('\0')) {
    if (!entry) continue;
    const separator = entry.indexOf('\t');
    const name = entry.slice(separator + 1);
    entries.set(name, `${entries.get(name) ?? ''}${entry.slice(0, separator)}\0`);
  }
  return entries;
}

async function workingContent(file: string): Promise<Buffer | string> {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) return `symlink:${await fs.readlink(file)}`;
    if (!stat.isFile()) throw new Error(`Cannot snapshot dirty directory: ${file}`);
    const bytes = await fs.readFile(file);
    return Buffer.concat([Buffer.from(`${stat.mode}:`), bytes]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function snapshot(workRoot: string, taskDir: string): Promise<Record<string, string>> {
  const [status, staged, artifactPrefix] = await Promise.all([
    git(workRoot, ['status', '--porcelain=v1', '--no-renames', '-z', '--untracked-files=all']),
    git(workRoot, ['ls-files', '--stage', '-z']),
    taskArtifactPrefix(taskDir),
  ]);
  const index = indexEntries(staged);
  const fingerprints: Record<string, string> = Object.create(null);
  for (const [name, state] of statusPaths(status)) {
    if (artifactPrefix && name.startsWith(artifactPrefix)) continue;
    fingerprints[name] = createHash('sha256')
      .update(state).update('\0').update(index.get(name) ?? '').update('\0')
      .update(await workingContent(path.join(workRoot, name))).digest('hex');
  }
  return fingerprints;
}

export async function captureExecution(workRoot: string, taskDir: string): Promise<FlowExecution> {
  const repo = await repository(workRoot);
  if (repo.workRoot !== await fs.realpath(workRoot)) {
    throw new Error(`Execution work root must be the repository root: ${workRoot}`);
  }
  const baselineHead = (await git(repo.workRoot, ['rev-parse', 'HEAD'])).trim();
  const execution = {
    workRoot: repo.workRoot, branch: repo.branch, baselineHead,
    baselineChanges: await snapshot(repo.workRoot, taskDir),
  };
  await assertExecutionHead(execution);
  return execution;
}

export async function assertExecutionHead(execution: FlowExecution): Promise<void> {
  const repo = await repository(execution.workRoot);
  const head = (await git(execution.workRoot, ['rev-parse', 'HEAD'])).trim();
  if (repo.workRoot !== execution.workRoot || repo.branch !== execution.branch ||
      head !== execution.baselineHead) {
    throw new Error('Execution branch or HEAD changed since this chunk started.');
  }
}

/** Existing dirty files belong to the caller, including files later restored to HEAD. */
export async function executionChanges(execution: FlowExecution, taskDir: string): Promise<string[]> {
  await assertExecutionHead(execution);
  const current = await snapshot(execution.workRoot, taskDir);
  for (const [name, fingerprint] of Object.entries(execution.baselineChanges)) {
    if (current[name] !== fingerprint) throw new Error(`Pre-existing change was modified: ${name}`);
  }
  return Object.keys(current).filter((name) => !Object.hasOwn(execution.baselineChanges, name)).sort();
}

export async function validateExecutionScope(
  execution: FlowExecution, taskDir: string, allowlist: string[]
): Promise<void> {
  for (const name of allowlist) {
    if (!name || path.isAbsolute(name) || name.split(/[\\/]/).includes('..') ||
        name.startsWith(':') || path.posix.normalize(name) !== name || name === '.') {
      throw new Error(`Execution scope requires exact repository-relative paths: ${name}`);
    }
  }
  const allowed = new Set(allowlist);
  const outside = (await executionChanges(execution, taskDir)).filter((name) => !allowed.has(name));
  if (outside.length) throw new Error(`Changes outside execution scope: ${outside.join(', ')}`);
}
