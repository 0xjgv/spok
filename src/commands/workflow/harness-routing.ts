import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Per-probe ceiling; observed wall times are well under one second. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

export type AutoRunner = 'claude' | 'codex' | 'omp' | 'current';
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
export type ModelFamily = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'sol' | 'terra';
export type ModelControl = 'selectable' | 'fixed-known' | 'fixed-unknown';
export type DegradedCode =
  | 'model_identity_unavailable'
  | 'same_family_as_producer'
  | 'producer_family_unknown';
export const AUTO_POLICY_VERSION = 'auto-v1';

/** Families are base model names: Codex Sol and OMP Sol are the same family. */
export const FAMILY_BY_MODEL: Record<AutoModel, ModelFamily> = {
  haiku: 'haiku',
  sonnet: 'sonnet',
  opus: 'opus',
  fable: 'fable',
  'gpt-5.6-terra': 'terra',
  'gpt-5.6-sol': 'sol',
  'openai-codex/gpt-5.6-sol': 'sol',
  'openai-codex/gpt-5.6-terra': 'terra',
};

/** How much model control a runner gives. `fixed-known` is reserved for chunk 3. */
export const MODEL_CONTROL_BY_RUNNER: Record<AutoRunner, ModelControl> = {
  claude: 'selectable',
  codex: 'selectable',
  omp: 'selectable',
  current: 'fixed-unknown',
};

export interface AutoCandidate {
  runner: AutoRunner;
  /** Absent only for fixed-unknown runners (`current`). */
  model?: AutoModel;
  effort?: AutoEffort;
}

type RejectionCode =
  | 'executable_missing'
  | 'not_authenticated'
  | 'probe_failed'
  | 'probe_timeout'
  | 'probe_unparseable'
  | 'model_unavailable'
  | 'effort_unsupported'
  | 'work_root_not_isolated';

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
  modelControl: ModelControl;
  rejected: RouteRejection[];
  /** Judge steps only (Phase 6). */
  producer?: { step: string; family?: ModelFamily };
  /** Absent means not degraded. */
  degraded?: { code: DegradedCode; reason: string };
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

/** Terminal fallback appended by the selector; never part of the 13×3 table. */
const CURRENT_FALLBACK: AutoCandidate = { runner: 'current' };
const MODEL_IDENTITY_UNAVAILABLE_REASON =
  'No explicit auto candidate is eligible; running on the current harness whose model identity is unavailable.';

/** Plain projection of an earlier flow step; flow.ts builds it so the leaf never imports flow types. */
export interface PriorStep {
  id: string;
  runner?: AutoRunner;
  model?: AutoModel;
}

/** Judge step to ids of the steps that produce the artifact it reviews; the latest prior one wins. */
const JUDGE_PRODUCER: Partial<Record<AutoStepId, readonly string[]>> = {
  'design-review': ['design-discussion'],
  validate: ['implement', 'repair'],
};

interface ProducerLookup {
  ids: readonly string[];
  step?: PriorStep;
}

/** Walk the step's candidates in order; first eligible wins and carries every earlier rejection.
 * When nothing is eligible, fall back to the current harness with a degraded route. */
export function selectAutoRoute(
  stepId: AutoStepId,
  reports: readonly CapabilityReport[],
  priorSteps: readonly PriorStep[] = []
): { route: AutoRoute } {
  const reportsByRunner = new Map(reports.map((report) => [report.runner, report]));
  const producer = findProducer(stepId, priorSteps);
  const candidates = partitionByFamily(
    AUTO_V1_CANDIDATES_BY_ID[stepId],
    familyOf(producer?.step?.model)
  );
  const rejected: RouteRejection[] = [];
  for (const candidate of candidates) {
    const rejection = rejectCandidate(candidate, reportsByRunner.get(candidate.runner));
    if (rejection) {
      rejected.push(rejection);
      continue;
    }
    return { route: buildRoute(candidate, rejected, producer) };
  }
  return { route: buildRoute(CURRENT_FALLBACK, rejected, producer) };
}

/** Undefined for non-judge steps; `step` undefined when no producer precedes the judge. */
function findProducer(
  stepId: AutoStepId,
  priorSteps: readonly PriorStep[]
): ProducerLookup | undefined {
  const ids = JUDGE_PRODUCER[stepId];
  if (!ids) return undefined;
  const step = [...priorSteps].reverse().find((prior) => ids.includes(prior.id));
  return { ids, step };
}

function familyOf(model: AutoModel | undefined): ModelFamily | undefined {
  return model === undefined ? undefined : FAMILY_BY_MODEL[model];
}

/** Stable partition: different-family candidates first, same-family after; table order within each. */
function partitionByFamily(
  candidates: readonly AutoCandidate[],
  family: ModelFamily | undefined
): readonly AutoCandidate[] {
  if (!family) return candidates;
  const differs = (candidate: AutoCandidate) => familyOf(candidate.model) !== family;
  return [...candidates.filter(differs), ...candidates.filter((candidate) => !differs(candidate))];
}

function buildRoute(
  candidate: AutoCandidate,
  rejected: RouteRejection[],
  producer: ProducerLookup | undefined
): AutoRoute {
  const record: AutoRouteRecord = {
    policy: AUTO_POLICY_VERSION,
    modelControl: MODEL_CONTROL_BY_RUNNER[candidate.runner],
    rejected,
  };
  if (producer?.step) {
    const family = familyOf(producer.step.model);
    record.producer = { step: producer.step.id, ...(family ? { family } : {}) };
  }
  const degraded = degradedFor(candidate, producer);
  if (degraded) record.degraded = degraded;
  return { ...candidate, route: record };
}

/** Precedence: current chosen > same family as producer > producer family unknown. */
function degradedFor(
  candidate: AutoCandidate,
  producer: ProducerLookup | undefined
): AutoRouteRecord['degraded'] {
  if (candidate.runner === 'current') {
    return { code: 'model_identity_unavailable', reason: MODEL_IDENTITY_UNAVAILABLE_REASON };
  }
  if (!producer) return undefined;
  const { ids, step } = producer;
  if (!step) {
    return {
      code: 'producer_family_unknown',
      reason: `No completed ${ids.join(' or ')} step precedes this judge; independence cannot be verified.`,
    };
  }
  const family = familyOf(step.model);
  if (!family) {
    return {
      code: 'producer_family_unknown',
      reason: `Producer ${step.id} ran on ${step.runner ?? 'an unknown runner'} with no known model family; independence cannot be verified.`,
    };
  }
  if (familyOf(candidate.model) !== family) return undefined;
  return {
    code: 'same_family_as_producer',
    reason: `Producer ${step.id} ran on the ${family} family and no different-family candidate is eligible.`,
  };
}

export type ProbeExec = (
  file: string,
  args: readonly string[],
  options: { timeout: number }
) => Promise<{ stdout: string; stderr: string }>;

type ProbedRunner = Exclude<AutoRunner, 'current'>;

const PROBE_COMMANDS: Record<ProbedRunner, { file: string; args: readonly string[] }> = {
  omp: { file: 'omp', args: ['models', '--json'] },
  codex: { file: 'codex', args: ['login', 'status'] },
  claude: { file: 'claude', args: ['auth', 'status', '--json'] },
};

// `current` is the harness already running the flow: always eligible, never probed.
const isProbedRunner = (runner: AutoRunner): runner is ProbedRunner => runner !== 'current';

// Wrapper keeps the promisified execFile overloads out of the ProbeExec signature.
const defaultExec: ProbeExec = (file, args, options) => execFileAsync(file, [...args], options);

/** Probe each distinct runner once, concurrently. Never throws; failures become unavailable reports. */
export async function probeHarnesses(
  runners: readonly AutoRunner[],
  exec: ProbeExec = defaultExec
): Promise<CapabilityReport[]> {
  const distinct = [...new Set(runners)].filter(isProbedRunner);
  return Promise.all(distinct.map((runner) => probeRunner(runner, exec)));
}

async function probeRunner(runner: ProbedRunner, exec: ProbeExec): Promise<CapabilityReport> {
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
  runner: ProbedRunner,
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
  if (candidate.runner !== 'omp' || candidate.model === undefined) return undefined;

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
