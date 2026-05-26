import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  checkClaudeSubagents,
  formatSubagentWarning,
  isBuiltinSubagent,
} from '../../src/core/subagent-check.js';

describe('subagent-check', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spok-subagent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  describe('isBuiltinSubagent', () => {
    it('treats general-purpose as builtin', () => {
      expect(isBuiltinSubagent('general-purpose')).toBe(true);
    });

    it('treats codebase-locator as builtin', () => {
      expect(isBuiltinSubagent('codebase-locator')).toBe(true);
    });

    it('treats unknown custom agent as non-builtin', () => {
      expect(isBuiltinSubagent('implementer-agent')).toBe(false);
    });
  });

  describe('checkClaudeSubagents', () => {
    it('reports missing custom subagent when ~/.claude/agents does not exist', () => {
      const result = checkClaudeSubagents(tempHome);

      expect(result.agentsDirExists).toBe(false);
      expect(result.missing).toContain('implementer-agent');
      expect(result.checkedDir).toBe(path.join(tempHome, '.claude', 'agents'));
    });

    it('reports missing custom subagent when file is absent', () => {
      const agentsDir = path.join(tempHome, '.claude', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(path.join(agentsDir, 'unrelated.md'), '# unrelated\n');

      const result = checkClaudeSubagents(tempHome);

      expect(result.agentsDirExists).toBe(true);
      expect(result.missing).toContain('implementer-agent');
    });

    it('reports no missing when custom subagent file exists', () => {
      const agentsDir = path.join(tempHome, '.claude', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentsDir, 'implementer-agent.md'),
        '---\nname: implementer-agent\n---\n# Implementer\n'
      );

      const result = checkClaudeSubagents(tempHome);

      expect(result.missing).toEqual([]);
    });

    it('accepts .markdown file extension', () => {
      const agentsDir = path.join(tempHome, '.claude', 'agents');
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentsDir, 'implementer-agent.markdown'),
        '# Implementer\n'
      );

      const result = checkClaudeSubagents(tempHome);

      expect(result.missing).toEqual([]);
    });
  });

  describe('formatSubagentWarning', () => {
    it('returns null when nothing is missing', () => {
      const warning = formatSubagentWarning({
        toolId: 'claude',
        missing: [],
        checkedDir: '/tmp/x',
        agentsDirExists: true,
      });

      expect(warning).toBeNull();
    });

    it('returns formatted multi-line warning when subagents missing', () => {
      const warning = formatSubagentWarning({
        toolId: 'claude',
        missing: ['implementer-agent'],
        checkedDir: '/tmp/x/.claude/agents',
        agentsDirExists: false,
      });

      expect(warning).toContain('implementer-agent');
      expect(warning).toContain('/tmp/x/.claude/agents');
    });
  });
});
