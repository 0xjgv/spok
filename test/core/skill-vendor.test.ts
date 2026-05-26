import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  installVendoredSkills,
  getVendoredSkillNames,
} from '../../src/core/skill-vendor.js';

describe('skill-vendor', () => {
  let tempDir: string;
  let sourceDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spok-vendor-test-'));
    sourceDir = path.join(tempDir, 'assets', 'skills');
    fs.mkdirSync(sourceDir, { recursive: true });

    fs.mkdirSync(path.join(sourceDir, 'spok-flow'), { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'spok-flow', 'SKILL.md'),
      '# spok-flow\n'
    );

    fs.mkdirSync(path.join(sourceDir, 'spok-helper'), { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'spok-helper', 'SKILL.md'),
      '# spok-helper\n'
    );
    fs.writeFileSync(
      path.join(sourceDir, 'spok-helper', 'extra.md'),
      'extra resource\n'
    );

    fs.mkdirSync(path.join(sourceDir, 'not-spok'), { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'not-spok', 'SKILL.md'),
      'should be ignored\n'
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getVendoredSkillNames', () => {
    it('returns spok-prefixed skill directory names', () => {
      const names = getVendoredSkillNames(sourceDir);
      expect(names).toEqual(['spok-flow', 'spok-helper']);
    });

    it('returns empty array when source directory is missing', () => {
      expect(getVendoredSkillNames(path.join(tempDir, 'does-not-exist'))).toEqual([]);
    });
  });

  describe('installVendoredSkills', () => {
    it('copies vendored skills into <projectRoot>/<toolSkillsDir>/skills', async () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      const result = await installVendoredSkills(projectRoot, '.claude', sourceDir);

      expect(result.skipped).toBe(false);
      expect(result.installedSkills).toEqual(['spok-flow', 'spok-helper']);

      expect(
        fs.existsSync(path.join(projectRoot, '.claude/skills/spok-flow/SKILL.md'))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectRoot, '.claude/skills/spok-helper/SKILL.md'))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectRoot, '.claude/skills/spok-helper/extra.md'))
      ).toBe(true);
    });

    it('does not copy non-spok directories', async () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      await installVendoredSkills(projectRoot, '.claude', sourceDir);

      expect(
        fs.existsSync(path.join(projectRoot, '.claude/skills/not-spok'))
      ).toBe(false);
    });

    it('is idempotent — re-running overwrites existing files', async () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      await installVendoredSkills(projectRoot, '.claude', sourceDir);

      const flowSkillPath = path.join(
        projectRoot,
        '.claude/skills/spok-flow/SKILL.md'
      );
      fs.writeFileSync(flowSkillPath, 'TAMPERED\n');
      expect(fs.readFileSync(flowSkillPath, 'utf-8')).toBe('TAMPERED\n');

      await installVendoredSkills(projectRoot, '.claude', sourceDir);

      expect(fs.readFileSync(flowSkillPath, 'utf-8')).toBe('# spok-flow\n');
    });

    it('removes stale files no longer present in source', async () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      await installVendoredSkills(projectRoot, '.claude', sourceDir);

      const staleFile = path.join(
        projectRoot,
        '.claude/skills/spok-helper/stale.md'
      );
      fs.writeFileSync(staleFile, 'leftover from prior version\n');
      expect(fs.existsSync(staleFile)).toBe(true);

      await installVendoredSkills(projectRoot, '.claude', sourceDir);

      expect(fs.existsSync(staleFile)).toBe(false);
    });

    it('returns skipped result when source dir is missing', async () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      const result = await installVendoredSkills(
        projectRoot,
        '.claude',
        path.join(tempDir, 'does-not-exist')
      );

      expect(result.skipped).toBe(true);
      expect(result.installedSkills).toEqual([]);
    });

    it('writes into the requested tool skills dir', async () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      await installVendoredSkills(projectRoot, '.cursor', sourceDir);

      expect(
        fs.existsSync(path.join(projectRoot, '.cursor/skills/spok-flow/SKILL.md'))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectRoot, '.claude/skills/spok-flow/SKILL.md'))
      ).toBe(false);
    });
  });
});
