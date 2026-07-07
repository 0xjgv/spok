import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { statusCommand } from '../../../src/commands/workflow/status.js';

let projectRoot: string;
let originalCwd: string;

async function writeSchema(name: string): Promise<void> {
  const schemaDir = path.join(projectRoot, 'spok', 'schemas', name);
  await fs.mkdir(path.join(schemaDir, 'templates'), { recursive: true });
  await fs.writeFile(path.join(schemaDir, 'templates', 'proposal.md'), '# Proposal\n', 'utf-8');
  await fs.writeFile(
    path.join(schemaDir, 'schema.yaml'),
    [
      `name: ${name}`,
      'version: 1',
      'description: Status test schema',
      'artifacts:',
      '  - id: proposal',
      '    generates: proposal.md',
      '    description: Proposal artifact',
      '    template: proposal.md',
      '    requires: []',
      '',
    ].join('\n'),
    'utf-8'
  );
}

async function writeChange(name: string, schemaName: string): Promise<void> {
  const changeDir = path.join(projectRoot, 'spok', 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, '.spok.yaml'), `schema: ${schemaName}\n`, 'utf-8');
}

function captureConsoleLogs(): string[] {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((message = '') => {
    logs.push(String(message));
  });
  return logs;
}

describe('statusCommand', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    projectRoot = path.join(os.tmpdir(), `spok-status-${randomUUID()}`);
    await fs.mkdir(path.join(projectRoot, 'spok', 'changes'), { recursive: true });
    await writeSchema('status-test');
    process.chdir(projectRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('prints an empty JSON status when no changes exist', async () => {
    const logs = captureConsoleLogs();

    await statusCommand({ json: true });

    expect(JSON.parse(logs[0])).toEqual({
      changes: [],
      message: 'No active changes.',
    });
  });

  it('requires --change when changes exist but no change is selected', async () => {
    await writeChange('demo', 'status-test');

    await expect(statusCommand({ json: true })).rejects.toThrow(
      'Missing required option --change. Available changes:\n  demo'
    );
  });

  it('prints JSON status for a selected change', async () => {
    const logs = captureConsoleLogs();
    await writeChange('demo', 'status-test');
    await fs.writeFile(
      path.join(projectRoot, 'spok', 'changes', 'demo', 'proposal.md'),
      '# Proposal\n',
      'utf-8'
    );

    await statusCommand({ change: 'demo', schema: 'status-test', json: true });

    const payload = JSON.parse(logs[0]) as {
      changeName: string;
      schemaName: string;
      isComplete: boolean;
    };
    expect(payload).toMatchObject({
      changeName: 'demo',
      schemaName: 'status-test',
      isComplete: true,
    });
  });
});
