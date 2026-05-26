/**
 * Crush Command Adapter
 *
 * Formats commands for Crush following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { spokCommandBasename } from '../spok-command-basename.js';

/**
 * Crush adapter for command generation.
 * File path: .crush/commands/spok-<id>.md
 * Frontmatter: name, description, category, tags
 */
export const crushAdapter: ToolCommandAdapter = {
  toolId: 'crush',

  getFilePath(commandId: string): string {
    return path.join('.crush', 'commands', `${spokCommandBasename(commandId)}.md`);
  },

  formatFile(content: CommandContent): string {
    const tagsStr = content.tags.join(', ');
    return `---
name: ${content.name}
description: ${content.description}
category: ${content.category}
tags: [${tagsStr}]
---

${content.body}
`;
  },
};
