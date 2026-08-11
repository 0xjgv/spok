/**
 * Read-only readiness probe for Spok-managed native agents.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getManagedAgentNames,
  getManagedAgentTargetDir,
  isManagedAgentToolId,
  type ManagedAgentToolId,
} from './agent-vendor.js';

interface AgentToolDefinition {
  displayName: string;
  extension: '.md' | '.toml';
}

const TOOL_DEFINITIONS: Record<ManagedAgentToolId, AgentToolDefinition> = {
  claude: {
    displayName: 'Claude Code',
    extension: '.md',
  },
  codex: {
    displayName: 'Codex',
    extension: '.toml',
  },
};

export interface SubagentCheckOptions {
  homeDir?: string;
  sourceDir?: string;
}

export interface SubagentCheckResult {
  toolId: ManagedAgentToolId;
  displayName: string;
  targetDir: string;
  targetDirExists: boolean;
  expectedCount: number;
  missing: string[];
}

function selectSupportedTools(toolIds: readonly string[]): ManagedAgentToolId[] {
  const selected = new Set<ManagedAgentToolId>();
  for (const toolId of toolIds) {
    if (isManagedAgentToolId(toolId)) selected.add(toolId);
  }
  return [...selected];
}

export async function checkSubagentReadiness(
  toolIds: readonly string[],
  options: SubagentCheckOptions = {}
): Promise<SubagentCheckResult[]> {
  const selectedTools = selectSupportedTools(toolIds);
  if (selectedTools.length === 0) return [];

  const names = await getManagedAgentNames(options.sourceDir);
  const homeDir = options.homeDir ?? os.homedir();

  return selectedTools.map((toolId) => {
    const definition = TOOL_DEFINITIONS[toolId];
    const targetDir = getManagedAgentTargetDir(toolId, homeDir);
    const expectedFiles = names.map((name) => `${name}${definition.extension}`);
    const missing = expectedFiles.filter(
      (filename) => !fs.existsSync(path.join(targetDir, filename))
    );

    return {
      toolId,
      displayName: definition.displayName,
      targetDir,
      targetDirExists: fs.existsSync(targetDir),
      expectedCount: expectedFiles.length,
      missing,
    };
  });
}

export function formatSubagentWarning(
  results: readonly SubagentCheckResult[]
): string | null {
  const incomplete = results.filter((result) => result.missing.length > 0);
  if (incomplete.length === 0) return null;

  return incomplete.map((result) => [
    `Missing Spok agents for ${result.displayName}`,
    `  Missing ${result.missing.length} of ${result.expectedCount}: ${result.missing.join(', ')}`,
    `  Expected in: ${result.targetDir}`,
    `  Run: spok skills install --tools ${result.toolId}`,
    `  Then start a fresh ${result.displayName} session.`,
  ].join('\n')).join('\n\n');
}
