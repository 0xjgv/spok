/**
 * Shared parsing for CLI tool-selection arguments.
 */

import { getToolsWithSkillsDir } from './shared/index.js';

export function parseToolsSelectionArg(toolsArg: string | undefined): string[] | null {
  if (typeof toolsArg === 'undefined') {
    return null;
  }

  const raw = toolsArg.trim();
  if (raw.length === 0) {
    throw new Error(
      'The --tools option requires a value. Use "all", "none", or a comma-separated list of tool IDs.'
    );
  }

  const availableTools = getToolsWithSkillsDir();
  const availableSet = new Set(availableTools);
  const availableList = ['all', 'none', ...availableTools].join(', ');

  const lowerRaw = raw.toLowerCase();
  if (lowerRaw === 'all') {
    return availableTools;
  }

  if (lowerRaw === 'none') {
    return [];
  }

  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new Error(
      'The --tools option requires at least one tool ID when not using "all" or "none".'
    );
  }

  const normalizedTokens = tokens.map((token) => token.toLowerCase());

  if (normalizedTokens.some((token) => token === 'all' || token === 'none')) {
    throw new Error('Cannot combine reserved values "all" or "none" with specific tool IDs.');
  }

  const invalidTokens = tokens.filter(
    (_token, index) => !availableSet.has(normalizedTokens[index])
  );

  if (invalidTokens.length > 0) {
    throw new Error(
      `Invalid tool(s): ${invalidTokens.join(', ')}. Available values: ${availableList}`
    );
  }

  const deduped: string[] = [];
  for (const token of normalizedTokens) {
    if (!deduped.includes(token)) {
      deduped.push(token);
    }
  }

  return deduped;
}
