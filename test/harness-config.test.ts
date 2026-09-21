import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const LEGACY_HOOKS = [
  'ups-classify.sh',
  'pre-bash-gate.sh',
  'pre-edit-gate.sh',
] as const;

describe('repository Claude hooks', () => {
  it('keeps deterministic Stop feedback without legacy approval gates', async () => {
    const settings = JSON.parse(
      await readFile(path.join(ROOT, '.claude/settings.json'), 'utf8'),
    ) as { hooks?: Record<string, unknown> };

    expect(settings.hooks?.UserPromptSubmit).toBeUndefined();
    expect(settings.hooks?.PreToolUse).toBeUndefined();
    expect(JSON.stringify(settings.hooks?.Stop)).toContain('post-edit');

    for (const script of LEGACY_HOOKS) {
      await expect(access(path.join(ROOT, '.claude/scripts', script))).rejects.toThrow();
    }

    const instructions = await readFile(path.join(ROOT, 'AGENTS.md'), 'utf8');
    expect(instructions).not.toContain('PreToolUse');
  });
});

describe('harness pre-commit gate', () => {
  it('covers staged skill assets with the skill test targets', async () => {
    const harness = await readFile(path.join(ROOT, 'harness.ts'), 'utf8');

    // Staged-file filter reaches skill/agent prose, not just TypeScript.
    expect(harness).toContain("'assets/skills'");
    expect(harness).toContain("'assets/agents'");

    // Targeted suites that assert on that prose.
    expect(harness).toContain("'test/skills'");
    expect(harness).toContain("'test/package-assets.test.ts'");

    const sliceBody = (name: string): string => {
      const start = harness.indexOf(`async function ${name}(`);
      expect(start).toBeGreaterThan(-1);
      return harness.slice(start, harness.indexOf('\nasync function ', start + 1));
    };

    const skillTests = sliceBody('cmdSkillTests');
    expect(skillTests).toContain('vitest');
    expect(skillTests).toContain('SKILL_TEST_TARGETS');

    const preCommit = sliceBody('cmdPreCommit');
    expect(preCommit).toContain('isSkillAsset');
    expect(preCommit).toContain('isSkillTest');
    expect(preCommit).toContain('cmdSkillTests');
    expect(preCommit).toContain('skipping checks');
  });
});
