import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applySpecs } from '../../src/core/specs-apply.js';

let projectRoot: string;

function changeSpecPath(capability: string): string {
  return path.join(projectRoot, 'spok', 'changes', 'demo', 'specs', capability, 'spec.md');
}

function mainSpecPath(capability: string): string {
  return path.join(projectRoot, 'spok', 'specs', capability, 'spec.md');
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

function mainAuthSpec(): string {
  return [
    '# auth Specification',
    '',
    '## Purpose',
    'Authenticate users.',
    '',
    '## Requirements',
    '### Requirement: Old Login',
    'The system SHALL support legacy login.',
    '',
    '#### Scenario: Legacy login',
    '- **WHEN** a user logs in',
    '- **THEN** access is granted',
    '',
    '### Requirement: Existing Session',
    'The system SHALL keep sessions active.',
    '',
    '### Requirement: Remove Legacy',
    'The system SHALL support legacy removal.',
    '',
  ].join('\n');
}

function fullDeltaSpec(): string {
  return [
    '## RENAMED Requirements',
    'FROM: ### Requirement: Old Login',
    'TO: ### Requirement: Password Login',
    '',
    '## REMOVED Requirements',
    '### Requirement: Remove Legacy',
    '',
    '## MODIFIED Requirements',
    '### Requirement: Existing Session',
    'The system SHALL keep sessions active for trusted users.',
    '',
    '## ADDED Requirements',
    '### Requirement: Multi Factor Login',
    'The system SHALL require a second factor.',
    '',
  ].join('\n');
}

describe('applySpecs', () => {
  beforeEach(async () => {
    projectRoot = path.join(os.tmpdir(), `spok-specs-apply-${randomUUID()}`);
    await fs.mkdir(path.join(projectRoot, 'spok', 'changes', 'demo'), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('throws when the change does not exist', async () => {
    await expect(applySpecs(projectRoot, 'missing')).rejects.toThrow("Change 'missing' not found.");
  });

  it('returns noChanges when the change has no delta specs', async () => {
    const result = await applySpecs(projectRoot, 'demo');

    expect(result).toEqual({
      changeName: 'demo',
      capabilities: [],
      totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
      noChanges: true,
    });
  });

  it('summarizes updates in dry-run mode without writing target specs', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message = '') => {
      logs.push(String(message));
    });
    await writeFile(mainSpecPath('auth'), mainAuthSpec());
    await writeFile(changeSpecPath('auth'), fullDeltaSpec());

    const result = await applySpecs(projectRoot, 'demo', {
      dryRun: true,
      skipValidation: true,
    });
    const targetContent = await fs.readFile(mainSpecPath('auth'), 'utf-8');

    expect(result).toMatchObject({
      changeName: 'demo',
      capabilities: [{ capability: 'auth', added: 1, modified: 1, removed: 1, renamed: 1 }],
      totals: { added: 1, modified: 1, removed: 1, renamed: 1 },
      noChanges: false,
    });
    expect(targetContent).toBe(mainAuthSpec());
    expect(logs).toContain('Would apply changes to spok/specs/auth/spec.md:');
    expect(logs).toContain('  + 1 added');
    expect(logs).toContain('  ~ 1 modified');
    expect(logs).toContain('  - 1 removed');
  });

  it('writes updated specs when not in dry-run mode', async () => {
    await writeFile(mainSpecPath('auth'), mainAuthSpec());
    await writeFile(changeSpecPath('auth'), fullDeltaSpec());

    const result = await applySpecs(projectRoot, 'demo', {
      skipValidation: true,
      silent: true,
    });
    const targetContent = await fs.readFile(mainSpecPath('auth'), 'utf-8');

    expect(result.noChanges).toBe(false);
    expect(targetContent).toContain('### Requirement: Password Login');
    expect(targetContent).toContain('The system SHALL keep sessions active for trusted users.');
    expect(targetContent).toContain('### Requirement: Multi Factor Login');
    expect(targetContent).not.toContain('### Requirement: Remove Legacy');
  });
});
