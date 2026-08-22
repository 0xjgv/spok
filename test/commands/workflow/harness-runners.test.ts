import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildClaudeArgv,
  buildCodexArgv,
  claudeRunner,
  codexRunner,
  resolveProjectRoot,
} from '../../../src/commands/workflow/harness-runners.js';
import type { HarnessRunRequest } from '../../../src/commands/workflow/harness-runners.js';

const PROMPT = 'Call the `spok-create-plan` skill with `/tmp/task` as the argument.';

// The stubs are POSIX shell scripts; CI runs the process-boundary cases on POSIX.
const posixOnly = process.platform === 'win32' ? it.skip : it;

function request(overrides: Partial<HarnessRunRequest> = {}): HarnessRunRequest {
  return { model: 'opus', prompt: PROMPT, projectRoot: os.tmpdir(), ...overrides };
}

describe('harness argv construction', () => {
  it('builds the claude recipe without effort', () => {
    expect(buildClaudeArgv(request())).toEqual([
      '-p',
      '--no-session-persistence',
      '--permission-mode',
      'auto',
      '--model',
      'opus',
    ]);
  });

  it('appends the effort flag when the step carries one', () => {
    expect(buildClaudeArgv(request({ effort: 'xhigh' }))).toEqual([
      '-p',
      '--no-session-persistence',
      '--permission-mode',
      'auto',
      '--model',
      'opus',
      '--effort',
      'xhigh',
    ]);
  });

  it('builds the codex recipe with the project root and output file', () => {
    expect(
      buildCodexArgv(
        request({ model: 'gpt-5.6-sol', projectRoot: '/repo' }),
        '/tmp/out/last-message.txt'
      )
    ).toEqual([
      'exec',
      '--ephemeral',
      '--dangerously-bypass-hook-trust',
      '--cd',
      '/repo',
      '--sandbox',
      'workspace-write',
      '--model',
      'gpt-5.6-sol',
      '-o',
      '/tmp/out/last-message.txt',
      '-',
    ]);
  });

  it('passes codex reasoning effort as a config override only when present', () => {
    expect(buildCodexArgv(request({ model: 'gpt-5.6-sol', effort: 'max' }), '/tmp/out')).toContain(
      'model_reasoning_effort="max"'
    );
  });

  it('never places the prompt in the argument list', () => {
    expect(buildClaudeArgv(request({ effort: 'high' }))).not.toContain(PROMPT);
    expect(buildCodexArgv(request({ effort: 'high' }), '/tmp/out')).not.toContain(PROMPT);
  });
});

describe('project root resolution', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `spok-run-root-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // git prints a forward-slash (and possibly short-name) toplevel on Windows,
  // which no path normalization reliably reconciles with fs.realpath there.
  posixOnly('returns the git toplevel for a task directory inside a repository', async () => {
    execFileSync('git', ['init', '-b', 'main', tempDir], { encoding: 'utf-8' });
    const taskDir = path.join(tempDir, 'spok', 'changes', 'demo');
    await fs.mkdir(taskDir, { recursive: true });

    expect(realpathSync.native(await resolveProjectRoot(taskDir))).toBe(
      realpathSync.native(tempDir)
    );
  });

  posixOnly('falls back to the resolved task directory outside a repository', async () => {
    expect(await resolveProjectRoot(tempDir)).toBe(path.resolve(tempDir));
  });
});

describe('harness subprocess failure mapping', () => {
  let binDir: string;
  let originalPath: string | undefined;

  async function writeStub(name: string, script: string): Promise<void> {
    const stubPath = path.join(binDir, name);
    await fs.writeFile(stubPath, script, 'utf-8');
    await fs.chmod(stubPath, 0o755);
  }

  beforeEach(async () => {
    binDir = path.join(os.tmpdir(), `spok-run-bin-${randomUUID()}`);
    await fs.mkdir(binDir, { recursive: true });
    originalPath = process.env.PATH;
    // Stubs shadow the real harnesses while still reaching system utilities.
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`;
  });

  afterEach(async () => {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    await fs.rm(binDir, { recursive: true, force: true });
  });

  posixOnly('reports a missing executable instead of throwing', async () => {
    process.env.PATH = binDir; // Nothing on PATH but the empty stub directory.

    expect(await claudeRunner.run(request())).toEqual({
      ok: false,
      reason: 'claude executable not found on PATH',
    });
  });

  posixOnly('reports the exit code of a failing harness', async () => {
    await writeStub('claude', '#!/bin/sh\ncat > /dev/null\nexit 7\n');

    expect(await claudeRunner.run(request())).toEqual({
      ok: false,
      reason: 'claude exited with code 7',
    });
  });

  posixOnly('returns the claude stdout as the final message', async () => {
    await writeStub('claude', '#!/bin/sh\ncat > /dev/null\nprintf "done\\nWork root: /repo\\n"\n');

    expect(await claudeRunner.run(request())).toEqual({
      ok: true,
      finalMessage: 'done\nWork root: /repo\n',
    });
  });

  posixOnly('reads the codex final message from the file it was told to write', async () => {
    await writeStub(
      'codex',
      '#!/bin/sh\nout=""\nwhile [ $# -gt 0 ]; do\n  if [ "$1" = "-o" ]; then out="$2"; fi\n  shift\ndone\ncat > /dev/null\nprintf "codex reply" > "$out"\n'
    );

    expect(await codexRunner.run(request({ model: 'gpt-5.6-sol' }))).toEqual({
      ok: true,
      finalMessage: 'codex reply',
    });
  });

  posixOnly('reports a codex run that wrote no final message', async () => {
    await writeStub('codex', '#!/bin/sh\ncat > /dev/null\nexit 0\n');

    const result = await codexRunner.run(request({ model: 'gpt-5.6-sol' }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/did not write its final message/);
  });
});
