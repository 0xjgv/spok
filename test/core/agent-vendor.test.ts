import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MANAGED_AGENT_MARKER,
  applyManagedAgentInstall,
  getManagedAgentNames,
  getManagedAgentState,
  getManagedAgentTargetDir,
  isManagedAgentToolId,
  prepareManagedAgentInstall,
  type ManagedAgentToolId,
} from '../../src/core/agent-vendor.js';

const VERSION = '9.8.7-test';
const DEFAULT_AGENT_NAMES = [
  'spok-codebase-analyzer',
  'spok-codebase-locator',
  'spok-codebase-pattern-finder',
  'spok-implementer-agent',
  'spok-web-search-researcher',
] as const;

function writeAgentCatalog(sourceDir: string, names: readonly string[]): void {
  const claudeDir = path.join(sourceDir, 'claude');
  const codexDir = path.join(sourceDir, 'codex');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });

  for (const name of names) {
    fs.writeFileSync(
      path.join(claudeDir, `${name}.md`),
      `---\nname: ${name}\ndescription: Test agent\ntools: Read\n---\n\n# ${name}\n`
    );
    fs.writeFileSync(
      path.join(codexDir, `${name}.toml`),
      `name = "${name}"\ndescription = "Test agent"\nsandbox_mode = "read-only"\n`
    );
  }
}

function replaceAgentCatalog(sourceDir: string, names: readonly string[]): void {
  fs.rmSync(sourceDir, { recursive: true, force: true });
  writeAgentCatalog(sourceDir, names);
}

async function installAgents(
  homeDir: string,
  sourceDir: string,
  toolIds: readonly ManagedAgentToolId[] = ['claude', 'codex'],
  force = false
) {
  const prepared = await prepareManagedAgentInstall({
    homeDir,
    sourceDir,
    toolIds,
    version: VERSION,
    force,
  });
  return applyManagedAgentInstall(prepared);
}

let tempDir: string;
let homeDir: string;
let sourceDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spok-agent-vendor-test-'));
  homeDir = path.join(tempDir, 'home');
  sourceDir = path.join(tempDir, 'assets', 'agents');
  fs.mkdirSync(homeDir, { recursive: true });
  writeAgentCatalog(sourceDir, ['spok-one', 'spok-two']);
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('managed agent catalog', () => {
  it('loads the five-name default Claude and Codex catalog', async () => {
    expect(await getManagedAgentNames()).toEqual(DEFAULT_AGENT_NAMES);
  });

  it('recognizes only supported tools and resolves home-scoped destinations', () => {
    expect(isManagedAgentToolId('claude')).toBe(true);
    expect(isManagedAgentToolId('codex')).toBe(true);
    expect(isManagedAgentToolId('cursor')).toBe(false);
    expect(getManagedAgentTargetDir('claude', homeDir)).toBe(
      path.join(homeDir, '.claude', 'agents')
    );
    expect(getManagedAgentTargetDir('codex', homeDir)).toBe(
      path.join(homeDir, '.codex', 'agents')
    );
  });

  it('adds native-format markers without changing source assets', async () => {
    const claudeSource = fs.readFileSync(
      path.join(sourceDir, 'claude', 'spok-one.md'),
      'utf8'
    );
    const codexSource = fs.readFileSync(
      path.join(sourceDir, 'codex', 'spok-one.toml'),
      'utf8'
    );

    await installAgents(homeDir, sourceDir);

    const claude = fs.readFileSync(
      path.join(homeDir, '.claude', 'agents', 'spok-one.md'),
      'utf8'
    );
    const codex = fs.readFileSync(
      path.join(homeDir, '.codex', 'agents', 'spok-one.toml'),
      'utf8'
    );
    const claudeLines = claude.split('\n');
    const frontmatterEnd = claudeLines.indexOf('---', 1);

    expect(claudeLines[frontmatterEnd + 1]).toContain(MANAGED_AGENT_MARKER);
    expect(claudeLines[frontmatterEnd + 1]).toContain(VERSION);
    expect(codex.split('\n')[0]).toContain(MANAGED_AGENT_MARKER);
    expect(codex.split('\n')[0]).toContain(VERSION);
    expect(fs.readFileSync(path.join(sourceDir, 'claude', 'spok-one.md'), 'utf8'))
      .toBe(claudeSource);
    expect(fs.readFileSync(path.join(sourceDir, 'codex', 'spok-one.toml'), 'utf8'))
      .toBe(codexSource);
  });
});

describe('managed agent installation', () => {
  it('installs both formats and is exactly idempotent', async () => {
    const first = await installAgents(homeDir, sourceDir);
    const claudePath = path.join(homeDir, '.claude', 'agents', 'spok-one.md');
    const codexPath = path.join(homeDir, '.codex', 'agents', 'spok-one.toml');
    const claudeContent = fs.readFileSync(claudePath, 'utf8');
    const codexContent = fs.readFileSync(codexPath, 'utf8');

    const second = await installAgents(homeDir, sourceDir);

    expect(first).toEqual([
      expect.objectContaining({
        toolId: 'claude',
        targetDir: path.dirname(claudePath),
        expectedCount: 2,
        writtenCount: 2,
        removedCount: 0,
        changed: true,
      }),
      expect.objectContaining({
        toolId: 'codex',
        targetDir: path.dirname(codexPath),
        expectedCount: 2,
        writtenCount: 2,
        removedCount: 0,
        changed: true,
      }),
    ]);
    expect(second.every((result) => !result.changed)).toBe(true);
    expect(second.every((result) => result.writtenCount === 0)).toBe(true);
    expect(fs.readFileSync(claudePath, 'utf8')).toBe(claudeContent);
    expect(fs.readFileSync(codexPath, 'utf8')).toBe(codexContent);
  });

  it('repairs missing and marked outdated expected files', async () => {
    await installAgents(homeDir, sourceDir, ['claude']);
    const agentsDir = getManagedAgentTargetDir('claude', homeDir);
    const onePath = path.join(agentsDir, 'spok-one.md');
    const twoPath = path.join(agentsDir, 'spok-two.md');
    const expectedOne = fs.readFileSync(onePath, 'utf8');
    const expectedTwo = fs.readFileSync(twoPath, 'utf8');
    fs.writeFileSync(
      onePath,
      expectedOne.replace(`version=${VERSION}`, 'version=0.0.1')
    );
    fs.rmSync(twoPath);

    const [result] = await installAgents(homeDir, sourceDir, ['claude']);

    expect(result).toMatchObject({ writtenCount: 2, removedCount: 0, changed: true });
    expect(fs.readFileSync(onePath, 'utf8')).toBe(expectedOne);
    expect(fs.readFileSync(twoPath, 'utf8')).toBe(expectedTwo);
  });
});

describe('managed agent destination safety', () => {
  it('removes only marked retired spok files', async () => {
    await installAgents(homeDir, sourceDir, ['claude']);
    const agentsDir = getManagedAgentTargetDir('claude', homeDir);
    const retiredPath = path.join(agentsDir, 'spok-one.md');
    const markedUnprefixedPath = path.join(agentsDir, 'notes.md');
    const unmarkedRetiredPath = path.join(agentsDir, 'spok-user.md');
    const otherExtensionPath = path.join(agentsDir, 'spok-other.txt');
    const managedContent = fs.readFileSync(retiredPath, 'utf8');
    fs.writeFileSync(markedUnprefixedPath, managedContent);
    fs.writeFileSync(unmarkedRetiredPath, '# User agent\n');
    fs.writeFileSync(otherExtensionPath, managedContent);
    replaceAgentCatalog(sourceDir, ['spok-two']);

    const [result] = await installAgents(homeDir, sourceDir, ['claude']);

    expect(result).toMatchObject({ writtenCount: 0, removedCount: 1, changed: true });
    expect(fs.existsSync(retiredPath)).toBe(false);
    expect(fs.readFileSync(markedUnprefixedPath, 'utf8')).toBe(managedContent);
    expect(fs.readFileSync(unmarkedRetiredPath, 'utf8')).toBe('# User agent\n');
    expect(fs.readFileSync(otherExtensionPath, 'utf8')).toBe(managedContent);
  });

  it('fails cross-tool collision preflight before any destination mutation', async () => {
    replaceAgentCatalog(sourceDir, ['spok-retired']);
    await installAgents(homeDir, sourceDir, ['claude']);
    const retiredPath = path.join(
      getManagedAgentTargetDir('claude', homeDir),
      'spok-retired.md'
    );
    const retiredContent = fs.readFileSync(retiredPath, 'utf8');
    replaceAgentCatalog(sourceDir, ['spok-one']);
    const codexCollision = path.join(
      getManagedAgentTargetDir('codex', homeDir),
      'spok-one.toml'
    );
    fs.mkdirSync(path.dirname(codexCollision), { recursive: true });
    fs.writeFileSync(codexCollision, 'name = "spok-one"\n# user-owned\n');

    await expect(prepareManagedAgentInstall({
      homeDir,
      sourceDir,
      toolIds: ['claude', 'codex'],
      version: VERSION,
    })).rejects.toThrow(new RegExp(`${codexCollision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*--force`, 'su'));

    expect(fs.readFileSync(retiredPath, 'utf8')).toBe(retiredContent);
    expect(fs.existsSync(path.join(path.dirname(retiredPath), 'spok-one.md'))).toBe(false);
    expect(fs.readFileSync(codexCollision, 'utf8')).toBe('name = "spok-one"\n# user-owned\n');
  });

  it('force adopts only exact current catalog filenames', async () => {
    const agentsDir = getManagedAgentTargetDir('codex', homeDir);
    const expectedPath = path.join(agentsDir, 'spok-one.toml');
    const unmarkedRetiredPath = path.join(agentsDir, 'spok-retired.toml');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(expectedPath, 'name = "spok-one"\n# user-owned\n');
    fs.writeFileSync(unmarkedRetiredPath, 'name = "spok-retired"\n');

    const [result] = await installAgents(homeDir, sourceDir, ['codex'], true);

    expect(result).toMatchObject({ writtenCount: 2, removedCount: 0, changed: true });
    expect(fs.readFileSync(expectedPath, 'utf8').split('\n')[0])
      .toContain(MANAGED_AGENT_MARKER);
    expect(fs.readFileSync(unmarkedRetiredPath, 'utf8'))
      .toBe('name = "spok-retired"\n');
  });
});

describe('managed agent state', () => {
  it('reports current, incomplete, and agent-only managed state', async () => {
    let state = await getManagedAgentState({
      homeDir,
      sourceDir,
      toolId: 'claude',
      version: VERSION,
    });
    expect(state).toEqual({
      toolId: 'claude',
      targetDir: getManagedAgentTargetDir('claude', homeDir),
      expectedCount: 2,
      hasManagedAgents: false,
      needsUpdate: true,
    });

    await installAgents(homeDir, sourceDir, ['claude']);
    state = await getManagedAgentState({
      homeDir,
      sourceDir,
      toolId: 'claude',
      version: VERSION,
    });
    expect(state).toMatchObject({ hasManagedAgents: true, needsUpdate: false });

    replaceAgentCatalog(sourceDir, ['spok-new']);
    state = await getManagedAgentState({
      homeDir,
      sourceDir,
      toolId: 'claude',
      version: VERSION,
    });
    expect(state).toMatchObject({
      expectedCount: 1,
      hasManagedAgents: true,
      needsUpdate: true,
    });
  });
});

describe('managed agent catalog validation', () => {
  it('rejects missing and empty source catalogs', async () => {
    const missingSource = path.join(tempDir, 'missing');
    await expect(getManagedAgentNames(missingSource)).rejects.toThrow(
      /Invalid managed agent catalog.*missing.*claude/iu
    );

    const emptySource = path.join(tempDir, 'empty');
    fs.mkdirSync(path.join(emptySource, 'claude'), { recursive: true });
    fs.mkdirSync(path.join(emptySource, 'codex'), { recursive: true });
    await expect(getManagedAgentNames(emptySource)).rejects.toThrow(
      /Invalid managed agent catalog.*no.*Claude/iu
    );
  });

  it('rejects source catalogs without exact stem parity', async () => {
    fs.rmSync(path.join(sourceDir, 'codex', 'spok-two.toml'));

    await expect(getManagedAgentNames(sourceDir)).rejects.toThrow(
      /Invalid managed agent catalog.*parity.*spok-two/iu
    );
  });

  it.each([
    ['claude', 'spok-wrong', 'spok-one.md'],
    ['codex', 'spok-wrong', 'spok-one.toml'],
  ] as const)('rejects a %s source whose native name differs from its stem', async (
    toolId,
    wrongName,
    filename
  ) => {
    const filepath = path.join(sourceDir, toolId, filename);
    const content = fs.readFileSync(filepath, 'utf8').replace('spok-one', wrongName);
    fs.writeFileSync(filepath, content);

    await expect(getManagedAgentNames(sourceDir)).rejects.toThrow(
      new RegExp(`${filename}.*${wrongName}.*spok-one`, 'su')
    );
  });

  it('rejects non-spok catalog names and unsupported install tools', async () => {
    replaceAgentCatalog(sourceDir, ['custom-agent']);
    await expect(getManagedAgentNames(sourceDir)).rejects.toThrow(
      /Invalid managed agent catalog.*custom-agent.*spok-/iu
    );

    replaceAgentCatalog(sourceDir, ['spok-one']);
    await expect(prepareManagedAgentInstall({
      homeDir,
      sourceDir,
      toolIds: ['cursor'],
      version: VERSION,
    })).rejects.toThrow(/Unsupported managed agent tool.*cursor/iu);
  });
});
