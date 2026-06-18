import path from 'node:path';
import { promises as fs } from 'node:fs';

export const WORKFLOW_STATE_FILE = 'workflow-state.json';

export type FlowRunState = 'ready' | 'blocked' | 'complete';
export type FlowStepStatus = 'pending' | 'ready' | 'completed';
export type FlowCompletionKind = 'file' | 'summary' | 'commit';
export type FlowModel = 'fable' | 'sonnet' | 'opus' | 'haiku';

const PROBLEM_VALIDATION_STEP_ID = 'validate-problem';

const FLOW_STEP_MODEL_BY_ID = {
  [PROBLEM_VALIDATION_STEP_ID]: 'fable',
  'research-questions': 'fable',
  research: 'sonnet',
  'design-discussion': 'fable',
  'structure-outline': 'opus',
  plan: 'fable',
  implement: 'opus',
  simplify: 'sonnet',
  validate: 'fable',
  commit: 'haiku',
} as const satisfies Record<string, FlowModel>;

export interface FlowStepResult {
  output?: string;
  summary?: string;
  commit?: string;
  completedAt: string;
}

export interface FlowStep {
  id: string;
  skill: string;
  model: FlowModel;
  argument: string;
  expectedOutput?: string;
  status: FlowStepStatus;
  result?: FlowStepResult;
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
  id: string;
  skill: string;
  model: FlowModel;
  argument: string;
  expectedOutput?: string;
  completionKind: FlowCompletionKind;
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

function buildStepDefinitions(taskDir: string): StepDefinition[] {
  const ticket = path.join(taskDir, 'ticket.md');
  const problemValidation = path.join(taskDir, 'problem-validation.md');
  const researchQuestions = path.join(taskDir, 'research-questions.md');
  const research = path.join(taskDir, 'research.md');
  const designDiscussion = path.join(taskDir, 'design-discussion.md');
  const structureOutline = path.join(taskDir, 'structure-outline.md');
  const plan = path.join(taskDir, 'plan.md');
  const validation = path.join(taskDir, 'validation.md');

  return [
    {
      id: PROBLEM_VALIDATION_STEP_ID,
      skill: 'spok-validate-problem',
      model: FLOW_STEP_MODEL_BY_ID[PROBLEM_VALIDATION_STEP_ID],
      argument: ticket,
      expectedOutput: problemValidation,
      completionKind: 'file',
    },
    {
      id: 'research-questions',
      skill: 'spok-create-research-questions',
      model: FLOW_STEP_MODEL_BY_ID['research-questions'],
      argument: ticket,
      expectedOutput: researchQuestions,
      completionKind: 'file',
    },
    {
      id: 'research',
      skill: 'spok-create-research',
      model: FLOW_STEP_MODEL_BY_ID.research,
      argument: researchQuestions,
      expectedOutput: research,
      completionKind: 'file',
    },
    {
      id: 'design-discussion',
      skill: 'spok-create-design-discussion',
      model: FLOW_STEP_MODEL_BY_ID['design-discussion'],
      argument: taskDir,
      expectedOutput: designDiscussion,
      completionKind: 'file',
    },
    {
      id: 'structure-outline',
      skill: 'spok-create-structure-outline',
      model: FLOW_STEP_MODEL_BY_ID['structure-outline'],
      argument: taskDir,
      expectedOutput: structureOutline,
      completionKind: 'file',
    },
    {
      id: 'plan',
      skill: 'spok-create-plan',
      model: FLOW_STEP_MODEL_BY_ID.plan,
      argument: taskDir,
      expectedOutput: plan,
      completionKind: 'file',
    },
    {
      id: 'implement',
      skill: 'spok-implement-plan',
      model: FLOW_STEP_MODEL_BY_ID.implement,
      argument: taskDir,
      completionKind: 'summary',
    },
    {
      id: 'simplify',
      skill: 'spok-simplify',
      model: FLOW_STEP_MODEL_BY_ID.simplify,
      argument: taskDir,
      completionKind: 'summary',
    },
    {
      id: 'validate',
      skill: 'spok-validate-implementation',
      model: FLOW_STEP_MODEL_BY_ID.validate,
      argument: taskDir,
      expectedOutput: validation,
      completionKind: 'file',
    },
    {
      id: 'commit',
      skill: 'spok-ci-commit',
      model: FLOW_STEP_MODEL_BY_ID.commit,
      argument: taskDir,
      completionKind: 'commit',
    },
  ];
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

function buildResponse(
  state: WorkflowState,
  extra: Pick<FlowResponse, 'step' | 'completedStep' | 'reason'> = {}
): FlowResponse {
  const nextStep = getCurrentStep(state);
  return {
    state: state.status,
    taskDir: state.taskDir,
    statePath: getStatePath(state.taskDir),
    steps: state.steps,
    nextStep,
    step: extra.step,
    completedStep: extra.completedStep,
    reason: extra.reason,
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

    if (definition.id === PROBLEM_VALIDATION_STEP_ID) {
      const decisionError = await validateProblemValidationFlowDecision(definition);
      if (decisionError) return decisionError;
    }
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

function flowDecisionAllowsProceed(content: string): boolean {
  const section = extractMarkdownSection(content, 'Flow Decision');
  const firstDecisionLine = section
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return /^`?proceed`?\b/i.test(firstDecisionLine ?? '');
}

async function validateProblemValidationFlowDecision(
  definition: StepDefinition
): Promise<string | undefined> {
  if (definition.id !== PROBLEM_VALIDATION_STEP_ID || !definition.expectedOutput) return;

  const content = await fs.readFile(definition.expectedOutput, 'utf-8');
  if (flowDecisionAllowsProceed(content)) return;

  return `Step ${PROBLEM_VALIDATION_STEP_ID} must set Flow Decision to proceed before the flow can continue: ${definition.expectedOutput}`;
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
    return buildBlockedResponse(loaded.taskDir, loaded.statePath, loaded.reason!);
  }

  const missingArtifact = await validateCompletedArtifacts(loaded.state);
  if (missingArtifact) {
    return blockedResponse(loaded.state, missingArtifact);
  }

  return buildResponse(loaded.state);
}

/** Owns state-file creation and refresh; blocked outcomes leave the file untouched. */
export async function getFlowNext(taskDirInput: string): Promise<FlowResponse> {
  const loaded = await loadOrCreateState(taskDirInput);
  if (!loaded.state) {
    return buildBlockedResponse(loaded.taskDir, loaded.statePath, loaded.reason!);
  }

  const missingArtifact = await validateCompletedArtifacts(loaded.state);
  if (missingArtifact) {
    return blockedResponse(loaded.state, missingArtifact);
  }

  await writeState(loaded.state);
  const response = buildResponse(loaded.state);
  return {
    ...response,
    step: response.nextStep,
  };
}

export async function completeFlowStep(
  taskDirInput: string,
  input: FlowCompleteInput
): Promise<FlowResponse> {
  const loaded = await loadOrCreateState(taskDirInput);
  if (!loaded.state) {
    return buildBlockedResponse(loaded.taskDir, loaded.statePath, loaded.reason!);
  }

  const priorArtifactError = await validateCompletedArtifacts(loaded.state);
  if (priorArtifactError) {
    return blockedResponse(loaded.state, priorArtifactError);
  }

  const currentStep = getCurrentStep(loaded.state);
  if (!currentStep) {
    return buildResponse(loaded.state);
  }

  if (input.step !== currentStep.id) {
    return blockedResponse(loaded.state, `Expected step ${currentStep.id}, got ${input.step}.`);
  }

  const definition = getDefinitionById(loaded.state.taskDir, currentStep.id);
  if (!definition) {
    return blockedResponse(loaded.state, `Unknown workflow step: ${currentStep.id}.`);
  }

  const result = await completeStepResult(definition, input);
  if (typeof result === 'string') {
    return blockedResponse(loaded.state, result);
  }

  currentStep.status = 'completed';
  currentStep.result = result;
  markNextStepReady(loaded.state);
  await writeState(loaded.state);

  return buildResponse(loaded.state, {
    completedStep: currentStep,
  });
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
  console.log(`Argument: ${step.argument}`);
  if (step.expectedOutput) {
    console.log(`Expected output: ${step.expectedOutput}`);
  }
}
