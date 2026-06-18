import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SKILLS_DIR = path.resolve(__dirname, '../../assets/skills');

const FORK_ARTIFACTS: Record<string, string> = {
  'spok-validate-problem': 'problem-validation.md',
  'spok-create-research-questions': 'research-questions.md',
  'spok-create-research': 'research.md',
  'spok-create-design-discussion': 'design-discussion.md',
  'spok-create-structure-outline': 'structure-outline.md',
  'spok-create-plan': 'plan.md',
  'spok-validate-implementation': 'validation.md',
};

const DATE_PREFIX_PATTERN = /\b\d{4}-\d{2}-\d{2}-/;

describe('spok fork-skill artifact routing', () => {
  it('enumerates the expected fork skills on disk', async () => {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const present = new Set(
      entries.filter((e) => e.isDirectory()).map((e) => e.name),
    );
    for (const skill of Object.keys(FORK_ARTIFACTS)) {
      expect(present.has(skill), `missing ${skill}/`).toBe(true);
    }
  });

  for (const [skill, artifact] of Object.entries(FORK_ARTIFACTS)) {
    describe(skill, () => {
      it(`routes its artifact to <task-dir>/${artifact}`, async () => {
        const file = path.join(SKILLS_DIR, skill, 'SKILL.md');
        const body = await fs.readFile(file, 'utf-8');
        expect(body, `${skill} should reference <task-dir>/${artifact}`).toContain(
          `<task-dir>/${artifact}`,
        );
      });

      it('does not reference the upstream .humanlayer/tasks/ path', async () => {
        const file = path.join(SKILLS_DIR, skill, 'SKILL.md');
        const body = await fs.readFile(file, 'utf-8');
        expect(body).not.toContain('.humanlayer/tasks/');
      });

      it('does not embed a YYYY-MM-DD- date-prefix in instructional text', async () => {
        const file = path.join(SKILLS_DIR, skill, 'SKILL.md');
        const body = await fs.readFile(file, 'utf-8');
        // Strip the legacy-orphan GC instruction (Fix B) before scanning —
        // it intentionally documents the date-prefix pattern so the agent
        // can recognize and delete orphans.
        const scrubbed = body.replace(
          /Before writing,[^\n]*\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}-[^\n]*\n/g,
          '',
        );
        expect(scrubbed).not.toMatch(DATE_PREFIX_PATTERN);
      });
    });
  }
});
