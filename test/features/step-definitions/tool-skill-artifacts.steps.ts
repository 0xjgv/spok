import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { InitCommand } from '../../../src/core/init.js';
import { UpdateCommand } from '../../../src/core/update.js';

interface SkillArtifactWorld {
  projectDir?: string;
  codexHome?: string;
  originalCodexHome?: string;
  originalXdgConfigHome?: string;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

Given('a new project', async function (this: SkillArtifactWorld) {
  this.projectDir = path.join(os.tmpdir(), `spok-acceptance-${randomUUID()}`);
  this.codexHome = path.join(this.projectDir, 'codex-home');
  this.originalCodexHome = process.env.CODEX_HOME;
  this.originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.CODEX_HOME = this.codexHome;
  process.env.XDG_CONFIG_HOME = path.join(this.projectDir, 'xdg-config');
  await fs.mkdir(this.projectDir, { recursive: true });
});

Given(
  'an existing Spok setup for the tools {string} without the workflow skill {string}',
  async function (this: SkillArtifactWorld, tools: string, skillName: string) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    assert.ok(this.codexHome, 'codexHome must be set by Given a new project');

    await new InitCommand({ tools, force: true, interactive: false }).execute(this.projectDir);

    await fs.rm(path.join(this.projectDir, '.claude', 'skills', skillName), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(this.projectDir, '.agents', 'skills', skillName), {
      recursive: true,
      force: true,
    });
  }
);

When('I initialize Spok for the tools {string}', async function (this: SkillArtifactWorld, tools: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  await new InitCommand({ tools, force: true, interactive: false }).execute(this.projectDir);
});

When('I update Spok with force', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  await new UpdateCommand({ force: true }).execute(this.projectDir);
});

Then('Spok creates skills under {string}', async function (this: SkillArtifactWorld, relativeDir: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.equal(
    await pathExists(path.join(this.projectDir, relativeDir, 'spok-propose', 'SKILL.md')),
    true
  );
});

Then('Spok creates the workflow skill {string} under {string}', async function (
  this: SkillArtifactWorld,
  skillName: string,
  relativeDir: string
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.equal(
    await pathExists(path.join(this.projectDir, relativeDir, skillName, 'SKILL.md')),
    true
  );
});

Then('Spok does not create {string}', async function (this: SkillArtifactWorld, relativePath: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.equal(await pathExists(path.join(this.projectDir, relativePath)), false);
});

Then('Spok does not create command or prompt files for the selected tools', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.codexHome, 'codexHome must be set by Given a new project');
  assert.equal(await pathExists(path.join(this.projectDir, '.claude', 'commands')), false);
  assert.equal(await pathExists(path.join(this.codexHome, 'prompts')), false);
});

After(async function (this: SkillArtifactWorld) {
  if (this.originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = this.originalCodexHome;
  }
  if (this.originalXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = this.originalXdgConfigHome;
  }
  if (this.projectDir) {
    await fs.rm(this.projectDir, { recursive: true, force: true });
  }
});
