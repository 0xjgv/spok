import { execFileSync } from 'node:child_process';
import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerFlowQuestion,
  completeFlowStep,
  getFlowNext,
  getFlowStatus,
  pauseFlowStep,
  WORKFLOW_STATE_FILE,
  type WorkflowState,
} from '../../../src/commands/workflow/flow.js';

const PASS_DESIGN = '---\ntype: design-review\nverdict: PASS\n---\n# Design Review\n';
const PASS_VALIDATION = '---\nverdict: PASS\n---\n# Validation\n';

function git(root: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) {
    delete env[key];
  }
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env }).trim();
}

async function write(root: string, name: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await fs.writeFile(path.join(root, name), content);
}

async function readState(taskDir: string): Promise<WorkflowState> {
  return JSON.parse(await fs.readFile(path.join(taskDir, WORKFLOW_STATE_FILE), 'utf8'));
}

async function completeFile(taskDir: string, step: string, content: string): Promise<void> {
  const next = await getFlowNext(taskDir);
  expect(next.step?.id, next.reason).toBe(step);
  const output = next.step!.expectedOutput!;
  await fs.writeFile(output, content);
  const result = await completeFlowStep(taskDir, { step, output });
  expect(result.state, result.reason).toBe('ready');
}

async function reachImplementation(taskDir: string): Promise<void> {
  await write(taskDir, 'ticket.md', '# Add one owned file\n');
  await completeFile(taskDir, 'validate-problem', '# Problem\n\n## Flow Decision\n\nproceed\n');
  for (const step of ['research-questions', 'research', 'design-discussion', 'structure-outline']) {
    await completeFile(taskDir, step, `# ${step}\n`);
  }
  await completeFile(taskDir, 'design-review', PASS_DESIGN);
  await completeFile(taskDir, 'plan', '# Plan\n');
}

async function implement(taskDir: string): Promise<string> {
  const next = await getFlowNext(taskDir);
  expect(next.step?.id, next.reason).toBe('implement');
  const workRoot = next.execution!.workRoot;
  await write(workRoot, 'owned.ts', 'export const owned = true;\n');
  const completed = await completeFlowStep(taskDir, {
    step: 'implement', summary: 'Added the owned file.', changedPaths: ['owned.ts'],
  });
  expect(completed.state, completed.reason).toBe('ready');
  return workRoot;
}

async function reachCommit(taskDir: string): Promise<string> {
  const workRoot = await implement(taskDir);
  const simplified = await completeFlowStep(taskDir, { step: 'simplify', summary: 'No changes needed.' });
  expect(simplified.state, simplified.reason).toBe('ready');
  await completeFile(taskDir, 'validate', PASS_VALIDATION);
  expect((await getFlowNext(taskDir)).step?.id).toBe('commit');
  return workRoot;
}

let tempDir: string;
let primary: string;
let taskDir: string;

beforeEach(async () => {
  vi.stubEnv('SPOK_FLOW_PROFILE', 'codex');
  tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'spok-execution-')));
  primary = path.join(tempDir, 'primary');
  await fs.mkdir(primary);
  git(primary, 'init', '-b', 'main');
  git(primary, 'config', 'user.email', 'flow@example.com');
  git(primary, 'config', 'user.name', 'Flow Test');
  git(primary, 'config', 'commit.gpgsign', 'false');
  git(primary, 'config', 'core.autocrlf', 'false');
  await write(primary, 'seed.ts', 'export const seed = true;\n');
  git(primary, 'add', 'seed.ts');
  git(primary, 'commit', '-m', 'Seed fixture');
  taskDir = path.join(primary, 'spok', 'changes', 'demo', '.flow', 'chunk-one');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function useLinkedWorktree(): Promise<string> {
  const linked = path.join(tempDir, 'linked');
  git(primary, 'worktree', 'add', '-b', 'linked', linked);
  taskDir = path.join(linked, 'spok', 'changes', 'demo', '.flow', 'chunk-one');
  return linked;
}

describe('flow execution isolation', () => {
  it('persists a dedicated execution before dispatch and leaves the source checkout intact', async () => {
    const sourceHead = git(primary, 'rev-parse', 'HEAD');
    await write(primary, 'seed.ts', 'caller edits\n');
    await reachImplementation(taskDir);
    const next = await getFlowNext(taskDir);
    expect(next.step?.id, next.reason).toBe('implement');
    expect(next.execution?.workRoot).not.toBe(primary);
    expect(next.execution?.baselineHead).toBe(sourceHead);
    expect((await readState(taskDir)).execution).toEqual(next.execution);
    expect(next.step?.prompt).toContain(next.execution!.workRoot);
    expect(git(primary, 'branch', '--show-current')).toBe('main');
    expect(git(primary, 'rev-parse', 'HEAD')).toBe(sourceHead);
    expect(await fs.readFile(path.join(primary, 'seed.ts'), 'utf8')).toBe('caller edits\n');
    expect(await fs.readFile(path.join(next.execution!.workRoot, 'seed.ts'), 'utf8'))
      .toBe('export const seed = true;\n');
    const repeated = await getFlowNext(taskDir);
    expect(repeated.execution).toEqual(next.execution);
  });

  it('reuses the change worktree across chunk directories', async () => {
    await reachImplementation(taskDir);
    const first = await getFlowNext(taskDir);
    const secondTask = path.join(path.dirname(taskDir), 'chunk-two');
    await reachImplementation(secondTask);
    const second = await getFlowNext(secondTask);
    expect(second.execution?.workRoot, second.reason).toBe(first.execution?.workRoot);
    expect(second.execution?.branch).toBe(first.execution?.branch);
  });

  it('captures linked-worktree dirty state and retains it across questions and retries', async () => {
    const linked = await useLinkedWorktree();
    await write(linked, 'caller.txt', 'pre-existing\n');
    await reachImplementation(taskDir);
    const initial = await getFlowNext(taskDir);
    expect(initial.execution?.workRoot).toBe(linked);
    expect(Object.keys(initial.execution!.baselineChanges)).toEqual(expect.arrayContaining([
      'caller.txt',
      '.agents/skills/spok-flow/SKILL.md',
      '.claude/skills/spok-flow/SKILL.md',
    ]));
    await write(linked, 'owned.ts', 'new implementation\n');
    const questions = [{
      id: 'format', kind: 'choice', prompt: 'Which output format?',
      options: [
        { id: 'json', label: 'JSON', consequence: 'Machine-readable output.' },
        { id: 'text', label: 'Text', consequence: 'Readable terminal output.' },
      ],
    }];
    const packet = path.join(taskDir, 'questions.json');
    await fs.writeFile(packet, JSON.stringify({ questions }));
    expect((await pauseFlowStep(taskDir, { step: 'implement', questions: packet })).state)
      .toBe('needs-input');
    expect((await getFlowNext(taskDir)).execution).toEqual(initial.execution);
    await answerFlowQuestion(taskDir, { question: 'format', answer: 'json' });
    const resumed = await getFlowNext(taskDir);
    expect(resumed.execution).toEqual(initial.execution);
    expect(resumed.step?.prompt).toContain('Which output format?');
    expect(resumed.step?.prompt).toContain('Machine-readable output.');
    expect(resumed.step?.prompt).toContain('format: json');
    const completed = await completeFlowStep(taskDir, {
      step: 'implement', summary: 'Implemented JSON output.', changedPaths: ['owned.ts'],
    });
    expect(completed.state, completed.reason).toBe('ready');
    expect(completed.execution?.ownedPaths).toEqual(['owned.ts']);
    expect(completed.execution?.baselineChanges).toEqual(initial.execution?.baselineChanges);
  });

});

describe('flow execution ownership', () => {
  it('blocks implementation completion when the changed-path report omits a new file', async () => {
    await reachImplementation(taskDir);
    const next = await getFlowNext(taskDir);
    await write(next.execution!.workRoot, 'owned.ts', 'implementation\n');
    const result = await completeFlowStep(taskDir, { step: 'implement', summary: 'Done.' });
    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('owned.ts');
    expect((await readState(taskDir)).execution?.ownedPaths).toBeUndefined();
    expect((await getFlowStatus(taskDir)).nextStep?.id).toBe('implement');
  });

  it('requires dispatch to record execution before implementation can complete', async () => {
    await reachImplementation(taskDir);
    const result = await completeFlowStep(taskDir, {
      step: 'implement', summary: 'Claimed completion before dispatch.', changedPaths: [],
    });
    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('flow next');
    expect((await readState(taskDir)).execution).toBeUndefined();
  });

  it('rejects a different work root even when it is another valid checkout', async () => {
    await reachImplementation(taskDir);
    const next = await getFlowNext(taskDir);
    const result = await completeFlowStep(taskDir, {
      step: 'implement', summary: 'No changes.', changedPaths: [], workRoot: primary,
    });
    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('conflicts with recorded execution root');
    expect((await readState(taskDir)).execution).toEqual(next.execution);
  });

});

describe('flow execution work-root identity', () => {
  it.each(['alias', 'padded'])('accepts the %s spelling of the recorded work root', async (spelling) => {
    await reachImplementation(taskDir);
    const next = await getFlowNext(taskDir);
    const workRoot = next.execution!.workRoot;
    const alias = path.join(tempDir, 'execution-alias');
    await fs.symlink(workRoot, alias, 'junction');
    const suppliedRoot = spelling === 'alias' ? alias : `  ${workRoot}\t`;
    expect(realpathSync.native(suppliedRoot.trim())).toBe(realpathSync.native(workRoot));
    const result = await completeFlowStep(taskDir, {
      step: 'implement', summary: 'No changes needed.', changedPaths: [], workRoot: suppliedRoot,
    });
    expect(result.state, result.reason).toBe('ready');
    expect(realpathSync.native(result.execution!.workRoot)).toBe(realpathSync.native(workRoot));
    expect((await readState(taskDir)).execution).toEqual({
      ...next.execution, ownedPaths: [],
    });
  });

  it.each(['', ' \t ', 'missing'])('rejects the invalid supplied work root %j', async (value) => {
    await reachImplementation(taskDir);
    const next = await getFlowNext(taskDir);
    const suppliedRoot = value === 'missing' ? path.join(tempDir, 'missing') : value;
    const result = await completeFlowStep(taskDir, {
      step: 'implement', summary: 'No changes needed.', changedPaths: [], workRoot: suppliedRoot,
    });
    expect(result.state).toBe('blocked');
    expect((await readState(taskDir)).execution).toEqual(next.execution);
  });
});

describe('flow execution scope', () => {
  it('puts the persisted root and exact implementation allowlist in the simplify prompt', async () => {
    await reachImplementation(taskDir);
    const workRoot = await implement(taskDir);
    const simplify = await getFlowNext(taskDir);
    expect(simplify.step?.id, simplify.reason).toBe('simplify');
    expect(simplify.step?.prompt).toContain(workRoot);
    expect(simplify.step?.prompt).toContain('Exact implementation allowlist: ["owned.ts"]');
    expect((await readState(taskDir)).execution?.ownedPaths).toEqual(['owned.ts']);
    await expect(fs.access(path.join(primary, 'owned.ts'))).rejects.toThrow();
  });

  it('blocks simplify dispatch and completion after an out-of-scope source edit', async () => {
    await reachImplementation(taskDir);
    const workRoot = await implement(taskDir);
    await write(workRoot, 'outside.ts', 'out of scope\n');
    const dispatched = await getFlowNext(taskDir);
    expect(dispatched.state).toBe('blocked');
    expect(dispatched.reason).toContain('outside.ts');
    const completed = await completeFlowStep(taskDir, { step: 'simplify', summary: 'Simplified.' });
    expect(completed.state).toBe('blocked');
    expect(completed.reason).toContain('outside.ts');
    await fs.rm(path.join(workRoot, 'outside.ts'));
    expect((await getFlowNext(taskDir)).step?.id).toBe('simplify');
  });

  it('blocks completion and redispatch when a pre-existing dirty file changes', async () => {
    const linked = await useLinkedWorktree();
    await write(linked, 'seed.ts', 'caller changes\n');
    await reachImplementation(taskDir);
    await getFlowNext(taskDir);
    await write(linked, 'seed.ts', 'overwritten caller changes\n');
    const result = await completeFlowStep(taskDir, {
      step: 'implement', summary: 'Changed seed.', changedPaths: ['seed.ts'],
    });
    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Pre-existing change was modified: seed.ts');
    expect((await getFlowNext(taskDir)).state).toBe('blocked');
  });

});

describe('flow execution commit checks', () => {
  it('completes the commit step with the real execution HEAD and leaves primary HEAD unchanged', async () => {
    const primaryHead = git(primary, 'rev-parse', 'HEAD');
    await reachImplementation(taskDir);
    const workRoot = await reachCommit(taskDir);
    git(workRoot, 'add', 'owned.ts');
    git(workRoot, 'commit', '-m', 'Implement owned file');
    const head = git(workRoot, 'rev-parse', 'HEAD');
    const result = await completeFlowStep(taskDir, { step: 'commit', commit: head });
    expect(result.state, result.reason).toBe('complete');
    expect(result.completedStep?.result?.commit).toBe(head);
    expect(result.completedStep?.result?.workRoot).toBe(workRoot);
    expect(git(primary, 'rev-parse', 'HEAD')).toBe(primaryHead);
  });

  it('rejects a commit that exists but is not the execution HEAD', async () => {
    await reachImplementation(taskDir);
    const workRoot = await reachCommit(taskDir);
    const baseline = git(workRoot, 'rev-parse', 'HEAD');
    git(workRoot, 'add', 'owned.ts');
    git(workRoot, 'commit', '-m', 'Implement owned file');
    const result = await completeFlowStep(taskDir, { step: 'commit', commit: baseline });
    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('Commit must equal execution HEAD');
  });

  it('rejects a real HEAD commit containing paths outside the implementation allowlist', async () => {
    await reachImplementation(taskDir);
    const workRoot = await reachCommit(taskDir);
    await write(workRoot, 'outside.ts', 'outside the implementation\n');
    git(workRoot, 'add', 'owned.ts', 'outside.ts');
    git(workRoot, 'commit', '-m', 'Include extra file');
    const result = await completeFlowStep(taskDir, {
      step: 'commit', commit: git(workRoot, 'rev-parse', 'HEAD'),
    });
    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('outside the implementation allowlist');
  });

  it('rejects commit completion while an owned path still has uncommitted changes', async () => {
    await reachImplementation(taskDir);
    const workRoot = await reachCommit(taskDir);
    git(workRoot, 'add', 'owned.ts');
    git(workRoot, 'commit', '-m', 'Implement owned file');
    await write(workRoot, 'owned.ts', 'export const owned = false;\n');
    const result = await completeFlowStep(taskDir, {
      step: 'commit', commit: git(workRoot, 'rev-parse', 'HEAD'),
    });
    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('uncommitted chunk changes');
    expect(result.reason).toContain('owned.ts');
  });

});

describe('flow execution commit rename scope', () => {
  it('rejects deletion of an unowned path even when Git detects a rename to an owned path', async () => {
    await reachImplementation(taskDir);
    const next = await getFlowNext(taskDir);
    const workRoot = next.execution!.workRoot;
    const original = await fs.readFile(path.join(workRoot, 'seed.ts'), 'utf8');
    await write(workRoot, 'owned.ts', original);
    const implemented = await completeFlowStep(taskDir, {
      step: 'implement', summary: 'Copy the seed.', changedPaths: ['owned.ts'],
    });
    expect(implemented.state, implemented.reason).toBe('ready');
    await completeFlowStep(taskDir, { step: 'simplify', summary: 'No changes needed.' });
    await completeFile(taskDir, 'validate', PASS_VALIDATION);
    expect((await getFlowNext(taskDir)).step?.id).toBe('commit');
    await fs.rm(path.join(workRoot, 'seed.ts'));
    git(workRoot, 'add', 'seed.ts', 'owned.ts');
    git(workRoot, 'commit', '-m', 'Move seed to owned');
    expect(git(workRoot, 'diff', '--name-status', '-M', 'HEAD~1', 'HEAD'))
      .toBe('R100\tseed.ts\towned.ts');
    const result = await completeFlowStep(taskDir, {
      step: 'commit', commit: git(workRoot, 'rev-parse', 'HEAD'),
    });
    expect(result.state).toBe('blocked');
    expect(result.reason).toContain('outside the implementation allowlist');
  });
});

describe('flow execution commit recovery', () => {
  it('redispatches after the commit was created and records the existing HEAD', async () => {
    await reachImplementation(taskDir);
    const workRoot = await reachCommit(taskDir);
    const baseline = (await readState(taskDir)).execution!.baselineHead;
    git(workRoot, 'add', 'owned.ts');
    git(workRoot, 'commit', '-m', 'Implement owned file');
    const head = git(workRoot, 'rev-parse', 'HEAD');
    const resumed = await getFlowNext(taskDir);
    expect(resumed.state, resumed.reason).toBe('ready');
    expect(resumed.step?.id).toBe('commit');
    expect(resumed.execution?.baselineHead).toBe(baseline);
    const completed = await completeFlowStep(taskDir, { step: 'commit', commit: head });
    expect(completed.state, completed.reason).toBe('complete');
    expect(completed.completedStep?.result?.commit).toBe(head);
    expect(git(workRoot, 'rev-list', '--count', `${baseline}..HEAD`)).toBe('1');
  });

  it('verifies the dedicated worktree commit despite ambient Git overrides for the source checkout', async () => {
    await reachImplementation(taskDir);
    const workRoot = await reachCommit(taskDir);
    git(workRoot, 'add', 'owned.ts');
    git(workRoot, 'commit', '-m', 'Implement owned file');
    const head = git(workRoot, 'rev-parse', 'HEAD');
    expect(git(primary, 'rev-parse', 'HEAD')).not.toBe(head);
    vi.stubEnv('GIT_DIR', path.join(primary, '.git'));
    vi.stubEnv('GIT_WORK_TREE', primary);
    vi.stubEnv('GIT_COMMON_DIR', path.join(primary, '.git'));
    vi.stubEnv('GIT_INDEX_FILE', path.join(primary, '.git', 'index'));
    const resumed = await getFlowNext(taskDir);
    expect(resumed.state, resumed.reason).toBe('ready');
    expect(resumed.execution?.workRoot).toBe(workRoot);
    const completed = await completeFlowStep(taskDir, { step: 'commit', commit: head });
    expect(completed.state, completed.reason).toBe('complete');
    expect(completed.completedStep?.result?.commit).toBe(head);
    expect(completed.completedStep?.result?.workRoot).toBe(workRoot);
  });
});

describe('flow execution legacy compatibility', () => {
  it('keeps legacy flows past implementation readable and completable without execution metadata', async () => {
    await reachImplementation(taskDir);
    await implement(taskDir);
    const legacy = await readState(taskDir);
    delete legacy.execution;
    await fs.writeFile(path.join(taskDir, WORKFLOW_STATE_FILE), JSON.stringify(legacy));
    expect((await getFlowStatus(taskDir)).nextStep?.id).toBe('simplify');
    expect((await getFlowNext(taskDir)).execution).toBeUndefined();
    await completeFlowStep(taskDir, { step: 'simplify', summary: 'Legacy simplification.' });
    await completeFile(taskDir, 'validate', PASS_VALIDATION);
    const completed = await completeFlowStep(taskDir, { step: 'commit', commit: 'legacy-commit' });
    expect(completed.state, completed.reason).toBe('complete');
    expect(completed.execution).toBeUndefined();
  });
});
