/**
 * Worktree Link Registration
 *
 * `wt` (git-worktree workspace tool) reads a `.worktreelink` file at the repo
 * root: one directory per line, each symlinked into every worktree so edits
 * land in the root checkout. Spok registers its specs directory relative to
 * that root (`spok/` at the root, or `<project>/spok/` for a nested project).
 *
 * Both steps are idempotent (exact-line match, append-only) and never clobber
 * existing entries. Projects outside git skip the exclude step, while invalid
 * git metadata skips registration entirely.
 */
import { readFileSync, statSync } from 'fs';
import * as path from 'path';
import { FileSystemUtils } from '../utils/file-system.js';
import { SPOK_DIR_NAME } from './config.js';

const WORKTREE_LINK_FILE = '.worktreelink';

export type LineStatus = 'created' | 'appended' | 'exists' | 'skipped';

export interface WorktreeLinkResult {
  linkFile: LineStatus;
  gitExclude: LineStatus;
}

interface GitCheckout {
  root: string;
  commonDir: string;
}

function requireDirectory(directoryPath: string): string {
  if (!statSync(directoryPath).isDirectory()) {
    throw new Error(`Expected a directory at ${directoryPath}`);
  }
  return FileSystemUtils.canonicalizeExistingPath(directoryPath);
}

function resolveGitDirectory(root: string, markerPath: string): string {
  const marker = statSync(markerPath);
  if (marker.isDirectory()) {
    return FileSystemUtils.canonicalizeExistingPath(markerPath);
  }
  if (!marker.isFile()) {
    throw new Error(`Invalid git marker at ${markerPath}`);
  }

  const pointer = /^gitdir:\s*(.+)$/i.exec(readFileSync(markerPath, 'utf-8').trim())?.[1];
  if (!pointer) {
    throw new Error(`Invalid gitdir pointer at ${markerPath}`);
  }
  return requireDirectory(path.resolve(root, pointer));
}

function resolveCommonDirectory(gitDir: string): string {
  const commonDirPath = path.join(gitDir, 'commondir');
  const marker = statSync(commonDirPath, { throwIfNoEntry: false });
  if (!marker) return gitDir;
  if (!marker.isFile()) {
    throw new Error(`Invalid commondir marker at ${commonDirPath}`);
  }

  const pointer = readFileSync(commonDirPath, 'utf-8').trim();
  if (!pointer) {
    throw new Error(`Empty commondir pointer at ${commonDirPath}`);
  }
  return requireDirectory(path.resolve(gitDir, pointer));
}

function resolveCheckoutAt(root: string): GitCheckout | null {
  const markerPath = path.join(root, '.git');
  if (!statSync(markerPath, { throwIfNoEntry: false })) return null;

  const gitDir = resolveGitDirectory(root, markerPath);
  return { root, commonDir: resolveCommonDirectory(gitDir) };
}

/** Append `line` to `filePath` unless an identical line is already present. */
async function ensureLine(filePath: string, line: string): Promise<LineStatus> {
  if (!(await FileSystemUtils.fileExists(filePath))) {
    await FileSystemUtils.writeFile(filePath, `${line}\n`);
    return 'created';
  }

  const content = await FileSystemUtils.readFile(filePath);
  if (content.split(/\r?\n/).includes(line)) {
    return 'exists';
  }

  const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  await FileSystemUtils.writeFile(filePath, `${content}${separator}${line}\n`);
  return 'appended';
}

/**
 * Resolve the enclosing checkout root and shared git directory.
 *
 * Walk ancestors for git metadata, including linked-worktree gitdir and
 * commondir pointers. Invalid metadata throws so callers don't misclassify a
 * broken checkout as a non-git project.
 */
export function resolveGitCheckout(projectPath: string): GitCheckout | null {
  let currentDir = FileSystemUtils.canonicalizeExistingPath(projectPath);
  while (true) {
    const checkout = resolveCheckoutAt(currentDir);
    if (checkout) return checkout;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

/**
 * Register the project's `spok/` directory in the enclosing checkout's
 * `.worktreelink` and keep that file out of git's untracked listing.
 *
 * @param projectPath Absolute path to the project root.
 */
export async function ensureWorktreeLink(projectPath: string): Promise<WorktreeLinkResult> {
  const canonicalProjectPath = FileSystemUtils.canonicalizeExistingPath(projectPath);
  let checkout: GitCheckout | null;
  try {
    checkout = resolveGitCheckout(canonicalProjectPath);
  } catch {
    return { linkFile: 'skipped', gitExclude: 'skipped' };
  }
  const linkRoot = checkout?.root ?? canonicalProjectPath;
  const relativeSpokPath = checkout
    ? path.relative(linkRoot, path.join(canonicalProjectPath, SPOK_DIR_NAME))
    : SPOK_DIR_NAME;
  const linkEntry = `${relativeSpokPath.split(path.sep).join('/')}/`;
  const linkFile = await ensureLine(path.join(linkRoot, WORKTREE_LINK_FILE), linkEntry);

  if (!checkout) {
    return { linkFile, gitExclude: 'skipped' };
  }

  try {
    const gitExclude = await ensureLine(
      path.join(checkout.commonDir, 'info', 'exclude'),
      WORKTREE_LINK_FILE
    );
    return { linkFile, gitExclude };
  } catch {
    return { linkFile, gitExclude: 'skipped' };
  }
}
