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
  'spok-self-learn': 'self-learn.md',
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

describe('spok-flow prompt dispatch contract', () => {
  async function readFlowSkill(): Promise<string> {
    return fs.readFile(path.join(SKILLS_DIR, 'spok-flow', 'SKILL.md'), 'utf-8');
  }

  it('dispatches the CLI-composed prompt verbatim', async () => {
    const body = await readFlowSkill();

    expect(body).toContain('`<step.prompt>` **verbatim**');
    expect(body).toContain('spok/MEMORY.md');
    expect(body).toContain('memoryWarning');
  });

  it('leaves step-specific clauses to the CLI', async () => {
    const body = await readFlowSkill();

    expect(body).not.toContain('must not create commits');
    expect(body).not.toContain('Invoke `spok-self-learn`');
  });
});

describe('spok-self-learn promotion contract', () => {
  it('emits capped, slugged candidate rules and human-approved promotions', async () => {
    const body = await fs.readFile(
      path.join(SKILLS_DIR, 'spok-self-learn', 'SKILL.md'),
      'utf-8',
    );

    expect(body).toContain('## Candidate Rules');
    expect(body).toContain('## Promotion Candidates');
    expect(body).toContain('at most 3 entries');
    expect(body).toContain('spok/changes/*/.flow/*/self-learn.md');
    expect(body).toContain('twice or more');
    expect(body).toContain('Do not edit `spok/MEMORY.md`');
  });
});

describe('spok-create-design-discussion visual evidence contract', () => {
  it('routes required evidence to an approved repository packet', async () => {
    const file = path.join(
      SKILLS_DIR,
      'spok-create-design-discussion',
      'SKILL.md',
    );
    const body = await fs.readFile(file, 'utf-8');

    expect(body).toContain('spok/evidence/<change>/<chunk>/');
    expect(body).toContain('references/design_evidence_template.html');
    expect(body).toContain('"schemaVersion": 1');
    expect(body).toContain('"status": "pending"');
    expect(body).toContain('"approvedBy": "<identity>"');
    expect(body).toContain('Missing either the current or target pane blocks completion');
  });

  it('defaults legacy tickets to not-applicable without a packet', async () => {
    const file = path.join(
      SKILLS_DIR,
      'spok-create-design-discussion',
      'SKILL.md',
    );
    const body = await fs.readFile(file, 'utf-8');

    expect(body).toContain(
      'Treat a ticket without `## Visual Evidence` as a legacy ticket with classification `not-applicable`.',
    );
    expect(body).toContain('Do not create an evidence packet.');
  });
});
