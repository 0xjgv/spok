/**
 * GitHub Copilot Command Adapter
 *
 * Formats commands for GitHub Copilot following its .prompt.md specification.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { spokCommandBasename } from '../spok-command-basename.js';

/**
 * GitHub Copilot adapter for command generation.
 * File path: .github/prompts/spok-<id>.prompt.md
 * Frontmatter: description
 */
export const githubCopilotAdapter: ToolCommandAdapter = {
  toolId: 'github-copilot',

  getFilePath(commandId: string): string {
    return path.join('.github', 'prompts', `${spokCommandBasename(commandId)}.prompt.md`);
  },

  formatFile(content: CommandContent): string {
    return `---
description: ${content.description}
---

${content.body}
`;
  },
};
