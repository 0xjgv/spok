import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newChangeCommand } from '../../../src/commands/workflow/new-change.js';

let rootDir: string;
let originalCwd: string;

async function createRepoRoot(): Promise<string> {
  const repoRoot = path.join(rootDir, 'repo');
  await fs.mkdir(path.join(repoRoot, 'spok'), { recursive: true });
  return repoRoot;
}

async function createWorkspaceRoot(): Promise<string> {
  const workspaceRoot = path.join(rootDir, 'workspace');
  await fs.mkdir(path.join(workspaceRoot, '.spok-workspace'), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, '.spok-workspace', 'workspace.yaml'),
    'version: 1\nname: platform\nlinks:\n  api: {}\n  web: {}\n',
    'utf-8'
  );
  return workspaceRoot;
}

async function readYaml(filePath: string): Promise<Record<string, unknown>> {
  return parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>;
}

describe('newChangeCommand', () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    rootDir = path.join(os.tmpdir(), `spok-new-change-${randomUUID()}`);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('requires a change name', async () => {
    await expect(newChangeCommand(undefined, {})).rejects.toThrow('Missing required argument <name>');
  });

  it('rejects affected areas outside workspace planning homes', async () => {
    const repoRoot = await createRepoRoot();
    process.chdir(repoRoot);

    await expect(newChangeCommand('repo-change', { areas: 'api' })).rejects.toThrow(
      '--areas can only be used when creating a workspace-scoped change'
    );
  });

  it('creates a repo-scoped change with README content', async () => {
    const repoRoot = await createRepoRoot();
    process.chdir(repoRoot);

    await newChangeCommand('repo-change', {
      description: 'Build the thing.',
      goal: 'Explicit goal.',
    });

    const changeDir = path.join(repoRoot, 'spok', 'changes', 'repo-change');
    const metadata = await readYaml(path.join(changeDir, '.spok.yaml'));
    await expect(fs.readFile(path.join(changeDir, 'README.md'), 'utf-8')).resolves.toContain(
      'Build the thing.'
    );
    expect(metadata).toMatchObject({
      schema: 'spec-driven',
      goal: 'Explicit goal.',
    });
  });

  it('rejects invalid workspace affected areas and lists valid links', async () => {
    const workspaceRoot = await createWorkspaceRoot();
    process.chdir(workspaceRoot);

    await expect(newChangeCommand('workspace-change', { areas: 'api,missing' })).rejects.toThrow(
      'Invalid affected area: missing. Valid workspace link names: api, web'
    );
  });

  it('creates a workspace-scoped change with affected areas', async () => {
    const workspaceRoot = await createWorkspaceRoot();
    process.chdir(workspaceRoot);

    await newChangeCommand('workspace-change', {
      description: 'Coordinate repositories.',
      areas: 'api, web',
    });

    const changeDir = path.join(workspaceRoot, 'changes', 'workspace-change');
    const metadata = await readYaml(path.join(changeDir, '.spok.yaml'));
    expect(metadata).toMatchObject({
      schema: 'workspace-planning',
      goal: 'Coordinate repositories.',
      affected_areas: ['api', 'web'],
    });
    expect(vi.mocked(console.log)).toHaveBeenCalledWith('Affected areas: api, web');
  });
});
