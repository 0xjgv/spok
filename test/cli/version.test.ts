import { describe, expect, it } from 'vitest';
import { version } from '../../package.json';
import { runCLI } from '../helpers/run-cli.js';

describe('spok version', () => {
  it.each([
    ['version'],
    ['--version'],
    ['-V'],
  ])('prints the package version for %s', async (...args) => {
    const result = await runCLI(args, {
      env: {
        SPOK_TELEMETRY: '0',
      },
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(version);
  });
});
