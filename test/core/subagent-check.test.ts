import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkSubagentReadiness,
  formatSubagentWarning,
  type SubagentCheckResult,
} from '../../src/core/subagent-check.js';

const DEFAULT_AGENT_NAMES = [
  'spok-ai-engineer',
  'spok-architect',
  'spok-codebase-analyzer',
  'spok-codebase-locator',
  'spok-codebase-pattern-finder',
  'spok-codebase-simplifier',
  'spok-designer',
  'spok-engineer',
  'spok-implementation-reviewer',
  'spok-implementer-agent',
  'spok-outline-implementer-agent',
  'spok-product',
  'spok-qa',
  'spok-reverse-engineer',
  'spok-security-engineer',
  'spok-web-search-researcher',
] as const;

const EXTENSIONS = {
  claude: '.md',
  codex: '.toml',
} as const;

function agentDir(homeDir: string, toolId: keyof typeof EXTENSIONS): string {
  return path.join(homeDir, `.${toolId}`, 'agents');
}

function writeAgentFiles(
  homeDir: string,
  toolId: keyof typeof EXTENSIONS,
  names: readonly string[]
): void {
  const targetDir = agentDir(homeDir, toolId);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of names) {
    fs.writeFileSync(path.join(targetDir, `${name}${EXTENSIONS[toolId]}`), 'present\n');
  }
}

describe('subagent-check', () => {
  let tempDir: string;
  let homeDir: string;
  let originalCodexHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spok-subagent-test-'));
    homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(homeDir);
    originalCodexHome = process.env.CODEX_HOME;
  });

  afterEach(() => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports the exact default catalog as missing for Claude and Codex', async () => {
    const results = await checkSubagentReadiness(['claude', 'codex'], { homeDir });

    expect(results).toEqual([
      {
        toolId: 'claude',
        displayName: 'Claude Code',
        targetDir: agentDir(homeDir, 'claude'),
        targetDirExists: false,
        expectedCount: 16,
        missing: DEFAULT_AGENT_NAMES.map((name) => `${name}.md`),
      },
      {
        toolId: 'codex',
        displayName: 'Codex',
        targetDir: agentDir(homeDir, 'codex'),
        targetDirExists: false,
        expectedCount: 16,
        missing: DEFAULT_AGENT_NAMES.map((name) => `${name}.toml`),
      },
    ]);
  });

  it('reports Claude and Codex complete when every expected file is present', async () => {
    writeAgentFiles(homeDir, 'claude', DEFAULT_AGENT_NAMES);
    writeAgentFiles(homeDir, 'codex', DEFAULT_AGENT_NAMES);

    const results = await checkSubagentReadiness(['claude', 'codex'], { homeDir });

    expect(results.map((result) => result.targetDirExists)).toEqual([true, true]);
    expect(results.map((result) => result.missing)).toEqual([[], []]);
  });

  it('reports only absent Claude and Codex files for partial installations', async () => {
    writeAgentFiles(homeDir, 'claude', [DEFAULT_AGENT_NAMES[0]]);
    writeAgentFiles(homeDir, 'codex', [DEFAULT_AGENT_NAMES[15]]);

    const [claude, codex] = await checkSubagentReadiness(['claude', 'codex'], {
      homeDir,
    });

    expect(claude?.missing).toEqual(
      DEFAULT_AGENT_NAMES.slice(1).map((name) => `${name}.md`)
    );
    expect(codex?.missing).toEqual(
      DEFAULT_AGENT_NAMES.slice(0, -1).map((name) => `${name}.toml`)
    );
  });

  it('ignores unsupported tools and preserves first-selected supported order', async () => {
    const results = await checkSubagentReadiness(
      ['cursor', 'codex', 'claude', 'codex', 'CLAUDE'],
      { homeDir }
    );

    expect(results.map((result) => result.toolId)).toEqual(['codex', 'claude']);
    await expect(checkSubagentReadiness(['cursor'], {
      homeDir,
      sourceDir: path.join(tempDir, 'missing-catalog'),
    })).resolves.toEqual([]);
  });

  it('uses ~/.codex/agents instead of CODEX_HOME', async () => {
    const codexHome = path.join(tempDir, 'codex-home');
    process.env.CODEX_HOME = codexHome;
    const codexHomeAgents = path.join(codexHome, 'agents');
    fs.mkdirSync(codexHomeAgents, { recursive: true });
    for (const name of DEFAULT_AGENT_NAMES) {
      fs.writeFileSync(path.join(codexHomeAgents, `${name}.toml`), 'present\n');
    }

    const [result] = await checkSubagentReadiness(['codex'], { homeDir });

    expect(result?.targetDir).toBe(agentDir(homeDir, 'codex'));
    expect(result?.missing).toHaveLength(16);
  });

  it('does not create the home or agent directories while probing', async () => {
    const missingHome = path.join(tempDir, 'missing-home');

    const results = await checkSubagentReadiness(['claude', 'codex'], {
      homeDir: missingHome,
    });

    expect(results.map((result) => result.targetDirExists)).toEqual([false, false]);
    expect(fs.existsSync(missingHome)).toBe(false);
    expect(fs.existsSync(agentDir(missingHome, 'claude'))).toBe(false);
    expect(fs.existsSync(agentDir(missingHome, 'codex'))).toBe(false);
  });

  it('formats one actionable warning for both incomplete tools', () => {
    const results: SubagentCheckResult[] = [
      {
        toolId: 'claude',
        displayName: 'Claude Code',
        targetDir: '/home/test/.claude/agents',
        targetDirExists: true,
        expectedCount: 16,
        missing: ['spok-implementer-agent.md'],
      },
      {
        toolId: 'codex',
        displayName: 'Codex',
        targetDir: '/home/test/.codex/agents',
        targetDirExists: false,
        expectedCount: 16,
        missing: ['spok-qa.toml'],
      },
    ];

    expect(formatSubagentWarning(results)).toBe([
      'Missing Spok agents for Claude Code',
      '  Missing 1 of 16: spok-implementer-agent.md',
      '  Expected in: /home/test/.claude/agents',
      '  Run: spok skills install --tools claude',
      '  Then start a fresh Claude Code session.',
      '',
      'Missing Spok agents for Codex',
      '  Missing 1 of 16: spok-qa.toml',
      '  Expected in: /home/test/.codex/agents',
      '  Run: spok skills install --tools codex',
      '  Then start a fresh Codex session.',
    ].join('\n'));
  });

  it('returns null when every selected supported tool is complete', () => {
    const complete: SubagentCheckResult = {
      toolId: 'claude',
      displayName: 'Claude Code',
      targetDir: '/home/test/.claude/agents',
      targetDirExists: true,
      expectedCount: 16,
      missing: [],
    };

    expect(formatSubagentWarning([complete])).toBeNull();
    expect(formatSubagentWarning([])).toBeNull();
  });
});
