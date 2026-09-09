import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILLS_DIR = path.resolve(__dirname, '../../assets/skills');

async function readAsset(skill: string, file = 'SKILL.md'): Promise<string> {
  return readFile(path.join(SKILLS_DIR, skill, file), 'utf-8');
}

describe('planning artifact alignment', () => {
  it('preserves exact context pointers outside the research question budget', async () => {
    const body = await readAsset('spok-create-research-questions');
    const template = await readAsset(
      'spok-create-research-questions', 'references/research_questions_template.md',
    );

    expect(body).toContain('Key Context Pointers');
    expect(body).toContain('URLs, repository identifiers, dependencies, and paths verbatim');
    expect(body).toContain('do not count toward the question limit');
    expect(template).toContain('## Key Context Pointers');
  });

  it('researches existing controls and frontend conventions conditionally', async () => {
    const body = await readAsset('spok-create-research-questions');

    expect(body).toContain('existing controls');
    expect(body).toContain('smallest viable scope');
    expect(body).toContain('For frontend or UI work');
    expect(body).toContain('design system, reusable components, tokens, and theming');
  });

  it('carries resolved decisions and control costs into the design template', async () => {
    const body = await readAsset('spok-create-design-discussion');
    const template = await readAsset(
      'spok-create-design-discussion', 'references/design_discussion_template.md',
    );

    for (const heading of [
      '## Smallest Viable Control', '## System Design', '## Program Design', '## Visual Evidence',
    ]) {
      expect(template).toContain(heading);
      expect(body).toContain(heading);
    }
    expect(body).toContain('added state, flags, or cross-service controls');
    expect(template).toMatch(/^# Design Discussion$/m);
    expect(template).toMatch(/^## Context$/m);
    expect(template).toMatch(/^### Scale$/m);
    expect(template).toMatch(/^## Resolved Design Decisions$/m);
    expect(template).not.toContain('### Design Questions');
  });

  it('records an autonomous visual decision after verification without an approval gate', async () => {
    const body = await readAsset('spok-create-design-discussion');

    expect(body).toContain('set `status` to `verified`');
    expect(body).toContain('"selectedBy": "agent"');
    expect(body).toContain('Render and verify the comparison');
    expect(body).toContain('may ask questions when they would improve the result');
    expect(body).not.toContain('obtain explicit approval');
    expect(body).not.toContain('"approvedBy"');
  });
});
