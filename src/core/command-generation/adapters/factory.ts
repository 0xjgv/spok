/**
 * Factory Droid Command Adapter
 *
 * Formats commands for Factory Droid following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { spokCommandBasename } from '../spok-command-basename.js';

/**
 * Factory adapter for command generation.
 * File path: .factory/commands/spok-<id>.md
 * Frontmatter: description, argument-hint
 */
export const factoryAdapter: ToolCommandAdapter = {
  toolId: 'factory',

  getFilePath(commandId: string): string {
    return path.join('.factory', 'commands', `${spokCommandBasename(commandId)}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
description: ${content.description}
argument-hint: command arguments
---

${content.body}
`;
  },
};
