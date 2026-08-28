import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PassThrough, Writable } from 'node:stream';
import { InitCommand } from '../../../src/core/init.js';
import { UpdateCommand } from '../../../src/core/update.js';
import { GlobalSkillsInstallCommand } from '../../../src/core/skills-install.js';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

const CODEX_HARNESS_ENV = [
  'CODEX_HOME',
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
  'CODEX_SHELL',
] as const;

type CodexHarnessEnv = (typeof CODEX_HARNESS_ENV)[number];

interface SkillArtifactWorld {
  projectDir?: string;
  codexHome?: string;
  originalCodexHarnessEnv?: Record<CodexHarnessEnv, string | undefined>;
  originalHome?: string;
  originalUserProfile?: string;
  originalFlowProfile?: string;
  originalXdgConfigHome?: string;
  originalPath?: string;
  setupGuidance?: string;
  flowTaskDir?: string;
  flowWorkRoot?: string;
  flowHeadCommit?: string;
  unreachableFlowCommit?: string;
  cliResult?: RunCLIResult;
  retiredCommandArtifacts?: string[];
  emptyAgentHome?: string;
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

async function runStagedFlowComplete(
  world: SkillArtifactWorld,
  step: string,
  args: readonly string[]
): Promise<RunCLIResult> {
  assert.ok(world.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(world.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  return runCLI(
    ['flow', 'complete', world.flowTaskDir, '--step', step, ...args, '--json'],
    { cwd: world.projectDir }
  );
}

Given('a new project', async function (this: SkillArtifactWorld) {
  this.projectDir = path.join(os.tmpdir(), `spok-acceptance-${randomUUID()}`);
  this.codexHome = path.join(this.projectDir, 'codex-home');
  this.originalCodexHarnessEnv = Object.fromEntries(
    CODEX_HARNESS_ENV.map((name) => [name, process.env[name]])
  ) as Record<CodexHarnessEnv, string | undefined>;
  this.originalHome = process.env.HOME;
  this.originalUserProfile = process.env.USERPROFILE;
  this.originalFlowProfile = process.env.SPOK_FLOW_PROFILE;
  this.originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.CODEX_HOME = this.codexHome;
  delete process.env.SPOK_FLOW_PROFILE;
  process.env.XDG_CONFIG_HOME = path.join(this.projectDir, 'xdg-config');
  await fs.mkdir(this.projectDir, { recursive: true });
});

Given('an empty home directory for agent readiness', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  this.emptyAgentHome = path.join(this.projectDir, 'empty-home');
  process.env.HOME = this.emptyAgentHome;
  process.env.USERPROFILE = this.emptyAgentHome;
  await fs.mkdir(this.emptyAgentHome, { recursive: true });
});

Given('the project is a Git repository', function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  execFileSync('git', ['init', '--quiet', this.projectDir]);
});

Given(
  'harness capability stubs report Codex logged out with OMP and Claude available',
  async function (this: SkillArtifactWorld) {
    if (process.platform === 'win32') return 'skipped';
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    const stubDir = path.join(this.projectDir, 'stub-bin');
    await fs.mkdir(stubDir, { recursive: true });
    const ompModels = JSON.stringify({
      models: [
        {
          selector: 'openai-codex/gpt-5.6-sol',
          thinking: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        {
          selector: 'openai-codex/gpt-5.6-terra',
          thinking: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
      ],
    });
    const stubs: Record<string, string> = {
      omp: `#!/bin/sh\nprintf '%s' '${ompModels}'\n`,
      codex: "#!/bin/sh\nprintf 'Not logged in\\n'\n",
      claude: '#!/bin/sh\nprintf \'%s\' \'{"loggedIn": true}\'\n',
    };
    for (const [name, content] of Object.entries(stubs)) {
      await fs.writeFile(path.join(stubDir, name), content, { mode: 0o755 });
    }
    this.originalPath = process.env.PATH;
    process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`;
  }
);

Given('a separate flow work repository', async function (this: SkillArtifactWorld) {
  this.flowWorkRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spok-flow-work-'));
  const git = (args: string[]) =>
    execFileSync('git', ['-C', this.flowWorkRoot!, ...args], { encoding: 'utf-8' }).trim();

  execFileSync('git', ['init', '-b', 'main', this.flowWorkRoot]);
  git(['config', 'user.email', 'flow@example.com']);
  git(['config', 'user.name', 'Flow Test']);
  await fs.writeFile(path.join(this.flowWorkRoot, 'work.txt'), 'one\n', 'utf-8');
  git(['add', 'work.txt']);
  git(['commit', '--no-gpg-sign', '-m', 'first']);
  const headCommit = git(['rev-parse', 'HEAD']);
  this.flowHeadCommit = headCommit;

  await fs.writeFile(path.join(this.flowWorkRoot, 'work.txt'), 'two\n', 'utf-8');
  git(['add', 'work.txt']);
  git(['commit', '--no-gpg-sign', '-m', 'second']);
  this.unreachableFlowCommit = git(['rev-parse', 'HEAD']);
  git(['reset', '--hard', headCommit]);
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

Given('a staged flow task in a linked worktree', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  const primary = path.join(this.projectDir, 'primary');
  await fs.mkdir(primary, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', primary]);
  const git = (args: string[]) =>
    execFileSync('git', ['-C', primary, ...args], { encoding: 'utf-8' }).trim();
  git(['config', 'user.email', 'flow@example.com']);
  git(['config', 'user.name', 'Flow Test']);
  await fs.writeFile(path.join(primary, 'seed.txt'), 'seed\n', 'utf-8');
  git(['add', 'seed.txt']);
  git(['commit', '--no-gpg-sign', '-m', 'seed']);
  const worktree = path.join(this.projectDir, 'worktree');
  git(['worktree', 'add', worktree]);
  this.flowTaskDir = path.join(worktree, 'spok', 'changes', 'demo', '.flow', 'chunk-one');
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

Given(
  'the staged flow task is ready to implement',
  { timeout: 15_000 },
  async function (this: SkillArtifactWorld) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');

    const completedSteps = [
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
  }
);

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

async function stageFlowThrough(taskDir: string, lastStep: 'simplify' | 'validate'): Promise<void> {
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

  const writtenFileSteps = lastStep === 'validate' ? fileSteps : fileSteps.slice(0, 7);
  for (const [, filename, content] of writtenFileSteps) {
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
          ...(lastStep === 'validate' ? [completedFileStep(fileSteps[7])] : []),
        ],
        createdAt: completedAt,
        updatedAt: completedAt,
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
}

type StagedRoute = { runner: string; model?: string; effort?: string };

const SELECTABLE_ROUTE = { policy: 'auto-v1', modelControl: 'selectable', rejected: [] };

/** Policy-consistent routes for an all-available machine, one per completed step. */
const STAGED_AUTO_ROUTES: Record<string, StagedRoute> = {
  'validate-problem': { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  'research-questions': { runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  research: { runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  'design-discussion': { runner: 'claude', model: 'fable', effort: 'xhigh' },
  'structure-outline': { runner: 'claude', model: 'fable', effort: 'xhigh' },
  'design-review': { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  plan: { runner: 'claude', model: 'fable', effort: 'xhigh' },
  implement: { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  simplify: { runner: 'claude', model: 'opus' },
  validate: { runner: 'claude', model: 'opus', effort: 'medium' },
};

const DEGRADED_CURRENT_ROUTE = {
  policy: 'auto-v1',
  modelControl: 'fixed-unknown',
  rejected: [
    {
      runner: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
      code: 'executable_missing',
      reason: 'codex is not installed or not on PATH.',
    },
    {
      runner: 'omp',
      model: 'openai-codex/gpt-5.6-sol',
      effort: 'xhigh',
      code: 'executable_missing',
      reason: 'omp is not installed or not on PATH.',
    },
    {
      runner: 'claude',
      model: 'opus',
      effort: 'medium',
      code: 'not_authenticated',
      reason: 'claude auth status --json reports loggedIn is not true.',
    },
  ],
  degraded: {
    code: 'model_identity_unavailable',
    reason:
      'No explicit auto candidate is eligible; running on the current harness whose model identity is unavailable.',
  },
};

/** Writes an auto-profile state file. `profile` is explicit so inferLegacyProfile cannot mislabel it. */
async function writeAutoFlowState(taskDir: string, steps: unknown[]): Promise<void> {
  const stamp = '2026-01-01T00:00:00.000Z';
  await fs.writeFile(
    path.join(taskDir, 'workflow-state.json'),
    `${JSON.stringify(
      { version: 2, profile: 'auto', taskDir, status: 'ready', steps, createdAt: stamp, updatedAt: stamp },
      null,
      2
    )}\n`,
    'utf-8'
  );
}

function jsonFlowStep(
  world: SkillArtifactWorld,
  id: string,
  occurrence: number
): { id: string; runner?: string; model?: string } {
  assert.ok(world.cliResult, 'cliResult must be set by a CLI run step');
  const response = JSON.parse(world.cliResult.stdout) as {
    steps: Array<{ id: string; runner?: string; model?: string }>;
  };
  const step = response.steps.filter((candidate) => candidate.id === id)[occurrence];
  assert.ok(step, `flow step ${id} occurrence ${occurrence} must exist in the JSON response`);
  return step;
}

Given('the staged flow task is completed through simplify', async function (this: SkillArtifactWorld) {
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  await stageFlowThrough(this.flowTaskDir, 'simplify');
});

Given('the staged flow task is completed through validation', async function (this: SkillArtifactWorld) {
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  await stageFlowThrough(this.flowTaskDir, 'validate');
});

Given('the staged flow task has the separate work root recorded', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.flowWorkRoot, 'flowWorkRoot must be set by Given a separate flow work repository');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  const statePath = path.join(this.flowTaskDir, 'workflow-state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf-8')) as {
    steps: Array<{ id: string; result?: Record<string, unknown> }>;
  };
  const implement = state.steps.find((step) => step.id === 'implement');
  assert.ok(implement?.result, 'implement result must exist in staged flow state');
  implement.result.workRoot = this.flowWorkRoot;
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
});

Given('a repair cycle is pending', async function (this: SkillArtifactWorld) {
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  const statePath = path.join(this.flowTaskDir, 'workflow-state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf-8')) as Record<string, unknown>;
  state.repairAttempts = 1;
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
});

Given('the staged auto flow task is ready on a degraded current route', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  await writeAutoFlowState(this.flowTaskDir, [
    { id: 'validate-problem', status: 'ready', runner: 'current', route: DEGRADED_CURRENT_ROUTE },
  ]);
});

Given(
  'the staged auto flow task is completed through validation on persisted routes',
  async function (this: SkillArtifactWorld) {
    assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
    await stageFlowThrough(this.flowTaskDir, 'validate');
    // The pending repair cycle (Given a repair cycle is pending) needs a FAIL verdict on validate#0.
    await fs.writeFile(
      path.join(this.flowTaskDir, 'validation.md'),
      '---\nverdict: FAIL\n---\n\n# Validation\n',
      'utf-8'
    );
    const statePath = path.join(this.flowTaskDir, 'workflow-state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf-8')) as {
      steps: Array<Record<string, unknown> & { id: string }>;
    };
    const steps = state.steps.map((step) => ({
      ...step,
      ...STAGED_AUTO_ROUTES[step.id],
      route: SELECTABLE_ROUTE,
    }));
    await writeAutoFlowState(this.flowTaskDir, steps);
  }
);

Given('the Claude harness is active', function (this: SkillArtifactWorld) {
  for (const name of CODEX_HARNESS_ENV) delete process.env[name];
});

Given('the Codex harness is active', function (this: SkillArtifactWorld) {
  assert.ok(this.codexHome, 'codexHome must be set by Given a new project');
  process.env.CODEX_HOME = this.codexHome; // explicit for legibility; already set by 'a new project'
});

Given('the Codex Desktop harness is active without CODEX_HOME', function () {
  delete process.env.CODEX_HOME;
  process.env.CODEX_THREAD_ID = 'codex-desktop-thread';
});

Given('the hybrid flow profile is active', function () {
  process.env.SPOK_FLOW_PROFILE = 'hybrid';
});

Given('the auto flow profile is active', function () {
  process.env.SPOK_FLOW_PROFILE = 'auto';
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
    await new InitCommand({
      tools,
      force: true,
      interactive: false,
      homeDir: this.emptyAgentHome,
    }).execute(this.projectDir!);
  });
});

When(
  'I initialize Spok interactively for the tools {string} and accept agent creation',
  async function (this: SkillArtifactWorld, tools: string) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    assert.ok(this.emptyAgentHome, 'empty agent home must be set by readiness setup');

    const input = new PassThrough();
    Object.assign(input, { isTTY: true, setRawMode: () => input });
    let terminalOutput = '';
    const output = new Writable({
      write(chunk, _encoding, callback) {
        terminalOutput += String(chunk);
        callback();
      },
    });
    Object.assign(output, { isTTY: false, columns: 80 });

    const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    const originalStdout = Object.getOwnPropertyDescriptor(process, 'stdout');
    const originalCI = process.env.CI;
    const originalInteractive = process.env.OPEN_SPEC_INTERACTIVE;
    let enterTimer: ReturnType<typeof setTimeout> | undefined;
    let consoleOutput = '';

    try {
      delete process.env.CI;
      delete process.env.OPEN_SPEC_INTERACTIVE;
      Object.defineProperties(process, {
        stdin: { configurable: true, value: input },
        stdout: { configurable: true, value: output },
      });
      enterTimer = setTimeout(() => input.write('\r'), 50);
      consoleOutput = await captureConsoleLog(async () => {
        await new InitCommand({
          tools,
          force: true,
          interactive: true,
          homeDir: this.emptyAgentHome,
        }).execute(this.projectDir!);
      });
    } finally {
      if (enterTimer) clearTimeout(enterTimer);
      input.destroy();
      if (originalStdin) Object.defineProperty(process, 'stdin', originalStdin);
      if (originalStdout) Object.defineProperty(process, 'stdout', originalStdout);
      if (originalCI === undefined) delete process.env.CI;
      else process.env.CI = originalCI;
      if (originalInteractive === undefined) delete process.env.OPEN_SPEC_INTERACTIVE;
      else process.env.OPEN_SPEC_INTERACTIVE = originalInteractive;
    }

    this.setupGuidance = `${consoleOutput}\n${terminalOutput}`;
  }
);

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

When('I run spok flow next as JSON for the staged task', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  this.cliResult = await runCLI(['flow', 'next', this.flowTaskDir, '--json'], {
    cwd: this.projectDir,
  });
  assert.equal(this.cliResult.exitCode, 0, this.cliResult.stderr);
});

When('I run spok flow status for the staged task', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  this.cliResult = await runCLI(['flow', 'status', this.flowTaskDir], { cwd: this.projectDir });
  assert.equal(this.cliResult.exitCode, 0, this.cliResult.stderr);
});

When('I run spok flow status as JSON for the staged task', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  this.cliResult = await runCLI(['flow', 'status', this.flowTaskDir, '--json'], {
    cwd: this.projectDir,
  });
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

When('I complete the staged flow implement step with the separate work root', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  assert.ok(this.flowWorkRoot, 'flowWorkRoot must be set by Given a separate flow work repository');
  this.cliResult = await runCLI(
    [
      'flow',
      'complete',
      this.flowTaskDir,
      '--step',
      'implement',
      '--summary',
      'Implemented the plan.',
      '--work-root',
      this.flowWorkRoot,
      '--json',
    ],
    { cwd: this.projectDir }
  );
});

When('I attempt the staged flow implement step with a blank work root', async function (
  this: SkillArtifactWorld
) {
  this.cliResult = await runStagedFlowComplete(this, 'implement', [
    '--summary',
    'Implemented the plan.',
    '--work-root',
    '   ',
  ]);
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

When('I complete the staged flow commit step with the separate work root', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.flowWorkRoot, 'flowWorkRoot must be set by Given a separate flow work repository');
  assert.ok(this.flowHeadCommit, 'flowHeadCommit must be set by Given a separate flow work repository');
  this.cliResult = await runStagedFlowComplete(this, 'commit', [
    '--commit',
    this.flowHeadCommit,
    '--work-root',
    this.flowWorkRoot,
    '--summary',
    'Committed the chunk.',
  ]);
});

When('I attempt the staged flow commit step with a conflicting work root', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.ok(this.flowHeadCommit, 'flowHeadCommit must be set by Given a separate flow work repository');
  this.cliResult = await runStagedFlowComplete(this, 'commit', [
    '--commit',
    this.flowHeadCommit,
    '--work-root',
    this.projectDir,
    '--summary',
    'Committed the chunk.',
  ]);
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

When(
  'I attempt the staged flow commit step with an unreachable work repository commit',
  async function (this: SkillArtifactWorld) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
    assert.ok(
      this.unreachableFlowCommit,
      'unreachableFlowCommit must be set by Given a separate flow work repository'
    );
    this.cliResult = await runCLI(
      [
        'flow',
        'complete',
        this.flowTaskDir,
        '--step',
        'commit',
        '--commit',
        this.unreachableFlowCommit,
        '--summary',
        'Committed the chunk.',
        '--json',
      ],
      { cwd: this.projectDir }
    );
  }
);

When('I update Spok with force', async function (this: SkillArtifactWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');

  if (this.emptyAgentHome) {
    const result = await runCLI(['update', '--force'], {
      cwd: this.projectDir,
      env: {
        HOME: this.emptyAgentHome,
        SPOK_TELEMETRY: '0',
        USERPROFILE: this.emptyAgentHome,
      },
      timeoutMs: 10_000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    this.setupGuidance = `${result.stdout}\n${result.stderr}`;
    return;
  }

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

When(
  'I remove global Spok skills under {string}',
  async function (this: SkillArtifactWorld, relativeDir: string) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    await fs.rm(path.join(this.projectDir, relativeDir), {
      recursive: true,
      force: true,
    });
  }
);

When(
  'I remove the global agent {string} under {string}',
  async function (this: SkillArtifactWorld, agentName: string, relativeDir: string) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    await fs.rm(path.join(this.projectDir, relativeDir, agentName), { force: true });
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

Then('Spok creates the global agent {string} under {string}', async function (
  this: SkillArtifactWorld,
  agentName: string,
  relativeDir: string
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.equal(
    await pathExists(path.join(this.projectDir, relativeDir, agentName)),
    true
  );
});

Then('Spok creates {int} global agents under {string}', async function (
  this: SkillArtifactWorld,
  expectedCount: number,
  relativeDir: string
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  const entries = await fs.readdir(path.join(this.projectDir, relativeDir), {
    withFileTypes: true,
  });
  const agentCount = entries.filter(
    (entry) => entry.isFile() && entry.name.startsWith('spok-')
  ).length;
  assert.equal(agentCount, expectedCount);
});

Then('Spok creates {int} home agents under {string}', async function (
  this: SkillArtifactWorld,
  expectedCount: number,
  relativeDir: string
) {
  assert.ok(this.emptyAgentHome, 'empty agent home must be set by readiness setup');
  const entries = await fs.readdir(path.join(this.emptyAgentHome, relativeDir), {
    withFileTypes: true,
  });
  const agentCount = entries.filter(
    (entry) => entry.isFile() && entry.name.startsWith('spok-')
  ).length;
  assert.equal(agentCount, expectedCount);
});

Then('Spok does not create global agents under {string}', async function (
  this: SkillArtifactWorld,
  relativeDir: string
) {
  assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
  assert.equal(await pathExists(path.join(this.projectDir, relativeDir)), false);
});

Then('project setup does not create global agent directories', async function (this: SkillArtifactWorld) {
  assert.ok(this.emptyAgentHome, 'empty agent home must be set by readiness setup');
  assert.equal(await pathExists(path.join(this.emptyAgentHome, '.claude', 'agents')), false);
  assert.equal(await pathExists(path.join(this.emptyAgentHome, '.codex', 'agents')), false);
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
  'the workflow skill {string} under {string} does not mention {string}',
  async function (this: SkillArtifactWorld, skillName: string, relativeDir: string, unexpectedText: string) {
    assert.ok(this.projectDir, 'projectDir must be set by Given a new project');
    const skillPath = path.join(this.projectDir, relativeDir, skillName, 'SKILL.md');
    const skill = await fs.readFile(skillPath, 'utf-8');
    assert.doesNotMatch(
      skill,
      new RegExp(unexpectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
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

Then('the staged flow state records the separate work root', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.flowWorkRoot, 'flowWorkRoot must be set by Given a separate flow work repository');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  const state = JSON.parse(
    await fs.readFile(path.join(this.flowTaskDir, 'workflow-state.json'), 'utf-8')
  ) as { steps: Array<{ id: string; result?: { workRoot?: string } }> };
  const workRoot = state.steps.find((step) => step.id === 'implement')?.result?.workRoot;
  assert.ok(workRoot, 'implement result must record a work root');
  assert.equal(await fs.realpath(workRoot), await fs.realpath(this.flowWorkRoot));
});

Then('the editing prompt directs work to the separate work root', function (this: SkillArtifactWorld) {
  assert.ok(this.cliResult, 'cliResult must be set by a CLI run step');
  assert.ok(this.flowWorkRoot, 'flowWorkRoot must be set by Given a separate flow work repository');
  assert.ok(
    `${this.cliResult.stdout}${this.cliResult.stderr}`.includes(
      `The implementation repository is \`${this.flowWorkRoot}\``
    ),
    `editing prompt must identify ${this.flowWorkRoot}`
  );
});

Then('the staged flow commit records the separate work root', async function (
  this: SkillArtifactWorld
) {
  assert.ok(this.flowWorkRoot, 'flowWorkRoot must be set by Given a separate flow work repository');
  assert.ok(this.flowHeadCommit, 'flowHeadCommit must be set by Given a separate flow work repository');
  assert.ok(this.flowTaskDir, 'flowTaskDir must be set by Given a staged flow task');
  const state = JSON.parse(
    await fs.readFile(path.join(this.flowTaskDir, 'workflow-state.json'), 'utf-8')
  ) as { steps: Array<{ id: string; result?: { commit?: string; workRoot?: string } }> };
  const result = state.steps.find((step) => step.id === 'commit')?.result;
  assert.equal(result?.commit, this.flowHeadCommit);
  assert.ok(result?.workRoot, 'commit result must record a work root');
  assert.equal(await fs.realpath(result.workRoot), await fs.realpath(this.flowWorkRoot));
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

Then(
  'the JSON flow step {string} occurrence {int} has runner {string} and model {string}',
  function (this: SkillArtifactWorld, id: string, occurrence: number, runner: string, model: string) {
    const step = jsonFlowStep(this, id, occurrence);
    assert.equal(step.runner, runner, `${id}#${occurrence} runner`);
    assert.equal(step.model, model, `${id}#${occurrence} model`);
  }
);

Then(
  'the JSON flow step {string} occurrence {int} has no runner',
  function (this: SkillArtifactWorld, id: string, occurrence: number) {
    const step = jsonFlowStep(this, id, occurrence);
    assert.equal(step.runner, undefined, `${id}#${occurrence} must be unrouted`);
  }
);

After(async function (this: SkillArtifactWorld) {
  if (this.originalCodexHarnessEnv) {
    for (const name of CODEX_HARNESS_ENV) {
      const value = this.originalCodexHarnessEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  if (this.originalPath !== undefined) {
    process.env.PATH = this.originalPath;
  }
  if (this.originalFlowProfile === undefined) {
    delete process.env.SPOK_FLOW_PROFILE;
  } else {
    process.env.SPOK_FLOW_PROFILE = this.originalFlowProfile;
  }
  if (this.originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = this.originalHome;
  }
  if (this.originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = this.originalUserProfile;
  }
  if (this.originalXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = this.originalXdgConfigHome;
  }
  if (this.projectDir) {
    await fs.rm(this.projectDir, { recursive: true, force: true });
  }
  if (this.flowWorkRoot) {
    await fs.rm(this.flowWorkRoot, { recursive: true, force: true });
  }
});
