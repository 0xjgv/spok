import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSkill = (name: string) =>
  readFile(resolve(__dirname, '../../assets/skills', name, 'SKILL.md'), 'utf-8');

describe('execution skill boundaries', () => {
  it('runs subprocesses in the execution root with access to task artifacts', async () => {
    const flow = await readSkill('spok-flow');
    expect(flow.match(/process `cwd: <project-root>`/g)).toHaveLength(3);
    expect(flow.match(/`--add-dir <task-dir>`/g)).toHaveLength(2);
    expect(flow).toContain('`--sandbox workspace-write`, `--add-dir <task-dir>`');
    expect(flow.match(/-u GIT_WORK_TREE -u GIT_INDEX_FILE git/g)).toHaveLength(2);
    expect(flow).toContain('Keep native dispatch and its prompt verbatim');
  });

  it('uses controller metadata and transports the cumulative implementation footprint', async () => {
    const flow = await readSkill('spok-flow');
    const implement = await readSkill('spok-implement-plan');
    expect(flow).toContain('response.execution.workRoot');
    expect(flow).toContain('--changed-path <paths...>');
    expect(flow).toContain('argv-capable process call');
    expect(flow).toContain('outcomes are mutually');
    expect(flow).not.toContain('unsteered commit discovery');
    expect(implement).toContain('full cumulative chunk list');
    expect(implement).toContain('Do not stage, commit, or push.');
    expect(implement).not.toContain('Wait for Human Confirmation');
  });

  it('limits simplification to the explicit allowlist without staging', async () => {
    const body = await readSkill('spok-simplify');
    expect(body).toContain('CLI explicitly allowlists');
    expect(body).toContain('An absent allowlist is a blocker');
    expect(body).toContain('Do not stage, commit, or push.');
  });

  it('preserves unrelated staged work while committing only owned paths', async () => {
    const body = await readSkill('spok-ci-commit');
    expect(body).toContain('allowlist is authoritative');
    expect(body).toContain('temporary index initialized from HEAD');
    expect(body).toContain('Do not replace or reset the real index wholesale');
    expect(body).toContain('not a mismatch or automatic failure');
    expect(body).not.toContain('Execute upon confirmation');
  });

  it('bounds repair to the owned-path allowlist and the findings it must fix', async () => {
    const body = await readSkill('spok-repair');
    expect(body).toContain('the owned-path allowlist the CLI supplies in `step.prompt`');
    expect(body).toContain('Edit only allowlisted paths');
    expect(body).toContain('An absent allowlist is a blocker');
    expect(body).toContain('`type: correctness-review` report with `verdict: FAIL`');
    expect(body).not.toContain('validation.md');
    expect(body).toContain('do not widen scope. Leave it unchanged and report it as a remaining blocker');
  });

  it('returns a structured repair envelope inside a CLI-budgeted attempt', async () => {
    const body = await readSkill('spok-repair');
    expect(body).toContain('Findings addressed:');
    expect(body).toContain('Commands run:');
    expect(body).toContain('Changed paths:');
    expect(body).toContain('Remaining blockers:');
    expect(body).toContain('Repair rounds are budgeted by `spok-review-correctness` (at most two)');
    expect(body).toContain('Do not claim a check passed without naming the exact command that ran.');
  });

  it('reports plan mismatches with evidence', async () => {
    const implement = await readSkill('spok-implement-plan');
    expect(implement).toContain('Report a consequential mismatch in this shape:');
    expect(implement).toContain('Expected: <what the plan says>');
    expect(implement).toContain('Found: <what the code does, at path:line>');
    expect(implement).toContain('Why this matters: <the required behavior or check at risk>');
  });
});

describe('question answer argument transport', () => {
  it('illustrates a separate answer argument without shell interpolation', async () => {
    const body = await readSkill('spok-flow');
    expect(body).toContain('"--answer", humanAnswer');
    expect(body).toContain('shell: false');
    expect(body).not.toContain('--answer "<human-answer>"');
  });
});
