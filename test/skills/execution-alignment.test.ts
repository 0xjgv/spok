import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSkill = (name: string) =>
  readFile(resolve(__dirname, '../../assets/skills', name, 'SKILL.md'), 'utf-8');

const readReference = (name: string, file: string) =>
  readFile(resolve(__dirname, '../../assets/skills', name, 'references', file), 'utf-8');

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

  it('ranks design authority above implementation state in the precedence rules', async () => {
    const body = await readSkill('spok-validate-implementation');
    expect(body).not.toContain(
      '**implementation state + executed checks > plan > structure outline > design discussion > research > ticket**',
    );
    expect(body).toContain('**design discussion > structure outline > plan**');
    expect(body).toContain('Chronology does not determine authority.');
    expect(body).toContain('never authorize a change in required behavior');
  });

  it('fails an implementation that contradicts required design behavior', async () => {
    const body = await readSkill('spok-validate-implementation');
    expect(body).toContain(
      'contradicts required design behavior is `FAIL` even when every executed check passes',
    );
    expect(body).toContain('not as a passing deviation');
    expect(body).toContain('do not rewrite history');
  });

  it('routes the validation verdict through the CLI instead of naming absent skills', async () => {
    const body = await readReference('spok-validate-implementation', 'validation_final_answer.md');
    expect(body).toContain('Inside a flow run the CLI routes from here; the human invokes nothing.');
    expect(body).toContain('the flow routes to a `repair` step and then back to `validate`');
    expect(body).toContain('the next step is `commit`, dispatched to `spok-ci-commit`');
    expect(body).not.toContain('iterate-implementation');
    expect(body).not.toContain('describe-pr');
  });

  it('reports changes that trace to no plan phase as findings', async () => {
    const template = await readReference('spok-validate-implementation', 'validation_template.md');
    const body = await readSkill('spok-validate-implementation');
    expect(template).toContain('### Unplanned Additions');
    expect(template).toContain('An addition the implementation cannot justify counts against `PASS`');
    expect(body).toContain('List changed paths and behavior not traceable to any plan phase');
    expect(body).toContain('an unjustified addition counts against `PASS`');
  });

  it('bounds repair to the owned-path allowlist and the findings it must fix', async () => {
    const body = await readSkill('spok-repair');
    expect(body).toContain('the owned-path allowlist the CLI supplies in `step.prompt`');
    expect(body).toContain('only the paths a recorded blocking finding demonstrably requires');
    expect(body).toContain('An absent allowlist is a blocker');
    expect(body).toContain('do not widen scope. Leave it unchanged and report it as a remaining blocker');
  });

  it('returns a structured repair envelope inside a CLI-budgeted attempt', async () => {
    const body = await readSkill('spok-repair');
    expect(body).toContain('Findings addressed:');
    expect(body).toContain('Commands run:');
    expect(body).toContain('Changed paths:');
    expect(body).toContain('Remaining blockers:');
    expect(body).toContain('Repair attempts are budgeted by the CLI; an exhausted budget blocks the flow.');
    expect(body).toContain('Do not claim a check passed without naming the exact command that ran.');
  });

  it('verifies supplied corrections and reports mismatches with evidence', async () => {
    const plan = await readSkill('spok-create-plan');
    const implement = await readSkill('spok-implement-plan');
    expect(plan).toContain('A supplied answer is authoritative for the decision it answers.');
    expect(plan).toContain('do not accept it blindly: read the named files');
    expect(plan).toContain('Chronology does not determine authority.');
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
