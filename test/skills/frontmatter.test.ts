import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { extractFrontmatter } from '../helpers/frontmatter';

const SKILLS_DIR = path.resolve(__dirname, '../../.claude/skills');
const USER_FACING_SKILLS = ['spok-propose', 'spok-apply', 'spok-archive'] as const;

describe('spok skill frontmatter', () => {
  it('user-facing workflow skills declare metadata.version "2.0"', async () => {
    for (const dir of USER_FACING_SKILLS) {
      const file = path.join(SKILLS_DIR, dir, 'SKILL.md');
      const raw = await fs.readFile(file, 'utf-8');
      const fm = parseYaml(extractFrontmatter(raw)) as {
        metadata?: { version?: unknown };
      } | null;
      expect(fm?.metadata?.version, `${dir}/SKILL.md`).toBe('2.0');
    }
  });
});
