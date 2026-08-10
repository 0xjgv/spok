import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { InitCommand } from '../../../src/core/init.js';
import { UpdateCommand } from '../../../src/core/update.js';
import { GlobalSkillsInstallCommand } from '../../../src/core/skills-install.js';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

interface SkillArtifactWorld {
  projectDir?: string;
  codexHome?: string;
  originalCodexHome?: string;
  originalFlowProfile?: string;
  originalXdgConfigHome?: string;
  setupGuidance?: string;
  flowTaskDir?: string;
  cliResult?: RunCLIResult;
  retiredCommandArtifacts?: string[];
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function captureConsoleLog(run: () => Promise<void>): Promise<string> {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };

  try {
    await run();
  } finally {
    console.log = originalLog;
  }

  return lines.join('\n');
}

Given('a new project', async function (this: SkillArtifactWorld) {
  this.projectDir = path.join(os.tmpdir(), `spok-acceptance-${randomUUID()}`);
  this.codexHome = path.join(this.projectDir, 'codex-home');
  this.originalCodexHome = process.env.CODEX_HOME;
  this.originalFlowProfile = process.env.SPOK_FLOW_PROFILE;
  this.originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.CODEX_HOME = this.codexHome;
  delete process.env.SPOK_FLOW_PROFILE;
  process.env.XDG_CONFIG_HOME = path.join(this.projectDir, 'xdg-config');
  await fs.mkdir(this.projectDir, { recursive: true });
});

Given('the project is a Git repository', function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  execFileSync('git', ['init', '--quiet', this.projectDir]);
});

Given('the project has invalid Git metadata', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  await fs.writeFile(path.join(this.projectDir, '.git'), 'invalid git metadata\n');
});

Given('the project has an empty Git metadata directory', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  await fs.mkdir(path.join(this.projectDir, '.git'));
});

Given('the platform permits backslashes in directory names', function () {
  if (process.platform === 'win32') return 'skipped';
});

Given('a staged flow task', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  this.flowTaskDir = path.join(this.projectDir, 'spok', 'changes', 'demo', '.flow', 'chunk-one');
  await fs.mkdir(this.flowTaskDir, { recursive: true });
  await fs.writeFile(path.join(this.flowTaskDir, 'ticket.md'), '# Chunk One\n', 'utf-8');
});

Given('the staged flow task is completed through problem validation', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  const output = path.join(this.flowTaskDir, 'problem-validation.md');
  await fs.writeFile(output, '# Problem Validation\n\n## Flow Decision\n\nproceed\n', 'utf-8');
  const result = await runCLI(
    ['flow', 'complete', this.flowTaskDir, '--step', 'validate-problem', '--output', output, '--json'],
    { cwd: this.projectDir }
  );
  assert.equal(result.exitCode, 0, result.stderr);
});

Given('the staged flow task is completed through research', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');

  const completedSteps = [
    ['validate-problem', 'problem-validation.md', '# Problem Validation\n\n## Flow Decision\n\nproceed\n'],
    ['research-questions', 'research-questions.md', '# Research Questions\n'],
    ['research', 'research.md', '# Research\n'],
  ] as const;

  for (const [step, filename, content] of completedSteps) {
    const output = path.join(this.flowTaskDir, filename);
    await fs.writeFile(output, content, 'utf-8');
    const result = await runCLI(
      ['flow', 'complete', this.flowTaskDir, '--step', step, '--output', output, '--json'],
      { cwd: this.projectDir }
    );
    assert.equal(result.exitCode, 0, result.stderr);
  }
});

Given('the staged flow task is completed through structure outline', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');

  const completedSteps = [
    ['validate-problem', 'problem-validation.md', '# Problem Validation\n\n## Flow Decision\n\nproceed\n'],
    ['research-questions', 'research-questions.md', '# Research Questions\n'],
    ['research', 'research.md', '# Research\n'],
    ['design-discussion', 'design-discussion.md', '# Design Discussion\n'],
    ['structure-outline', 'structure-outline.md', '# Structure Outline\n'],
  ] as const;

  for (const [step, filename, content] of completedSteps) {
    const output = path.join(this.flowTaskDir, filename);
    await fs.writeFile(output, content, 'utf-8');
    const result = await runCLI(
      ['flow', 'complete', this.flowTaskDir, '--step', step, '--output', output, '--json'],
      { cwd: this.projectDir }
    );
    assert.equal(result.exitCode, 0, result.stderr);
  }
});

Given('project config contains:', async function (this: SkillArtifactWorld, configContent: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  const configDir = path.join(this.projectDir, 'spok');
  await fs.mkdir(path.join(configDir, 'changes'), { recursive: true });
  await fs.writeFile(path.join(configDir, 'config.toml'), `${configContent.trim()}\n`, 'utf-8');
});

Given(
  'a project schema template points outside its templates directory',
  async function (this: SkillArtifactWorld) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    const schemaDir = path.join(this.projectDir, 'spok', 'schemas', 'escaping');
    await fs.mkdir(path.join(schemaDir, 'templates'), { recursive: true });
    await fs.mkdir(path.join(this.projectDir, 'spok', 'changes', 'demo'), { recursive: true });
    await fs.writeFile(
      path.join(schemaDir, 'schema.yaml'),
      [
        'name: escaping',
        'version: 1',
        'artifacts:',
        '  - id: proposal',
        '    generates: proposal.md',
        '    description: Escaping proposal',
        '    template: ../../../../outside-template.md',
        '',
      ].join('\n'),
      'utf-8'
    );
    await fs.writeFile(
      path.join(this.projectDir, 'outside-template.md'),
      'outside-template-secret\n',
      'utf-8'
    );
  }
);

Given('self-learn is enabled in project config', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  const configDir = path.join(this.projectDir, 'spok');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'config.toml'),
    'schema = "spec-driven"\n\n[flow]\nself_learn = true\n',
    'utf-8'
  );
});

Given('the staged flow task is completed through validation', async function (this: SkillArtifactWorld) {
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  const taskDir = this.flowTaskDir;
  const completedAt = '2026-01-01T00:00:00.000Z';
  const fileSteps = [
    ['validate-problem', 'problem-validation.md', '# Problem Validation\n\n## Flow Decision\n\nproceed\n'],
    ['research-questions', 'research-questions.md', '# Research Questions\n'],
    ['research', 'research.md', '# Research\n'],
    ['design-discussion', 'design-discussion.md', '# Design Discussion\n'],
    ['structure-outline', 'structure-outline.md', '# Structure Outline\n'],
    [
      'design-review',
      'design-review.md',
      '---\ntype: design-review\nverdict: PASS\n---\n\n# Design Review\n',
    ],
    ['plan', 'plan.md', '# Plan\n'],
    ['validate', 'validation.md', '---\nverdict: PASS\n---\n\n# Validation\n'],
  ] as const;

  for (const [, filename, content] of fileSteps) {
    await fs.writeFile(path.join(taskDir, filename), content, 'utf-8');
  }

  const completedFileStep = ([id, filename]: readonly [string, string, string]) => ({
    id,
    status: 'completed',
    result: {
      output: path.join(taskDir, filename),
      completedAt,
    },
  });

  await fs.writeFile(
    path.join(taskDir, 'workflow-state.json'),
    `${JSON.stringify(
      {
        version: 2,
        taskDir,
        status: 'ready',
        steps: [
          ...fileSteps.slice(0, 7).map(completedFileStep),
          {
            id: 'implement',
            status: 'completed',
            result: { summary: 'Implemented the plan.', completedAt },
          },
          {
            id: 'simplify',
            status: 'completed',
            result: { summary: 'Simplified the implementation.', completedAt },
          },
          completedFileStep(fileSteps[7]),
        ],
        createdAt: completedAt,
        updatedAt: completedAt,
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
});

Given('a repair cycle is pending', async function (this: SkillArtifactWorld) {
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  const statePath = path.join(this.flowTaskDir, 'workflow-state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf-8')) as Record<string, unknown>;
  state.repairAttempts = 1;
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
});

Given('the Claude harness is active', function (this: SkillArtifactWorld) {
  delete process.env.CODEX_HOME; // cleared so the spawned CLI detects claude
});

Given('the Codex harness is active', function (this: SkillArtifactWorld) {
  assert.ok(this.codexHome, 'codexHome must be set by Given a new project');
  process.env.CODEX_HOME = this.codexHome; // explicit for legibility; already set by 'a new project'
});

Given('the hybrid flow profile is active', function () {
  process.env.SPOK_FLOW_PROFILE = 'hybrid';
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

Given('retired Spok command artifacts exist', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  await fs.mkdir(path.join(this.projectDir, 'spok'), { recursive: true });
  this.retiredCommandArtifacts = [
    path.join('.claude', 'commands', 'spok', 'propose.md'),
    path.join('.claude', 'commands', 'spok-propose.md'),
  ];

  for (const relativePath of this.retiredCommandArtifacts) {
    const artifactPath = path.join(this.projectDir, relativePath);
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, 'retired command\n', 'utf-8');
  }
});

When('I initialize Spok for the tools {string}', async function (this: SkillArtifactWorld, tools: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  this.setupGuidance = await captureConsoleLog(async () => {
    await new InitCommand({ tools, force: true, interactive: false }).execute(this.projectDir!);
  });
});

When(
  'I initialize Spok for the tools {string} in {string}',
  async function (this: SkillArtifactWorld, tools: string, relativePath: string) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    this.setupGuidance = await captureConsoleLog(async () => {
      await new InitCommand({ tools, force: true, interactive: false }).execute(
        path.join(this.projectDir!, relativePath)
      );
    });
  }
);

When('I run spok flow next for the staged task', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  this.cliResult = await runCLI(['flow', 'next', this.flowTaskDir], { cwd: this.projectDir });
  assert.equal(this.cliResult.exitCode, 0, this.cliResult.stderr);
});

When('I attempt the staged flow design-review step', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  this.cliResult = await runCLI(
    [
      'flow',
      'complete',
      this.flowTaskDir,
      '--step',
      'design-review',
      '--output',
      path.join(this.flowTaskDir, 'design-review.md'),
      '--json',
    ],
    { cwd: this.projectDir }
  );
});

When('I run the Spok CLI in the project with {string}', async function (this: SkillArtifactWorld, args: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  this.cliResult = await runCLI(args.split(' '), {
    cwd: this.projectDir,
    env: {
      SPOK_TELEMETRY: '0',
    },
    timeoutMs: 10_000,
  });
});

When('I complete the staged flow commit step', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  this.cliResult = await runCLI(
    [
      'flow',
      'complete',
      this.flowTaskDir,
      '--step',
      'commit',
      '--commit',
      'abc123',
      '--summary',
      'Committed the chunk.',
      '--json',
    ],
    { cwd: this.projectDir }
  );
  assert.equal(this.cliResult.exitCode, 0, this.cliResult.stderr);
});

/** Same call as the step above, without asserting success: blocked outcomes exit 1. */
When('I attempt the staged flow commit step', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  this.cliResult = await runCLI(
    [
      'flow',
      'complete',
      this.flowTaskDir,
      '--step',
      'commit',
      '--commit',
      'abc123',
      '--summary',
      'Committed the chunk.',
      '--json',
    ],
    { cwd: this.projectDir }
  );
});

When('I update Spok with force', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  this.setupGuidance = await captureConsoleLog(async () => {
    await new UpdateCommand({ force: true }).execute(this.projectDir!);
  });
});

When('I install global Spok skills for the tools {string}', async function (this: SkillArtifactWorld, tools: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  this.setupGuidance = await captureConsoleLog(async () => {
    await new GlobalSkillsInstallCommand({
      tools,
      interactive: false,
      homeDir: this.projectDir!,
    }).execute();
  });
});

When(
  'I remove the global workflow skill {string} under {string}',
  async function (this: SkillArtifactWorld, skillName: string, relativeDir: string) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    await fs.rm(path.join(this.projectDir, relativeDir, skillName), {
      recursive: true,
      force: true,
    });
  }
);

When('I run spok update globally', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  this.cliResult = await runCLI(['update', '--global'], {
    cwd: this.projectDir,
    env: {
      HOME: this.projectDir,
      SPOK_TELEMETRY: '0',
      USERPROFILE: this.projectDir,
    },
    timeoutMs: 10_000,
  });
  assert.equal(this.cliResult.exitCode, 0, this.cliResult.stderr);
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

Then('Spok creates global skills under {string}', async function (this: SkillArtifactWorld, relativeDir: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.equal(
    await pathExists(path.join(this.projectDir, relativeDir, 'spok-propose', 'SKILL.md')),
    true
  );
});

Then('Spok creates the global workflow skill {string} under {string}', async function (
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

Then('Spok creates file {string}', async function (this: SkillArtifactWorld, relativePath: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.equal(await pathExists(path.join(this.projectDir, relativePath)), true);
});

Then(
  'the repository worktree link contains one {string} entry',
  async function (this: SkillArtifactWorld, entry: string) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    const content = await fs.readFile(path.join(this.projectDir, '.worktreelink'), 'utf-8');
    assert.equal(
      content.split(/\r?\n/).filter((line) => line === entry).length,
      1
    );
  }
);

Then('the repository excludes {string}', async function (this: SkillArtifactWorld, entry: string) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  const content = await fs.readFile(path.join(this.projectDir, '.git', 'info', 'exclude'), 'utf-8');
  assert.equal(content.split(/\r?\n/).filter((line) => line === entry).length, 1);
});

Then('Spok removes the retired command artifacts', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.retiredCommandArtifacts, 'retired command artifacts must be created first');

  for (const relativePath of this.retiredCommandArtifacts) {
    assert.equal(await pathExists(path.join(this.projectDir, relativePath)), false);
  }
});

Then('Spok does not create command or prompt files for the selected tools', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.codexHome, 'codexHome must be set by Given a new project');
  assert.equal(await pathExists(path.join(this.projectDir, '.claude', 'commands')), false);
  assert.equal(await pathExists(path.join(this.codexHome, 'prompts')), false);
});

Then('setup guidance mentions {string}', function (this: SkillArtifactWorld, command: string) {
  assert.ok(this.setupGuidance, 'setupGuidance must be set by a setup or update step');
  assert.match(this.setupGuidance, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

Then(
  'the workflow skill {string} under {string} mentions {string}',
  async function (this: SkillArtifactWorld, skillName: string, relativeDir: string, expectedText: string) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    const skillPath = path.join(this.projectDir, relativeDir, skillName, 'SKILL.md');
    const skill = await fs.readFile(skillPath, 'utf-8');
    assert.match(skill, new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
);

Then(
  'the workflow skill resource {string} under {string} in {string} contains {string}',
  async function (
    this: SkillArtifactWorld,
    resourcePath: string,
    skillName: string,
    relativeDir: string,
    expectedText: string
  ) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    const installedResourcePath = path.join(
      this.projectDir,
      relativeDir,
      skillName,
      resourcePath
    );
    const resource = await fs.readFile(installedResourcePath, 'utf-8');
    assert.match(resource, new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
);

Then('the Spok CLI exits with code {int}', function (this: SkillArtifactWorld, expectedCode: number) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.equal(this.cliResult.exitCode, expectedCode, this.cliResult.stderr);
});

Then('the Spok CLI error does not contain {string}', function (this: SkillArtifactWorld, expected: string) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.doesNotMatch(
    this.cliResult.stderr,
    new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
});

Then('the Spok CLI output does not contain {string}', function (this: SkillArtifactWorld, expected: string) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.doesNotMatch(
    `${this.cliResult.stdout}${this.cliResult.stderr}`,
    new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
});

After(async function (this: SkillArtifactWorld) {
  if (this.originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = this.originalCodexHome;
  }
  if (this.originalFlowProfile === undefined) {
    delete process.env.SPOK_FLOW_PROFILE;
  } else {
    process.env.SPOK_FLOW_PROFILE = this.originalFlowProfile;
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
