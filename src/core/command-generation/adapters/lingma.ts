/**
 * Lingma Command Adapter
 *
 * Formats commands for Lingma following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { spokCommandBasename } from '../spok-command-basename.js';

/**
 * Lingma adapter for command generation.
 * File path: .lingma/commands/spok-<id>.md
 * Frontmatter: name, description, category, tags
 */
export const lingmaAdapter: ToolCommandAdapter = {
  toolId: 'lingma',

  getFilePath(commandId: string): string {
    return path.join('.lingma', 'commands', `${spokCommandBasename(commandId)}.md`);
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
