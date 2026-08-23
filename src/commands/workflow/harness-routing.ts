import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Per-probe ceiling; observed wall times are well under one second. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

export type AutoRunner = 'claude' | 'codex' | 'omp';
export type AutoModel =
  | 'haiku'
  | 'sonnet'
  | 'opus'
  | 'fable'
  | 'gpt-5.6-terra'
  | 'gpt-5.6-sol'
  | 'openai-codex/gpt-5.6-sol'
  | 'openai-codex/gpt-5.6-terra';
export type AutoEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const AUTO_POLICY_VERSION = 'auto-v1';

export interface AutoCandidate {
  runner: AutoRunner;
  model: AutoModel;
  effort?: AutoEffort;
}

type RejectionCode =
  | 'executable_missing'
  | 'not_authenticated'
  | 'probe_failed'
  | 'probe_timeout'
  | 'probe_unparseable'
  | 'model_unavailable'
  | 'effort_unsupported';

interface RouteRejection extends AutoCandidate {
  code: RejectionCode;
  reason: string;
}

/** Result of one non-billable probe. `models` is omp-only: selector → supported thinking levels. */
export interface CapabilityReport {
  runner: AutoRunner;
  available: boolean;
  models?: Map<string, string[]>;
  code?: RejectionCode;
  reason?: string;
}

/** Persisted on the resolved step as `route`. */
export interface AutoRouteRecord {
  policy: typeof AUTO_POLICY_VERSION;
  rejected: RouteRejection[];
}

interface AutoRoute extends AutoCandidate {
  route: AutoRouteRecord;
}

const SOL = 'openai-codex/gpt-5.6-sol';
const TERRA = 'openai-codex/gpt-5.6-terra';

/** Ordered candidates per step. OMP always follows the Codex candidate it mirrors. */
export const AUTO_V1_CANDIDATES_BY_ID = {
  'validate-problem': [
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
    { runner: 'omp', model: SOL, effort: 'xhigh' },
    { runner: 'claude', model: 'opus', effort: 'medium' },
  ],
  'research-questions': [
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
    { runner: 'omp', model: SOL, effort: 'medium' },
    { runner: 'claude', model: 'opus', effort: 'medium' },
  ],
  research: [
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
    { runner: 'omp', model: SOL, effort: 'medium' },
    { runner: 'claude', model: 'sonnet', effort: 'medium' },
  ],
  'design-discussion': [
    { runner: 'claude', model: 'fable', effort: 'xhigh' },
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
    { runner: 'omp', model: SOL, effort: 'max' },
  ],
  'structure-outline': [
    { runner: 'claude', model: 'fable', effort: 'xhigh' },
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
    { runner: 'omp', model: SOL, effort: 'xhigh' },
  ],
  'design-review': [
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
    { runner: 'omp', model: SOL, effort: 'xhigh' },
    { runner: 'claude', model: 'opus', effort: 'medium' },
  ],
  plan: [
    { runner: 'claude', model: 'fable', effort: 'xhigh' },
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
    { runner: 'omp', model: SOL, effort: 'max' },
  ],
  implement: [
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
    { runner: 'omp', model: SOL, effort: 'xhigh' },
    { runner: 'claude', model: 'opus', effort: 'medium' },
  ],
  simplify: [
    { runner: 'claude', model: 'opus' },
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
    { runner: 'omp', model: SOL, effort: 'xhigh' },
  ],
  validate: [
    { runner: 'claude', model: 'opus', effort: 'medium' },
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
    { runner: 'omp', model: SOL, effort: 'xhigh' },
  ],
  repair: [
    { runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
    { runner: 'omp', model: SOL, effort: 'max' },
    { runner: 'claude', model: 'opus', effort: 'high' },
  ],
  commit: [
    { runner: 'codex', model: 'gpt-5.6-terra', effort: 'low' },
    { runner: 'omp', model: TERRA, effort: 'low' },
    { runner: 'claude', model: 'haiku', effort: 'low' },
  ],
  'self-learn': [
    { runner: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
    { runner: 'omp', model: TERRA, effort: 'xhigh' },
    { runner: 'claude', model: 'sonnet', effort: 'xhigh' },
  ],
} satisfies Record<string, readonly AutoCandidate[]>;

type AutoStepId = keyof typeof AUTO_V1_CANDIDATES_BY_ID;

/** Walk the step's candidates in order; first eligible wins and carries every earlier rejection. */
export function selectAutoRoute(
  stepId: AutoStepId,
  reports: readonly CapabilityReport[]
): { route: AutoRoute } | { rejected: RouteRejection[] } {
  const reportsByRunner = new Map(reports.map((report) => [report.runner, report]));
  const rejected: RouteRejection[] = [];
  for (const candidate of AUTO_V1_CANDIDATES_BY_ID[stepId]) {
    const rejection = rejectCandidate(candidate, reportsByRunner.get(candidate.runner));
    if (rejection) {
      rejected.push(rejection);
      continue;
    }
    return { route: { ...candidate, route: { policy: AUTO_POLICY_VERSION, rejected } } };
  }
  return { rejected };
}

export type ProbeExec = (
  file: string,
  args: readonly string[],
  options: { timeout: number }
) => Promise<{ stdout: string; stderr: string }>;

const PROBE_COMMANDS: Record<AutoRunner, { file: string; args: readonly string[] }> = {
  omp: { file: 'omp', args: ['models', '--json'] },
  codex: { file: 'codex', args: ['login', 'status'] },
  claude: { file: 'claude', args: ['auth', 'status', '--json'] },
};

// Wrapper keeps the promisified execFile overloads out of the ProbeExec signature.
const defaultExec: ProbeExec = (file, args, options) => execFileAsync(file, [...args], options);

/** Probe each distinct runner once, concurrently. Never throws; failures become unavailable reports. */
export async function probeHarnesses(
  runners: readonly AutoRunner[],
  exec: ProbeExec = defaultExec
): Promise<CapabilityReport[]> {
  const distinct = [...new Set(runners)];
  return Promise.all(distinct.map((runner) => probeRunner(runner, exec)));
}

async function probeRunner(runner: AutoRunner, exec: ProbeExec): Promise<CapabilityReport> {
  const command = PROBE_COMMANDS[runner];
  try {
    const { stdout, stderr } = await exec(command.file, command.args, {
      timeout: DEFAULT_PROBE_TIMEOUT_MS,
    });
    return interpretProbe(runner, stdout, stderr);
  } catch (error) {
    return { runner, available: false, ...classifyProbeError(runner, error) };
  }
}

function interpretProbe(runner: AutoRunner, stdout: string, stderr: string): CapabilityReport {
  if (runner === 'omp') return interpretOmpModels(stdout);
  if (runner === 'claude') return interpretClaudeAuth(stdout);
  const status = [stdout, stderr].flatMap((stream) => stream.split('\n').map((line) => line.trim()));
  if (status.some((line) => line.startsWith('Logged in'))) return { runner, available: true };
  return {
    runner,
    available: false,
    code: 'not_authenticated',
    reason: `codex login status reported: ${firstLine(stdout) || firstLine(stderr) || '(no output)'}`,
  };
}

function interpretOmpModels(stdout: string): CapabilityReport {
  const parsed = parseJson(stdout);
  const models = (parsed as { models?: unknown } | undefined)?.models;
  if (!Array.isArray(models)) {
    return {
      runner: 'omp',
      available: false,
      code: 'probe_unparseable',
      reason: 'omp models --json did not return a models array.',
    };
  }
  const bySelector = new Map<string, string[]>();
  for (const entry of models) {
    if (!entry || typeof entry !== 'object') continue;
    const { selector, thinking } = entry as { selector?: unknown; thinking?: unknown };
    if (typeof selector !== 'string') continue;
    bySelector.set(
      selector,
      Array.isArray(thinking) ? thinking.filter((level): level is string => typeof level === 'string') : []
    );
  }
  return { runner: 'omp', available: true, models: bySelector };
}

function interpretClaudeAuth(stdout: string): CapabilityReport {
  const parsed = parseJson(stdout);
  if (!parsed || typeof parsed !== 'object') {
    return {
      runner: 'claude',
      available: false,
      code: 'probe_unparseable',
      reason: 'claude auth status --json did not return JSON.',
    };
  }
  if ((parsed as { loggedIn?: unknown } | null)?.loggedIn === true) {
    return { runner: 'claude', available: true };
  }
  return {
    runner: 'claude',
    available: false,
    code: 'not_authenticated',
    reason: 'claude auth status --json reports loggedIn is not true.',
  };
}

function classifyProbeError(
  runner: AutoRunner,
  error: unknown
): { code: RejectionCode; reason: string } {
  const failure = error as {
    code?: unknown;
    killed?: boolean;
    signal?: string;
    stderr?: string;
    message?: string;
  };
  const { file, args } = PROBE_COMMANDS[runner];
  const command = [file, ...args].join(' ');
  if (failure.code === 'ENOENT') {
    return {
      code: 'executable_missing',
      reason: `${file} is not installed or not on PATH.`,
    };
  }
  if (failure.killed) {
    return {
      code: 'probe_timeout',
      reason: `${command} did not finish within the probe timeout.`,
    };
  }
  const detail = firstLine(failure.stderr) || firstLine(failure.message) || 'nonzero exit';
  if (runner === 'omp') {
    return { code: 'probe_failed', reason: `${command} failed: ${detail}` };
  }
  return { code: 'not_authenticated', reason: `${command} exited nonzero: ${detail}` };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function firstLine(text: string | undefined): string {
  return text?.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

function rejectCandidate(
  candidate: AutoCandidate,
  report: CapabilityReport | undefined
): RouteRejection | undefined {
  if (!report) {
    return {
      ...candidate,
      code: 'probe_failed',
      reason: `No capability report for ${candidate.runner}.`,
    };
  }
  if (!report.available) {
    return {
      ...candidate,
      code: report.code ?? 'probe_failed',
      reason: report.reason ?? `${candidate.runner} is unavailable.`,
    };
  }
  if (candidate.runner !== 'omp') return undefined;

  const efforts = report.models?.get(candidate.model);
  if (efforts === undefined) {
    return {
      ...candidate,
      code: 'model_unavailable',
      reason: `omp models --json lists no selector ${candidate.model}.`,
    };
  }
  if (candidate.effort && !efforts.includes(candidate.effort)) {
    const supported = efforts.length > 0 ? efforts.join(', ') : 'none';
    return {
      ...candidate,
      code: 'effort_unsupported',
      reason: `omp selector ${candidate.model} supports thinking ${supported}, not ${candidate.effort}.`,
    };
  }
  return undefined;
}
