import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { extractFrontmatter } from '../helpers/frontmatter';
import {
  generateSkillContent,
  getSkillTemplates,
} from '../../src/core/shared/skill-generation.js';

const USER_FACING_SKILLS = ['spok-explore', 'spok-propose', 'spok-apply', 'spok-archive'] as const;

describe('spok skill frontmatter', () => {
  it('user-facing workflow skills declare metadata.version "2.0"', () => {
    const templates = getSkillTemplates();

    for (const dir of USER_FACING_SKILLS) {
      const entry = templates.find((template) => template.dirName === dir);
      expect(entry, dir).toBeDefined();
      if (!entry) throw new Error(`missing template for ${dir}`);

      const raw = generateSkillContent(entry.template, '1.3.1');
      const fm = parseYaml(extractFrontmatter(raw)) as {
        metadata?: { version?: unknown };
      } | null;
      expect(fm?.metadata?.version, `${dir}/SKILL.md`).toBe('2.0');
    }
  });
});
