/**
 * Subagent Probe
 *
 * Some vendored Spok skills (notably `spok-implement-plan`) invoke custom
 * subagents that ship with the user's Claude Code installation rather than as
 * Spok-managed files. This module probes `~/.claude/agents/` for those custom
 * subagents and reports which are missing so the CLI can warn the user.
 *
 * Built-in Claude Code subagents (`general-purpose`, `codebase-locator`,
 * `codebase-analyzer`, etc.) are always treated as present and never warned
 * about.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const BUILTIN_SUBAGENTS = new Set<string>([
  'general-purpose',
  'ai-engineer',
  'architect',
  'claude',
  'claude-code-guide',
  'codebase-analyzer',
  'codebase-locator',
  'codebase-pattern-finder',
  'codebase-simplifier',
  'designer',
  'engineer',
  'explore',
  'plan',
  'product',
  'qa',
  'reverse-engineer',
  'security-engineer',
  'statusline-setup',
  'web-search-researcher',
]);

const REQUIRED_CUSTOM_SUBAGENTS: readonly string[] = [
  'implementer-agent',
];

export interface SubagentCheckResult {
  toolId: 'claude';
  missing: string[];
  checkedDir: string;
  agentsDirExists: boolean;
}

export function isBuiltinSubagent(name: string): boolean {
  return BUILTIN_SUBAGENTS.has(name);
}

function agentFileExists(agentsDir: string, name: string): boolean {
  const candidates = [`${name}.md`, `${name}.markdown`];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(agentsDir, candidate))) {
      return true;
    }
  }
  return false;
}

/**
 * Probe Claude Code's `~/.claude/agents/` directory for custom subagents
 * referenced by vendored Spok skills. Returns the list of missing custom
 * subagents so the caller can surface a warning.
 */
export function checkClaudeSubagents(
  homedir: string = os.homedir()
): SubagentCheckResult {
  const agentsDir = path.join(homedir, '.claude', 'agents');
  const agentsDirExists = fs.existsSync(agentsDir);
  const missing: string[] = [];

  for (const name of REQUIRED_CUSTOM_SUBAGENTS) {
    if (BUILTIN_SUBAGENTS.has(name)) continue;
    if (!agentsDirExists || !agentFileExists(agentsDir, name)) {
      missing.push(name);
    }
  }

  return {
    toolId: 'claude',
    missing,
    checkedDir: agentsDir,
    agentsDirExists,
  };
}

export function formatSubagentWarning(result: SubagentCheckResult): string | null {
  if (result.missing.length === 0) return null;
  const lines: string[] = [];
  lines.push(`Missing custom Claude subagent(s): ${result.missing.join(', ')}`);
  lines.push(`  Expected in: ${result.checkedDir}`);
  lines.push('  Some Spok skills (e.g. spok-implement-plan) may fall back to general-purpose.');
  return lines.join('\n');
}
