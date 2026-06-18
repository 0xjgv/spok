import { describe, expect, it } from 'vitest';
import { version } from '../../package.json';
import { runCLI } from '../helpers/run-cli.js';

function commandNames(stdout: string): string[] {
  const lines = stdout.split('\n');
  const commandsIndex = lines.findIndex((line) => line.trim() === 'Commands:');
  if (commandsIndex === -1) return [];
  const names: string[] = [];
  for (const line of lines.slice(commandsIndex + 1)) {
    if (line.trim() === '') break;
    if (line.startsWith('  ') && line.length > 2 && line[2].trim() !== '') {
      names.push(line.trim().split(' ')[0]);
    }
  }
  return names;
}

describe('spok version', () => {
  it('prints the package version', async () => {
    const result = await runCLI(['version'], {
      env: {
        SPOK_TELEMETRY: '0',
      },
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(version);
  });

  it.each([
    ['--version'],
    ['-V'],
    ['--no-color'],
  ])('rejects removed option %s', async (option) => {
    const result = await runCLI([option], {
      env: {
        SPOK_TELEMETRY: '0',
      },
      timeoutMs: 10_000,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`unknown option '${option}'`);
  });

  it('lists version and help before the rest of the commands', async () => {
    const result = await runCLI(['--help'], {
      env: {
        SPOK_TELEMETRY: '0',
      },
      timeoutMs: 10_000,
    });
    const lines = result.stdout.split('\n');
    const commandsIndex = lines.findIndex((line) => line.trim() === 'Commands:');

    expect(result.exitCode).toBe(0);
    expect(commandsIndex).not.toBe(-1);
    expect(commandNames(result.stdout).slice(0, 2)).toEqual(['version', 'help']);
  });
});

describe('spok skills help', () => {
  it('shows concrete examples without listing a nested help command', async () => {
    const result = await runCLI(['skills', '--help'], {
      env: {
        SPOK_TELEMETRY: '0',
      },
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(commandNames(result.stdout)).toEqual(['install']);
    expect(result.stdout).toContain('Examples:');
    expect(result.stdout).toContain('spok skills install --tools claude,codex,factory');
    expect(result.stdout).toContain('Help:');
    expect(result.stdout).toContain('spok help skills');
    expect(result.stdout).toContain('spok skills install --help');
    expect(result.stdout).not.toContain('help [command]');
  });

  it('corrects the misleading nested skills help form', async () => {
    const result = await runCLI(['skills', 'help', 'skills'], {
      env: {
        SPOK_TELEMETRY: '0',
      },
      timeoutMs: 10_000,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown skills subcommand: skills');
    expect(result.stderr).toContain('Use one of:');
    expect(result.stderr).toContain('spok help skills');
    expect(result.stderr).toContain('spok skills --help');
    expect(result.stderr).toContain('spok skills install --help');
  });

  it('keeps skills help as a hidden alias for skills --help', async () => {
    const result = await runCLI(['skills', 'help'], {
      env: {
        SPOK_TELEMETRY: '0',
      },
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(commandNames(result.stdout)).toEqual(['install']);
  });
});
