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

  it('accepts agent-performed UI evidence while retaining required automated checks', async () => {
    const body = await readSkill('spok-validate-implementation');
    expect(body).toContain('Perform relevant UI/manual checks yourself');
    expect(body).toContain('human signoff is not required');
    expect(body).toContain('required automated check that cannot run or does not pass as a validation failure');
    expect(body).toContain('exact commands and exit codes');
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
