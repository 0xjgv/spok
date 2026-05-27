#!/usr/bin/env node
/**
 * One-shot vendor script that copies the flow+chunks skill closure into
 * assets/skills/spok-*. Cross-references between skills are rewritten so the
 * vendored copies invoke each other under the `spok-` namespace.
 *
 * Usage:
 *   node scripts/vendor-skills.mjs [--source <dir>] [--dest <dir>]
 *
 * Defaults:
 *   --source ~/.claude/skills
 *   --dest   assets/skills
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SKILLS = [
  'flow',
  'create-scoped-chunks',
  'create-research-questions',
  'create-research',
  'create-design-discussion',
  'create-structure-outline',
  'create-plan',
  'implement-plan',
  'validate-implementation',
  'ci-commit',
  'code-review',
];

/**
 * Spok-specific forks — not copied from ~/.claude/skills; maintained in assets/skills/.
 * Includes the 7 downstream flow skills because they now route artifacts to
 * `<task-dir>` rather than `.humanlayer/tasks/`, a fork-only divergence.
 */
const HAND_MAINTAINED_SKILLS = new Set([
  'flow',
  'create-scoped-chunks',
  'create-research-questions',
  'create-research',
  'create-design-discussion',
  'create-structure-outline',
  'create-plan',
  'implement-plan',
  'validate-implementation',
]);

function parseArgs(argv) {
  const opts = {
    source: path.join(os.homedir(), '.claude', 'skills'),
    dest: path.join(REPO_ROOT, 'assets', 'skills'),
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') opts.source = argv[++i];
    else if (arg === '--dest') opts.dest = argv[++i];
  }
  return opts;
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} content @param {string} skillName */
function rewriteSkillName(content, skillName) {
  if (skillName === 'flow') {
    // "flow" is a common English word — do not rewrite phrases like "data flow".
    return content.replace(/(?<![\w-])flow(?![\w-])/g, (match, offset, str) => {
      const prefix = str.slice(Math.max(0, offset - 5), offset);
      if (prefix === 'data ') return 'flow';
      return 'spok-flow';
    });
  }

  const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(skillName)}(?![\\w-])`, 'g');
  return content.replace(pattern, `spok-${skillName}`);
}

/** @param {string} content */
export function rewriteSkillReferences(content) {
  let out = content;
  for (const skillName of SKILLS) {
    out = rewriteSkillName(out, skillName);
  }
  // Fix double-prefix if a reference was already spok-*.
  out = out.replace(/spok-spok-/g, 'spok-');
  return out;
}

/** @param {string} content @param {string} vendoredName */
export function normalizeFrontmatterName(content, vendoredName) {
  if (!content.startsWith('---')) return content;

  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;

  const frontmatter = content.slice(0, end + 4);
  const body = content.slice(end + 4);
  const updated = frontmatter.replace(/^name:\s*.+$/m, `name: ${vendoredName}`);
  return updated + body;
}

/** @param {string} filePath @param {string | undefined} vendoredName */
async function rewriteSkillFile(filePath, vendoredName) {
  const content = await fs.readFile(filePath, 'utf-8');
  let next = rewriteSkillReferences(content);
  if (filePath.endsWith('SKILL.md') && vendoredName) {
    next = normalizeFrontmatterName(next, vendoredName);
  }
  if (content !== next) {
    await fs.writeFile(filePath, next);
  }
}

/** @param {string} skillDir @param {string | undefined} vendoredName */
async function rewriteAllSkillMd(skillDir, vendoredName) {
  const stack = [skillDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === 'SKILL.md' || entry.name.endsWith('.md')) {
        await rewriteSkillFile(full, vendoredName);
      }
    }
  }
}

async function writeCodeReviewStub(destDir) {
  const dir = path.join(destDir, 'spok-code-review');
  await fs.mkdir(dir, { recursive: true });
  const content = `---
name: spok-code-review
description: Run a code review at the requested rigor. Vendored stub — relies on the user-installed code-review tooling. Argument: rigor level (e.g., "high").
license: MIT
metadata:
  author: spok
  version: "1.0"
---

# spok-code-review

This is a vendored placeholder. The original \`code-review\` skill ships with
the user's Claude Code installation (e.g. the \`code-review\` plugin from the
official marketplace). When invoked by \`spok-flow\`, run a code review on the
current branch's changes at the rigor level passed as the argument.

Output: a review summary listing any blocking issues, suggested fixes, and a
verdict (approve / request-changes).
`;
  await fs.writeFile(path.join(dir, 'SKILL.md'), content);
}

async function main() {
  const { source, dest } = parseArgs(process.argv);

  console.log(`vendor-skills: source=${source}`);
  console.log(`vendor-skills: dest=${dest}`);

  await fs.mkdir(dest, { recursive: true });

  let vendored = 0;
  let stubbed = 0;
  for (const skill of SKILLS) {
    const srcDir = path.join(source, skill);
    const destDir = path.join(dest, `spok-${skill}`);

    if (HAND_MAINTAINED_SKILLS.has(skill)) {
      console.log(`vendor-skills: skip  spok-${skill} (hand-maintained in assets/skills/)`);
      continue;
    }

    if (!(await pathExists(srcDir))) {
      if (skill === 'code-review') {
        await writeCodeReviewStub(dest);
        console.log(`vendor-skills: stub  spok-${skill}`);
        stubbed++;
        continue;
      }
      console.warn(`vendor-skills: SKIP ${skill} — source not found at ${srcDir}`);
      continue;
    }

    await fs.rm(destDir, { recursive: true, force: true });
    await copyDir(srcDir, destDir);
    await rewriteAllSkillMd(destDir, `spok-${skill}`);
    console.log(`vendor-skills: ok    spok-${skill}`);
    vendored++;
  }

  console.log(`vendor-skills: done — vendored=${vendored} stubbed=${stubbed}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
