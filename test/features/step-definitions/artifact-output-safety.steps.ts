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

function statusPayload(world: ArtifactOutputSafetyWorld): StatusPayload {
  assert.ok(world.cliResult, 'cliResult must be set by the status step');
  assert.equal(world.cliResult.exitCode, 0, world.cliResult.stderr);
  return JSON.parse(world.cliResult.stdout) as StatusPayload;
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

When('I request JSON status for the change', async function (this: ArtifactOutputSafetyWorld) {
  assert.ok(this.projectDir, 'projectDir must be set by the project setup step');
  this.cliResult = await runCLI(['status', '--change', 'demo', '--json'], {
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

After({ tags: '@artifact-output-safety' }, async function (this: ArtifactOutputSafetyWorld) {
  if (this.projectDir) {
    await fs.rm(this.projectDir, { recursive: true, force: true });
  }
});
