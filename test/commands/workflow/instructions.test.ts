import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateApplyInstructions,
  instructionsCommand,
  printApplyInstructionsText,
  printInstructionsText,
} from '../../../src/commands/workflow/instructions.js';
import type { ApplyInstructions } from '../../../src/commands/workflow/shared.js';
import type { ArtifactInstructions } from '../../../src/core/artifact-graph/index.js';

interface ApplyHarness {
  projectRoot: string;
  changeDir: string;
  writeProposal(): Promise<void>;
  writeTasks(content: string): Promise<void>;
}

async function writeSchema(projectRoot: string, name: string, tracks: string | null): Promise<void> {
  const schemaDir = path.join(projectRoot, 'spok', 'schemas', name);
  await fs.mkdir(path.join(schemaDir, 'templates'), { recursive: true });
  await fs.writeFile(path.join(schemaDir, 'templates', 'proposal.md'), '# Proposal\n', 'utf-8');
  await fs.writeFile(
    path.join(schemaDir, 'schema.yaml'),
    [
      `name: ${name}`,
      'version: 1',
      'description: Apply test schema',
      'artifacts:',
      '  - id: proposal',
      '    generates: proposal.md',
      '    description: Proposal artifact',
      '    template: proposal.md',
      '    requires: []',
      'apply:',
      '  requires: [proposal]',
      tracks === null ? '  tracks: null' : `  tracks: ${tracks}`,
      '  instruction: Custom apply guidance.',
      '',
    ].join('\n'),
    'utf-8'
  );
}

function useApplyHarness(schemaName: string): ApplyHarness {
  const projectRoot = path.join(os.tmpdir(), `spok-instructions-${randomUUID()}`);
  const changeDir = path.join(projectRoot, 'spok', 'changes', 'demo');

  beforeEach(async () => {
    await writeSchema(projectRoot, 'tracked-apply', 'tasks.md');
    await writeSchema(projectRoot, 'untracked-apply', null);
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, '.spok.yaml'), `schema: ${schemaName}\n`, 'utf-8');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  return {
    projectRoot,
    changeDir,
    writeProposal: () => fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n', 'utf-8'),
    writeTasks: (content: string) =>
      fs.writeFile(path.join(changeDir, 'tasks.md'), content, 'utf-8'),
  };
}

function captureConsoleLogs(): string[] {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((message = '') => {
    logs.push(String(message));
  });
  return logs;
}

function artifactInstructions(changeDir: string): ArtifactInstructions {
  return {
    changeName: 'demo',
    artifactId: 'design',
    schemaName: 'tracked-apply',
    changeDir,
    outputPath: 'design.md',
    resolvedOutputPath: path.join(changeDir, 'design.md'),
    existingOutputPaths: [],
    description: 'Design the change.',
    instruction: 'Prefer the smallest useful design.',
    context: 'Repo context.',
    rules: ['Use concise prose.', 'Keep scope narrow.'],
    template: '# Design\n\n## Decisions\n',
    dependencies: [
      {
        id: 'proposal',
        done: false,
        path: 'proposal.md',
        description: 'Proposal artifact',
      },
      {
        id: 'research',
        done: true,
        path: 'research.md',
        description: 'Research artifact',
      },
    ],
    unlocks: ['tasks', 'validation'],
  };
}

function applyInstructions(overrides: Partial<ApplyInstructions> = {}): ApplyInstructions {
  return {
    changeName: 'demo',
    changeDir: '/tmp/demo',
    schemaName: 'tracked-apply',
    contextFiles: {
      proposal: ['/tmp/demo/proposal.md'],
      design: ['/tmp/demo/design.md', '/tmp/demo/spec.md'],
    },
    progress: { total: 2, complete: 1, remaining: 1 },
    tasks: [
      { id: '1', description: 'Done task', done: true },
      { id: '2', description: 'Pending task', done: false },
    ],
    state: 'ready',
    instruction: 'Use the next pending task.',
    ...overrides,
  };
}

describe('workflow instructions text output', () => {
  const harness = useApplyHarness('tracked-apply');

  it('prints artifact instructions with context, blockers, dependencies, and unlocks', () => {
    const logs = captureConsoleLogs();

    printInstructionsText(artifactInstructions(harness.changeDir), true);

    expect(logs).toContain('<warning>');
    expect(logs).toContain('Missing: proposal');
    expect(logs).toContain('<project_context>');
    expect(logs).toContain('Repo context.');
    expect(logs).toContain('- Use concise prose.');
    expect(logs).toContain(`  <path>${path.join(harness.changeDir, 'proposal.md')}</path>`);
    expect(logs).toContain('Prefer the smallest useful design.');
    expect(logs).toContain('Completing this artifact enables: tasks, validation');
    expect(logs.at(-1)).toBe('</artifact>');
  });

  it('prints apply instructions for ready, blocked, and all-done states', () => {
    const logs = captureConsoleLogs();

    printApplyInstructionsText(applyInstructions());
    printApplyInstructionsText(
      applyInstructions({
        state: 'blocked',
        missingArtifacts: ['proposal'],
        contextFiles: {},
        progress: { total: 0, complete: 0, remaining: 0 },
        tasks: [],
        instruction: 'Cannot apply yet.',
      })
    );
    printApplyInstructionsText(
      applyInstructions({
        state: 'all_done',
        progress: { total: 1, complete: 1, remaining: 0 },
        tasks: [{ id: '1', description: 'Complete task', done: true }],
        instruction: 'Archive the change.',
      })
    );

    expect(logs).toContain('## Apply: demo');
    expect(logs).toContain('- proposal: /tmp/demo/proposal.md');
    expect(logs).toContain('- [x] Done task');
    expect(logs).toContain('- [ ] Pending task');
    expect(logs).toContain('Missing artifacts: proposal');
    expect(logs).toContain('1/1 complete ✓');
  });
});

describe('instructionsCommand', () => {
  const harness = useApplyHarness('tracked-apply');

  it('prints JSON instructions for an artifact', async () => {
    const logs = captureConsoleLogs();
    const cwd = process.cwd();

    try {
      process.chdir(harness.projectRoot);

      await instructionsCommand('proposal', {
        change: 'demo',
        schema: 'tracked-apply',
        json: true,
      });
    } finally {
      process.chdir(cwd);
    }

    const payload = JSON.parse(logs[0]) as { artifactId: string; changeName: string };
    expect(payload).toMatchObject({
      artifactId: 'proposal',
      changeName: 'demo',
    });
  });
});

describe('generateApplyInstructions', () => {
  const harness = useApplyHarness('tracked-apply');

  it('blocks when required artifacts are missing', async () => {
    const result = await generateApplyInstructions(harness.projectRoot, 'demo', 'tracked-apply');

    expect(result.state).toBe('blocked');
    expect(result.missingArtifacts).toEqual(['proposal']);
    expect(result.instruction).toContain('Missing artifacts: proposal');
  });

  it('blocks when the tracking file is missing or empty', async () => {
    await harness.writeProposal();

    const missing = await generateApplyInstructions(harness.projectRoot, 'demo', 'tracked-apply');
    await harness.writeTasks('# Tasks\n\nNo checkbox items here.\n');
    const empty = await generateApplyInstructions(harness.projectRoot, 'demo', 'tracked-apply');

    expect(missing.state).toBe('blocked');
    expect(missing.instruction).toContain('tasks.md file is missing');
    expect(empty.state).toBe('blocked');
    expect(empty.instruction).toContain('contains no chunks');
  });

  it('parses task checkboxes and reports ready or all-done progress', async () => {
    await harness.writeProposal();
    await harness.writeTasks('- [x] Completed chunk\n- [ ] Pending chunk\n* [X] Also complete\n');

    const ready = await generateApplyInstructions(harness.projectRoot, 'demo', 'tracked-apply');

    expect(ready.state).toBe('ready');
    expect(ready.progress).toEqual({ total: 3, complete: 2, remaining: 1 });
    expect(ready.tasks.map(({ description, done }) => ({ description, done }))).toEqual([
      { description: 'Completed chunk', done: true },
      { description: 'Pending chunk', done: false },
      { description: 'Also complete', done: true },
    ]);

    await harness.writeTasks('- [x] Completed chunk\n');
    const allDone = await generateApplyInstructions(harness.projectRoot, 'demo', 'tracked-apply');

    expect(allDone.state).toBe('all_done');
    expect(allDone.instruction).toContain('All tasks are complete');
  });
});

describe('generateApplyInstructions without tracking', () => {
  const harness = useApplyHarness('untracked-apply');

  it('uses schema guidance when no tracking file is configured', async () => {
    await harness.writeProposal();

    const result = await generateApplyInstructions(harness.projectRoot, 'demo', 'untracked-apply');

    expect(result.state).toBe('ready');
    expect(result.progress).toEqual({ total: 0, complete: 0, remaining: 0 });
    expect(result.tasks).toEqual([]);
    expect(result.instruction).toBe('Custom apply guidance.');
  });
});
