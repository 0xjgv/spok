import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import { FileSystemUtils } from '../../utils/file-system.js';

/**
 * Checks if a path contains glob pattern characters.
 */
export function isGlobPattern(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
}

function isInsideChangeDir(changeDir: string, candidatePath: string): boolean {
  const relativePath = path.relative(changeDir, candidatePath);
  return (
    relativePath === '' ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

/**
 * Resolves an artifact's output path(s) to concrete files that currently exist.
 * Returns absolute file paths. Glob matches are sorted for deterministic output.
 */
export function resolveArtifactOutputs(changeDir: string, generates: string): string[] {
  const canonicalChangeDir = FileSystemUtils.canonicalizeExistingPath(changeDir);

  if (!isGlobPattern(generates)) {
    const fullPath = path.join(canonicalChangeDir, generates);
    try {
      const canonicalOutput = FileSystemUtils.canonicalizeExistingPath(fullPath);
      return fs.statSync(fullPath).isFile() && isInsideChangeDir(canonicalChangeDir, canonicalOutput)
        ? [canonicalOutput]
        : [];
    } catch {
      return [];
    }
  }

  const normalizedPattern = FileSystemUtils.toPosixPath(generates);
  const matches = fg
    .sync(normalizedPattern, { cwd: canonicalChangeDir, onlyFiles: true, absolute: true })
    .map((match) => FileSystemUtils.canonicalizeExistingPath(path.normalize(match)))
    .filter((match) => isInsideChangeDir(canonicalChangeDir, match));

  return Array.from(new Set(matches)).sort();
}

/**
 * Checks if an artifact has at least one resolved output file.
 */
export function artifactOutputExists(changeDir: string, generates: string): boolean {
  return resolveArtifactOutputs(changeDir, generates).length > 0;
}
