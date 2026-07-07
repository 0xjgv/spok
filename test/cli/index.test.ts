import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cliMocks = vi.hoisted(() => ({
  applyInstructionsCommand: vi.fn(async () => {}),
  flowCompleteCommand: vi.fn(async () => {}),
  flowNextCommand: vi.fn(async () => {}),
  flowStatusCommand: vi.fn(async () => {}),
  initExecute: vi.fn(async () => {}),
  initOptions: vi.fn(),
  instructionsCommand: vi.fn(async () => {}),
  maybeShowTelemetryNotice: vi.fn(async () => {}),
  newChangeCommand: vi.fn(async () => {}),
  shutdown: vi.fn(async () => {}),
  statusCommand: vi.fn(async () => {}),
  trackCommand: vi.fn(async () => {}),
  trackTelemetryEvent: vi.fn(async () => {}),
}));

vi.mock('../../src/commands/workflow/index.js', () => ({
  DEFAULT_SCHEMA: 'spec-driven',
  applyInstructionsCommand: cliMocks.applyInstructionsCommand,
  flowCompleteCommand: cliMocks.flowCompleteCommand,
  flowNextCommand: cliMocks.flowNextCommand,
  flowStatusCommand: cliMocks.flowStatusCommand,
  instructionsCommand: cliMocks.instructionsCommand,
  newChangeCommand: cliMocks.newChangeCommand,
  statusCommand: cliMocks.statusCommand,
}));

vi.mock('../../src/core/init.js', () => ({
  InitCommand: class {
    execute = cliMocks.initExecute;

    constructor(options: unknown) {
      cliMocks.initOptions(options);
    }
  },
}));

vi.mock('../../src/telemetry/index.js', () => ({
  maybeShowTelemetryNotice: cliMocks.maybeShowTelemetryNotice,
  shutdown: cliMocks.shutdown,
  trackCommand: cliMocks.trackCommand,
  trackTelemetryEvent: cliMocks.trackTelemetryEvent,
}));

async function importCliWithArgs(args: string[]): Promise<void> {
  process.argv = [process.execPath, 'spok', ...args];
  await import('../../src/cli/index.js');
}

describe('CLI entrypoint', () => {
  let originalArgv: string[];
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalArgv = [...process.argv];
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spok-cli-index-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as typeof process.exit);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('warns about invalid project config before non-json workflow commands run', async () => {
    const spokDir = path.join(tempDir, 'spok');
    fs.mkdirSync(spokDir, { recursive: true });
    fs.writeFileSync(
      path.join(spokDir, 'config.yaml'),
      `schema: ""
flow:
  self_learn: "yes"
`
    );
    process.chdir(tempDir);

    await importCliWithArgs(['status', '--change', 'demo']);

    await vi.waitFor(() => {
      expect(cliMocks.statusCommand).toHaveBeenCalledWith(
        expect.objectContaining({ change: 'demo' })
      );
    });
    expect(console.error).toHaveBeenCalledWith(`Warning: invalid Spok config at ${path.join('spok', 'config.yaml')}`);
    expect(console.error).toHaveBeenCalledWith('- schema: schema must be a non-empty string');
    expect(console.error).toHaveBeenCalledWith('- flow.self_learn: flow.self_learn must be boolean');
    expect(console.error).toHaveBeenCalledWith('Run `spok doctor` for a full configuration report.');
  });

  it('allows init to target a directory that does not exist yet', async () => {
    const targetPath = path.join(tempDir, 'new-project');

    await importCliWithArgs(['init', targetPath, '--tools', 'none', '--force']);

    await vi.waitFor(() => {
      expect(cliMocks.initExecute).toHaveBeenCalledWith(targetPath);
    });
    expect(cliMocks.initOptions).toHaveBeenCalledWith({
      force: true,
      tools: 'none',
    });
    expect(console.log).toHaveBeenCalledWith(`Directory "${targetPath}" doesn't exist, it will be created.`);
  });
});
