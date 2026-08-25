import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  ensureVendoredSkill,
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
    fs.mkdirSync(path.join(sourceDir, 'spok-helper', 'references'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        sourceDir,
        'spok-helper',
        'references',
        'design_evidence_template.html'
      ),
      Buffer.from('<!doctype html>\n<meta charset="utf-8">\nCurrent → Target\n')
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

    it('copies nested HTML resources byte-for-byte', async () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });
      const sourcePath = path.join(
        sourceDir,
        'spok-helper',
        'references',
        'design_evidence_template.html'
      );

      await installVendoredSkills(projectRoot, '.claude', sourceDir);

      const installedPath = path.join(
        projectRoot,
        '.claude',
        'skills',
        'spok-helper',
        'references',
        'design_evidence_template.html'
      );
      expect(fs.readFileSync(installedPath)).toEqual(fs.readFileSync(sourcePath));
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

  describe('ensureVendoredSkill', () => {
    let projectRoot: string;
    let homeDir: string;

    beforeEach(() => {
      projectRoot = path.join(tempDir, 'project');
      homeDir = path.join(tempDir, 'home');
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.mkdirSync(homeDir, { recursive: true });
    });

    it('returns present without touching an existing project-local skill', async () => {
      const marker = path.join(projectRoot, '.claude/skills/spok-flow/SKILL.md');
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, '# pinned local copy\n');

      const result = await ensureVendoredSkill(projectRoot, '.claude', 'spok-flow', {
        sourceDir,
        homeDir,
      });

      expect(result.status).toBe('present');
      expect(result.skillPath).toBe(marker);
      expect(fs.readFileSync(marker, 'utf-8')).toBe('# pinned local copy\n');
    });

    it('materializes a missing skill from the distribution into the project', async () => {
      const result = await ensureVendoredSkill(projectRoot, '.agents', 'spok-helper', {
        sourceDir,
        homeDir,
      });

      expect(result.status).toBe('materialized');
      const skillDir = path.join(projectRoot, '.agents/skills/spok-helper');
      expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
      expect(
        fs.existsSync(path.join(skillDir, 'references/design_evidence_template.html'))
      ).toBe(true);

      const again = await ensureVendoredSkill(projectRoot, '.agents', 'spok-helper', {
        sourceDir,
        homeDir,
      });
      expect(again.status).toBe('present');
    });

    it('replaces a non-empty project skill directory without a marker', async () => {
      const skillDir = path.join(projectRoot, '.agents/skills/spok-helper');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'stale.md'), 'incomplete install\n');

      const result = await ensureVendoredSkill(projectRoot, '.agents', 'spok-helper', {
        sourceDir,
        homeDir,
      });

      expect(result.status).toBe('materialized');
      expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(skillDir, 'stale.md'))).toBe(false);
    });

    it('reports a concurrent materialization winner as present', async () => {
      const results = await Promise.all([
        ensureVendoredSkill(projectRoot, '.agents', 'spok-helper', { sourceDir, homeDir }),
        ensureVendoredSkill(projectRoot, '.agents', 'spok-helper', { sourceDir, homeDir }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        'materialized',
        'present',
      ]);
    });

    it('falls back to a global install when the distribution lacks the skill', async () => {
      const globalMarker = path.join(homeDir, '.claude/skills/spok-mystery/SKILL.md');
      fs.mkdirSync(path.dirname(globalMarker), { recursive: true });
      fs.writeFileSync(globalMarker, '# global\n');

      const result = await ensureVendoredSkill(projectRoot, '.claude', 'spok-mystery', {
        sourceDir,
        homeDir,
      });

      expect(result.status).toBe('present');
      expect(result.skillPath).toBe(globalMarker);
    });

    it('falls back to a global install when project materialization fails', async () => {
      const globalMarker = path.join(homeDir, '.claude/skills/spok-flow/SKILL.md');
      fs.mkdirSync(path.dirname(globalMarker), { recursive: true });
      fs.writeFileSync(globalMarker, '# global\n');
      fs.writeFileSync(path.join(projectRoot, '.claude'), 'not a directory');

      const result = await ensureVendoredSkill(projectRoot, '.claude', 'spok-flow', {
        sourceDir,
        homeDir,
      });

      expect(result).toEqual({ status: 'present', skillPath: globalMarker });
    });

    it('reports unavailable when no source can provide the skill', async () => {
      const result = await ensureVendoredSkill(projectRoot, '.claude', 'spok-mystery', {
        sourceDir,
        homeDir,
      });

      expect(result.status).toBe('unavailable');
      expect(result.reason).toContain('spok-mystery');
    });

    it('reports unavailable when materialization cannot write into the project', async () => {
      fs.writeFileSync(path.join(projectRoot, '.claude'), 'not a directory');

      const result = await ensureVendoredSkill(projectRoot, '.claude', 'spok-flow', {
        sourceDir,
        homeDir,
      });

      expect(result.status).toBe('unavailable');
      expect(result.reason).toContain('spok-flow');
    });
  });
});
