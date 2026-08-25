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
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
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

export type EnsureSkillStatus = 'present' | 'materialized' | 'unavailable';

export interface EnsureSkillResult {
  status: EnsureSkillStatus;
  /** SKILL.md path that satisfied the check; absent when unavailable. */
  skillPath?: string;
  reason?: string;
}

export interface EnsureSkillOptions {
  sourceDir?: string;
  homeDir?: string;
}

function skillMarkerPath(root: string, toolSkillsDir: string, skillName: string): string {
  return path.join(root, toolSkillsDir, 'skills', skillName, 'SKILL.md');
}

function presentSkillResult(
  projectMarker: string,
  globalMarker: string
): EnsureSkillResult | undefined {
  const marker = fs.existsSync(projectMarker)
    ? projectMarker
    : fs.existsSync(globalMarker)
      ? globalMarker
      : undefined;
  return marker ? { status: 'present', skillPath: marker } : undefined;
}

async function publishCopiedSkill(
  tempSkill: string,
  destSkill: string,
  projectMarker: string
): Promise<EnsureSkillStatus> {
  try {
    await fs.promises.rename(tempSkill, destSkill);
    return 'materialized';
  } catch {
    if (fs.existsSync(projectMarker)) return 'present';
  }

  const staleSkill = `${tempSkill}.stale`;
  let displacedStaleSkill = false;
  try {
    await fs.promises.rename(destSkill, staleSkill);
    displacedStaleSkill = true;
  } catch {
    // Another materializer may have removed the incomplete destination.
  }

  try {
    await fs.promises.rename(tempSkill, destSkill);
    return 'materialized';
  } catch (error) {
    if (fs.existsSync(projectMarker)) return 'present';
    if (displacedStaleSkill) {
      await fs.promises.rename(staleSkill, destSkill).catch(() => {});
    }
    throw error;
  } finally {
    if (fs.existsSync(projectMarker)) {
      await fs.promises.rm(staleSkill, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Ensure one vendored skill is discoverable for a tool, materializing it from
 * the Spok distribution into the project when missing.
 *
 * Checked in order: project-local copy, then the distribution (copied into the
 * project so the run is pinned to it), then a global `~/<toolSkillsDir>` install.
 * The copy lands via temp-dir-then-rename so a concurrent run in the same
 * project never observes a half-written skill.
 */
export async function ensureVendoredSkill(
  projectRoot: string,
  toolSkillsDir: string,
  skillName: string,
  options: EnsureSkillOptions = {}
): Promise<EnsureSkillResult> {
  const sourceDir = options.sourceDir ?? ASSETS_SKILLS_DIR;
  const projectMarker = skillMarkerPath(projectRoot, toolSkillsDir, skillName);
  if (fs.existsSync(projectMarker)) {
    return { status: 'present', skillPath: projectMarker };
  }

  const homeDir = options.homeDir ?? os.homedir();
  const globalMarker = skillMarkerPath(homeDir, toolSkillsDir, skillName);
  const srcSkill = path.join(sourceDir, skillName);
  if (fs.existsSync(path.join(srcSkill, 'SKILL.md'))) {
    const destSkill = path.dirname(projectMarker);
    const suffix = `${process.pid}-${randomUUID()}`;
    const tempSkill = `${destSkill}.tmp-${suffix}`;
    try {
      await copyDir(srcSkill, tempSkill);
      const status = await publishCopiedSkill(tempSkill, destSkill, projectMarker);
      return { status, skillPath: projectMarker };
    } catch (error) {
      return (
        presentSkillResult(projectMarker, globalMarker) ?? {
          status: 'unavailable',
          reason: `could not materialize ${skillName}: ${(error as Error).message}`,
        }
      );
    } finally {
      await fs.promises.rm(tempSkill, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (fs.existsSync(globalMarker)) {
    return { status: 'present', skillPath: globalMarker };
  }

  return {
    status: 'unavailable',
    reason: `skill ${skillName} is not installed for ${toolSkillsDir} and the Spok distribution has no vendored copy (${srcSkill})`,
  };
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
