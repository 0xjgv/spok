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
