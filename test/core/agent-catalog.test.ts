import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { extractFrontmatter } from '../helpers/frontmatter';

const AGENT_ASSETS = path.resolve('assets/agents');
const EXPECTED_AGENTS = [
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
const WRITABLE_AGENTS = new Set<string>([
  'spok-codebase-simplifier',
  'spok-implementer-agent',
  'spok-outline-implementer-agent',
]);
const LEGACY_ASSUMPTIONS = [
  /riptide/iu,
  /humanlayer/iu,
  /thoughts\/shared/iu,
  /\.humanlayer/iu,
  /claude\.md/iu,
  /subagent_type/iu,
];

interface ClaudeFrontmatter {
  name?: unknown;
  description?: unknown;
  model?: unknown;
  tools?: unknown;
}

interface CodexAgent {
  name?: unknown;
  description?: unknown;
  developer_instructions?: unknown;
  model?: unknown;
  model_reasoning_effort?: unknown;
  sandbox_mode?: unknown;
}

async function agentNames(directory: string, extension: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((filename) => filename.endsWith(extension))
    .map((filename) => filename.slice(0, -extension.length))
    .sort();
}

function expectHostNeutral(content: string, filename: string): void {
  for (const pattern of LEGACY_ASSUMPTIONS) {
    expect(content, filename).not.toMatch(pattern);
  }
}

function parseCodexAgent(filename: string): CodexAgent {
  const script = [
    'const filename = process.argv[1];',
    'const content = await Bun.file(filename).text();',
    'console.log(JSON.stringify(Bun.TOML.parse(content)));',
  ].join(' ');
  const output = execFileSync('bun', ['-e', script, filename], { encoding: 'utf8' });
  return JSON.parse(output) as CodexAgent;
}

describe('Spok agent catalog', () => {
  it('keeps the Claude and Codex catalogs in parity', async () => {
    const claudeNames = await agentNames(path.join(AGENT_ASSETS, 'claude'), '.md');
    const codexNames = await agentNames(path.join(AGENT_ASSETS, 'codex'), '.toml');

    expect(claudeNames).toEqual(EXPECTED_AGENTS);
    expect(claudeNames).toEqual(codexNames);
    expect(claudeNames.every((name) => name.startsWith('spok-'))).toBe(true);
  });

  it('uses valid native definitions that inherit the caller model', async () => {
    const names = await agentNames(path.join(AGENT_ASSETS, 'claude'), '.md');

    for (const name of names) {
      const claudeFile = path.join(AGENT_ASSETS, 'claude', `${name}.md`);
      const claudeContent = await readFile(claudeFile, 'utf8');
      const claude = parseYaml(extractFrontmatter(claudeContent)) as ClaudeFrontmatter;

      expect(claude.name, claudeFile).toBe(name);
      expect(claude.description, claudeFile).toEqual(expect.any(String));
      expect(claude.tools, claudeFile).toEqual(expect.any(String));
      expect(claude.tools, claudeFile).not.toMatch(/\bAgent\b/u);
      if (WRITABLE_AGENTS.has(name)) {
        expect(claude.tools, claudeFile).toMatch(/\bEdit\b/u);
      } else {
        expect(claude.tools, claudeFile).not.toMatch(/\b(?:Bash|Edit|Write)\b/u);
      }
      expect(claude, claudeFile).not.toHaveProperty('model');
      expect(claudeContent.slice(claudeContent.indexOf('\n---', 4) + 4).trim(), claudeFile)
        .not.toBe('');
      expect(claudeContent, claudeFile).toMatch(/(?:do not|never) (?:delegate|spawn)/iu);
      expectHostNeutral(claudeContent, claudeFile);

      const codexFile = path.join(AGENT_ASSETS, 'codex', `${name}.toml`);
      const codexContent = await readFile(codexFile, 'utf8');
      const codex = parseCodexAgent(codexFile);

      expect(codex.name, codexFile).toBe(name);
      expect(codex.description, codexFile).toEqual(expect.any(String));
      expect(codex.developer_instructions, codexFile).toEqual(expect.any(String));
      expect(codex.sandbox_mode, codexFile)
        .toBe(WRITABLE_AGENTS.has(name) ? 'workspace-write' : 'read-only');
      expect(codex, codexFile).not.toHaveProperty('model');
      expect(codex, codexFile).not.toHaveProperty('model_reasoning_effort');
      expect(codex.developer_instructions, codexFile)
        .toMatch(/(?:do not|never) (?:delegate|spawn)/iu);
      expectHostNeutral(codexContent, codexFile);
    }
  });
});
