/**
 * The harness boundary the run loop dispatches through: one runner per harness
 * (claude, codex). The loop never constructs a command line itself. The
 * invocations mirror the recipes the spok-flow skill has always specified.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FLOW_PROFILE_ENV, runGit } from './flow.js';
import type { FlowRunner } from './flow.js';

export interface HarnessRunRequest {
  model: string;
  effort?: string;
  /** The state machine's composed prompt, dispatched verbatim. */
  prompt: string;
  projectRoot: string;
}

export type HarnessRunResult =
  | { ok: true; finalMessage: string }
  | { ok: false; reason: string };

export interface HarnessRunner {
  run(request: HarnessRunRequest): Promise<HarnessRunResult>;
}

export type RunnerLookup = (runner: FlowRunner) => HarnessRunner | undefined;

/** Exposed for tests: the exact argv, prompt never included. */
export function buildClaudeArgv(request: HarnessRunRequest): string[] {
  const argv = [
    '-p',
    '--no-session-persistence',
    '--permission-mode',
    'auto',
    '--model',
    request.model,
  ];
  if (request.effort) argv.push('--effort', request.effort);
  return argv;
}

/** Exposed for tests: the exact argv, prompt never included; `-` reads it from stdin. */
export function buildCodexArgv(request: HarnessRunRequest, outputFile: string): string[] {
  const argv = [
    'exec',
    '--ephemeral',
    '--dangerously-bypass-hook-trust',
    '--cd',
    request.projectRoot,
    '--sandbox',
    'workspace-write',
    '--model',
    request.model,
  ];
  if (request.effort) argv.push('-c', `model_reasoning_effort="${request.effort}"`);
  argv.push('-o', outputFile, '-');
  return argv;
}

/** `git -C <task-dir> rev-parse --show-toplevel`, falling back to the task dir. */
export async function resolveProjectRoot(taskDir: string): Promise<string> {
  const toplevel = (await runGit(taskDir, ['rev-parse', '--show-toplevel']))?.trim();
  return toplevel || path.resolve(taskDir);
}

let activeChild: ChildProcess | undefined;

/**
 * Signals the running harness's whole process group, if any. Cancellation
 * records no completion, so the current step stays ready and the run resumes
 * where it stopped.
 */
export function killActiveHarnessGroup(signal: 'SIGINT' | 'SIGTERM'): void {
  const pid = activeChild?.pid;
  if (!pid) return;
  try {
    process.kill(-pid, signal); // Negative pid: the child's whole process group.
  } catch {
    // Child already exited between the check and the kill.
  }
}

type SpawnOutcome = { ok: true; stdout: string } | { ok: false; reason: string };

/**
 * Spawns the harness detached so it leads its own process group (the signal
 * handlers kill the group), pipes the prompt to stdin, and resolves on close.
 * `forwardStdoutToStderr` streams codex's progress output through; claude's
 * stdout is captured as the final message instead. stderr is inherited.
 */
function spawnHarness(
  command: string,
  argv: string[],
  prompt: string,
  cwd: string,
  forwardStdoutToStderr: boolean
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    // The run's profile override must not leak into the harness: a nested spok
    // invocation from a subagent would inherit a profile it was never given.
    const env = { ...process.env };
    delete env[FLOW_PROFILE_ENV];
    const child = spawn(command, argv, {
      cwd,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    activeChild = child;

    let stdout = '';
    child.stdout!.setEncoding('utf-8');
    child.stdout!.on('data', (chunk: string) => {
      if (forwardStdoutToStderr) {
        process.stderr.write(chunk);
      } else {
        stdout += chunk;
      }
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      activeChild = undefined;
      resolve({
        ok: false,
        reason:
          error.code === 'ENOENT'
            ? `${command} executable not found on PATH`
            : `${command} failed to start: ${error.message}`,
      });
    });
    child.on('close', (code) => {
      activeChild = undefined;
      resolve(
        code === 0
          ? { ok: true, stdout }
          : { ok: false, reason: `${command} exited with code ${code ?? 'null (signal)'}` }
      );
    });

    child.stdin!.on('error', () => {
      // A child that dies before reading its stdin surfaces via 'error'/'close'.
    });
    child.stdin!.end(prompt);
  });
}

export const claudeRunner: HarnessRunner = {
  async run(request) {
    const outcome = await spawnHarness(
      'claude',
      buildClaudeArgv(request),
      request.prompt,
      request.projectRoot,
      false
    );
    return outcome.ok ? { ok: true, finalMessage: outcome.stdout } : outcome;
  },
};

export const codexRunner: HarnessRunner = {
  async run(request) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spok-run-codex-'));
    const outputFile = path.join(tempDir, 'last-message.txt');
    try {
      const outcome = await spawnHarness(
        'codex',
        buildCodexArgv(request, outputFile),
        request.prompt,
        request.projectRoot,
        true // codex streams progress on stdout; forward it to parent stderr.
      );
      if (!outcome.ok) return outcome;

      try {
        return { ok: true, finalMessage: await fs.readFile(outputFile, 'utf-8') };
      } catch {
        return { ok: false, reason: `codex did not write its final message to ${outputFile}` };
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },
};

const RUNNERS: Record<FlowRunner, HarnessRunner> = {
  claude: claudeRunner,
  codex: codexRunner,
};

export const defaultRunnerLookup: RunnerLookup = (runner: FlowRunner) => RUNNERS[runner];
