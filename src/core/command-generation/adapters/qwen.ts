/**
 * Qwen Code Command Adapter
 *
 * Formats commands for Qwen Code following its TOML specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { spokCommandBasename } from '../spok-command-basename.js';

/**
 * Qwen adapter for command generation.
 * File path: .qwen/commands/spok-<id>.toml
 * Format: TOML with description and prompt fields
 */
export const qwenAdapter: ToolCommandAdapter = {
  toolId: 'qwen',

  getFilePath(commandId: string): string {
    return path.join('.qwen', 'commands', `${spokCommandBasename(commandId)}.toml`);
  },

  formatFile(content: CommandContent): string {
    return `description = "${content.description}"

prompt = """
${content.body}
"""
`;
  },
};
