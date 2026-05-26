/**
 * CodeBuddy Command Adapter
 *
 * Formats commands for CodeBuddy following its frontmatter specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { spokCommandBasename } from '../spok-command-basename.js';

/**
 * CodeBuddy adapter for command generation.
 * File path: .codebuddy/commands/spok-<id>.md
 * Frontmatter: name, description, argument-hint
 */
export const codebuddyAdapter: ToolCommandAdapter = {
  toolId: 'codebuddy',

  getFilePath(commandId: string): string {
    return path.join('.codebuddy', 'commands', `${spokCommandBasename(commandId)}.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
name: ${content.name}
description: "${content.description}"
argument-hint: "[command arguments]"
---

${content.body}
`;
  },
};
