/**
 * Skill Vendoring
 *
 * Copies the vendored `spok-*` skill directories from `assets/skills/` into a
 * project's tool-specific skills directory (e.g. `<project>/.claude/skills/`).
 * The vendored set includes `spok-flow`, `spok-create-scoped-chunks`, and the
 * transitive helpers they invoke.
 *
 * Idempotent: removes the destination directory before writing so a re-run
 * overwrites stale content cleanly.
 */
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_SKILLS_DIR = path.resolve(__dirname, '../../assets/skills');

export interface VendorInstallResult {
  installedSkills: string[];
  skipped: boolean;
  reason?: string;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

export function getVendoredSkillNames(sourceDir: string = ASSETS_SKILLS_DIR): string[] {
  try {
    return fs
      .readdirSync(sourceDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('spok-'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Install the vendored skill closure into `<projectRoot>/<toolSkillsDir>/skills/`.
 *
 * @param projectRoot   Absolute path to the project root.
 * @param toolSkillsDir Tool-relative path (e.g. `.claude`) where `skills/` lives.
 * @param sourceDir     Override for the vendored source dir (testing).
 */
export async function installVendoredSkills(
  projectRoot: string,
  toolSkillsDir: string,
  sourceDir: string = ASSETS_SKILLS_DIR
): Promise<VendorInstallResult> {
  if (!fs.existsSync(sourceDir)) {
    return {
      installedSkills: [],
      skipped: true,
      reason: `vendored skills source not found: ${sourceDir}`,
    };
  }

  const skillNames = getVendoredSkillNames(sourceDir);
  if (skillNames.length === 0) {
    return {
      installedSkills: [],
      skipped: true,
      reason: 'no vendored skills found',
    };
  }

  const targetSkillsRoot = path.join(projectRoot, toolSkillsDir, 'skills');
  await fs.promises.mkdir(targetSkillsRoot, { recursive: true });

  const installed: string[] = [];
  for (const skillName of skillNames) {
    const srcSkill = path.join(sourceDir, skillName);
    const destSkill = path.join(targetSkillsRoot, skillName);

    await fs.promises.rm(destSkill, { recursive: true, force: true });
    await copyDir(srcSkill, destSkill);
    installed.push(skillName);
  }

  return { installedSkills: installed, skipped: false };
}
