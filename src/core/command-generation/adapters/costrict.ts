/**
 * CoStrict Command Adapter
 *
 * Formats commands for CoStrict following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { spokCommandBasename } from '../spok-command-basename.js';

/**
 * CoStrict adapter for command generation.
 * File path: .cospec/spok/commands/spok-<id>.md
 * Frontmatter: description, argument-hint
 */
export const costrictAdapter: ToolCommandAdapter = {
  toolId: 'costrict',

  getFilePath(commandId: string): string {
    return path.join('.cospec', 'spok', 'commands', `${spokCommandBasename(commandId)}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
description: "${content.description}"
argument-hint: command arguments
---

${content.body}
`;
  },
};
