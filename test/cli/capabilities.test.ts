import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { version } from '../../package.json';
import { runCLI } from '../helpers/run-cli.js';

interface ManifestCommand {
  path: string;
  visibility: 'user' | 'skill' | 'internal';
  emitsJson: boolean;
}

interface ManifestSetting {
  path: string;
  type: string;
  default: unknown;
  description: string;
}

interface CapabilitiesManifest {
  schemaVersion: number;
  version: string;
  description: string;
  recommendedFlow: string[];
  commands: ManifestCommand[];
  settings: ManifestSetting[];
}

// Keep telemetry enabled (to exercise the first-run notice path) but stop the
// spawned CLI from making the real ~7s PostHog network flush, which otherwise
// makes this suite flaky under parallel load. See offline-telemetry.mjs.
const offlineTelemetryPreload = new URL('../helpers/offline-telemetry.mjs', import.meta.url).href;

function jsonTelemetryEnv(configHome: string): NodeJS.ProcessEnv {
  return {
    CI: 'false',
    DO_NOT_TRACK: '0',
    NODE_OPTIONS: `--import ${offlineTelemetryPreload}`,
    SPOK_TELEMETRY: '1',
    XDG_CONFIG_HOME: configHome,
  };
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout);
}

describe('spok capabilities', () => {
  let tempDir: string;
  let configHome: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `spok-capabilities-${randomUUID()}`);
    configHome = path.join(tempDir, 'config');
    await fs.mkdir(path.join(tempDir, 'spok', 'changes'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('prints the current CLI surface as JSON', async () => {
    const result = await runCLI(['capabilities', '--json'], {
      env: {
        SPOK_TELEMETRY: '0',
      },
      timeoutMs: 10_000,
    });
    const manifest = parseJson(result.stdout) as CapabilitiesManifest;
    const byPath = new Map(manifest.commands.map((command) => [command.path, command]));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.version).toBe(version);
    expect(manifest.description).toBe('AI-native system for spec-driven development');
    expect(manifest.recommendedFlow).toEqual([
      '/spok-explore',
      '/spok-propose',
      '/spok-apply',
      '/spok-archive',
    ]);
    expect(manifest.settings).toContainEqual(
      expect.objectContaining({
        path: 'flow.self_learn',
        type: 'boolean',
        default: false,
      })
    );
    expect(byPath.get('new change')).toMatchObject({ visibility: 'skill' });
    expect(byPath.get('flow status')).toMatchObject({ visibility: 'internal', emitsJson: true });
    expect(byPath.get('flow next')).toMatchObject({ visibility: 'internal', emitsJson: true });
    expect(byPath.get('flow complete')).toMatchObject({ visibility: 'internal', emitsJson: true });
    expect(byPath.get('list')).toMatchObject({ emitsJson: true });
    expect(byPath.get('status')).toMatchObject({ emitsJson: true });
    expect(byPath.get('instructions')).toMatchObject({ emitsJson: true });
    expect(byPath.get('capabilities')).toMatchObject({ visibility: 'skill', emitsJson: true });
  });

  it.each([
    ['list --json', ['list', '--json']],
    ['status --json', ['status', '--json']],
    ['capabilities --json', ['capabilities', '--json']],
  ])('keeps %s stdout parseable when telemetry notice has not been recorded', async (_label, args) => {
    const result = await runCLI(args, {
      cwd: tempDir,
      env: jsonTelemetryEnv(configHome),
      timeoutMs: 15_000,
    });

    expect(result.exitCode).toBe(0);
    expect(() => parseJson(result.stdout)).not.toThrow();
    expect(result.stdout).not.toContain('Note: Spok collects anonymous usage stats');
  });
});
