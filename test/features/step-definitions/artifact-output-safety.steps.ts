import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';

interface ArtifactOutputSafetyWorld {
  projectDir?: string;
  cliResult?: RunCLIResult;
}

interface StatusPayload {
  isComplete: boolean;
  artifactPaths: Record<string, { existingOutputPaths: string[] }>;
}

interface ApplyPayload {
  state: string;
  tasks: Array<{ description: string }>;
  instruction: string;
}

function statusPayload(world: ArtifactOutputSafetyWorld): StatusPayload {
  assert.ok(world.cliResult, 'cliResult must be set by the status step');
  assert.equal(world.cliResult.exitCode, 0, world.cliResult.stderr);
  return JSON.parse(world.cliResult.stdout) as StatusPayload;
}

function applyPayload(world: ArtifactOutputSafetyWorld): ApplyPayload {
  assert.ok(world.cliResult, 'cliResult must be set by the apply step');
  assert.equal(world.cliResult.exitCode, 0, world.cliResult.stderr);
  return JSON.parse(world.cliResult.stdout) as ApplyPayload;
}

Given('a change with traversal and symlink artifact outputs', async function (
  this: ArtifactOutputSafetyWorld
) {
  this.projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spok-artifact-output-safety-'));
  const changesDir = path.join(this.projectDir, 'spok', 'changes');
  const changeDir = path.join(changesDir, 'demo');
  const schemaDir = path.join(this.projectDir, 'spok', 'schemas', 'output-safety');
  const linkedOutputDir = path.join(this.projectDir, 'outside-output');

  await fs.mkdir(changeDir, { recursive: true });
  await fs.mkdir(schemaDir, { recursive: true });
  await fs.mkdir(linkedOutputDir, { recursive: true });
  await fs.writeFile(path.join(changesDir, 'outside.md'), 'outside traversal output\n', 'utf-8');
  await fs.writeFile(path.join(linkedOutputDir, 'output.md'), 'outside symlink output\n', 'utf-8');
  await fs.symlink(
    linkedOutputDir,
    path.join(changeDir, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  await fs.writeFile(path.join(changeDir, '.spok.yaml'), 'schema: output-safety\n', 'utf-8');
  await fs.writeFile(
    path.join(schemaDir, 'schema.yaml'),
    [
      'name: output-safety',
      'version: 1',
      'artifacts:',
      '  - id: traversal',
      '    generates: ../outside.md',
      '    description: Traversal output',
      '    template: unused.md',
      '    requires: []',
      '  - id: symlink',
      '    generates: linked/output.md',
      '    description: Symlink output',
      '    template: unused.md',
      '    requires: []',
      '',
    ].join('\n'),
    'utf-8'
  );
});

Given('a change whose tracking file escapes by {string}', async function (
  this: ArtifactOutputSafetyWorld,
  method: string
) {
  assert.ok(method === 'traversal' || method === 'symlink', `unexpected escape method: ${method}`);

  this.projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spok-artifact-output-safety-'));
  const changeDir = path.join(this.projectDir, 'spok', 'changes', 'demo');
  const schemaDir = path.join(this.projectDir, 'spok', 'schemas', 'tracking-safety');
  const outsideTasksDir = path.join(this.projectDir, 'outside-tasks');
  const outsideTasksPath = path.join(outsideTasksDir, 'tasks.md');

  await fs.mkdir(changeDir, { recursive: true });
  await fs.mkdir(schemaDir, { recursive: true });
  await fs.mkdir(outsideTasksDir, { recursive: true });
  await fs.writeFile(outsideTasksPath, '- [x] outside secret task\n', 'utf-8');
  await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n', 'utf-8');
  await fs.writeFile(path.join(changeDir, '.spok.yaml'), 'schema: tracking-safety\n', 'utf-8');

  const tracks =
    method === 'traversal'
      ? path.relative(changeDir, outsideTasksPath).split(path.sep).join('/')
      : 'linked-tasks/tasks.md';

  if (method === 'symlink') {
    await fs.symlink(
      outsideTasksDir,
      path.join(changeDir, 'linked-tasks'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  }

  await fs.writeFile(
    path.join(schemaDir, 'schema.yaml'),
    [
      'name: tracking-safety',
      'version: 1',
      'artifacts:',
      '  - id: proposal',
      '    generates: proposal.md',
      '    description: Proposal artifact',
      '    template: unused.md',
      '    requires: []',
      'apply:',
      '  requires: [proposal]',
      `  tracks: ${tracks}`,
      '',
    ].join('\n'),
    'utf-8'
  );
});

When('I request JSON status for the change', async function (this: ArtifactOutputSafetyWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by the project setup step');
  this.cliResult = await runCLI(['status', '--change', 'demo', '--json'], {
    cwd: this.projectDir,
    env: { SPOK_TELEMETRY: '0' },
    timeoutMs: 10_000,
  });
});

When('I request JSON apply instructions for the change', async function (
  this: ArtifactOutputSafetyWorld
) {
  assert.ok(this.projectDir, 'projectDir must be set by the project setup step');
  this.cliResult = await runCLI(['instructions', 'apply', '--change', 'demo', '--json'], {
    cwd: this.projectDir,
    env: { SPOK_TELEMETRY: '0' },
    timeoutMs: 10_000,
  });
});

Then('neither outside artifact output is resolved', function (this: ArtifactOutputSafetyWorld) {
  const payload = statusPayload(this);
  assert.deepEqual(payload.artifactPaths.traversal.existingOutputPaths, []);
  assert.deepEqual(payload.artifactPaths.symlink.existingOutputPaths, []);
});

Then('the change is not complete', function (this: ArtifactOutputSafetyWorld) {
  assert.equal(statusPayload(this).isComplete, false);
});

Then('outside apply tasks are not loaded', function (this: ArtifactOutputSafetyWorld) {
  const payload = applyPayload(this);
  assert.deepEqual(payload.tasks, []);
  assert.doesNotMatch(
    `${this.cliResult?.stdout ?? ''}${this.cliResult?.stderr ?? ''}`,
    /outside secret task/
  );
});

Then('apply is blocked because the tracking file is missing', function (
  this: ArtifactOutputSafetyWorld
) {
  const payload = applyPayload(this);
  assert.equal(payload.state, 'blocked');
  assert.match(payload.instruction, /tasks\.md file is missing/);
});

After({ tags: '@artifact-output-safety' }, async function (this: ArtifactOutputSafetyWorld) {
  if (this.projectDir) {
    await fs.rm(this.projectDir, { recursive: true, force: true });
  }
});
