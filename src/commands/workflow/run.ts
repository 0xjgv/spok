/**
 * Drives the deterministic flow state machine to a terminal outcome without an
 * interpreting agent: each ready step is dispatched to its routed harness as a
 * foreground subprocess, and completion is recorded from artifacts and a
 * machine-readable output contract — never from interpretation.
 */
import path from 'node:path';
import {
  DESIGN_REVIEW_BLOCK_CODES,
  FLOW_PROFILE_ENV,
  SUMMARY_MAX_LENGTH,
  completeFlowStep,
  extractMarkdownSection,
  flowBlockCode,
  getFlowNext,
  readArtifact,
} from './flow.js';
import type { FlowCompleteInput, FlowStep } from './flow.js';
import {
  defaultRunnerLookup,
  killActiveHarnessGroup,
  resolveProjectRoot,
} from './harness-runners.js';
import type { RunnerLookup } from './harness-runners.js';

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

/**
 * Blocked codes that mean the just-dispatched harness broke its completion
 * contract (no artifact, unreadable verdict, unusable work root). The blocked
 * state is never persisted, so a plain re-run resumes the same step — these
 * report as resumable step failures (exit 3), not do-not-retry blockers.
 */
const STEP_CONTRACT_FAILURE_CODES = new Set([
  'missing_output',
  'validation_verdict_unreadable',
  'invalid_work_root',
  'missing_work_root',
]);

export interface RunCommandOptions {
  profile?: string;
  json?: boolean;
}

function capSummary(text: string): string {
  return text.slice(0, SUMMARY_MAX_LENGTH);
}

/** Splits the already-trimmed message into [body, lastNonEmptyLine]. */
function splitTrailingLine(trimmed: string): { body: string; lastLine: string } {
  const newlineIndex = trimmed.lastIndexOf('\n');
  if (newlineIndex === -1) return { body: '', lastLine: trimmed };
  return {
    body: trimmed.slice(0, newlineIndex).trim(),
    lastLine: trimmed.slice(newlineIndex + 1).trim(),
  };
}

/** Undefined means the contract was not met: the step must not be completed. */
export function parseSummaryCompletion(
  finalMessage: string
): { summary: string; workRoot?: string } | undefined {
  const trimmed = finalMessage.trim();
  if (!trimmed) return undefined;

  const { body, lastLine } = splitTrailingLine(trimmed);
  const workRootMatch = lastLine.match(/^[*_]*Work root[*_]*:[*_]*\s*(.+)$/i);
  if (!workRootMatch) return { summary: capSummary(trimmed) };

  if (!body) return undefined; // Only a Work root line: no summary to record.
  const workRoot = stripTokenDecoration(workRootMatch[1]!.trim());
  return { summary: capSummary(body), workRoot };
}

/** Harness replies wrap tokens in backticks/quotes or end them with punctuation. */
function stripTokenDecoration(token: string): string {
  return token.replace(/^[`'"]+|[`'".,;:]+$/g, '');
}

/** Undefined means no trailing `Commit: <sha>` line: the step must not be completed. */
export function parseCommitCompletion(
  finalMessage: string
): { commit: string; summary?: string } | undefined {
  const trimmed = finalMessage.trim();
  if (!trimmed) return undefined;

  const { body, lastLine } = splitTrailingLine(trimmed);
  const commitMatch = lastLine.match(/^[*_]*Commit[*_]*:[*_]*\s*(\S+)$/i);
  if (!commitMatch) return undefined;

  const commit = stripTokenDecoration(commitMatch[1]!);
  if (!commit) return undefined;
  return { commit, summary: body ? capSummary(body) : undefined };
}

/** FlowCompleteInput for the step, or a failure reason string. */
function buildCompleteInput(step: FlowStep, finalMessage: string): FlowCompleteInput | string {
  if (step.completionKind === 'file') {
    // The artifact gate in completeFlowStep validates the step's own expected
    // output path; the harness message is ignored.
    return { step: step.id };
  }

  if (step.completionKind === 'commit') {
    const parsed = parseCommitCompletion(finalMessage);
    if (!parsed) {
      return 'harness reply did not end with a `Commit: <sha>` line';
    }
    return { step: step.id, commit: parsed.commit, summary: parsed.summary };
  }

  const parsed = parseSummaryCompletion(finalMessage);
  if (!parsed) {
    return 'harness reply contained no summary text';
  }
  return { step: step.id, summary: parsed.summary, workRoot: parsed.workRoot };
}

/**
 * `steps` holds the persisted list; the dispatched step is a prompt-carrying
 * copy, so the position comes from the ready status rather than identity.
 */
function describeStep(step: FlowStep, steps: FlowStep[]): string {
  const position = steps.findIndex((candidate) => candidate.status === 'ready') + 1;
  const effort = step.effort ? ` (effort ${step.effort})` : '';
  return `[${position}/${steps.length}] ${step.id} → ${step.runner} ${step.model}${effort}`;
}

/** The recorded commit step's SHA on the terminal complete response, if any. */
function findCommitSha(steps: FlowStep[]): string | undefined {
  return steps.find((step) => step.completionKind === 'commit')?.result?.commit;
}

/** One semantic progress event per report site; `--json` renders these as JSONL. */
type RunEvent =
  | { event: 'run_started'; taskDir: string; profile: string | null }
  | {
      event: 'step_started';
      step: string;
      runner: string;
      model: string;
      effort?: string;
      attempt?: number;
    }
  | { event: 'step_completed'; step: string }
  | { event: 'warning'; message: string }
  | { event: 'blocked'; code: string; reason: string; humanDecisions?: string }
  | { event: 'step_failed'; step: string | null; reason: string }
  | { event: 'complete'; commit?: string };

/** JSONL under `--json`; otherwise the human line, at the sites that have one. */
function report(json: boolean, event: RunEvent, humanLine?: string): void {
  if (json) {
    // JSON.stringify drops undefined-valued keys, so optional fields stay absent.
    console.log(JSON.stringify({ schemaVersion: 1, ...event }));
  } else if (humanLine !== undefined) {
    console.log(humanLine);
  }
}

const HUMAN_DECISION_CODES = new Set<string>(DESIGN_REVIEW_BLOCK_CODES);

/**
 * Attachment for a blocked event: only the two design-review codes qualify, and
 * only when the task's design review carries a `## Human Decisions Required`
 * section. Best-effort — an unreadable file or an empty section attaches nothing.
 */
async function humanDecisionsFor(taskDir: string, code: string): Promise<string | undefined> {
  if (!HUMAN_DECISION_CODES.has(code)) return undefined;
  const content = await readArtifact(path.join(taskDir, 'design-review.md'));
  if (content === undefined) return undefined;
  return extractMarkdownSection(content, 'Human Decisions Required') || undefined;
}

/** Reports the blocker, then yields the run's exit code. */
async function reportBlocked(json: boolean, taskDir: string, reason?: string): Promise<number> {
  const blockReason = reason ?? 'Unknown workflow blocker';
  const code = flowBlockCode(blockReason);
  report(
    json,
    {
      event: 'blocked',
      code,
      reason: blockReason,
      humanDecisions: await humanDecisionsFor(taskDir, code),
    },
    `Blocked: ${blockReason}`
  );
  return 2;
}

/** Reports the failure, then yields the run's exit code. */
function reportStepFailed(json: boolean, stepId: string | null, detail: string): number {
  const reason = stepId === null ? detail : `Step ${stepId} failed: ${detail}`;
  report(json, { event: 'step_failed', step: stepId, reason }, reason);
  return 3;
}

/** Overrides the flow profile for this run; returns the restorer. */
function overrideFlowProfile(profile: string | undefined): () => void {
  const original = process.env[FLOW_PROFILE_ENV];
  if (profile) process.env[FLOW_PROFILE_ENV] = profile;
  return () => {
    if (original === undefined) delete process.env[FLOW_PROFILE_ENV];
    else process.env[FLOW_PROFILE_ENV] = original;
  };
}

/** Routes SIGINT/SIGTERM to the running harness's process group; returns the disposer. */
function forwardSignalsToHarness(): () => void {
  const removers = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    const handler = () => {
      killActiveHarnessGroup(signal);
      process.exit(SIGNAL_EXIT_CODES[signal]);
    };
    process.on(signal, handler);
    return () => void process.removeListener(signal, handler);
  });
  return () => removers.forEach((remove) => remove());
}

export async function runCommand(
  taskDir: string,
  options: RunCommandOptions = {},
  runners: RunnerLookup = defaultRunnerLookup
): Promise<number> {
  const json = options.json === true;
  const restoreFlowProfile = overrideFlowProfile(options.profile);
  const stopForwardingSignals = forwardSignalsToHarness();

  try {
    const projectRoot = await resolveProjectRoot(taskDir);
    let started = false;
    // Each distinct warning text is relayed at most once per run:
    // memoryWarning recurs on every response.
    const relayedWarnings = new Set<string>();

    while (true) {
      const next = await getFlowNext(taskDir);
      if (!started) {
        started = true;
        // Emitted before the event derived from this same response.
        report(json, {
          event: 'run_started',
          taskDir: next.taskDir,
          profile: next.profile ?? null,
        });
      }
      for (const warning of [next.memoryWarning, next.workRootWarning]) {
        if (!warning || relayedWarnings.has(warning)) continue;
        relayedWarnings.add(warning);
        report(json, { event: 'warning', message: warning }, `Warning: ${warning}`);
      }
      if (next.state === 'blocked') return reportBlocked(json, next.taskDir, next.reason);
      if (next.state === 'complete') {
        report(
          json,
          { event: 'complete', commit: findCommitSha(next.steps) },
          `Flow complete: ${next.taskDir}`
        );
        return 0;
      }

      const step = next.nextStep;
      if (!step?.prompt) {
        return reportStepFailed(
          json,
          null,
          'No dispatchable step: the flow is ready but carries no prompt.'
        );
      }

      report(
        json,
        {
          event: 'step_started',
          step: step.id,
          runner: step.runner,
          model: step.model,
          effort: step.effort,
          attempt: step.attempt,
        },
        describeStep(step, next.steps)
      );

      const runner = runners(step.runner);
      if (!runner) return reportStepFailed(json, step.id, `no runner available for ${step.runner}.`);

      const result = await runner.run({
        model: step.model,
        effort: step.effort,
        prompt: step.prompt,
        projectRoot,
      });
      if (!result.ok) return reportStepFailed(json, step.id, result.reason);

      const input = buildCompleteInput(step, result.finalMessage);
      if (typeof input === 'string') return reportStepFailed(json, step.id, input);

      const completed = await completeFlowStep(taskDir, input);
      if (completed.state === 'blocked') {
        // A contract break by the harness we just ran resumes on re-invocation;
        // everything else is a genuine workflow blocker.
        const reason = completed.reason ?? 'Unknown workflow blocker';
        if (STEP_CONTRACT_FAILURE_CODES.has(flowBlockCode(reason))) {
          return reportStepFailed(json, step.id, reason);
        }
        return reportBlocked(json, completed.taskDir, completed.reason);
      }
      report(json, { event: 'step_completed', step: step.id }, `${step.id} completed`);
    }
  } finally {
    stopForwardingSignals();
    restoreFlowProfile();
  }
}
