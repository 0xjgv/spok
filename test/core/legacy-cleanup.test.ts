import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import {
  detectLegacyArtifacts,
  detectLegacyConfigFiles,
  detectLegacySlashCommands,
  detectLegacyStructureFiles,
  detectRetiredSkillDirs,
  hasSpokMarkers,
  isOnlySpokContent,
  removeMarkerBlock,
  cleanupLegacyArtifacts,
  formatCleanupSummary,
  formatDetectionSummary,
  formatProjectMdMigrationHint,
  getToolsFromLegacyArtifacts,
  LEGACY_CONFIG_FILES,
  LEGACY_SLASH_COMMAND_PATHS,
  RETIRED_SKILL_DIRS,
} from '../../src/core/legacy-cleanup.js';
import { SPOK_MARKERS } from '../../src/core/config.js';
import { CommandAdapterRegistry } from '../../src/core/command-generation/registry.js';

describe('legacy-cleanup', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `spok-legacy-test-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
    // Create spok directory structure
    await fs.mkdir(path.join(testDir, 'spok'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('hasSpokMarkers', () => {
    it('should return true when both markers are present', () => {
      const content = `Some content
${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}
More content`;
      expect(hasSpokMarkers(content)).toBe(true);
    });

    it('should return false when start marker is missing', () => {
      const content = `Some content
Spok content
${SPOK_MARKERS.end}`;
      expect(hasSpokMarkers(content)).toBe(false);
    });

    it('should return false when end marker is missing', () => {
      const content = `${SPOK_MARKERS.start}
Spok content
Some content`;
      expect(hasSpokMarkers(content)).toBe(false);
    });

    it('should return false when no markers are present', () => {
      const content = 'Plain content without markers';
      expect(hasSpokMarkers(content)).toBe(false);
    });
  });

  describe('isOnlySpokContent', () => {
    it('should return true when content is only markers and whitespace outside', () => {
      const content = `${SPOK_MARKERS.start}
Spok content here
${SPOK_MARKERS.end}`;
      expect(isOnlySpokContent(content)).toBe(true);
    });

    it('should return true with whitespace before and after markers', () => {
      const content = `

${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}

`;
      expect(isOnlySpokContent(content)).toBe(true);
    });

    it('should return false when content exists before markers', () => {
      const content = `User content here
${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}`;
      expect(isOnlySpokContent(content)).toBe(false);
    });

    it('should return false when content exists after markers', () => {
      const content = `${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}
User content here`;
      expect(isOnlySpokContent(content)).toBe(false);
    });

    it('should return false when markers are missing', () => {
      const content = 'Plain content without markers';
      expect(isOnlySpokContent(content)).toBe(false);
    });

    it('should return false when end marker comes before start marker', () => {
      const content = `${SPOK_MARKERS.end}
Content
${SPOK_MARKERS.start}`;
      expect(isOnlySpokContent(content)).toBe(false);
    });
  });

  describe('removeMarkerBlock', () => {
    it('should remove marker block and preserve content before', () => {
      const content = `User content before
${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}`;
      const result = removeMarkerBlock(content);
      expect(result).toBe('User content before\n');
      expect(result).not.toContain(SPOK_MARKERS.start);
      expect(result).not.toContain(SPOK_MARKERS.end);
    });

    it('should remove marker block and preserve content after', () => {
      const content = `${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}
User content after`;
      const result = removeMarkerBlock(content);
      expect(result).toBe('User content after\n');
    });

    it('should remove marker block and preserve content before and after', () => {
      const content = `User content before
${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}
User content after`;
      const result = removeMarkerBlock(content);
      expect(result).toContain('User content before');
      expect(result).toContain('User content after');
      expect(result).not.toContain(SPOK_MARKERS.start);
    });

    it('should clean up double blank lines', () => {
      const content = `Line 1


${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}


Line 2`;
      const result = removeMarkerBlock(content);
      expect(result).not.toMatch(/\n{3,}/);
    });

    it('should return empty string when only markers remain', () => {
      const content = `${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}`;
      const result = removeMarkerBlock(content);
      expect(result).toBe('');
    });

    it('should return original content when markers are missing', () => {
      const content = 'Plain content without markers';
      const result = removeMarkerBlock(content);
      // When no markers found, content is returned trimmed (no trailing newline added)
      expect(result).toBe('Plain content without markers');
    });

    it('should return original content when markers are in wrong order', () => {
      const content = `${SPOK_MARKERS.end}
Content
${SPOK_MARKERS.start}`;
      const result = removeMarkerBlock(content);
      expect(result).toContain(SPOK_MARKERS.end);
      expect(result).toContain(SPOK_MARKERS.start);
    });

    it('should ignore inline mentions of markers and only remove actual block', () => {
      const content = `Intro referencing ${SPOK_MARKERS.start} and ${SPOK_MARKERS.end} inline.

${SPOK_MARKERS.start}
Managed content here
${SPOK_MARKERS.end}
After content`;
      const result = removeMarkerBlock(content);
      // Inline mentions preserved
      expect(result).toContain('Intro referencing');
      expect(result).toContain(SPOK_MARKERS.start);
      expect(result).toContain(SPOK_MARKERS.end);
      // Managed content removed
      expect(result).not.toContain('Managed content here');
      expect(result).toContain('After content');
    });
  });

  describe('detectLegacyConfigFiles', () => {
    it('should detect CLAUDE.md with Spok markers and put in update list', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, `${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}`);

      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).toContain('CLAUDE.md');
      // Config files are NEVER deleted, always updated (markers removed)
      expect(result.filesToUpdate).toContain('CLAUDE.md');
    });

    it('should detect files with mixed content and put in update list', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, `User instructions here
${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}`);

      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).toContain('CLAUDE.md');
      expect(result.filesToUpdate).toContain('CLAUDE.md');
    });

    it('should not detect files without Spok markers', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, 'Plain instructions without markers');

      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).not.toContain('CLAUDE.md');
    });

    it('should detect multiple config files', async () => {
      // Create multiple config files with markers
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), `${SPOK_MARKERS.start}\nContent\n${SPOK_MARKERS.end}`);
      await fs.writeFile(path.join(testDir, 'CLINE.md'), `${SPOK_MARKERS.start}\nContent\n${SPOK_MARKERS.end}`);
      await fs.writeFile(path.join(testDir, 'QODER.md'), `${SPOK_MARKERS.start}\nContent\n${SPOK_MARKERS.end}`);

      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).toHaveLength(3);
      expect(result.allFiles).toContain('CLAUDE.md');
      expect(result.allFiles).toContain('CLINE.md');
      expect(result.allFiles).toContain('QODER.md');
      // All should be in update list, none deleted
      expect(result.filesToUpdate).toHaveLength(3);
    });

    it('should handle non-existent files gracefully', async () => {
      const result = await detectLegacyConfigFiles(testDir);
      expect(result.allFiles).toHaveLength(0);
      expect(result.filesToUpdate).toHaveLength(0);
    });
  });

  describe('detectLegacySlashCommands', () => {
    it('should detect legacy Claude slash command directory', async () => {
      const dirPath = path.join(testDir, '.claude', 'commands', 'spok');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'proposal.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.directories).toContain('.claude/commands/spok');
    });

    it('should detect retired commands/opsx directory', async () => {
      const dirPath = path.join(testDir, '.claude', 'commands', 'opsx');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'propose.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.directories).toContain('.claude/commands/opsx');
    });

    it('should detect legacy Cursor slash command files', async () => {
      const dirPath = path.join(testDir, '.cursor', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'spok-proposal.md'), 'content');
      await fs.writeFile(path.join(dirPath, 'spok-apply.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.cursor/commands/spok-proposal.md');
      expect(result.files).toContain('.cursor/commands/spok-apply.md');
    });

    it('should detect legacy Windsurf workflow files', async () => {
      const dirPath = path.join(testDir, '.windsurf', 'workflows');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'spok-archive.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.windsurf/workflows/spok-archive.md');
    });

    it('should detect multiple tool directories and files', async () => {
      // Create directory-based
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'spok'), { recursive: true });
      await fs.mkdir(path.join(testDir, '.qoder', 'commands', 'spok'), { recursive: true });

      // Create file-based
      await fs.mkdir(path.join(testDir, '.cursor', 'commands'), { recursive: true });
      await fs.writeFile(path.join(testDir, '.cursor', 'commands', 'spok-proposal.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.directories).toContain('.claude/commands/spok');
      expect(result.directories).toContain('.qoder/commands/spok');
      expect(result.files).toContain('.cursor/commands/spok-proposal.md');
    });

    it('should not detect non-spok files', async () => {
      const dirPath = path.join(testDir, '.cursor', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'other-command.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).not.toContain('.cursor/commands/other-command.md');
    });

    it('should handle non-existent directories gracefully', async () => {
      const result = await detectLegacySlashCommands(testDir);
      expect(result.directories).toHaveLength(0);
      expect(result.files).toHaveLength(0);
    });

    it('should detect TOML-based slash commands for Qwen', async () => {
      const dirPath = path.join(testDir, '.qwen', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'spok-proposal.toml'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.qwen/commands/spok-proposal.toml');
    });

    it('should detect Continue prompt files', async () => {
      const dirPath = path.join(testDir, '.continue', 'prompts');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'spok-apply.prompt'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.continue/prompts/spok-apply.prompt');
    });

    it('should detect legacy OpenCode opsx-* command files', async () => {
      const dirPath = path.join(testDir, '.opencode', 'command');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'opsx-propose.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.opencode/command/opsx-propose.md');
    });

    it('should detect legacy OpenCode spok-* command files', async () => {
      const dirPath = path.join(testDir, '.opencode', 'command');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'spok-new.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.opencode/command/spok-new.md');
    });

    it('should detect both opsx-* and spok-* OpenCode command files', async () => {
      const dirPath = path.join(testDir, '.opencode', 'command');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'opsx-propose.md'), 'content');
      await fs.writeFile(path.join(dirPath, 'spok-new.md'), 'content');

      const result = await detectLegacySlashCommands(testDir);
      expect(result.files).toContain('.opencode/command/opsx-propose.md');
      expect(result.files).toContain('.opencode/command/spok-new.md');
    });
  });

  describe('detectLegacyStructureFiles', () => {
    it('should detect spok/AGENTS.md', async () => {
      const agentsPath = path.join(testDir, 'spok', 'AGENTS.md');
      await fs.writeFile(agentsPath, '# AGENTS.md content');

      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasOpenspecAgents).toBe(true);
    });

    it('should detect spok/project.md', async () => {
      const projectPath = path.join(testDir, 'spok', 'project.md');
      await fs.writeFile(projectPath, '# Project content');

      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasProjectMd).toBe(true);
    });

    it('should detect root AGENTS.md with Spok markers', async () => {
      const agentsPath = path.join(testDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, `${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}`);

      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasRootAgentsWithMarkers).toBe(true);
    });

    it('should not detect root AGENTS.md without markers', async () => {
      const agentsPath = path.join(testDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, 'Plain content without markers');

      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasRootAgentsWithMarkers).toBe(false);
    });

    it('should handle non-existent files gracefully', async () => {
      const result = await detectLegacyStructureFiles(testDir);
      expect(result.hasOpenspecAgents).toBe(false);
      expect(result.hasProjectMd).toBe(false);
      expect(result.hasRootAgentsWithMarkers).toBe(false);
    });
  });

  describe('detectLegacyArtifacts', () => {
    it('should return hasLegacyArtifacts: false when nothing is found', async () => {
      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(false);
    });

    it('should return hasLegacyArtifacts: true when config files are found', async () => {
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), `${SPOK_MARKERS.start}\nContent\n${SPOK_MARKERS.end}`);

      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.configFiles).toContain('CLAUDE.md');
    });

    it('should return hasLegacyArtifacts: true when slash commands are found', async () => {
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'spok'), { recursive: true });

      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.slashCommandDirs).toContain('.claude/commands/spok');
    });

    it('should return hasLegacyArtifacts: true when spok/AGENTS.md is found', async () => {
      await fs.writeFile(path.join(testDir, 'spok', 'AGENTS.md'), 'content');

      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.hasOpenspecAgents).toBe(true);
    });

    it('should detect project.md for migration hint (it is preserved, not deleted)', async () => {
      await fs.writeFile(path.join(testDir, 'spok', 'project.md'), 'content');

      const result = await detectLegacyArtifacts(testDir);
      // project.md triggers hasLegacyArtifacts to show migration hint
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.hasProjectMd).toBe(true);
    });

    it('should combine all detection results', async () => {
      // Create various legacy artifacts
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), `${SPOK_MARKERS.start}\nContent\n${SPOK_MARKERS.end}`);
      await fs.mkdir(path.join(testDir, '.claude', 'commands', 'spok'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'spok', 'AGENTS.md'), 'content');
      await fs.writeFile(path.join(testDir, 'spok', 'project.md'), 'content');

      const result = await detectLegacyArtifacts(testDir);
      expect(result.hasLegacyArtifacts).toBe(true);
      expect(result.configFiles).toContain('CLAUDE.md');
      expect(result.slashCommandDirs).toContain('.claude/commands/spok');
      expect(result.hasOpenspecAgents).toBe(true);
      expect(result.hasProjectMd).toBe(true);
    });
  });

  describe('cleanupLegacyArtifacts', () => {
    it('should remove markers from config files that have only Spok content (never delete)', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, `${SPOK_MARKERS.start}\nContent\n${SPOK_MARKERS.end}`);

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      // Config files should NEVER be deleted, only have markers removed
      expect(result.deletedFiles).not.toContain('CLAUDE.md');
      expect(result.modifiedFiles).toContain('CLAUDE.md');
      // File should still exist
      await expect(fs.access(claudePath)).resolves.not.toThrow();
      // File should be empty or have markers removed
      const content = await fs.readFile(claudePath, 'utf-8');
      expect(content).not.toContain(SPOK_MARKERS.start);
      expect(content).not.toContain(SPOK_MARKERS.end);
    });

    it('should remove marker block from files with mixed content', async () => {
      const claudePath = path.join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudePath, `User instructions
${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}`);

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.modifiedFiles).toContain('CLAUDE.md');
      const content = await fs.readFile(claudePath, 'utf-8');
      expect(content).toContain('User instructions');
      expect(content).not.toContain(SPOK_MARKERS.start);
    });

    it('should delete legacy slash command directories', async () => {
      const dirPath = path.join(testDir, '.claude', 'commands', 'spok');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'proposal.md'), 'content');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedDirs).toContain('.claude/commands/spok');
      await expect(fs.access(dirPath)).rejects.toThrow();
      // Parent directory should still exist
      await expect(fs.access(path.join(testDir, '.claude', 'commands'))).resolves.not.toThrow();
    });

    it('should delete legacy slash command files', async () => {
      const dirPath = path.join(testDir, '.cursor', 'commands');
      await fs.mkdir(dirPath, { recursive: true });
      const filePath = path.join(dirPath, 'spok-proposal.md');
      await fs.writeFile(filePath, 'content');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedFiles).toContain('.cursor/commands/spok-proposal.md');
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should delete spok/AGENTS.md', async () => {
      const agentsPath = path.join(testDir, 'spok', 'AGENTS.md');
      await fs.writeFile(agentsPath, 'content');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.deletedFiles).toContain('spok/AGENTS.md');
      await expect(fs.access(agentsPath)).rejects.toThrow();
      // spok directory should still exist
      await expect(fs.access(path.join(testDir, 'spok'))).resolves.not.toThrow();
    });

    it('should NOT delete spok/project.md', async () => {
      const projectPath = path.join(testDir, 'spok', 'project.md');
      await fs.writeFile(projectPath, 'User project content');

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.projectMdNeedsMigration).toBe(true);
      expect(result.deletedFiles).not.toContain('spok/project.md');
      await expect(fs.access(projectPath)).resolves.not.toThrow();
    });

    it('should handle root AGENTS.md with mixed content', async () => {
      const agentsPath = path.join(testDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, `User content
${SPOK_MARKERS.start}
Spok content
${SPOK_MARKERS.end}`);

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      expect(result.modifiedFiles).toContain('AGENTS.md');
      const content = await fs.readFile(agentsPath, 'utf-8');
      expect(content).toContain('User content');
      expect(content).not.toContain(SPOK_MARKERS.start);
    });

    it('should remove markers from root AGENTS.md even when only Spok content (never delete)', async () => {
      const agentsPath = path.join(testDir, 'AGENTS.md');
      await fs.writeFile(agentsPath, `${SPOK_MARKERS.start}\nSpok content\n${SPOK_MARKERS.end}`);

      const detection = await detectLegacyArtifacts(testDir);
      const result = await cleanupLegacyArtifacts(testDir, detection);

      // Root AGENTS.md should NEVER be deleted, only have markers removed
      expect(result.deletedFiles).not.toContain('AGENTS.md');
      expect(result.modifiedFiles).toContain('AGENTS.md');
      // File should still exist
      await expect(fs.access(agentsPath)).resolves.not.toThrow();
    });

    it('should report errors without stopping cleanup', async () => {
      // Create a valid detection result with a non-existent file to simulate error
      const detection = {
        configFiles: ['NON_EXISTENT.md'],
        configFilesToUpdate: ['NON_EXISTENT.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const result = await cleanupLegacyArtifacts(testDir, detection);

      // Should not throw, but should record the error
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('NON_EXISTENT.md');
    });
  });

  describe('formatCleanupSummary', () => {
    it('should format deleted files', () => {
      const result = {
        deletedFiles: ['CLAUDE.md', 'CLINE.md'],
        modifiedFiles: [],
        deletedDirs: [],
        projectMdNeedsMigration: false,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('Cleaned up legacy files:');
      expect(summary).toContain('✓ Removed CLAUDE.md');
      expect(summary).toContain('✓ Removed CLINE.md');
    });

    it('should format deleted directories', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: [],
        deletedDirs: ['.claude/commands/spok'],
        projectMdNeedsMigration: false,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('✓ Removed .claude/commands/spok/ (replaced by Spok skills)');
    });

    it('should format modified files', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: ['AGENTS.md'],
        deletedDirs: [],
        projectMdNeedsMigration: false,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('✓ Removed Spok markers from AGENTS.md');
    });

    it('should include migration hint for project.md', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: [],
        deletedDirs: [],
        projectMdNeedsMigration: true,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('Needs your attention');
      expect(summary).toContain('spok/project.md');
      expect(summary).toContain('config.toml');
    });

    it('should include errors', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: [],
        deletedDirs: [],
        projectMdNeedsMigration: false,
        errors: ['Failed to delete CLAUDE.md: Permission denied'],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toContain('Errors during cleanup:');
      expect(summary).toContain('Failed to delete CLAUDE.md');
    });

    it('should return empty string when nothing to report', () => {
      const result = {
        deletedFiles: [],
        modifiedFiles: [],
        deletedDirs: [],
        projectMdNeedsMigration: false,
        errors: [],
      };

      const summary = formatCleanupSummary(result);
      expect(summary).toBe('');
    });
  });

  describe('formatDetectionSummary', () => {
    it('should include welcoming upgrade header and explanation', () => {
      const detection = {
        configFiles: ['CLAUDE.md'],
        configFilesToUpdate: ['CLAUDE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('Upgrading to the new Spok');
      expect(summary).toContain('agent skills');
      expect(summary).toContain('keeping everything working');
    });

    it('should format config files as files to update (never remove)', () => {
      const detection = {
        configFiles: ['CLAUDE.md'],
        configFilesToUpdate: ['CLAUDE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      // Config files should be in "Files to update", not "Files to remove"
      expect(summary).toContain('Files to update');
      expect(summary).toContain('• CLAUDE.md');
      // Should NOT be in removals
      expect(summary).not.toContain('No user content to preserve');
    });

    it('should format files to be updated', () => {
      const detection = {
        configFiles: ['CLINE.md'],
        configFilesToUpdate: ['CLINE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('Files to update');
      expect(summary).toContain('markers will be removed');
      expect(summary).toContain('your content preserved');
      expect(summary).toContain('• CLINE.md');
    });

    it('should format slash command directories', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: ['.claude/commands/spok'],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('Files to remove');
      expect(summary).toContain('• .claude/commands/spok/');
    });

    it('should format slash command files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.cursor/commands/spok-proposal.md'],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('Files to remove');
      expect(summary).toContain('• .cursor/commands/spok-proposal.md');
    });

    it('should format spok/AGENTS.md', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: true,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('Files to remove');
      expect(summary).toContain('• spok/AGENTS.md');
    });

    it('should include attention section for project.md', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: true,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: false,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toContain('Needs your attention');
      expect(summary).toContain('• spok/project.md');
      expect(summary).toContain('won\'t delete this file');
      expect(summary).toContain('config.toml');
      expect(summary).toContain('"context"');
    });

    it('should include attention section with other legacy artifacts', () => {
      const detection = {
        configFiles: ['CLAUDE.md'],
        configFilesToUpdate: ['CLAUDE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: true,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      // Config files now in "Files to update", not "Files to remove"
      expect(summary).toContain('Files to update');
      expect(summary).toContain('CLAUDE.md');
      expect(summary).toContain('Needs your attention');
      expect(summary).toContain('spok/project.md');
    });

    it('should group both removals and updates correctly', () => {
      const detection = {
        configFiles: ['CLAUDE.md', 'CLINE.md'],
        configFilesToUpdate: ['CLAUDE.md', 'CLINE.md'],
        slashCommandDirs: ['.claude/commands/spok'],
        slashCommandFiles: [],
        hasOpenspecAgents: true,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const summary = formatDetectionSummary(detection);
      // Check both sections exist
      expect(summary).toContain('Files to remove');
      expect(summary).toContain('Files to update');
      // Check removals (only slash commands and spok/AGENTS.md)
      expect(summary).toContain('• .claude/commands/spok/');
      expect(summary).toContain('• spok/AGENTS.md');
      // Check updates (all config files)
      expect(summary).toContain('• CLAUDE.md');
      expect(summary).toContain('• CLINE.md');
    });

    it('should return empty string when nothing is detected', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: false,
      };

      const summary = formatDetectionSummary(detection);
      expect(summary).toBe('');
    });
  });

  describe('formatProjectMdMigrationHint', () => {
    it('should return migration hint message', () => {
      const hint = formatProjectMdMigrationHint();
      expect(hint).toContain('Needs your attention');
      expect(hint).toContain('spok/project.md');
      expect(hint).toContain('won\'t delete this file');
      expect(hint).toContain('config.toml');
      expect(hint).toContain('"context"');
    });

    it('should include actionable instructions', () => {
      const hint = formatProjectMdMigrationHint();
      expect(hint).toContain('move any useful content');
      expect(hint).toContain('delete the file when ready');
    });

    it('should explain the new context section benefits', () => {
      const hint = formatProjectMdMigrationHint();
      expect(hint).toContain('included in every Spok request');
      expect(hint).toContain('reliably');
    });
  });

  describe('LEGACY_CONFIG_FILES', () => {
    it('should include expected config file names', () => {
      expect(LEGACY_CONFIG_FILES).toContain('CLAUDE.md');
      expect(LEGACY_CONFIG_FILES).toContain('CLINE.md');
      expect(LEGACY_CONFIG_FILES).toContain('CODEBUDDY.md');
      expect(LEGACY_CONFIG_FILES).toContain('COSTRICT.md');
      expect(LEGACY_CONFIG_FILES).toContain('QODER.md');
      expect(LEGACY_CONFIG_FILES).toContain('IFLOW.md');
      expect(LEGACY_CONFIG_FILES).toContain('AGENTS.md');
      expect(LEGACY_CONFIG_FILES).toContain('QWEN.md');
    });
  });

  describe('LEGACY_SLASH_COMMAND_PATHS', () => {
    it('should include expected tool patterns', () => {
      expect(LEGACY_SLASH_COMMAND_PATHS['claude']).toEqual({
        type: 'directory',
        path: ['.claude/commands/spok', '.claude/commands/opsx'],
        pattern: ['.claude/commands/spok-*.md', '.claude/commands/opsx-*.md'],
      });

      expect(LEGACY_SLASH_COMMAND_PATHS['cursor']).toEqual({
        type: 'files',
        pattern: ['.cursor/commands/spok-*.md', '.cursor/commands/opsx-*.md'],
      });

      expect(LEGACY_SLASH_COMMAND_PATHS['windsurf']).toEqual({
        type: 'files',
        pattern: ['.windsurf/workflows/spok-*.md', '.windsurf/workflows/opsx-*.md'],
      });
    });

    it('should only include legacy tool IDs that are present in the CommandAdapterRegistry', () => {
      const registeredTools = new Set(CommandAdapterRegistry.getAll().map(adapter => adapter.toolId));

      // Verify all legacy map entries correspond to known adapters
      for (const tool of Object.keys(LEGACY_SLASH_COMMAND_PATHS)) {
        expect(registeredTools.has(tool)).toBe(true);
      }

      // Bob was added for retired opsx-* flat command cleanup
      expect(LEGACY_SLASH_COMMAND_PATHS).toHaveProperty('bob');
    });
  });

  describe('getToolsFromLegacyArtifacts', () => {
    it('should extract claude from directory-based legacy artifacts', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: ['.claude/commands/spok'],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('claude');
      expect(tools).toHaveLength(1);
    });

    it('should extract cursor from file-based legacy artifacts', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.cursor/commands/spok-proposal.md'],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('cursor');
      expect(tools).toHaveLength(1);
    });

    it('should extract multiple tools from mixed legacy artifacts', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: ['.claude/commands/spok', '.qoder/commands/spok'],
        slashCommandFiles: ['.cursor/commands/spok-apply.md', '.windsurf/workflows/spok-archive.md'],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('claude');
      expect(tools).toContain('qoder');
      expect(tools).toContain('cursor');
      expect(tools).toContain('windsurf');
      expect(tools).toHaveLength(4);
    });

    it('should deduplicate tools when multiple files match same tool', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [
          '.cursor/commands/spok-proposal.md',
          '.cursor/commands/spok-apply.md',
          '.cursor/commands/spok-archive.md',
        ],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('cursor');
      expect(tools).toHaveLength(1);
    });

    it('should return empty array when no legacy artifacts', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: false,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toHaveLength(0);
    });

    it('should handle qwen TOML-based legacy files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.qwen/commands/spok-proposal.toml'],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('qwen');
      expect(tools).toHaveLength(1);
    });

    it('should handle continue prompt files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.continue/prompts/spok-apply.prompt'],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('continue');
      expect(tools).toHaveLength(1);
    });

    it('should handle github-copilot prompt files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.github/prompts/spok-apply.prompt.md'],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('github-copilot');
      expect(tools).toHaveLength(1);
    });

    it('should handle opencode opsx-* legacy files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.opencode/command/opsx-propose.md'],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('opencode');
      expect(tools).toHaveLength(1);
    });

    it('should handle opencode spok-* legacy files', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: ['.opencode/command/spok-new.md'],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('opencode');
      expect(tools).toHaveLength(1);
    });

    it('should deduplicate opencode when both opsx-* and spok-* files exist', () => {
      const detection = {
        configFiles: [],
        configFilesToUpdate: [],
        slashCommandDirs: [],
        slashCommandFiles: [
          '.opencode/command/opsx-propose.md',
          '.opencode/command/spok-new.md',
        ],
        hasOpenspecAgents: false,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toContain('opencode');
      expect(tools).toHaveLength(1);
    });

    it('should not extract tools from config files only', () => {
      // Config files don't indicate which tools were configured
      // Only slash command dirs/files tell us which tools to upgrade
      const detection = {
        configFiles: ['CLAUDE.md'],
        configFilesToUpdate: ['CLAUDE.md'],
        slashCommandDirs: [],
        slashCommandFiles: [],
        hasOpenspecAgents: true,
        hasProjectMd: false,
        hasRootAgentsWithMarkers: false,
        hasLegacyArtifacts: true,
      };

      const tools = getToolsFromLegacyArtifacts(detection);
      expect(tools).toHaveLength(0);
    });
  });

  describe('RETIRED_SKILL_DIRS', () => {
    it('should include the renamed surviving skills', () => {
      expect(RETIRED_SKILL_DIRS).toContain('spok-apply-change');
      expect(RETIRED_SKILL_DIRS).toContain('spok-archive-change');
    });

    it('should include workflows retired in the 3-verb collapse', () => {
      expect(RETIRED_SKILL_DIRS).not.toContain('spok-explore');
      expect(RETIRED_SKILL_DIRS).toContain('spok-new-change');
      expect(RETIRED_SKILL_DIRS).toContain('spok-continue-change');
      expect(RETIRED_SKILL_DIRS).toContain('spok-sync-specs');
      expect(RETIRED_SKILL_DIRS).toContain('spok-onboard');
      expect(RETIRED_SKILL_DIRS).toContain('spok-feedback');
    });
  });

  describe('detectRetiredSkillDirs', () => {
    it('returns empty array when no retired skill directories exist', async () => {
      const found = await detectRetiredSkillDirs(testDir);
      expect(found).toEqual([]);
    });

    it('finds a retired Claude skill directory', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'spok-apply-change');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# stale\n');

      const found = await detectRetiredSkillDirs(testDir);
      expect(found).toContain('.claude/skills/spok-apply-change');
    });

    it('does not flag the surviving skill names', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'spok-apply');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# current\n');

      const found = await detectRetiredSkillDirs(testDir);
      expect(found).not.toContain('.claude/skills/spok-apply');
    });

    it('finds retired dirs across multiple tools while preserving explore', async () => {
      const claudeCurrent = path.join(testDir, '.claude', 'skills', 'spok-explore');
      const cursorRetired = path.join(testDir, '.cursor', 'skills', 'spok-sync-specs');
      await fs.mkdir(claudeCurrent, { recursive: true });
      await fs.mkdir(cursorRetired, { recursive: true });

      const found = await detectRetiredSkillDirs(testDir);
      expect(found).not.toContain('.claude/skills/spok-explore');
      expect(found).toContain('.cursor/skills/spok-sync-specs');
    });
  });

  describe('cleanupLegacyArtifacts — retired skill dirs', () => {
    it('deletes retired skill directories detected via detectLegacyArtifacts', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'spok-apply-change');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# stale\n');

      const detection = await detectLegacyArtifacts(testDir);
      expect(detection.retiredSkillDirs).toContain('.claude/skills/spok-apply-change');

      const result = await cleanupLegacyArtifacts(testDir, detection);
      expect(result.deletedDirs).toContain('.claude/skills/spok-apply-change');
      await expect(fs.access(skillDir)).rejects.toThrow();
    });

    it('leaves the surviving skill directory untouched', async () => {
      const surviving = path.join(testDir, '.claude', 'skills', 'spok-apply');
      const retired = path.join(testDir, '.claude', 'skills', 'spok-apply-change');
      await fs.mkdir(surviving, { recursive: true });
      await fs.mkdir(retired, { recursive: true });
      await fs.writeFile(path.join(surviving, 'SKILL.md'), '# current\n');
      await fs.writeFile(path.join(retired, 'SKILL.md'), '# stale\n');

      const detection = await detectLegacyArtifacts(testDir);
      await cleanupLegacyArtifacts(testDir, detection);

      await expect(fs.access(surviving)).resolves.not.toThrow();
      await expect(fs.access(retired)).rejects.toThrow();
    });
  });
});
