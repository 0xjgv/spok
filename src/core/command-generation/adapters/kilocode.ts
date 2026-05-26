/**
 * Kilo Code Command Adapter
 *
 * Formats commands for Kilo Code following its workflow specification.
 * Kilo Code workflows don't use frontmatter.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { spokCommandBasename } from '../spok-command-basename.js';

/**
 * Kilo Code adapter for command generation.
 * File path: .kilocode/workflows/spok-<id>.md
 * Format: Plain markdown without frontmatter
 */
export const kilocodeAdapter: ToolCommandAdapter = {
  toolId: 'kilocode',

  getFilePath(commandId: string): string {
    return path.join('.kilocode', 'workflows', `${spokCommandBasename(commandId)}.md`);
  },

  formatFile(content: CommandContent): string {
    return `${content.body}
`;
  },
};
