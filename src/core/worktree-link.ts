/**
 * Worktree Link Registration
 *
 * `wt` (git-worktree workspace tool) reads a `.worktreelink` file at the repo
 * root: one directory per line, each symlinked into every worktree so edits
 * land in the root checkout. Spok registers its specs directory relative to
 * that root (`spok/` at the root, or `<project>/spok/` for a nested project).
 *
 * Both steps are idempotent (exact-line match, append-only) and never clobber
 * existing entries. Projects that aren't git repos skip the exclude step.
 */
import { execFileSync } from 'child_process';
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
 * Git owns repository discovery, including nested paths, linked worktrees, and
 * gitdir indirection. Failures are non-fatal because worktree registration is
 * an optional init integration.
 */
export function resolveGitCheckout(projectPath: string): GitCheckout | null {
  try {
    const output = execFileSync(
      'git',
      [
        '-C',
        projectPath,
        'rev-parse',
        '--show-toplevel',
        '--git-common-dir',
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const [root, commonDir] = output.trim().split(/\r?\n/);
    if (!root || !commonDir) return null;

    return {
      root: FileSystemUtils.canonicalizeExistingPath(path.resolve(projectPath, root)),
      commonDir: FileSystemUtils.canonicalizeExistingPath(path.resolve(projectPath, commonDir)),
    };
  } catch {
    return null;
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
  const checkout = resolveGitCheckout(canonicalProjectPath);
  const linkRoot = checkout?.root ?? canonicalProjectPath;
  const relativeSpokPath = checkout
    ? path.relative(linkRoot, path.join(canonicalProjectPath, SPOK_DIR_NAME))
    : SPOK_DIR_NAME;
  const linkEntry = `${FileSystemUtils.toPosixPath(relativeSpokPath)}/`;
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
