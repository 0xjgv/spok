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

  it('delegates research before drafting questions and names the design-system probes', async () => {
    const body = await readAsset('spok-create-research-questions');
    const template = await readAsset(
      'spok-create-research-questions', 'references/research_questions_template.md',
    );

    const delegation = body.indexOf("Use the current host's native subagent mechanism to delegate");
    const drafting = body.indexOf('**Create questions about:**');
    expect(delegation).toBeGreaterThan(-1);
    expect(delegation).toBeLessThan(drafting);
    expect(body).toContain('design tokens with their hex values');
    expect(body).toContain('even if UI is not explicitly mentioned');
    expect(template).toContain('Trace the flow of logic');
    expect(template).not.toContain('spok-flow of logic');
  });

  it('models numbered takeaway headers and reference coverage in the research template', async () => {
    const template = await readAsset(
      'spok-create-research', 'references/research_template.md',
    );

    expect(template).toMatch(/^### 1\. \[Takeaway about this concept/m);
    expect(template).toMatch(/^### 2\. \[Takeaway about the next concept\]$/m);
    expect(template).toContain('never use `diff` blocks or `+`/`-` change markers');
    expect(template).toContain('exhaustive for that area');
  });

  it('fans research out by codebase area and shows takeaway headers by example', async () => {
    const body = await readAsset('spok-create-research');

    expect(body).toContain('aim for 2-6 well-scoped subagents rather than one per question');
    expect(body).toContain('`spok-codebase-locator` first to find what exists');
    expect(body).toContain('BAD (question as header)');
    expect(body).toContain('GOOD (takeaway)');
    expect(body).toContain('Call-stack tree');
    expect(body).toContain('Diagrams stay under the gate in the section above.');
    expect(body).toContain(
      'Use a diagram only when relationships among three or more components are materially clearer',
    );
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
