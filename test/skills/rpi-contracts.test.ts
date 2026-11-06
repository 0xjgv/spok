import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSkill = (name: string) =>
  readFile(resolve(__dirname, '../../assets/skills', name, 'SKILL.md'), 'utf-8');

describe('research stages trace every write path', () => {
  it('asks about write/derive paths, hypotheses, and control surfaces', async () => {
    const body = await readSkill('spok-create-research-questions');
    expect(body).toContain('every code path that writes or derives that state, and the trace each path leaves in stored data');
    expect(body).toContain('marks as `hypothesis`');
    expect(body).toContain('Never treat a hypothesis as established');
    expect(body).toContain('fewer than 8 except for the largest tasks');
    expect(body).not.toContain('no more than 8');
  });

  it('documents every write path without picking a cause', async () => {
    const body = await readSkill('spok-create-research');
    expect(body).toContain('document every such path and the trace each leaves in stored data');
  });
});

describe('spok-cause-check', () => {
  it('writes evidence/causal-paths.md with a first-wrong-step trace', async () => {
    const body = await readSkill('spok-cause-check');
    expect(body).toContain('<task-dir>/evidence/causal-paths.md');
    expect(body).toContain('`N/A: no defect`');
    expect(body).toContain('cheapest observation that rules it out');
    expect(body).toContain('A query on production data goes to the user to run');
    expect(body).toContain('`checked on real data`, `replayed`, or `read in code`');
    expect(body).toContain('first link whose input is correct and whose output is wrong');
    expect(body).toContain('**Get the evidence first (Recommended)** or **Design without it**');
    expect(body).toContain('Return the absolute path of `<task-dir>/evidence/causal-paths.md`');
  });

  it('raises questions through the flow packet, never directly', async () => {
    const body = await readSkill('spok-cause-check');
    expect(body).toContain("raise it through the flow's question packet");
    expect(body).toContain('Otherwise use AskUserQuestion.');
  });
});

describe('spok-create-structure-outline', () => {
  it('builds only on resolved decisions and returns open design questions', async () => {
    const body = await readSkill('spok-create-structure-outline');
    expect(body).toContain('Build only on resolved decisions.');
    expect(body).toContain('stop and return that question instead of an');
    expect(body).toContain('`- [ ] Phase N: [Title]`');
    expect(body).not.toContain('without adding a human approval gate');
  });
});

describe('spok-simplify', () => {
  it('reports scope, fixes, skipped candidates, and changed paths', async () => {
    const body = await readSkill('spok-simplify');
    for (const field of ['Resolved scope:', 'Fixes applied:', 'Candidates skipped:', 'Changed paths:', 'Behavior preserved:']) {
      expect(body).toContain(field);
    }
    expect(body).not.toMatch(/validation\.md|design review|`validate`/);
  });
});

describe('spok-review-correctness', () => {
  it('writes review.md with exact correctness-review frontmatter', async () => {
    const body = await readSkill('spok-review-correctness');
    expect(body).toContain('---\ntype: correctness-review\nverdict: PASS\n---');
    expect(body).toContain('`verdict: FAIL` otherwise');
    expect(body).toContain('## Verification\n- `<exact command>` (cwd: <directory>) — exit <code>');
    expect(body).toContain('Return the absolute path of `<task-dir>/review.md`');
  });

  it('confirms findings, repairs through spok-repair, and caps at two rounds', async () => {
    const body = await readSkill('spok-review-correctness');
    expect(body).toContain('Launch a fresh reviewer.');
    expect(body).toContain('You are read-only: do not edit, stage, commit, or push');
    expect(body).toContain('staged, unstaged, and untracked files in the allowlist');
    expect(body).toContain('Check that the fix sits at the first wrong step the evidence note names');
    expect(body).toContain('each with `file:line`, trigger, impact, and fix direction');
    expect(body).toContain('Confirm each finding from the code yourself.');
    expect(body).toContain('calls the\n   `spok-repair` skill');
    expect(body).toContain('Cap repairs at two rounds.');
    expect(body).toContain('Never stage, commit, or push.');
  });
});

describe('spok-ci-commit', () => {
  it('reruns the review verification commands before committing', async () => {
    const body = await readSkill('spok-ci-commit');
    expect(body).toContain('Rerun the verification commands before committing');
    expect(body).toContain('Commit only when every command exits 0.');
    expect(body).toContain('report each command with its exact exit code');
    expect(body).toContain('Never commit task-dir artifacts');
    expect(body).toContain('Do not push');
  });
});
