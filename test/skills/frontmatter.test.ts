import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { extractFrontmatter } from '../helpers/frontmatter';

const SKILLS_DIR = path.resolve(__dirname, '../../.claude/skills');

describe('spok skill frontmatter', () => {
  it('every spok-*/SKILL.md declares metadata.version "0.1.0"', async () => {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skillDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith('spok-'))
      .map((e) => e.name)
      .sort();

    // Guard against an empty-glob false pass.
    expect(skillDirs.length).toBeGreaterThan(0);

    for (const dir of skillDirs) {
      const file = path.join(SKILLS_DIR, dir, 'SKILL.md');
      const raw = await fs.readFile(file, 'utf-8');
      const fm = parseYaml(extractFrontmatter(raw)) as {
        metadata?: { version?: unknown };
      } | null;
      expect(fm?.metadata?.version, `${dir}/SKILL.md`).toBe('0.1.0');
    }
  });
});
