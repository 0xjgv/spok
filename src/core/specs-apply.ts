/**
 * Spec Application Logic
 *
 * Extracted from ArchiveCommand to enable standalone spec application.
 * Applies delta specs from a change to main specs without archiving.
 */

import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  extractRequirementsSection,
  parseDeltaSpec,
  normalizeRequirementName,
  type RequirementBlock,
  type DeltaPlan,
} from './parsers/requirement-blocks.js';
import { findMainSpecStructureIssues } from './parsers/spec-structure.js';
import { Validator } from './validation/validator.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SpecUpdate {
  source: string;
  target: string;
  exists: boolean;
}

export interface ApplyResult {
  capability: string;
  added: number;
  modified: number;
  removed: number;
  renamed: number;
}

export interface SpecsApplyOutput {
  changeName: string;
  capabilities: ApplyResult[];
  totals: {
    added: number;
    modified: number;
    removed: number;
    renamed: number;
  };
  noChanges: boolean;
}

type Counts = { added: number; modified: number; removed: number; renamed: number };

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Find all delta spec files that need to be applied from a change.
 */
export async function findSpecUpdates(changeDir: string, mainSpecsDir: string): Promise<SpecUpdate[]> {
  const updates: SpecUpdate[] = [];
  const changeSpecsDir = path.join(changeDir, 'specs');

  try {
    const entries = await fs.readdir(changeSpecsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const specFile = path.join(changeSpecsDir, entry.name, 'spec.md');
        const targetFile = path.join(mainSpecsDir, entry.name, 'spec.md');

        try {
          await fs.access(specFile);

          // Check if target exists
          let exists = false;
          try {
            await fs.access(targetFile);
            exists = true;
          } catch {
            exists = false;
          }

          updates.push({
            source: specFile,
            target: targetFile,
            exists,
          });
        } catch {
          // Source spec doesn't exist, skip
        }
      }
    }
  } catch {
    // No specs directory in change
  }

  return updates;
}

/**
 * Reject duplicate requirements within a delta section and conflicts across
 * sections (e.g. the same requirement appearing in both MODIFIED and REMOVED).
 */
function validateDeltaPlan(plan: DeltaPlan, specName: string): void {
  const addedNames = collectUniqueNames(plan.added.map(a => a.name), name =>
    `${specName} validation failed - duplicate requirement in ADDED for header "### Requirement: ${name}"`
  );
  const modifiedNames = collectUniqueNames(plan.modified.map(m => m.name), name =>
    `${specName} validation failed - duplicate requirement in MODIFIED for header "### Requirement: ${name}"`
  );
  const removedNames = collectUniqueNames(plan.removed, name =>
    `${specName} validation failed - duplicate requirement in REMOVED for header "### Requirement: ${name}"`
  );

  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();
  for (const { from, to } of plan.renamed) {
    const fromNorm = normalizeRequirementName(from);
    const toNorm = normalizeRequirementName(to);
    if (renamedFrom.has(fromNorm)) {
      throw new Error(
        `${specName} validation failed - duplicate FROM in RENAMED for header "### Requirement: ${from}"`
      );
    }
    if (renamedTo.has(toNorm)) {
      throw new Error(
        `${specName} validation failed - duplicate TO in RENAMED for header "### Requirement: ${to}"`
      );
    }
    renamedFrom.add(fromNorm);
    renamedTo.add(toNorm);
  }

  // Cross-section conflicts: the same requirement appearing in two sections.
  const conflicts: Array<{ name: string; a: string; b: string }> = [];
  for (const n of modifiedNames) {
    if (removedNames.has(n)) conflicts.push({ name: n, a: 'MODIFIED', b: 'REMOVED' });
    if (addedNames.has(n)) conflicts.push({ name: n, a: 'MODIFIED', b: 'ADDED' });
  }
  for (const n of addedNames) {
    if (removedNames.has(n)) conflicts.push({ name: n, a: 'ADDED', b: 'REMOVED' });
  }

  // Renamed interplay: MODIFIED must reference the NEW header, not FROM.
  for (const { from, to } of plan.renamed) {
    const fromNorm = normalizeRequirementName(from);
    const toNorm = normalizeRequirementName(to);
    if (modifiedNames.has(fromNorm)) {
      throw new Error(
        `${specName} validation failed - when a rename exists, MODIFIED must reference the NEW header "### Requirement: ${to}"`
      );
    }
    if (addedNames.has(toNorm)) {
      throw new Error(
        `${specName} validation failed - RENAMED TO header collides with ADDED for "### Requirement: ${to}"`
      );
    }
  }

  if (conflicts.length > 0) {
    const c = conflicts[0];
    throw new Error(
      `${specName} validation failed - requirement present in multiple sections (${c.a} and ${c.b}) for header "### Requirement: ${c.name}"`
    );
  }
}

/**
 * Normalize and collect names into a Set, throwing on the first duplicate.
 * The error message is produced by `onDuplicate`, called with the original name.
 */
function collectUniqueNames(names: string[], onDuplicate: (name: string) => string): Set<string> {
  const seen = new Set<string>();
  for (const name of names) {
    const norm = normalizeRequirementName(name);
    if (seen.has(norm)) {
      throw new Error(onDuplicate(name));
    }
    seen.add(norm);
  }
  return seen;
}

/**
 * Read the existing target spec, or synthesize a skeleton for a new spec.
 * MODIFIED/RENAMED require an existing spec; REMOVED is warned and ignored.
 */
async function loadOrCreateTargetContent(
  update: SpecUpdate,
  specName: string,
  changeName: string,
  plan: DeltaPlan
): Promise<{ targetContent: string; isNewSpec: boolean }> {
  try {
    return { targetContent: await fs.readFile(update.target, 'utf-8'), isNewSpec: false };
  } catch {
    // Target spec does not exist; only ADDED is meaningful for a new spec.
    if (plan.modified.length > 0 || plan.renamed.length > 0) {
      throw new Error(
        `${specName}: target spec does not exist; only ADDED requirements are allowed for new specs. MODIFIED and RENAMED operations require an existing spec.`
      );
    }
    if (plan.removed.length > 0) {
      console.log(
        chalk.yellow(
          `⚠️  Warning: ${specName} - ${plan.removed.length} REMOVED requirement(s) ignored for new spec (nothing to remove).`
        )
      );
    }
    return { targetContent: buildSpecSkeleton(specName, changeName), isNewSpec: true };
  }
}

/**
 * Apply the delta operations to a name->block map in order:
 * RENAMED → REMOVED → MODIFIED → ADDED, mutating the map in place.
 */
function applyDeltaOperations(
  nameToBlock: Map<string, RequirementBlock>,
  plan: DeltaPlan,
  specName: string,
  isNewSpec: boolean
): void {
  for (const r of plan.renamed) {
    const from = normalizeRequirementName(r.from);
    const to = normalizeRequirementName(r.to);
    if (!nameToBlock.has(from)) {
      throw new Error(`${specName} RENAMED failed for header "### Requirement: ${r.from}" - source not found`);
    }
    if (nameToBlock.has(to)) {
      throw new Error(`${specName} RENAMED failed for header "### Requirement: ${r.to}" - target already exists`);
    }
    const block = nameToBlock.get(from)!;
    const newHeader = `### Requirement: ${to}`;
    const rawLines = block.raw.split('\n');
    rawLines[0] = newHeader;
    nameToBlock.delete(from);
    nameToBlock.set(to, { headerLine: newHeader, name: to, raw: rawLines.join('\n') });
  }

  for (const name of plan.removed) {
    const key = normalizeRequirementName(name);
    if (!nameToBlock.has(key)) {
      // New specs already warned about and ignore missing REMOVED requirements;
      // existing specs treat a missing requirement as an error.
      if (!isNewSpec) {
        throw new Error(`${specName} REMOVED failed for header "### Requirement: ${name}" - not found`);
      }
      continue;
    }
    nameToBlock.delete(key);
  }

  for (const mod of plan.modified) {
    const key = normalizeRequirementName(mod.name);
    if (!nameToBlock.has(key)) {
      throw new Error(`${specName} MODIFIED failed for header "### Requirement: ${mod.name}" - not found`);
    }
    // The provided block's header must match the requirement being modified.
    const modHeaderMatch = mod.raw.split('\n')[0].match(/^###\s*Requirement:\s*(.+)\s*$/i);
    if (!modHeaderMatch || normalizeRequirementName(modHeaderMatch[1]) !== key) {
      throw new Error(
        `${specName} MODIFIED failed for header "### Requirement: ${mod.name}" - header mismatch in content`
      );
    }
    nameToBlock.set(key, mod);
  }

  for (const add of plan.added) {
    const key = normalizeRequirementName(add.name);
    if (nameToBlock.has(key)) {
      throw new Error(`${specName} ADDED failed for header "### Requirement: ${add.name}" - already exists`);
    }
    nameToBlock.set(key, add);
  }
}

/**
 * Recompose the requirements section, preserving the original block order and
 * appending any newly added blocks at the end.
 */
function recomposeSpec(
  parts: ReturnType<typeof extractRequirementsSection>,
  nameToBlock: Map<string, RequirementBlock>
): string {
  const orderedBlocks: RequirementBlock[] = [];
  const seen = new Set<string>();
  for (const block of parts.bodyBlocks) {
    const key = normalizeRequirementName(block.name);
    const replacement = nameToBlock.get(key);
    if (replacement) {
      orderedBlocks.push(replacement);
      seen.add(key);
    }
  }
  for (const [key, block] of nameToBlock.entries()) {
    if (!seen.has(key)) {
      orderedBlocks.push(block);
    }
  }

  const reqBody = [parts.preamble && parts.preamble.trim() ? parts.preamble.trimEnd() : '']
    .filter(Boolean)
    .concat(orderedBlocks.map(b => b.raw))
    .join('\n\n')
    .trimEnd();

  return [parts.before.trimEnd(), parts.headerLine, reqBody, parts.after]
    .filter((s, idx) => !(idx === 0 && s === ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Build an updated spec by applying delta operations.
 * Returns the rebuilt content and counts of operations.
 */
export async function buildUpdatedSpec(
  update: SpecUpdate,
  changeName: string
): Promise<{ rebuilt: string; counts: Counts }> {
  const changeContent = await fs.readFile(update.source, 'utf-8');
  const plan = parseDeltaSpec(changeContent);
  const specName = path.basename(path.dirname(update.target));

  validateDeltaPlan(plan, specName);

  const hasAnyDelta = plan.added.length + plan.modified.length + plan.removed.length + plan.renamed.length > 0;
  if (!hasAnyDelta) {
    throw new Error(
      `Delta parsing found no operations for ${path.basename(path.dirname(update.source))}. ` +
        `Provide ADDED/MODIFIED/REMOVED/RENAMED sections in change spec.`
    );
  }

  const { targetContent, isNewSpec } = await loadOrCreateTargetContent(update, specName, changeName, plan);

  const structureIssues = findMainSpecStructureIssues(targetContent);
  if (structureIssues.length > 0) {
    const details = structureIssues.map(issue => `line ${issue.line}: ${issue.message}`).join('\n');
    throw new Error(
      `${specName}: target spec is structurally invalid and cannot be updated until fixed:\n${details}`
    );
  }

  const parts = extractRequirementsSection(targetContent);
  const nameToBlock = new Map<string, RequirementBlock>();
  for (const block of parts.bodyBlocks) {
    nameToBlock.set(normalizeRequirementName(block.name), block);
  }

  applyDeltaOperations(nameToBlock, plan, specName, isNewSpec);

  return {
    rebuilt: recomposeSpec(parts, nameToBlock),
    counts: {
      added: plan.added.length,
      modified: plan.modified.length,
      removed: plan.removed.length,
      renamed: plan.renamed.length,
    },
  };
}

/**
 * Write an updated spec to disk.
 */
export async function writeUpdatedSpec(
  update: SpecUpdate,
  rebuilt: string,
  counts: Counts
): Promise<void> {
  // Create target directory if needed
  const targetDir = path.dirname(update.target);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(update.target, rebuilt);

  const specName = path.basename(path.dirname(update.target));
  console.log(`Applying changes to spok/specs/${specName}/spec.md:`);
  logCounts(counts);
}

/**
 * Print the non-zero operation counts beneath a "(Would) apply changes" line.
 */
function logCounts(counts: Counts): void {
  if (counts.added) console.log(`  + ${counts.added} added`);
  if (counts.modified) console.log(`  ~ ${counts.modified} modified`);
  if (counts.removed) console.log(`  - ${counts.removed} removed`);
  if (counts.renamed) console.log(`  → ${counts.renamed} renamed`);
}

/**
 * Build a skeleton spec for new capabilities.
 */
export function buildSpecSkeleton(specFolderName: string, changeName: string): string {
  const titleBase = specFolderName;
  return `# ${titleBase} Specification\n\n## Purpose\nTBD - created by archiving change ${changeName}. Update Purpose after archive.\n\n## Requirements\n`;
}

/**
 * Apply all delta specs from a change to main specs.
 *
 * @param projectRoot - The project root directory
 * @param changeName - The name of the change to apply
 * @param options - Options for the operation
 * @returns Result of the operation with counts
 */
export async function applySpecs(
  projectRoot: string,
  changeName: string,
  options: {
    dryRun?: boolean;
    skipValidation?: boolean;
    silent?: boolean;
  } = {}
): Promise<SpecsApplyOutput> {
  const changeDir = path.join(projectRoot, 'spok', 'changes', changeName);
  const mainSpecsDir = path.join(projectRoot, 'spok', 'specs');

  // Verify change exists
  try {
    const stat = await fs.stat(changeDir);
    if (!stat.isDirectory()) {
      throw new Error(`Change '${changeName}' not found.`);
    }
  } catch {
    throw new Error(`Change '${changeName}' not found.`);
  }

  // Find specs to update
  const specUpdates = await findSpecUpdates(changeDir, mainSpecsDir);

  if (specUpdates.length === 0) {
    return {
      changeName,
      capabilities: [],
      totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
      noChanges: true,
    };
  }

  // Prepare all updates first (validation pass, no writes)
  const prepared: Array<{ update: SpecUpdate; rebuilt: string; counts: Counts }> = [];

  for (const update of specUpdates) {
    const built = await buildUpdatedSpec(update, changeName);
    prepared.push({ update, rebuilt: built.rebuilt, counts: built.counts });
  }

  // Validate rebuilt specs unless validation is skipped
  if (!options.skipValidation) {
    const validator = new Validator();
    for (const p of prepared) {
      const specName = path.basename(path.dirname(p.update.target));
      const report = await validator.validateSpecContent(specName, p.rebuilt);
      if (!report.valid) {
        const errors = report.issues
          .filter((i) => i.level === 'ERROR')
          .map((i) => `  ✗ ${i.message}`)
          .join('\n');
        throw new Error(`Validation errors in rebuilt spec for ${specName}:\n${errors}`);
      }
    }
  }

  // Build results
  const capabilities: ApplyResult[] = [];
  const totals = { added: 0, modified: 0, removed: 0, renamed: 0 };

  for (const p of prepared) {
    const capability = path.basename(path.dirname(p.update.target));

    if (!options.dryRun) {
      // Write the updated spec
      const targetDir = path.dirname(p.update.target);
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(p.update.target, p.rebuilt);
    }

    if (!options.silent) {
      const verb = options.dryRun ? 'Would apply' : 'Applying';
      console.log(`${verb} changes to spok/specs/${capability}/spec.md:`);
      logCounts(p.counts);
    }

    capabilities.push({
      capability,
      ...p.counts,
    });

    totals.added += p.counts.added;
    totals.modified += p.counts.modified;
    totals.removed += p.counts.removed;
    totals.renamed += p.counts.renamed;
  }

  return {
    changeName,
    capabilities,
    totals,
    noChanges: false,
  };
}
