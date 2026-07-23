import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'assets/skills');

async function readSkill(skill: string): Promise<string> {
  return fs.readFile(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf-8');
}

describe('artifact grounding rules in skill assets', () => {
  describe('spok-create-research-questions', () => {
    it('makes the repository tooling question mandatory for every run', async () => {
      const body = await readSkill('spok-create-research-questions');

      expect(body).toContain('MANDATORY — every run must include this question');
      expect(body).toContain(
        "what are this repository's actual lint, typecheck, test, and format commands?",
      );
    });

    it('names the manifest as the evidence source and forbids inference', async () => {
      const body = await readSkill('spok-create-research-questions');

      expect(body).toContain('`package.json` scripts, `Makefile` targets, or the equivalent');
      expect(body).toContain('never inferred from a toolchain name');
    });

    it('states the mandatory question counts toward the question cap', async () => {
      const body = await readSkill('spok-create-research-questions');

      expect(body).toContain(
        'The mandatory question counts toward the maximum number of questions.',
      );
    });
  });

  describe('spok-create-plan', () => {
    it('requires verification commands to come from the manifest or research', async () => {
      const body = await readSkill('spok-create-plan');

      expect(body).toContain(
        "Every automated-verification command must come from the repository's manifest",
      );
      expect(body).toContain('or from `research.md`');
      expect(body).toContain('Never name a command from a toolchain guess');
    });

    it('forbids hedging when research did not establish the commands', async () => {
      const body = await readSkill('spok-create-plan');

      expect(body).toContain('If research did not establish the commands, say so plainly');
      expect(body).toContain('Do not hedge with a conditional like "if configured"');
    });
  });

  describe('spok-implement-plan', () => {
    it('limits reporting to checks actually executed', async () => {
      const body = await readSkill('spok-implement-plan');

      expect(body).toContain('Report only checks you actually executed.');
      expect(body).toContain('the exact command you ran and its real output');
    });

    it('requires disclosing a plan-named command the repository lacks', async () => {
      const body = await readSkill('spok-implement-plan');

      expect(body).toContain(
        'If the plan names a command that does not exist in this repository, say so',
      );
      expect(body).toContain('never substitute a different command silently');
      expect(body).toContain('never report the named command as passing');
    });
  });

  describe('spok-flow', () => {
    it('forbids relaying unattributed verification claims into the summary', async () => {
      const body = await readSkill('spok-flow');

      expect(body).toContain(
        'Do not relay a verification claim that cannot be attributed to a command that ran',
      );
      expect(body).toContain('drop the claim from the summary');
    });
  });

  describe('spok-ci-commit', () => {
    it('forbids staging paths the agent did not modify', async () => {
      const body = await readSkill('spok-ci-commit');

      expect(body).toContain('Never stage a path you did not modify');
      expect(body).toContain('other agents may be working in this repository concurrently');
    });

    it('requires a gitignore check before listing expected files', async () => {
      const body = await readSkill('spok-ci-commit');

      expect(body).toContain('Never treat a gitignored path as committable');
      expect(body).toContain('`git check-ignore`');
    });
  });
});

describe("Spok's own project context", () => {
  it('states that verification commands are read from package.json scripts', async () => {
    const raw = await fs.readFile(path.join(REPO_ROOT, 'spok/config.yaml'), 'utf-8');
    const context = (parseYaml(raw) as { context?: string }).context ?? '';

    expect(context).toContain('Read verification commands from package.json scripts');
  });

  it('names the gitignored vendor targets', async () => {
    const raw = await fs.readFile(path.join(REPO_ROOT, 'spok/config.yaml'), 'utf-8');
    const context = (parseYaml(raw) as { context?: string }).context ?? '';

    expect(context).toContain('.claude/ and .agents/ are gitignored vendor targets');
  });

  it('carries no point-in-time dependency versions', async () => {
    const raw = await fs.readFile(path.join(REPO_ROOT, 'spok/config.yaml'), 'utf-8');
    const context = (parseYaml(raw) as { context?: string }).context ?? '';

    expect(context).not.toMatch(/\d+\.\d+\.\d+/);
    expect(context).not.toMatch(/\^\d/);
  });
});
