/**
 * Worktree Link Registration
 *
 * `wt` (git-worktree workspace tool) reads a `.worktreelink` file at the repo
 * root: one directory per line, each symlinked into every worktree so edits
 * land in the root checkout. Spok writes its specs under `spok/`, so a Spok
 * project wants `spok/` listed there.
 *
 * Both steps are idempotent (exact-line match, append-only) and never clobber
 * existing entries. Projects that aren't git repos skip the exclude step.
 */
import * as path from 'path';
import * as fs from 'fs';
import { FileSystemUtils } from '../utils/file-system.js';
import { SPOK_DIR_NAME } from './config.js';

const WORKTREE_LINK_FILE = '.worktreelink';
const WORKTREE_LINK_ENTRY = `${SPOK_DIR_NAME}/`;

export type LineStatus = 'created' | 'appended' | 'exists' | 'skipped';

export interface WorktreeLinkResult {
  linkFile: LineStatus;
  gitExclude: LineStatus;
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
 * Resolve the git *common* dir for `projectPath` (where `info/exclude` lives).
 *
 * In a linked worktree `.git` is a file pointing at `<common>/worktrees/<name>`,
 * whose `commondir` file points back at the shared dir — the fs equivalent of
 * `git rev-parse --path-format=absolute --git-common-dir`.
 *
 * @returns Absolute path, or null when `projectPath` isn't a git checkout.
 */
export function resolveGitCommonDir(projectPath: string): string | null {
  const gitPath = path.join(projectPath, '.git');

  let stats: fs.Stats;
  try {
    stats = fs.statSync(gitPath);
  } catch {
    return null;
  }

  if (stats.isDirectory()) return gitPath;
  if (!stats.isFile()) return null;

  const pointer = fs.readFileSync(gitPath, 'utf-8').match(/^gitdir:\s*(.+?)\s*$/m);
  if (!pointer) return null;

  const gitDir = path.resolve(projectPath, pointer[1]);
  const commondirFile = path.join(gitDir, 'commondir');

  try {
    return path.resolve(gitDir, fs.readFileSync(commondirFile, 'utf-8').trim());
  } catch {
    return gitDir;
  }
}

/**
 * Register `spok/` in the project's `.worktreelink` and keep that file out of
 * git's untracked listing via `.git/info/exclude`.
 *
 * @param projectPath Absolute path to the project root.
 */
export async function ensureWorktreeLink(projectPath: string): Promise<WorktreeLinkResult> {
  const linkFile = await ensureLine(
    path.join(projectPath, WORKTREE_LINK_FILE),
    WORKTREE_LINK_ENTRY
  );

  const commonDir = resolveGitCommonDir(projectPath);
  if (!commonDir) {
    return { linkFile, gitExclude: 'skipped' };
  }

  try {
    const gitExclude = await ensureLine(
      path.join(commonDir, 'info', 'exclude'),
      WORKTREE_LINK_FILE
    );
    return { linkFile, gitExclude };
  } catch {
    return { linkFile, gitExclude: 'skipped' };
  }
}
