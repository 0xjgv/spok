import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SKILLS_DIR = path.resolve(__dirname, '../../assets/skills');

async function readFlowSkill(): Promise<string> {
  return fs.readFile(path.join(SKILLS_DIR, 'spok-flow', 'SKILL.md'), 'utf-8');
}

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

  it('dispatches hybrid steps through their declared runner', async () => {
    const body = await readFlowSkill();

    expect(body).toContain('SPOK_FLOW_PROFILE=hybrid');
    expect(body).toContain('`step.runner`');
    expect(body).toContain('codex exec');
    expect(body).toContain('--dangerously-bypass-hook-trust');
    expect(body).toMatch(/run enabled hooks without an\s+interactive trust prompt/);
    expect(body).toContain('claude -p');
    expect(body).toContain('Do not call `spok flow complete`');
    expect(body).toContain('Do not use `--dangerously-bypass-approvals-and-sandbox`');
  });

  it('uses host-neutral native delegation for the host-owned fallback agent', async () => {
    const body = await readFlowSkill();

    expect(body).toContain("the current host's native subagent mechanism");
    expect(body).toContain('host-owned `general-purpose`');
    expect(body).not.toContain('subagent_type');
    expect(body).not.toContain('**Agent** tool');
  });
});

describe('spok-flow current and OMP dispatch contract', () => {
  it('enumerates the four-runner vocabulary and halts on anything else', async () => {
    const body = await readFlowSkill();
    expect(body).toContain('`claude`, `codex`, `omp`, or `current`');
    expect(body).toContain('report the malformed route');
    expect(body).toContain('halt before dispatch');
  });

  it('removes active-host inference entirely', async () => {
    const body = await readFlowSkill();
    expect(body).not.toContain('CODEX_HOME');
    expect(body).not.toContain('active harness');
  });

  it('dispatches current natively with no model or effort', async () => {
    const body = await readFlowSkill();
    expect(body).toContain('When `step.runner` is `current`');
    expect(body).toContain('Pass no model and no effort');
    expect(body).toContain('ignore hand-authored `model` or `effort` values');
  });

  it('requires model for explicit runners and effort for OMP', async () => {
    const body = await readFlowSkill();
    expect(body).toMatch(/require a\s+non-empty `step\.model`/);
    expect(body).toMatch(/`omp` additionally requires a non-empty\s+`step\.effort`/);
  });

  it('re-proves linked-worktree isolation before the OMP prompt', async () => {
    const body = await readFlowSkill();
    expect(body).toContain('rev-parse --path-format=absolute --git-dir --git-common-dir');
    expect(body).toContain('halt before sending the prompt');
  });

  it('ignores inherited Git repository variables during the OMP isolation proof', async () => {
    const body = await readFlowSkill();
    expect(body).toMatch(
      /When `step\.runner` is `omp`[\s\S]*?`GIT_DIR`, `GIT_COMMON_DIR`, and\s+`GIT_WORK_TREE`\s+removed from the child environment/
    );
  });

  it('dispatches OMP with the exact command and the prompt on stdin', async () => {
    const body = await readFlowSkill();
    expect(body).toContain(
      'omp -p --no-session --cwd <project-root> --model <step.model> --thinking <step.effort> --auto-approve',
    );
    expect(body).toMatch(/When `step\.runner` is `omp`[\s\S]*?\*\*verbatim\*\* on stdin/);
  });

  it('never reroutes after a failed dispatch', async () => {
    const body = await readFlowSkill();
    expect(body).toContain('A failed dispatch never changes the harness, model, or effort');
    expect(body).toContain('the persisted ready route remains unchanged');
  });
});

describe('spok-implement-plan model inheritance contract', () => {
  it('implements inline inside a model-pinned flow step', async () => {
    const body = await fs.readFile(
      path.join(SKILLS_DIR, 'spok-implement-plan', 'SKILL.md'),
      'utf-8',
    );

    expect(body).toContain('Do not launch `spok-implementer-agent` or any other nested agent.');
    expect(body).toContain('The outer flow step already selected the runner, model, and effort.');
  });
});

describe('Spok-prefixed agent routing', () => {
  const namedAgents = [
    'codebase-locator',
    'codebase-analyzer',
    'codebase-pattern-finder',
    'web-search-researcher',
    'implementer-agent',
  ] as const;

  it('does not retain unprefixed catalog agent references or host-specific launch syntax', async () => {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skillFiles = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(SKILLS_DIR, entry.name, 'SKILL.md'));

    for (const file of skillFiles) {
      const body = await fs.readFile(file, 'utf-8');
      for (const agent of namedAgents) {
        const unprefixed = new RegExp(`(?<!spok-)\\b${agent}\\b`, 'u');
        expect(body, `${file} contains unprefixed ${agent}`).not.toMatch(unprefixed);
      }
      expect(body, `${file} contains Claude-only subagent syntax`).not.toMatch(
        /subagent_type|Task tool|\*\*Agent\*\* tool/u,
      );
    }
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
