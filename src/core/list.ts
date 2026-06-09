import { promises as fs } from 'fs';
import path from 'path';
import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MarkdownParser } from './parsers/markdown-parser.js';

interface ChangeInfo {
  name: string;
  completedTasks: number;
  totalTasks: number;
  lastModified: Date;
}

interface ListOptions {
  sort?: 'recent' | 'name';
  json?: boolean;
}

/**
 * Get the most recent modification time of any file in a directory (recursive).
 * Falls back to the directory's own mtime if no files are found.
 */
async function getLastModified(dirPath: string): Promise<Date> {
  let latest: Date | null = null;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        if (latest === null || stat.mtime > latest) {
          latest = stat.mtime;
        }
      }
    }
  }

  await walk(dirPath);

  // If no files found, use the directory's own modification time
  if (latest === null) {
    const dirStat = await fs.stat(dirPath);
    return dirStat.mtime;
  }

  return latest;
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "3 days ago")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) {
    return date.toLocaleDateString();
  } else if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return 'just now';
  }
}

interface SpecInfo {
  id: string;
  requirementCount: number;
}

export class ListCommand {
  async execute(targetPath: string = '.', mode: 'changes' | 'specs' = 'changes', options: ListOptions = {}): Promise<void> {
    if (mode === 'changes') {
      await this.listChanges(targetPath, options);
    } else {
      await this.listSpecs(targetPath);
    }
  }

  private async listChanges(targetPath: string, options: ListOptions): Promise<void> {
    const { sort = 'recent', json = false } = options;
    const changesDir = path.join(targetPath, 'spok', 'changes');

    // Check if changes directory exists
    try {
      await fs.access(changesDir);
    } catch {
      throw new Error("No Spok changes directory found. Run 'spok init' first.");
    }

    const changeDirs = await readSubdirectories(changesDir, name => name !== 'archive');

    if (changeDirs.length === 0) {
      console.log(json ? JSON.stringify({ changes: [] }) : 'No active changes found.');
      return;
    }

    const changes = await this.collectChanges(changesDir, changeDirs);

    // Sort by preference (default: recent first)
    if (sort === 'recent') {
      changes.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    } else {
      changes.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (json) {
      this.printChangesJson(changes);
    } else {
      this.printChangesTable(changes);
    }
  }

  private async collectChanges(changesDir: string, changeDirs: string[]): Promise<ChangeInfo[]> {
    const changes: ChangeInfo[] = [];
    for (const changeDir of changeDirs) {
      const progress = await getTaskProgressForChange(changesDir, changeDir);
      const lastModified = await getLastModified(path.join(changesDir, changeDir));
      changes.push({
        name: changeDir,
        completedTasks: progress.completed,
        totalTasks: progress.total,
        lastModified
      });
    }
    return changes;
  }

  private printChangesJson(changes: ChangeInfo[]): void {
    const jsonOutput = changes.map(c => ({
      name: c.name,
      completedTasks: c.completedTasks,
      totalTasks: c.totalTasks,
      lastModified: c.lastModified.toISOString(),
      status: c.totalTasks === 0 ? 'no-tasks' : c.completedTasks === c.totalTasks ? 'complete' : 'in-progress'
    }));
    console.log(JSON.stringify({ changes: jsonOutput }, null, 2));
  }

  private printChangesTable(changes: ChangeInfo[]): void {
    console.log('Changes:');
    const padding = '  ';
    const nameWidth = Math.max(...changes.map(c => c.name.length));
    for (const change of changes) {
      const paddedName = change.name.padEnd(nameWidth);
      const status = formatTaskStatus({ total: change.totalTasks, completed: change.completedTasks });
      const timeAgo = formatRelativeTime(change.lastModified);
      console.log(`${padding}${paddedName}     ${status.padEnd(12)}  ${timeAgo}`);
    }
  }

  private async listSpecs(targetPath: string): Promise<void> {
    const specsDir = path.join(targetPath, 'spok', 'specs');
    try {
      await fs.access(specsDir);
    } catch {
      console.log('No specs found.');
      return;
    }

    const specDirs = await readSubdirectories(specsDir);
    if (specDirs.length === 0) {
      console.log('No specs found.');
      return;
    }

    const specs = specDirs.map(id => ({ id, requirementCount: countSpecRequirements(specsDir, id) }));

    specs.sort((a, b) => a.id.localeCompare(b.id));
    console.log('Specs:');
    const padding = '  ';
    const nameWidth = Math.max(...specs.map(s => s.id.length));
    for (const spec of specs) {
      const padded = spec.id.padEnd(nameWidth);
      console.log(`${padding}${padded}     requirements ${spec.requirementCount}`);
    }
  }
}

/**
 * List the names of immediate subdirectories, optionally filtered by name.
 */
async function readSubdirectories(dir: string, include: (name: string) => boolean = () => true): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && include(entry.name))
    .map(entry => entry.name);
}

/**
 * Count the requirements declared in a spec's spec.md.
 * Returns 0 if the spec cannot be read or parsed.
 */
function countSpecRequirements(specsDir: string, id: string): number {
  const specPath = join(specsDir, id, 'spec.md');
  try {
    const content = readFileSync(specPath, 'utf-8');
    const spec = new MarkdownParser(content).parseSpec(id);
    return spec.requirements.length;
  } catch {
    return 0;
  }
}