import path from 'node:path';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import { PROJECT_CONFIG_FILE_NAMES, readProjectConfig } from '../../core/project-config.js';

export const WORKFLOW_STATE_FILE = 'workflow-state.json';
export const FLOW_EVENT_LOG_FILE = 'flow-events.jsonl';

export type FlowModel = 'haiku' | 'sonnet' | 'opus' | 'gpt-5.6-terra' | 'gpt-5.6-sol' | 'fable';
export type FlowEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type FlowCompletionKind = 'file' | 'summary' | 'commit';
export type FlowStepStatus = 'pending' | 'ready' | 'completed';
export type FlowRunState = 'ready' | 'blocked' | 'complete';
type FlowTier = 'max' | 'heavy' | 'mid' | 'cheap';
type FlowTool = 'claude' | 'codex';
interface Routing {
  model: FlowModel;
  effort?: FlowEffort;
}

const PROBLEM_VALIDATION_STEP_ID = 'validate-problem';
const VALIDATE_STEP_ID = 'validate';
const SELF_LEARN_STEP_ID = 'self-learn';
const FLOW_EVENT_DIR = '.spok';

const MEMORY_FILE = 'MEMORY.md';
const MAX_MEMORY_RULES = 20;
// - `slug` — imperative sentence.   (em dash or hyphen, so a typo is not silently fatal)
const MEMORY_RULE_PATTERN = /^-\s+`([a-z0-9-]+)`\s+(?:—|-)\s+(\S.*)$/;
// A bullet opening with a backtick is a rule attempt; anything else is prose.
const MEMORY_RULE_BULLET_PATTERN = /^-\s+`/;

// Spok flow model map
const FLOW_STEP_TIER_BY_ID = {
  [PROBLEM_VALIDATION_STEP_ID]: 'heavy',
  'research-questions': 'heavy',
  research: 'mid',
  'design-discussion': 'max',
  'structure-outline': 'max',
  plan: 'max',
  implement: 'mid',
  simplify: 'heavy',
  validate: 'heavy',
  commit: 'cheap',
  [SELF_LEARN_STEP_ID]: 'mid',
} as const satisfies Record<string, FlowTier>;

const ROUTING_MATRIX: Record<FlowTool, Record<FlowTier, Routing>> = {
  claude: {
    max: { model: 'fable', effort: 'high' },
    heavy: { model: 'opus', effort: 'xhigh' },
    mid: { model: 'sonnet', effort: 'xhigh' },
    cheap: { model: 'haiku' },
  },
  codex: {
    max: { model: 'gpt-5.6-sol', effort: 'max' },
    heavy: { model: 'gpt-5.6-sol', effort: 'xhigh' },
    mid: { model: 'gpt-5.6-terra', effort: 'xhigh' },
    cheap: { model: 'gpt-5.6-terra', effort: 'low' },
  },
};

function detectTool(): FlowTool {
  return process.env.CODEX_HOME?.trim() ? 'codex' : 'claude';
}

export interface FlowStepResult {
  completedAt: string;
  summary?: string;
  output?: string;
  commit?: string;
}

export interface FlowStep {
  id: string;
  skill: string;
  model: FlowModel;
  effort?: FlowEffort;
  argument: string;
  expectedOutput?: string;
  status: FlowStepStatus;
  result?: FlowStepResult;
  /** Derived per response, never persisted: the full subagent prompt to dispatch verbatim. */
  prompt?: string;
}

export interface WorkflowState {
  version: 1;
  taskDir: string;
  status: FlowRunState;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface FlowResponse {
  state: FlowRunState;
  taskDir: string;
  statePath: string;
  steps: FlowStep[];
  nextStep?: FlowStep;
  step?: FlowStep;
  completedStep?: FlowStep;
  reason?: string;
  memoryPath?: string;
  memoryRuleCount?: number;
  memoryRuleTotal?: number;
  memoryWarning?: string;
}

export interface FlowCompleteInput {
  step: string;
  output?: string;
  summary?: string;
  commit?: string;
}

export interface FlowCommandOptions {
  json?: boolean;
}

export interface FlowCompleteCommandOptions extends FlowCommandOptions, FlowCompleteInput {}

interface StepDefinition {
  id: RoutedStepId;
  skill: string;
  model: FlowModel;
  effort?: FlowEffort;
  argument: string;
  expectedOutput?: string;
  completionKind: FlowCompletionKind;
}

type RoutedStepId = keyof typeof FLOW_STEP_TIER_BY_ID;

interface FlowStepPaths {
  taskDir: string;
  ticket: string;
  problemValidation: string;
  researchQuestions: string;
  research: string;
  designDiscussion: string;
  structureOutline: string;
  plan: string;
  validation: string;
  selfLearn: string;
}

interface StepDefinitionSpec {
  id: RoutedStepId;
  skill: string;
  argument: keyof FlowStepPaths;
  expectedOutput?: keyof FlowStepPaths;
  completionKind: FlowCompletionKind;
}

const BASE_STEP_DEFINITION_SPECS = [
  {
    id: PROBLEM_VALIDATION_STEP_ID,
    skill: 'spok-validate-problem',
    argument: 'ticket',
    expectedOutput: 'problemValidation',
    completionKind: 'file',
  },
  {
    id: 'research-questions',
    skill: 'spok-create-research-questions',
    argument: 'ticket',
    expectedOutput: 'researchQuestions',
    completionKind: 'file',
  },
  {
    id: 'research',
    skill: 'spok-create-research',
    argument: 'researchQuestions',
    expectedOutput: 'research',
    completionKind: 'file',
  },
  {
    id: 'design-discussion',
    skill: 'spok-create-design-discussion',
    argument: 'taskDir',
    expectedOutput: 'designDiscussion',
    completionKind: 'file',
  },
  {
    id: 'structure-outline',
    skill: 'spok-create-structure-outline',
    argument: 'taskDir',
    expectedOutput: 'structureOutline',
    completionKind: 'file',
  },
  {
    id: 'plan',
    skill: 'spok-create-plan',
    argument: 'taskDir',
    expectedOutput: 'plan',
    completionKind: 'file',
  },
  {
    id: 'implement',
    skill: 'spok-implement-plan',
    argument: 'taskDir',
    completionKind: 'summary',
  },
  {
    id: 'simplify',
    skill: 'spok-simplify',
    argument: 'taskDir',
    completionKind: 'summary',
  },
  {
    id: VALIDATE_STEP_ID,
    skill: 'spok-validate-implementation',
    argument: 'taskDir',
    expectedOutput: 'validation',
    completionKind: 'file',
  },
  {
    id: 'commit',
    skill: 'spok-ci-commit',
    argument: 'taskDir',
    completionKind: 'commit',
  },
] as const satisfies readonly StepDefinitionSpec[];

const SELF_LEARN_STEP_DEFINITION_SPEC = {
  id: SELF_LEARN_STEP_ID,
  skill: 'spok-self-learn',
  argument: 'taskDir',
  expectedOutput: 'selfLearn',
  completionKind: 'file',
} as const satisfies StepDefinitionSpec;

interface FlowEvent {
  schemaVersion: 1;
  timestamp: string;
  event: 'flow_status' | 'flow_next' | 'flow_complete';
  state: FlowRunState;
  step?: string;
  completedStep?: string;
  code?: string;
  reason?: string;
}

interface LoadResult {
  taskDir: string;
  statePath: string;
  state?: WorkflowState;
  reason?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveTaskDir(taskDir: string): string {
  return path.resolve(taskDir);
}

function getStatePath(taskDir: string): string {
  return path.join(taskDir, WORKFLOW_STATE_FILE);
}

export function getFlowEventLogPath(taskDir: string): string {
  return path.join(taskDir, FLOW_EVENT_DIR, FLOW_EVENT_LOG_FILE);
}

function findProjectRootForTaskDir(taskDir: string): string | undefined {
  let current = taskDir;

  while (true) {
    if (PROJECT_CONFIG_FILE_NAMES.some((fileName) => existsSync(path.join(current, 'spok', fileName)))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

interface MemoryRead {
  path: string;
  rules: string[];
  ignoredOverCap: number;
  malformedBullets: number;
  unreadable?: boolean;
}

/** Memory is optional, so a directory or a permission error degrades to no rules. */
function readMemoryLines(memoryPath: string): string[] | undefined {
  try {
    return readFileSync(memoryPath, 'utf-8').split('\n');
  } catch {
    return;
  }
}

/**
 * Presence-based: `spok/MEMORY.md` is read when it exists. Only lines matching
 * the rule grammar survive, so the file can carry as much prose as its author
 * wants without a byte of it reaching a prompt.
 */
function readMemory(taskDir: string): MemoryRead | undefined {
  const projectRoot = findProjectRootForTaskDir(taskDir);
  if (!projectRoot) return;

  const memoryPath = path.join(projectRoot, 'spok', MEMORY_FILE);
  if (!existsSync(memoryPath)) return;

  const lines = readMemoryLines(memoryPath);
  if (!lines) {
    return { path: memoryPath, rules: [], ignoredOverCap: 0, malformedBullets: 0, unreadable: true };
  }

  const rules: string[] = [];
  let conforming = 0;
  let malformedBullets = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(MEMORY_RULE_PATTERN);
    if (!match) {
      if (MEMORY_RULE_BULLET_PATTERN.test(trimmed)) malformedBullets += 1;
      continue;
    }

    conforming += 1;
    if (rules.length < MAX_MEMORY_RULES) rules.push(match[2]!.trim());
  }

  return {
    path: memoryPath,
    rules,
    ignoredOverCap: conforming - rules.length,
    malformedBullets,
  };
}

/** Anything dropped is reported: silent truncation would read as full coverage. */
function buildMemoryWarning(memory: MemoryRead | undefined): string | undefined {
  if (!memory) return;
  if (memory.unreadable) return `${memory.path}: could not be read; no rules were applied.`;

  const problems: string[] = [];
  if (memory.ignoredOverCap > 0) {
    problems.push(`${memory.ignoredOverCap} rule(s) past the ${MAX_MEMORY_RULES}-rule cap ignored`);
  }
  if (memory.malformedBullets > 0) {
    problems.push(`${memory.malformedBullets} bullet(s) dropped for not matching the rule grammar`);
  }
  if (problems.length === 0) return;

  return `${memory.path}: ${problems.join('; ')}.`;
}

const STEP_PROMPT_CLAUSES: Partial<Record<RoutedStepId, string>> = {
  implement:
    'You are running inside spok-flow. Implement and verify the plan, return a ' +
    'summary of what you did, and do NOT create any commits — the commit step owns that.',
  [SELF_LEARN_STEP_ID]: 'This gate is advisory. Do not fail, amend, or rewrite the commit.',
};

/** The whole subagent prompt. The driver dispatches it verbatim and assembles nothing. */
function buildStepPrompt(definition: StepDefinition, rules: string[]): string {
  const sections: string[] = [];

  if (rules.length > 0) {
    sections.push(
      [`Repository rules from spok/${MEMORY_FILE}. Follow every one of them:`, ...rules.map((rule) => `- ${rule}`)].join(
        '\n'
      )
    );
  }

  sections.push(
    `Call the \`${definition.skill}\` skill with \`${definition.argument}\` as the argument using the Skill tool.`
  );

  sections.push(
    definition.completionKind === 'file'
      ? 'When complete, return the absolute path of the document that was created.'
      : 'When complete, return a concise summary of what you did.'
  );

  const clause = STEP_PROMPT_CLAUSES[definition.id];
  if (clause) sections.push(clause);

  return sections.join('\n\n');
}

function isSelfLearnEnabled(taskDir: string): boolean {
  const projectRoot = findProjectRootForTaskDir(taskDir);
  if (!projectRoot) return false;
  return readProjectConfig(projectRoot)?.flow?.self_learn === true;
}

function buildFlowStepPaths(taskDir: string): FlowStepPaths {
  return {
    taskDir,
    ticket: path.join(taskDir, 'ticket.md'),
    problemValidation: path.join(taskDir, 'problem-validation.md'),
    researchQuestions: path.join(taskDir, 'research-questions.md'),
    research: path.join(taskDir, 'research.md'),
    designDiscussion: path.join(taskDir, 'design-discussion.md'),
    structureOutline: path.join(taskDir, 'structure-outline.md'),
    plan: path.join(taskDir, 'plan.md'),
    validation: path.join(taskDir, 'validation.md'),
    selfLearn: path.join(taskDir, 'self-learn.md'),
  };
}

function buildStepDefinition(
  spec: StepDefinitionSpec,
  paths: FlowStepPaths,
  tool: FlowTool
): StepDefinition {
  const routing = ROUTING_MATRIX[tool][FLOW_STEP_TIER_BY_ID[spec.id]];
  return {
    id: spec.id,
    skill: spec.skill,
    ...routing,
    argument: paths[spec.argument],
    expectedOutput: spec.expectedOutput ? paths[spec.expectedOutput] : undefined,
    completionKind: spec.completionKind,
  };
}

function buildStepDefinitions(taskDir: string): StepDefinition[] {
  const paths = buildFlowStepPaths(taskDir);
  const tool = detectTool();
  const specs = isSelfLearnEnabled(taskDir)
    ? [...BASE_STEP_DEFINITION_SPECS, SELF_LEARN_STEP_DEFINITION_SPEC]
    : BASE_STEP_DEFINITION_SPECS;
  return specs.map((spec) => buildStepDefinition(spec, paths, tool));
}

function stepFromDefinition(
  definition: StepDefinition,
  status: FlowStepStatus,
  result?: FlowStepResult
): FlowStep {
  return {
    id: definition.id,
    skill: definition.skill,
    model: definition.model,
    effort: definition.effort,
    argument: definition.argument,
    expectedOutput: definition.expectedOutput,
    status,
    result,
  };
}

function createInitialState(taskDir: string): WorkflowState {
  const timestamp = nowIso();
  const definitions = buildStepDefinitions(taskDir);
  return {
    version: 1,
    taskDir,
    status: 'ready',
    steps: definitions.map((definition, index) =>
      stepFromDefinition(definition, index === 0 ? 'ready' : 'pending')
    ),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function isCompletedStep(step: unknown): step is FlowStep {
  if (!step || typeof step !== 'object') return false;
  const candidate = step as Partial<FlowStep>;
  return typeof candidate.id === 'string' && candidate.status === 'completed';
}

function shouldSkipProblemValidationForLegacyState(completedById: Map<string, FlowStep>): boolean {
  return completedById.size > 0 && !completedById.has(PROBLEM_VALIDATION_STEP_ID);
}

function normalizeState(taskDir: string, stored: unknown): WorkflowState {
  const initial = createInitialState(taskDir);
  if (!stored || typeof stored !== 'object') return initial;

  const candidate = stored as Partial<WorkflowState>;
  const storedSteps = Array.isArray(candidate.steps) ? candidate.steps : [];
  const completedById = new Map<string, FlowStep>();
  for (const step of storedSteps) {
    if (isCompletedStep(step)) {
      completedById.set(step.id, step);
    }
  }

  const definitions = buildStepDefinitions(taskDir);
  const skipProblemValidation = shouldSkipProblemValidationForLegacyState(completedById);
  const steps = definitions.map((definition) => {
    const completed = completedById.get(definition.id);
    if (!completed && definition.id === PROBLEM_VALIDATION_STEP_ID && skipProblemValidation) {
      return stepFromDefinition(definition, 'completed', {
        summary: 'Skipped for legacy workflow state created before validate-problem existed.',
        completedAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : initial.createdAt,
      });
    }

    return stepFromDefinition(definition, completed ? 'completed' : 'pending', completed?.result);
  });

  const state: WorkflowState = {
    version: 1,
    taskDir,
    status: 'ready',
    steps,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : initial.createdAt,
    updatedAt: initial.updatedAt,
  };

  markNextStepReady(state);
  return state;
}

function markNextStepReady(state: WorkflowState): void {
  let readySet = false;

  for (const step of state.steps) {
    if (step.status === 'completed') continue;

    if (!readySet) {
      step.status = 'ready';
      readySet = true;
    } else {
      step.status = 'pending';
    }
  }

  state.status = readySet ? 'ready' : 'complete';
}

async function pathIsFile(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function pathIsNonEmptyFile(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function flowBlockCode(reason: string): string {
  if (reason.startsWith('Task directory does not exist:')) return 'missing_task_dir';
  if (reason.startsWith('Missing required ticket file:')) return 'missing_ticket';
  if (reason.startsWith('Invalid workflow state JSON:')) return 'invalid_state_json';
  if (reason.startsWith('Missing completed artifact for step ')) return 'missing_completed_artifact';
  if (reason.startsWith('Expected step ')) return 'wrong_step';
  if (reason.startsWith('Unknown workflow step:')) return 'unknown_step';
  if (reason.startsWith('Expected output path ')) return 'wrong_output_path';
  if (reason.startsWith('Expected output file is missing or empty for step ')) return 'missing_output';
  if (reason.includes('must set Flow Decision to proceed')) return 'flow_decision_not_proceed';
  if (reason.includes('recorded a FAIL verdict')) return 'validation_verdict_fail';
  if (reason.includes('has no readable verdict')) return 'validation_verdict_unreadable';
  if (reason.includes('must provide a non-empty --summary')) return 'missing_summary';
  if (reason.includes('must provide a commit SHA')) return 'missing_commit';
  return 'blocked';
}

async function appendFlowEvent(taskDir: string, event: FlowEvent): Promise<void> {
  try {
    if (!(await pathIsDirectory(taskDir))) return;

    const eventLogPath = getFlowEventLogPath(taskDir);
    await fs.mkdir(path.dirname(eventLogPath), { recursive: true });
    await fs.appendFile(eventLogPath, `${JSON.stringify(event)}\n`, 'utf-8');
  } catch {
    // Best-effort background signal. Flow behavior must never depend on it.
  }
}

async function recordFlowResponse(
  response: FlowResponse,
  eventName: FlowEvent['event']
): Promise<void> {
  const event: FlowEvent = {
    schemaVersion: 1,
    timestamp: nowIso(),
    event: eventName,
    state: response.state,
  };

  const step = response.step?.id ?? response.nextStep?.id;
  if (step) event.step = step;
  if (response.completedStep?.id) event.completedStep = response.completedStep.id;
  if (response.reason) {
    event.code = flowBlockCode(response.reason);
    event.reason = response.reason;
  }

  await appendFlowEvent(response.taskDir, event);
}

async function writeState(state: WorkflowState): Promise<void> {
  state.updatedAt = nowIso();
  await fs.writeFile(getStatePath(state.taskDir), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

async function loadOrCreateState(taskDirInput: string): Promise<LoadResult> {
  const taskDir = resolveTaskDir(taskDirInput);
  const statePath = getStatePath(taskDir);

  if (!(await pathIsDirectory(taskDir))) {
    return {
      taskDir,
      statePath,
      reason: `Task directory does not exist: ${taskDir}`,
    };
  }

  const ticketPath = path.join(taskDir, 'ticket.md');
  if (!(await pathIsFile(ticketPath))) {
    return {
      taskDir,
      statePath,
      reason: `Missing required ticket file: ${ticketPath}`,
    };
  }

  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    return {
      taskDir,
      statePath,
      state: normalizeState(taskDir, JSON.parse(raw)),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        taskDir,
        statePath,
        state: createInitialState(taskDir),
      };
    }

    if (error instanceof SyntaxError) {
      return {
        taskDir,
        statePath,
        reason: `Invalid workflow state JSON: ${statePath}`,
      };
    }

    throw error;
  }
}

function getDefinitionById(taskDir: string, stepId: string): StepDefinition | undefined {
  return buildStepDefinitions(taskDir).find((definition) => definition.id === stepId);
}

function getCurrentStep(state: WorkflowState): FlowStep | undefined {
  return state.steps.find((step) => step.status === 'ready');
}

/**
 * `getCurrentStep` returns a reference into `state.steps`, so the prompt is
 * attached to a copy — mutating in place would leak it into workflow-state.json.
 */
function withStepPrompt(
  taskDir: string,
  step: FlowStep | undefined,
  rules: string[]
): FlowStep | undefined {
  if (!step) return step;

  const definition = getDefinitionById(taskDir, step.id);
  if (!definition) return step;

  return { ...step, prompt: buildStepPrompt(definition, rules) };
}

function buildResponse(
  state: WorkflowState,
  extra: Pick<FlowResponse, 'step' | 'completedStep' | 'reason'> = {}
): FlowResponse {
  const memory = readMemory(state.taskDir);
  const nextStep = withStepPrompt(state.taskDir, getCurrentStep(state), memory?.rules ?? []);
  return {
    state: state.status,
    taskDir: state.taskDir,
    statePath: getStatePath(state.taskDir),
    steps: state.steps,
    nextStep,
    step: extra.step,
    completedStep: extra.completedStep,
    reason: extra.reason,
    memoryPath: memory?.path,
    memoryRuleCount: memory?.rules.length,
    memoryRuleTotal: memory && memory.rules.length + memory.ignoredOverCap,
    memoryWarning: buildMemoryWarning(memory),
  };
}

function buildBlockedResponse(taskDir: string, statePath: string, reason: string): FlowResponse {
  return {
    state: 'blocked',
    taskDir,
    statePath,
    steps: [],
    reason,
  };
}

async function validateCompletedArtifacts(state: WorkflowState): Promise<string | undefined> {
  for (const step of state.steps) {
    if (step.status !== 'completed') continue;

    const definition = getDefinitionById(state.taskDir, step.id);
    if (definition?.completionKind !== 'file' || !definition.expectedOutput) continue;
    if (!step.result?.output) continue;

    if (!(await pathIsNonEmptyFile(definition.expectedOutput))) {
      return `Missing completed artifact for step ${step.id}: ${definition.expectedOutput}`;
    }

    // Both gates self-guard on step id. Re-running them keeps a completed
    // artifact that was edited after completion from carrying the flow forward.
    const decisionError = await validateProblemValidationFlowDecision(definition);
    if (decisionError) return decisionError;

    const verdictError = await validateValidationVerdict(definition);
    if (verdictError) return verdictError;
  }
}

/**
 * Blocked is a response state, not a stored state: the state file is never
 * written for a blocked outcome, so the next query re-derives from disk.
 */
function blockedResponse(state: WorkflowState, reason: string): FlowResponse {
  return {
    state: 'blocked',
    taskDir: state.taskDir,
    statePath: getStatePath(state.taskDir),
    steps: state.steps,
    nextStep: getCurrentStep(state),
    reason,
  };
}

function normalizeOutputPath(output: string): string {
  return path.normalize(path.resolve(output));
}

function validateFileCompletion(
  definition: StepDefinition,
  input: FlowCompleteInput
): string | undefined {
  if (!definition.expectedOutput) {
    return `Step ${definition.id} does not declare an expected output path.`;
  }

  // --output is optional: the CLI already knows the expected path. When
  // provided, it must match.
  if (!input.output) return;

  const expected = path.normalize(definition.expectedOutput);
  const actual = normalizeOutputPath(input.output);
  if (actual !== expected) {
    return `Expected output path ${definition.expectedOutput} for step ${definition.id}, got ${path.resolve(input.output)}.`;
  }
}

function extractMarkdownSection(content: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(
    new RegExp(`(?:^|\\n)##\\s+${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i')
  );
  return match?.[1]?.trim() ?? '';
}

/** First non-blank trimmed line of a `## <heading>` section, or '' when there is none. */
function firstSectionLine(content: string, heading: string): string {
  return (
    extractMarkdownSection(content, heading)
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

function flowDecisionAllowsProceed(content: string): boolean {
  return /^`?proceed`?\b/i.test(firstSectionLine(content, 'Flow Decision'));
}

/** Undefined when the artifact cannot be read: the callers treat that as a failed gate. */
async function readArtifact(targetPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(targetPath, 'utf-8');
  } catch {
    return;
  }
}

async function validateProblemValidationFlowDecision(
  definition: StepDefinition
): Promise<string | undefined> {
  if (definition.id !== PROBLEM_VALIDATION_STEP_ID || !definition.expectedOutput) return;

  const content = await readArtifact(definition.expectedOutput);
  if (content !== undefined && flowDecisionAllowsProceed(content)) return;

  return `Step ${PROBLEM_VALIDATION_STEP_ID} must set Flow Decision to proceed before the flow can continue: ${definition.expectedOutput}`;
}

type Verdict = 'PASS' | 'FAIL';

function parseVerdictValue(raw: string): Verdict | undefined {
  const value = raw
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .trim()
    .toUpperCase();
  return value === 'PASS' || value === 'FAIL' ? value : undefined;
}

/** Raw value of the first frontmatter `verdict:` line, or undefined when there is none. */
function frontmatterVerdictValue(normalized: string): string | undefined {
  if (!normalized.startsWith('---\n')) return;

  const closingIndex = normalized.indexOf('\n---', 4);
  if (closingIndex === -1) return;

  for (const line of normalized.slice(4, closingIndex).split('\n')) {
    const match = line.match(/^verdict\s*:\s*(.+?)\s*$/i);
    if (match) return match[1];
  }
}

/** Pure. Returns undefined when no verdict is readable. */
function readValidationVerdict(content: string): Verdict | undefined {
  const normalized = content.replace(/\r\n/g, '\n');

  // An explicit frontmatter verdict is the machine-facing contract:
  // an unrecognized value is unreadable — no body fallback.
  const declared = frontmatterVerdictValue(normalized);
  if (declared !== undefined) return parseVerdictValue(declared);

  const match = firstSectionLine(normalized, 'Validation Verdict')
    .replace(/[*`]/g, '')
    .match(/^(?:verdict\s*:?\s*)?(PASS|FAIL)\b/i);
  return match ? parseVerdictValue(match[1]!) : undefined;
}

async function validateValidationVerdict(definition: StepDefinition): Promise<string | undefined> {
  if (definition.id !== VALIDATE_STEP_ID || !definition.expectedOutput) return;

  const content = await readArtifact(definition.expectedOutput);
  const verdict = content === undefined ? undefined : readValidationVerdict(content);
  if (verdict === 'PASS') return;
  if (verdict === 'FAIL') {
    return `Step ${VALIDATE_STEP_ID} recorded a FAIL verdict: ${definition.expectedOutput}`;
  }

  return `Step ${VALIDATE_STEP_ID} has no readable verdict (expected PASS or FAIL): ${definition.expectedOutput}`;
}

async function completeStepResult(
  definition: StepDefinition,
  input: FlowCompleteInput
): Promise<FlowStepResult | string> {
  if (definition.completionKind === 'file') {
    const validationError = validateFileCompletion(definition, input);
    if (validationError) return validationError;

    if (!(await pathIsNonEmptyFile(definition.expectedOutput!))) {
      return `Expected output file is missing or empty for step ${definition.id}: ${definition.expectedOutput}`;
    }

    const decisionError = await validateProblemValidationFlowDecision(definition);
    if (decisionError) return decisionError;

    const verdictError = await validateValidationVerdict(definition);
    if (verdictError) return verdictError;

    return {
      output: definition.expectedOutput,
      completedAt: nowIso(),
    };
  }

  if (definition.completionKind === 'summary') {
    const summary = input.summary?.trim();
    if (!summary) {
      return `Step ${definition.id} must provide a non-empty --summary.`;
    }

    return {
      summary,
      completedAt: nowIso(),
    };
  }

  const commit = input.commit?.trim();
  if (!commit) {
    return `Step ${definition.id} must provide a commit SHA with --commit.`;
  }

  return {
    commit,
    summary: input.summary?.trim() || undefined,
    completedAt: nowIso(),
  };
}

/** Read-only: derives state from disk without creating or touching the state file. */
export async function getFlowStatus(taskDirInput: string): Promise<FlowResponse> {
  const loaded = await loadOrCreateState(taskDirInput);
  if (!loaded.state) {
    const response = buildBlockedResponse(loaded.taskDir, loaded.statePath, loaded.reason!);
    await recordFlowResponse(response, 'flow_status');
    return response;
  }

  const missingArtifact = await validateCompletedArtifacts(loaded.state);
  if (missingArtifact) {
    const response = blockedResponse(loaded.state, missingArtifact);
    await recordFlowResponse(response, 'flow_status');
    return response;
  }

  const response = buildResponse(loaded.state);
  await recordFlowResponse(response, 'flow_status');
  return response;
}

/** Owns state-file creation and refresh; blocked outcomes leave the file untouched. */
export async function getFlowNext(taskDirInput: string): Promise<FlowResponse> {
  const loaded = await loadOrCreateState(taskDirInput);
  if (!loaded.state) {
    const response = buildBlockedResponse(loaded.taskDir, loaded.statePath, loaded.reason!);
    await recordFlowResponse(response, 'flow_next');
    return response;
  }

  const missingArtifact = await validateCompletedArtifacts(loaded.state);
  if (missingArtifact) {
    const response = blockedResponse(loaded.state, missingArtifact);
    await recordFlowResponse(response, 'flow_next');
    return response;
  }

  await writeState(loaded.state);
  const response = buildResponse(loaded.state);
  const nextResponse = {
    ...response,
    step: response.nextStep,
  };
  await recordFlowResponse(nextResponse, 'flow_next');
  return nextResponse;
}

export async function completeFlowStep(
  taskDirInput: string,
  input: FlowCompleteInput
): Promise<FlowResponse> {
  const loaded = await loadOrCreateState(taskDirInput);
  if (!loaded.state) {
    const response = buildBlockedResponse(loaded.taskDir, loaded.statePath, loaded.reason!);
    await recordFlowResponse(response, 'flow_complete');
    return response;
  }

  const priorArtifactError = await validateCompletedArtifacts(loaded.state);
  if (priorArtifactError) {
    const response = blockedResponse(loaded.state, priorArtifactError);
    await recordFlowResponse(response, 'flow_complete');
    return response;
  }

  const currentStep = getCurrentStep(loaded.state);
  if (!currentStep) {
    const response = buildResponse(loaded.state);
    await recordFlowResponse(response, 'flow_complete');
    return response;
  }

  if (input.step !== currentStep.id) {
    const response = blockedResponse(
      loaded.state,
      `Expected step ${currentStep.id}, got ${input.step}.`
    );
    await recordFlowResponse(response, 'flow_complete');
    return response;
  }

  const definition = getDefinitionById(loaded.state.taskDir, currentStep.id);
  if (!definition) {
    const response = blockedResponse(loaded.state, `Unknown workflow step: ${currentStep.id}.`);
    await recordFlowResponse(response, 'flow_complete');
    return response;
  }

  const result = await completeStepResult(definition, input);
  if (typeof result === 'string') {
    const response = blockedResponse(loaded.state, result);
    await recordFlowResponse(response, 'flow_complete');
    return response;
  }

  currentStep.status = 'completed';
  currentStep.result = result;
  markNextStepReady(loaded.state);
  await writeState(loaded.state);

  const response = buildResponse(loaded.state, {
    completedStep: currentStep,
  });
  await recordFlowResponse(response, 'flow_complete');
  return response;
}

export async function flowStatusCommand(
  taskDir: string,
  options: FlowCommandOptions = {}
): Promise<void> {
  reportFlowResponse(await getFlowStatus(taskDir), options);
}

export async function flowNextCommand(
  taskDir: string,
  options: FlowCommandOptions = {}
): Promise<void> {
  reportFlowResponse(await getFlowNext(taskDir), options);
}

export async function flowCompleteCommand(
  taskDir: string,
  options: FlowCompleteCommandOptions
): Promise<void> {
  reportFlowResponse(await completeFlowStep(taskDir, options), options);
}

/** Prints the response and signals blocked outcomes via a nonzero exit code. */
function reportFlowResponse(response: FlowResponse, options: FlowCommandOptions): void {
  printFlowResponse(response, options);
  if (response.state === 'blocked') {
    process.exitCode = 1;
  }
}

function printFlowResponse(response: FlowResponse, options: FlowCommandOptions): void {
  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (response.state === 'blocked') {
    console.log(`Blocked: ${response.reason ?? 'Unknown workflow blocker'}`);
    return;
  }

  if (response.state === 'complete') {
    console.log(`Flow complete: ${response.taskDir}`);
    return;
  }

  const step = response.step ?? response.nextStep;
  if (!step) {
    console.log(`No ready workflow step: ${response.taskDir}`);
    return;
  }

  console.log(`Next step: ${step.id}`);
  console.log(`Skill: ${step.skill}`);
  console.log(`Model: ${step.model}`);
  if (step.effort) {
    console.log(`Effort: ${step.effort}`);
  }
  console.log(`Argument: ${step.argument}`);
  if (step.expectedOutput) {
    console.log(`Expected output: ${step.expectedOutput}`);
  }
  if (response.memoryPath) {
    console.log(
      `Memory: ${response.memoryPath} (${response.memoryRuleCount} of ${response.memoryRuleTotal} rules)`
    );
  }
  if (response.memoryWarning) {
    console.log(`Memory warning: ${response.memoryWarning}`);
  }
}
