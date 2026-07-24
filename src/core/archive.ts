import { promises as fs } from 'fs';
import path from 'path';
import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import { validateChangeName } from '../utils/change-utils.js';
import { Validator } from './validation/validator.js';
import type { ValidationIssue, ValidationLevel } from './validation/types.js';
import chalk from 'chalk';
import {
  findSpecUpdates,
  buildUpdatedSpec,
  writeUpdatedSpec,
  type SpecUpdate,
} from './specs-apply.js';

/**
 * Recursively copy a directory. Used when fs.rename fails (e.g. EPERM on Windows).
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Move a directory from src to dest. On Windows, fs.rename() often fails with
 * EPERM when the directory is non-empty or another process has it open (IDE,
 * file watcher, antivirus). Fall back to copy-then-remove when rename fails
 * with EPERM or EXDEV.
 */
async function moveDirectory(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: any) {
    const code = err?.code;
    if (code === 'EPERM' || code === 'EXDEV') {
      await copyDirRecursive(src, dest);
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

const DELTA_SECTION_HEADER = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/m;

const ISSUE_STYLES: Record<ValidationLevel, { symbol: string; paint: (text: string) => string }> = {
  ERROR: { symbol: '✗', paint: chalk.red },
  WARNING: { symbol: '⚠', paint: chalk.yellow },
  INFO: { symbol: 'ℹ', paint: chalk.cyan },
};

/**
 * Render an issue with its location, so a long report stays navigable.
 */
function formatIssue(issue: ValidationIssue): string {
  const { symbol, paint } = ISSUE_STYLES[issue.level];
  const location = issue.path && issue.path !== 'file' ? `${issue.path}: ` : '';
  return paint(`  ${symbol} ${location}${issue.message}`);
}

/**
 * True for issues anchored to the change's `deltas` array. Those deltas are
 * re-parsed from the delta spec files and graded as full requirements, so
 * name-only REMOVED entries always fail. validateChangeDeltaSpecs grades the
 * same files under the right rules, making these duplicates noise.
 */
function isDeltaIssue({ path: issuePath }: ValidationIssue): boolean {
  // Zod joins with dots (`deltas.0.requirement.text`); applyChangeRules writes
  // brackets (`deltas[0].description`). Both dialects appear in one report.
  return issuePath === 'deltas' || issuePath.startsWith('deltas.') || issuePath.startsWith('deltas[');
}

export class ArchiveCommand {
  async execute(
    changeName?: string,
    options: { yes?: boolean; skipSpecs?: boolean; noValidate?: boolean; validate?: boolean } = {}
  ): Promise<void> {
    const targetPath = '.';
    const changesDir = path.join(targetPath, 'spok', 'changes');
    const archiveDir = path.join(changesDir, 'archive');
    const mainSpecsDir = path.join(targetPath, 'spok', 'specs');

    // Check if changes directory exists
    try {
      await fs.access(changesDir);
    } catch {
      throw new Error("No Spok changes directory found. Run 'spok init' first.");
    }

    if (changeName !== undefined) {
      const nameValidation = validateChangeName(changeName);
      if (!nameValidation.valid) {
        throw new Error(`Invalid change name '${changeName}': ${nameValidation.error}`);
      }
    }

    // Get change name interactively if not provided
    if (!changeName) {
      const selectedChange = await this.selectChange(changesDir);
      if (!selectedChange) {
        console.log('No change selected. Aborting.');
        return;
      }
      changeName = selectedChange;
    }

    const changeDir = path.join(changesDir, changeName);

    // Verify change exists
    try {
      const stat = await fs.stat(changeDir);
      if (!stat.isDirectory()) {
        throw new Error(`Change '${changeName}' not found.`);
      }
    } catch {
      throw new Error(`Change '${changeName}' not found.`);
    }

    const skipValidation = options.validate === false || options.noValidate === true;

    // Validate specs and change before archiving
    const mayProceed = skipValidation
      ? await this.confirmSkippedValidation(changeName, changeDir, options.yes)
      : await this.reportPreArchiveValidation(changeDir);
    if (!mayProceed) {
      return;
    }

    // Show progress and check for incomplete tasks
    const progress = await getTaskProgressForChange(changesDir, changeName);
    const status = formatTaskStatus(progress);
    console.log(`Task status: ${status}`);

    const incompleteTasks = Math.max(progress.total - progress.completed, 0);
    if (incompleteTasks > 0) {
      if (!options.yes) {
        const { confirm } = await import('@inquirer/prompts');
        const proceed = await confirm({
          message: `Warning: ${incompleteTasks} incomplete task(s) found. Continue?`,
          default: false
        });
        if (!proceed) {
          console.log('Archive cancelled.');
          return;
        }
      } else {
        console.log(`Warning: ${incompleteTasks} incomplete task(s) found. Continuing due to --yes flag.`);
      }
    }

    // Handle spec updates unless skipSpecs flag is set
    if (options.skipSpecs) {
      console.log('Skipping spec updates (--skip-specs flag provided).');
    } else {
      // Find specs to update
      const specUpdates = await findSpecUpdates(changeDir, mainSpecsDir);
      
      if (specUpdates.length > 0) {
        console.log('\nSpecs to update:');
        for (const update of specUpdates) {
          const status = update.exists ? 'update' : 'create';
          const capability = path.basename(path.dirname(update.target));
          console.log(`  ${capability}: ${status}`);
        }

        let shouldUpdateSpecs = true;
        if (!options.yes) {
          const { confirm } = await import('@inquirer/prompts');
          shouldUpdateSpecs = await confirm({
            message: 'Proceed with spec updates?',
            default: true
          });
          if (!shouldUpdateSpecs) {
            console.log('Skipping spec updates. Proceeding with archive.');
          }
        }

        if (shouldUpdateSpecs) {
          // Prepare all updates first (validation pass, no writes)
          const prepared: Array<{ update: SpecUpdate; rebuilt: string; counts: { added: number; modified: number; removed: number; renamed: number } }> = [];
          try {
            for (const update of specUpdates) {
              const built = await buildUpdatedSpec(update, changeName!);
              prepared.push({ update, rebuilt: built.rebuilt, counts: built.counts });
            }
          } catch (err: any) {
            console.log(String(err.message || err));
            console.log('Aborted. No files were changed.');
            return;
          }

          // All validations passed; pre-validate rebuilt full spec and then write files and display counts
          let totals = { added: 0, modified: 0, removed: 0, renamed: 0 };
          for (const p of prepared) {
            const specName = path.basename(path.dirname(p.update.target));
            if (!skipValidation) {
              const report = await new Validator().validateSpecContent(specName, p.rebuilt);
              if (!report.valid) {
                console.log(chalk.red(`\nValidation errors in rebuilt spec for ${specName} (will not write changes):`));
                for (const issue of report.issues) {
                  console.log(formatIssue(issue));
                }
                console.log('Aborted. No files were changed.');
                return;
              }
            }
            await writeUpdatedSpec(p.update, p.rebuilt, p.counts);
            totals.added += p.counts.added;
            totals.modified += p.counts.modified;
            totals.removed += p.counts.removed;
            totals.renamed += p.counts.renamed;
          }
          console.log(
            `Totals: + ${totals.added}, ~ ${totals.modified}, - ${totals.removed}, → ${totals.renamed}`
          );
          console.log('Specs updated successfully.');
        }
      }
    }

    // Create archive directory with date prefix
    const archiveName = `${this.getArchiveDate()}-${changeName}`;
    const archivePath = path.join(archiveDir, archiveName);

    // Check if archive already exists
    try {
      await fs.access(archivePath);
      throw new Error(`Archive '${archiveName}' already exists.`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Create archive directory if needed
    await fs.mkdir(archiveDir, { recursive: true });

    // Move change to archive (uses copy+remove on EPERM/EXDEV, e.g. Windows)
    await moveDirectory(changeDir, archivePath);

    console.log(`Change '${changeName}' archived as '${archiveName}'.`);
  }

  /**
   * Report proposal and delta-spec issues. Returns false when a blocking
   * delta-spec error means the archive must not proceed.
   */
  private async reportPreArchiveValidation(changeDir: string): Promise<boolean> {
    const validator = new Validator();
    // Delta-formatted spec files, when present, are the authority on requirement rules.
    const hasDeltaSpecs = await this.hasDeltaSpecs(path.join(changeDir, 'specs'));

    // Proposal validation is informative only (do not block archive)
    const changeFile = path.join(changeDir, 'proposal.md');
    const proposalExists = await fs.access(changeFile).then(() => true, () => false);
    if (proposalExists) {
      const changeReport = await validator.validateChange(changeFile);
      const issues = hasDeltaSpecs
        ? changeReport.issues.filter(issue => !isDeltaIssue(issue))
        : changeReport.issues;
      if (issues.length > 0) {
        console.log(chalk.yellow('\nProposal issues in proposal.md (non-blocking):'));
        for (const issue of issues) {
          console.log(formatIssue(issue));
        }
      }
    }

    if (!hasDeltaSpecs) {
      return true;
    }

    const deltaReport = await validator.validateChangeDeltaSpecs(changeDir);
    if (deltaReport.valid) {
      return true;
    }

    console.log(chalk.red('\nValidation errors in change delta specs:'));
    for (const issue of deltaReport.issues) {
      console.log(formatIssue(issue));
    }
    console.log(chalk.red('\nValidation failed. Please fix the errors before archiving.'));
    console.log(chalk.yellow('To skip validation (not recommended), use --no-validate flag.'));
    return false;
  }

  /**
   * Warn that validation was skipped. Returns false when the user declines.
   */
  private async confirmSkippedValidation(
    changeName: string,
    changeDir: string,
    assumeYes?: boolean
  ): Promise<boolean> {
    const timestamp = new Date().toISOString();

    if (!assumeYes) {
      const { confirm } = await import('@inquirer/prompts');
      const proceed = await confirm({
        message: chalk.yellow('⚠️  WARNING: Skipping validation may archive invalid specs. Continue? (y/N)'),
        default: false
      });
      if (!proceed) {
        console.log('Archive cancelled.');
        return false;
      }
    } else {
      console.log(chalk.yellow(`\n⚠️  WARNING: Skipping validation may archive invalid specs.`));
    }

    console.log(chalk.yellow(`[${timestamp}] Validation skipped for change: ${changeName}`));
    console.log(chalk.yellow(`Affected files: ${changeDir}`));
    return true;
  }

  /**
   * True when any spec.md under the change carries a delta section header.
   */
  private async hasDeltaSpecs(changeSpecsDir: string): Promise<boolean> {
    const candidates = await fs.readdir(changeSpecsDir, { withFileTypes: true }).catch(() => []);

    for (const candidate of candidates) {
      if (!candidate.isDirectory()) continue;
      const specPath = path.join(changeSpecsDir, candidate.name, 'spec.md');
      // A missing or unreadable spec.md contributes no deltas.
      const content = await fs.readFile(specPath, 'utf-8').catch(() => '');
      if (DELTA_SECTION_HEADER.test(content)) {
        return true;
      }
    }

    return false;
  }

  private async selectChange(changesDir: string): Promise<string | null> {
    const { select } = await import('@inquirer/prompts');
    // Get all directories in changes (excluding archive)
    const entries = await fs.readdir(changesDir, { withFileTypes: true });
    const changeDirs = entries
      .filter(entry => entry.isDirectory() && entry.name !== 'archive')
      .map(entry => entry.name)
      .sort();

    if (changeDirs.length === 0) {
      console.log('No active changes found.');
      return null;
    }

    // Build choices with progress inline to avoid duplicate lists
    let choices: Array<{ name: string; value: string }> = changeDirs.map(name => ({ name, value: name }));
    try {
      const progressList: Array<{ id: string; status: string }> = [];
      for (const id of changeDirs) {
        const progress = await getTaskProgressForChange(changesDir, id);
        const status = formatTaskStatus(progress);
        progressList.push({ id, status });
      }
      const nameWidth = Math.max(...progressList.map(p => p.id.length));
      choices = progressList.map(p => ({
        name: `${p.id.padEnd(nameWidth)}     ${p.status}`,
        value: p.id
      }));
    } catch {
      // If anything fails, fall back to simple names
      choices = changeDirs.map(name => ({ name, value: name }));
    }

    try {
      const answer = await select({
        message: 'Select a change to archive',
        choices
      });
      return answer;
    } catch (error) {
      // User cancelled (Ctrl+C)
      return null;
    }
  }

  private getArchiveDate(): string {
    // Returns date in YYYY-MM-DD format
    return new Date().toISOString().split('T')[0];
  }
}
