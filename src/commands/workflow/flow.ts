import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { z } from 'zod';
import { PROJECT_CONFIG_FILE_NAMES, readProjectConfig } from '../../core/project-config.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  AUTO_V1_CANDIDATES_BY_ID,
  MODEL_CONTROL_BY_RUNNER,
  probeHarnesses,
  selectAutoRoute,
  type AutoCandidate,
  type AutoEffort,
  type AutoModel,
  type AutoRouteRecord,
  type AutoRunner,
  type CapabilityReport,
} from './harness-routing.js';

const execFileAsync = promisify(execFile);

export const WORKFLOW_STATE_FILE = 'workflow-state.json';
export const FLOW_EVENT_LOG_FILE = 'flow-events.jsonl';

/** Routing vocabulary lives in the leaf module; flow.ts re-exports it under its own names. */
export type FlowModel = AutoModel;
export type FlowEffort = AutoEffort;
export type FlowRunner = AutoRunner;
type Routing = AutoCandidate;
export type FlowCompletionKind = 'file' | 'summary' | 'commit';
export type FlowStepStatus = 'pending' | 'ready' | 'completed';
export type FlowRunState = 'ready' | 'needs-input' | 'blocked' | 'complete';
/** Profiles resolvable at state creation; `auto` defers routing to `spok flow next`. */
type DetectedProfile = 'claude' | 'codex';
export type FlowProfile = DetectedProfile | 'hybrid' | 'auto';
type FlowTier = 'max' | 'heavy' | 'mid' | 'cheap';

const PROBLEM_VALIDATION_STEP_ID = 'validate-problem';
const DESIGN_REVIEW_STEP_ID = 'design-review';
const VALIDATE_STEP_ID = 'validate';
const REPAIR_STEP_ID = 'repair';
const SELF_LEARN_STEP_ID = 'self-learn';
const FLOW_EVENT_DIR = '.spok';
const FLOW_PROFILE_ENV = 'SPOK_FLOW_PROFILE';

/** Bounded: a FAIL splices at most this many [repair, validate] pairs per flow. */
const MAX_REPAIR_ATTEMPTS = 2;

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
  'structure-outline': 'heavy',
  [DESIGN_REVIEW_STEP_ID]: 'heavy',
  plan: 'max',
  implement: 'mid',
  simplify: 'heavy',
  validate: 'heavy',
  [REPAIR_STEP_ID]: 'heavy',
  commit: 'cheap',
  [SELF_LEARN_STEP_ID]: 'mid',
} as const satisfies Record<string, FlowTier>;

type RoutedStepId = keyof typeof FLOW_STEP_TIER_BY_ID;

const CLAUDE_ROUTING_BY_ID = {
  [PROBLEM_VALIDATION_STEP_ID]: { runner: 'claude', model: 'opus', effort: 'medium' },
  'research-questions': { runner: 'claude', model: 'opus', effort: 'medium' },
  research: { runner: 'claude', model: 'sonnet', effort: 'medium' },
  'design-discussion': { runner: 'claude', model: 'fable', effort: 'xhigh' },
  'structure-outline': { runner: 'claude', model: 'fable', effort: 'xhigh' },
  [DESIGN_REVIEW_STEP_ID]: { runner: 'claude', model: 'opus', effort: 'medium' },
  plan: { runner: 'claude', model: 'fable', effort: 'xhigh' },
  implement: { runner: 'claude', model: 'opus', effort: 'medium' },
  simplify: { runner: 'claude', model: 'opus' },
  // Judge must not be the implementer's model; Fable is the strongest in-family alternative.
  validate: { runner: 'claude', model: 'fable', effort: 'high' },
  [REPAIR_STEP_ID]: { runner: 'claude', model: 'opus', effort: 'high' },
  commit: { runner: 'claude', model: 'haiku', effort: 'low' },
  [SELF_LEARN_STEP_ID]: { runner: 'claude', model: 'sonnet', effort: 'xhigh' },
} as const satisfies Record<RoutedStepId, Routing>;

const CODEX_ROUTING_BY_TIER: Record<FlowTier, Routing> = {
  max: { runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
  heavy: { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  mid: { runner: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
  cheap: { runner: 'codex', model: 'gpt-5.6-terra', effort: 'low' },
};

const HYBRID_ROUTING_BY_ID = {
  [PROBLEM_VALIDATION_STEP_ID]: {
    runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh',
  },
  'research-questions': { runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  research: { runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  'design-discussion': { runner: 'claude', model: 'fable', effort: 'xhigh' },
  'structure-outline': { runner: 'claude', model: 'fable', effort: 'xhigh' },
  [DESIGN_REVIEW_STEP_ID]: {
    runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh',
  },
  plan: { runner: 'claude', model: 'fable', effort: 'xhigh' },
  implement: { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  simplify: { runner: 'claude', model: 'opus' },
  validate: { runner: 'claude', model: 'opus', effort: 'medium' },
  [REPAIR_STEP_ID]: { runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
  commit: { runner: 'codex', model: 'gpt-5.6-terra', effort: 'low' },
  [SELF_LEARN_STEP_ID]: { runner: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
} as const satisfies Record<RoutedStepId, Routing>;

/** Sole key check for the auto policy table: fails to compile if harness-routing.ts drops a step that flow.ts routes. */
const AUTO_CANDIDATES_BY_STEP: Record<RoutedStepId, readonly AutoCandidate[]> =
  AUTO_V1_CANDIDATES_BY_ID;

const CODEX_HARNESS_ENV = [
  'CODEX_HOME',
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
  'CODEX_SHELL',
] as const;

function detectTool(): DetectedProfile {
  return CODEX_HARNESS_ENV.some((name) => process.env[name]?.trim()) ? 'codex' : 'claude';
}

function isFlowProfile(value: unknown): value is FlowProfile {
  return value === 'claude' || value === 'codex' || value === 'hybrid' || value === 'auto';
}

function requestedFlowProfile(): { profile?: FlowProfile; reason?: string } {
  const raw = process.env[FLOW_PROFILE_ENV]?.trim();
  if (!raw) return {};
  if (isFlowProfile(raw)) return { profile: raw };
  return {
    reason: `Unknown flow profile: ${raw}. Expected claude, codex, hybrid, or auto.`,
  };
}

export interface FlowStepResult {
  completedAt: string;
  summary?: string;
  output?: string;
  commit?: string;
  /** Absolute path of the repository the step edited; recorded so the commit step never rediscovers it. */
  workRoot?: string;
}

const FlowQuestionOptionSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    consequence: z.string().trim().min(1),
  })
  .strict();

const FlowQuestionSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        id: z.string().trim().min(1),
        prompt: z.string().trim().min(1),
        kind: z.literal('choice'),
        options: z.array(FlowQuestionOptionSchema).min(2).max(3),
        recommendedOptionId: z.string().trim().min(1).optional(),
      })
      .strict(),
    z
      .object({
        id: z.string().trim().min(1),
        prompt: z.string().trim().min(1),
        kind: z.literal('input'),
      })
      .strict(),
  ])
  .superRefine((question, context) => {
    if (question.kind !== 'choice') return;
    const optionIds = question.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({ code: 'custom', message: 'choice option ids must be unique' });
    }
    if (question.recommendedOptionId && !optionIds.includes(question.recommendedOptionId)) {
      context.addIssue({
        code: 'custom',
        message: 'recommendedOptionId must name one of the choice options',
      });
    }
  });

const QuestionPacketSchema = z
  .object({ questions: z.array(FlowQuestionSchema).min(1) })
  .strict()
  .superRefine((packet, context) => {
    const ids = packet.questions.map((question) => question.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'question ids must be unique' });
    }
  });

const FlowQuestionAnswerSchema = z
  .object({
    questionId: z.string().trim().min(1),
    answer: z.string().trim().min(1),
    answeredAt: z.string().min(1),
  })
  .strict();

const FlowInteractionSchema = z
  .object({
    round: z.number().int().positive(),
    pausedAt: z.string().min(1),
    resolvedAt: z.string().min(1).optional(),
    questions: z.array(FlowQuestionSchema).min(1),
    answers: z.array(FlowQuestionAnswerSchema),
  })
  .strict();

export type FlowQuestion = z.infer<typeof FlowQuestionSchema>;
export type FlowQuestionAnswer = z.infer<typeof FlowQuestionAnswerSchema>;
export type FlowInteraction = z.infer<typeof FlowInteractionSchema>;

export interface FlowStep {
  id: string;
  skill: string;
  /** Absent on auto-profile steps until `spok flow next` resolves them. */
  runner?: FlowRunner;
  model?: FlowModel;
  effort?: FlowEffort;
  argument: string;
  expectedOutput?: string;
  status: FlowStepStatus;
  result?: FlowStepResult;
  /** Auto profile only: policy version and every candidate rejected before this route was chosen. */
  route?: AutoRouteRecord;
  /** 1-based repair-cycle attempt for spliced repair/validate steps; absent on the base graph. */
  attempt?: number;
  /** Durable question rounds reported while this occurrence remains unfinished. */
  interactions?: FlowInteraction[];
  /** Derived per response, never persisted: the full subagent prompt to dispatch verbatim. */
  prompt?: string;
}

export interface WorkflowState {
  version: 2;
  profile: FlowProfile;
  taskDir: string;
  status: FlowRunState;
  steps: FlowStep[];
  repairAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface FlowResponse {
  state: FlowRunState;
  profile?: FlowProfile;
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
  workRoot?: string;
  workRootWarning?: string;
  question?: FlowQuestion;
  questions?: FlowQuestion[];
}

export interface FlowCompleteInput {
  step: string;
  output?: string;
  summary?: string;
  commit?: string;
  workRoot?: string;
}

export interface FlowCommandOptions {
  json?: boolean;
}

export interface FlowCompleteCommandOptions extends FlowCommandOptions, FlowCompleteInput {}

export interface FlowPauseInput {
  step: string;
  questions: string;
}

export interface FlowAnswerInput {
  question: string;
  answer: string;
}

export interface FlowPauseCommandOptions extends FlowCommandOptions, FlowPauseInput {}
export interface FlowAnswerCommandOptions extends FlowCommandOptions, FlowAnswerInput {}

interface StepDefinition {
  id: RoutedStepId;
  skill: string;
  runner?: FlowRunner;
  model?: FlowModel;
  effort?: FlowEffort;
  argument: string;
  expectedOutput?: string;
  completionKind: FlowCompletionKind;
  attempt?: number;
}

interface FlowStepPaths {
  taskDir: string;
  ticket: string;
  problemValidation: string;
  researchQuestions: string;
  research: string;
  designDiscussion: string;
  structureOutline: string;
  designReview: string;
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

const VALIDATE_STEP_DEFINITION_SPEC = {
  id: VALIDATE_STEP_ID,
  skill: 'spok-validate-implementation',
  argument: 'taskDir',
  expectedOutput: 'validation',
  completionKind: 'file',
} as const satisfies StepDefinitionSpec;

const REPAIR_STEP_DEFINITION_SPEC = {
  id: REPAIR_STEP_ID,
  skill: 'spok-repair',
  argument: 'validation',
  completionKind: 'summary',
} as const satisfies StepDefinitionSpec;

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
    id: DESIGN_REVIEW_STEP_ID,
    skill: 'spok-review-design',
    argument: 'taskDir',
    expectedOutput: 'designReview',
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
  VALIDATE_STEP_DEFINITION_SPEC,
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
  event: 'flow_status' | 'flow_next' | 'flow_complete' | 'flow_pause' | 'flow_answer';
  state: FlowRunState;
  step?: string;
  completedStep?: string;
  /** Routing of the completed step; lets the log answer "which model judged, on which attempt". */
  runner?: FlowRunner;
  model?: FlowModel;
  attempt?: number;
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

function interactionAnswers(interactions: FlowInteraction[] | undefined): FlowQuestionAnswer[] {
  return interactions?.flatMap((interaction) => interaction.answers) ?? [];
}

function unansweredQuestions(step: FlowStep | undefined): FlowQuestion[] {
  if (!step?.interactions) return [];
  const answered = new Set(
    interactionAnswers(step.interactions).map((answer) => answer.questionId)
  );
  return step.interactions
    .flatMap((interaction) => interaction.questions)
    .filter((question) => !answered.has(question.id));
}

function answeredQuestionsClause(interactions: FlowInteraction[] | undefined): string | undefined {
  const answers = interactionAnswers(interactions);
  if (answers.length === 0) return;
  return [
    'Human answers to earlier open questions. Treat these as authoritative:',
    ...answers.map((answer) => `- ${answer.questionId}: ${answer.answer}`),
    'Regenerate the stage output after applying these answers. Do not treat an output created before this resumed attempt as complete.',
  ].join('\n');
}

function openQuestionClause(
  taskDir: string,
  stepId: RoutedStepId,
  interactions: FlowInteraction[] | undefined
): string {
  const round = (interactions?.length ?? 0) + 1;
  const packetPath = path.join(taskDir, 'open-questions', `${stepId}-round-${round}.json`);
  return [
    'Work autonomously. Resolve code-answerable uncertainty from the repository and supplied artifacts. ' +
      'Do not ask the user directly and do not ask for approval between stages.',
    'Only when consequential human intent is missing and choosing would materially change behavior, ' +
      `create or overwrite this exact packet path: \`${packetPath}\`. Create its parent directory when needed.`,
    'The packet must be strict JSON with a non-empty `questions` array. Every question needs unique, ' +
      'stable `id` and non-empty `prompt` fields. An `input` question has `kind: "input"`. A `choice` ' +
      'question has `kind: "choice"`, two or three `options`, and may have `recommendedOptionId`; every ' +
      'option needs unique, non-empty `id`, `label`, and `consequence` fields. Never reuse a question id ' +
      'from an earlier round.',
    'For that outcome, do not create the stage completion artifact or return a completion summary. End ' +
      'your reply with a final line exactly `NEEDS_INPUT: <absolute-question-packet-path>`, replacing the ' +
      `placeholder with \`${packetPath}\`. The NEEDS_INPUT outcome and normal completion are mutually exclusive.`,
    'If no consequential human intent is missing, do not create a question packet and complete the stage normally.',
  ].join('\n');
}

const STEP_PROMPT_CLAUSES: Partial<Record<RoutedStepId, string>> = {
  implement:
    'You are running inside spok-flow. Implement and verify the plan, return a ' +
    'summary of what you did, and do NOT create any commits — the commit step owns that. ' +
    'End your reply with a final line reading `Work root: <absolute path>`, naming the ' +
    'absolute path of the repository working tree you edited (the git worktree root that ' +
    'holds the changed files, which may differ from the task directory). Report the path ' +
    '`git -C <directory containing an edited file> rev-parse --show-toplevel` prints, not a guess.',
  validate:
    'You are the adversary, not the author. Presume the implementation is wrong and try to ' +
    'break it. Judge from the diff, the plan, the ticket, and the design discussion (including ' +
    'its Scale section); do NOT read step summaries in workflow-state.json or trust the ' +
    'implementer\'s claims.',
  [SELF_LEARN_STEP_ID]: 'This gate is advisory. Do not fail, amend, or rewrite the commit.',
};

/**
 * The commit step runs as a fresh subagent with no session history, so the
 * repository it must commit in is stated outright rather than rediscovered.
 */
function workRootClause(workRoot: string): string {
  return (
    `The changes to commit are in \`${workRoot}\`. Run every git command with ` +
    `\`-C ${workRoot}\`. If that repository has no changes, stop and report — do not ` +
    'search other directories, and never commit from a repository you were not given.'
  );
}

function editingWorkRootClause(workRoot: string): string {
  return (
    `The implementation repository is \`${workRoot}\`, which may differ from the task directory. ` +
    'Read and edit source files there, and run verification commands from that directory. ' +
    `Run every git command with \`-C ${workRoot}\`. Do not edit source files in the task ` +
    'directory unless it is the same repository.'
  );
}

/** The whole subagent prompt. The driver dispatches it verbatim and assembles nothing. */
function buildStepPrompt(
  taskDir: string,
  definition: StepDefinition,
  rules: string[],
  interactions?: FlowInteraction[],
  workRoot?: string
): string {
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

  sections.push(openQuestionClause(taskDir, definition.id, interactions));

  sections.push(
    definition.completionKind === 'file'
      ? 'When complete, return the absolute path of the document that was created.'
      : 'When complete, return a concise summary of what you did.'
  );

  const clause = STEP_PROMPT_CLAUSES[definition.id];
  if (clause) sections.push(clause);

  const answers = answeredQuestionsClause(interactions);
  if (answers) sections.push(answers);

  if (workRoot) {
    if (definition.completionKind === 'commit') sections.push(workRootClause(workRoot));
    if (definition.id === 'simplify' || definition.id === REPAIR_STEP_ID) {
      sections.push(editingWorkRootClause(workRoot));
    }
  }

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
    designReview: path.join(taskDir, 'design-review.md'),
    plan: path.join(taskDir, 'plan.md'),
    validation: path.join(taskDir, 'validation.md'),
    selfLearn: path.join(taskDir, 'self-learn.md'),
  };
}

function profileRouting(spec: StepDefinitionSpec, profile: FlowProfile): Routing | undefined {
  if (profile === 'auto') return undefined;
  if (profile === 'hybrid') return HYBRID_ROUTING_BY_ID[spec.id];
  if (profile === 'claude') return CLAUDE_ROUTING_BY_ID[spec.id];
  return CODEX_ROUTING_BY_TIER[FLOW_STEP_TIER_BY_ID[spec.id]];
}

function buildStepDefinition(
  spec: StepDefinitionSpec,
  paths: FlowStepPaths,
  profile: FlowProfile
): StepDefinition {
  const routing = profileRouting(spec, profile);
  return {
    id: spec.id,
    skill: spec.skill,
    ...routing,
    argument: paths[spec.argument],
    expectedOutput: spec.expectedOutput ? paths[spec.expectedOutput] : undefined,
    completionKind: spec.completionKind,
  };
}

const REPAIR_CYCLE_SPECS = [REPAIR_STEP_DEFINITION_SPEC, VALIDATE_STEP_DEFINITION_SPEC] as const;

/** The [repair, validate] pair one FAIL splices in, stamped with its 1-based attempt. */
function repairCycleDefinitions(
  taskDir: string,
  attempt: number,
  profile: FlowProfile
): StepDefinition[] {
  const paths = buildFlowStepPaths(taskDir);
  return REPAIR_CYCLE_SPECS.map((spec) => ({
    ...buildStepDefinition(spec, paths, profile),
    attempt,
  }));
}

function buildStepDefinitions(
  taskDir: string,
  repairAttempts: number,
  profile: FlowProfile
): StepDefinition[] {
  const paths = buildFlowStepPaths(taskDir);
  const specs = isSelfLearnEnabled(taskDir)
    ? [...BASE_STEP_DEFINITION_SPECS, SELF_LEARN_STEP_DEFINITION_SPEC]
    : BASE_STEP_DEFINITION_SPECS;
  const definitions: StepDefinition[] = specs.map((spec) =>
    buildStepDefinition(spec, paths, profile)
  );
  if (repairAttempts === 0) return definitions;

  // Every cycle lands as one block right after the base validate, so the flat
  // list reads: validate, then (repair, validate) once per attempt.
  const cycles = Array.from({ length: repairAttempts }, (_, index) =>
    repairCycleDefinitions(taskDir, index + 1, profile)
  ).flat();
  const validateIndex = definitions.findIndex((definition) => definition.id === VALIDATE_STEP_ID);
  definitions.splice(validateIndex + 1, 0, ...cycles);
  return definitions;
}

function stepFromDefinition(
  definition: StepDefinition,
  status: FlowStepStatus,
  result?: FlowStepResult
): FlowStep {
  const { runner, model, effort } = definition;
  return {
    id: definition.id,
    skill: definition.skill,
    ...(runner && model ? { runner, model, effort } : {}),
    argument: definition.argument,
    expectedOutput: definition.expectedOutput,
    status,
    result,
    attempt: definition.attempt,
  };
}

function createInitialState(taskDir: string, profile: FlowProfile): WorkflowState {
  const timestamp = nowIso();
  const definitions = buildStepDefinitions(taskDir, 0, profile);
  return {
    version: 2,
    profile,
    taskDir,
    status: 'ready',
    steps: definitions.map((definition, index) =>
      stepFromDefinition(definition, index === 0 ? 'ready' : 'pending')
    ),
    repairAttempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** The step's id when the stored value is shaped like a step at all, else undefined. */
function storedStepId(step: unknown): string | undefined {
  if (!step || typeof step !== 'object') return;
  const id = (step as Partial<FlowStep>).id;
  return typeof id === 'string' ? id : undefined;
}

function isCompletedStep(step: unknown): step is FlowStep {
  return storedStepId(step) !== undefined && (step as Partial<FlowStep>).status === 'completed';
}

function occurrenceKey(id: string, occurrence: number): string {
  return `${id}#${occurrence}`;
}

/**
 * Keys a step by how many same-id steps preceded it, so the repeated `validate`
 * of a repair cycle cannot inherit the first occurrence's completed result.
 * Mutates `counts`, which must be walked in list order.
 */
function takeOccurrenceKey(counts: Map<string, number>, id: string): string {
  const occurrence = counts.get(id) ?? 0;
  counts.set(id, occurrence + 1);
  return occurrenceKey(id, occurrence);
}

function shouldSkipProblemValidationForLegacyState(completed: Map<string, FlowStep>): boolean {
  return completed.size > 0 && !completed.has(occurrenceKey(PROBLEM_VALIDATION_STEP_ID, 0));
}

const STEPS_AT_OR_AFTER_PLAN = new Set([
  'plan',
  'implement',
  'simplify',
  VALIDATE_STEP_ID,
  REPAIR_STEP_ID,
  'commit',
  SELF_LEARN_STEP_ID,
]);

function shouldCompleteDesignReviewForLegacyState(storedSteps: unknown[]): boolean {
  if (storedSteps.some((step) => storedStepId(step) === DESIGN_REVIEW_STEP_ID)) return false;

  return storedSteps.some((step) => {
    const id = storedStepId(step);
    return id !== undefined && STEPS_AT_OR_AFTER_PLAN.has(id) && isCompletedStep(step);
  });
}

function inferLegacyProfile(stored: unknown): DetectedProfile | undefined {
  if (!stored || typeof stored !== 'object') return;
  const steps = Array.isArray((stored as Partial<WorkflowState>).steps)
    ? (stored as Partial<WorkflowState>).steps!
    : [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const model = (step as Partial<FlowStep>).model;
    if (typeof model !== 'string') continue;
    if (model.startsWith('gpt-')) return 'codex';
    if (model === 'fable' || model === 'opus' || model === 'sonnet' || model === 'haiku') {
      return 'claude';
    }
  }
}

function resolveStateProfile(
  stored: unknown,
  requested: FlowProfile | undefined
): { profile?: FlowProfile; reason?: string } {
  if (!stored || typeof stored !== 'object') {
    return { profile: requested ?? detectTool() };
  }

  const candidate = stored as Partial<WorkflowState>;
  if (candidate.profile !== undefined && !isFlowProfile(candidate.profile)) {
    return { reason: `Invalid workflow state profile: ${String(candidate.profile)}.` };
  }

  const existing = candidate.profile ?? inferLegacyProfile(stored);
  if (requested && existing && requested !== existing) {
    return {
      reason: `Flow profile mismatch: state uses ${existing}, requested ${requested}.`,
    };
  }
  if (existing === 'hybrid' || existing === 'auto') return { profile: existing };
  return { profile: requested ?? detectTool() };
}

function normalizeState(
  taskDir: string,
  stored: unknown,
  profile: FlowProfile
): WorkflowState {
  const initial = createInitialState(taskDir, profile);
  if (!stored || typeof stored !== 'object') return initial;

  const candidate = stored as Partial<WorkflowState>;
  const repairAttempts =
    typeof candidate.repairAttempts === 'number' && candidate.repairAttempts > 0
      ? Math.floor(candidate.repairAttempts)
      : 0;
  const storedSteps = Array.isArray(candidate.steps) ? candidate.steps : [];
  const completedByKey = new Map<string, FlowStep>();
  const storedByKey = new Map<string, Partial<FlowStep>>();
  const storedOccurrences = new Map<string, number>();
  for (const step of storedSteps) {
    const id = storedStepId(step);
    if (id === undefined) continue;
    const key = takeOccurrenceKey(storedOccurrences, id);
    storedByKey.set(key, step as Partial<FlowStep>);
    if (isCompletedStep(step)) completedByKey.set(key, step);
  }

  const definitions = buildStepDefinitions(taskDir, repairAttempts, profile);
  const skipProblemValidation = shouldSkipProblemValidationForLegacyState(completedByKey);
  const completeDesignReview = shouldCompleteDesignReviewForLegacyState(storedSteps);
  const definitionOccurrences = new Map<string, number>();
  const steps = definitions.map((definition) => {
    const key = takeOccurrenceKey(definitionOccurrences, definition.id);
    const completed = completedByKey.get(key);
    if (!completed && definition.id === PROBLEM_VALIDATION_STEP_ID && skipProblemValidation) {
      return stepFromDefinition(definition, 'completed', {
        summary: 'Skipped for legacy workflow state created before validate-problem existed.',
        completedAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : initial.createdAt,
      });
    }

    if (!completed && definition.id === DESIGN_REVIEW_STEP_ID && completeDesignReview) {
      return stepFromDefinition(definition, 'completed', {
        summary: 'Completed synthetically for legacy workflow state with plan or later work completed.',
        completedAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : initial.createdAt,
      });
    }

    const step = stepFromDefinition(
      definition,
      completed ? 'completed' : 'pending',
      completed?.result
    );
    const stored = storedByKey.get(key);
    const interactions = readStoredInteractions(stored?.interactions);
    const routed = profile === 'auto' || completed || interactions
      ? withPersistedRoute(step, stored)
      : step;
    return interactions ? { ...routed, interactions } : routed;
  });

  const state: WorkflowState = {
    version: 2,
    profile,
    taskDir,
    status: 'ready',
    steps,
    repairAttempts,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : initial.createdAt,
    updatedAt: initial.updatedAt,
  };

  markNextStepReady(state);
  return state;
}

function readStoredInteractions(value: unknown): FlowInteraction[] | undefined {
  const parsed = z.array(FlowInteractionSchema).safeParse(value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}

/** Preserves completed history and keeps auto routes stable across every normalization. */
function withPersistedRoute(step: FlowStep, stored: Partial<FlowStep> | undefined): FlowStep {
  if (!stored?.runner) return step;
  const { id, skill, ...rest } = step;
  return {
    id,
    skill,
    ...rest,
    runner: stored.runner,
    ...(stored.model !== undefined ? { model: stored.model } : {}),
    ...(stored.effort !== undefined ? { effort: stored.effort } : {}),
    // Chunk-1 routes predate modelControl; default it in memory from the runner.
    route: stored.route && {
      ...stored.route,
      modelControl: stored.route.modelControl ?? MODEL_CONTROL_BY_RUNNER[stored.runner],
    },
  };
}

function markNextStepReady(state: WorkflowState): void {
  let readyStep: FlowStep | undefined;

  for (const step of state.steps) {
    if (step.status === 'completed') continue;

    if (!readyStep) {
      step.status = 'ready';
      readyStep = step;
    } else {
      step.status = 'pending';
    }
  }

  if (!readyStep) {
    state.status = 'complete';
  } else {
    state.status = unansweredQuestions(readyStep).length > 0 ? 'needs-input' : 'ready';
  }
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
  if (reason.startsWith('Invalid workflow state profile:')) return 'invalid_state_profile';
  if (reason.startsWith('Unknown flow profile:')) return 'unknown_flow_profile';
  if (reason.startsWith('Flow profile mismatch:')) return 'flow_profile_mismatch';
  if (reason.startsWith('Missing completed artifact for step ')) return 'missing_completed_artifact';
  if (reason.startsWith('Expected step ')) return 'wrong_step';
  if (reason.startsWith('Unknown workflow step:')) return 'unknown_step';
  if (reason.startsWith('Expected output path ')) return 'wrong_output_path';
  if (reason.startsWith('Expected output file is missing or empty for step ')) return 'missing_output';
  if (reason.includes('must set Flow Decision to proceed')) return 'flow_decision_not_proceed';
  if (reason.includes('repair attempts')) return 'repair_attempts_exhausted';
  if (reason.startsWith(`Step ${DESIGN_REVIEW_STEP_ID} recorded a FAIL verdict`)) {
    return 'design_review_verdict_fail';
  }
  if (reason.startsWith(`Step ${DESIGN_REVIEW_STEP_ID} has no readable verdict`)) {
    return 'design_review_verdict_unreadable';
  }
  if (reason.includes('recorded a FAIL verdict')) return 'validation_verdict_fail';
  if (reason.includes('has no readable verdict')) return 'validation_verdict_unreadable';
  if (reason.includes('must provide a non-empty --summary')) return 'missing_summary';
  if (reason.includes('must provide a commit SHA')) return 'missing_commit';
  if (reason.includes('must provide an absolute --work-root')) return 'invalid_work_root';
  if (reason.startsWith('Work root directory does not exist')) return 'missing_work_root';
  if (reason.includes('conflicts with recorded work root')) return 'work_root_conflict';
  if (reason.includes('is not a commit object in')) return 'commit_not_found';
  if (reason.includes('is not reachable from HEAD in')) return 'commit_not_reachable';
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
  const completed = response.completedStep;
  if (completed?.id) {
    event.completedStep = completed.id;
    event.runner = completed.runner;
    event.model = completed.model;
    if (completed.attempt !== undefined) event.attempt = completed.attempt;
  }
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

  const requested = requestedFlowProfile();
  if (requested.reason) {
    return { taskDir, statePath, reason: requested.reason };
  }

  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const stored: unknown = JSON.parse(raw);
    const resolved = resolveStateProfile(stored, requested.profile);
    if (!resolved.profile) {
      return { taskDir, statePath, reason: resolved.reason! };
    }
    return {
      taskDir,
      statePath,
      state: normalizeState(taskDir, stored, resolved.profile),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        taskDir,
        statePath,
        state: createInitialState(taskDir, requested.profile ?? detectTool()),
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

function getDefinitionById(
  taskDir: string,
  stepId: string,
  repairAttempts: number,
  profile: FlowProfile
): StepDefinition | undefined {
  return buildStepDefinitions(taskDir, repairAttempts, profile).find(
    (definition) => definition.id === stepId
  );
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
  rules: string[],
  repairAttempts: number,
  profile: FlowProfile,
  workRoot?: string
): FlowStep | undefined {
  if (!step) return step;

  const definition = getDefinitionById(taskDir, step.id, repairAttempts, profile);
  if (!definition) return step;

  return {
    ...step,
    prompt: buildStepPrompt(taskDir, definition, rules, step.interactions, workRoot),
  };
}

/** The most recently recorded work root: repair can move the work after implement. */
function recordedWorkRoot(state: WorkflowState): string | undefined {
  let workRoot: string | undefined;
  for (const step of state.steps) {
    if (step.status === 'completed' && step.result?.workRoot) workRoot = step.result.workRoot;
  }
  return workRoot;
}

/**
 * Warns only where the gap bites: a state file written before work roots
 * existed still reaches commit, it just reaches it unsteered.
 */
function buildWorkRootWarning(state: WorkflowState, workRoot: string | undefined): string | undefined {
  if (workRoot || getCurrentStep(state)?.id !== 'commit') return;

  return 'No work root was recorded by an earlier step; the commit agent must discover the repository itself.';
}

function buildResponse(
  state: WorkflowState,
  extra: Pick<FlowResponse, 'step' | 'completedStep' | 'reason'> = {}
): FlowResponse {
  const memory = readMemory(state.taskDir);
  const workRoot = recordedWorkRoot(state);
  const nextStep = withStepPrompt(
    state.taskDir,
    getCurrentStep(state),
    memory?.rules ?? [],
    state.repairAttempts,
    state.profile,
    workRoot
  );
  const questions = unansweredQuestions(nextStep);
  return {
    state: state.status,
    profile: state.profile,
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
    workRoot,
    workRootWarning: buildWorkRootWarning(state, workRoot),
    question: questions[0],
    questions: questions.length > 0 ? questions : undefined,
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
  const definitions = buildStepDefinitions(state.taskDir, state.repairAttempts, state.profile);
  const finalValidateIndex = state.steps.map((step) => step.id).lastIndexOf(VALIDATE_STEP_ID);

  for (const [index, step] of state.steps.entries()) {
    if (step.status !== 'completed') continue;

    const definition = definitions.find((candidate) => candidate.id === step.id);
    if (definition?.completionKind !== 'file' || !definition.expectedOutput) continue;
    if (!step.result?.output) continue;

    if (!(await pathIsNonEmptyFile(definition.expectedOutput))) {
      return `Missing completed artifact for step ${step.id}: ${definition.expectedOutput}`;
    }

    // The gates self-guard on step id. Re-running them keeps a completed
    // artifact that was edited after completion from carrying the flow forward.
    const decisionError = await validateProblemValidationFlowDecision(definition);
    if (decisionError) return decisionError;

    const designReviewError = await validateDesignReviewVerdict(definition);
    if (designReviewError) return designReviewError;

    // The verdict gate fires only on the final validate occurrence: an earlier
    // completed validate legitimately holds a FAIL artifact mid-cycle.
    if (step.id === VALIDATE_STEP_ID && index !== finalValidateIndex) continue;

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
    profile: state.profile,
    taskDir: state.taskDir,
    statePath: getStatePath(state.taskDir),
    steps: state.steps,
    nextStep: getCurrentStep(state),
    reason,
  };
}

/** Auto profile only. Probes the ready step's distinct candidates concurrently, then applies
 * auto-v1 in policy order and fills the route in place. A step that already has a runner is
 * never re-routed; when nothing is eligible the selector falls back to the current harness. */
async function resolveReadyStepRoute(state: WorkflowState): Promise<void> {
  if (state.profile !== 'auto') return;
  const index = state.steps.findIndex((step) => step.status === 'ready');
  const ready = state.steps[index];
  if (!ready || ready.runner) return;

  // Step ids come from the definition table, so the cast is safe.
  const stepId = ready.id as RoutedStepId;
  const runners = AUTO_CANDIDATES_BY_STEP[stepId].map((candidate) => candidate.runner);
  const reports = await probeHarnesses(runners);
  const { route } = selectAutoRoute(
    stepId,
    await withOmpIsolation(reports, state.taskDir),
    state.steps.slice(0, index)
  );
  state.steps[index] = withPersistedRoute(ready, route);
}

/** OMP is eligible only from a linked worktree: without proof the available report
 * degrades to work_root_not_isolated and ordered selection falls to the next candidate.
 * Runs at most one git probe, and only when OMP is otherwise available. */
async function withOmpIsolation(
  reports: CapabilityReport[],
  taskDir: string
): Promise<CapabilityReport[]> {
  const omp = reports.find((report) => report.runner === 'omp');
  if (!omp?.available) return reports;
  const root = findProjectRootForTaskDir(taskDir) ?? taskDir;
  if (await isLinkedWorktree(root)) return reports;
  const rejection: CapabilityReport = {
    runner: 'omp',
    available: false,
    code: 'work_root_not_isolated',
    reason: `${root} is not a provably linked Git worktree; omp --auto-approve requires one.`,
  };
  return reports.map((report) => (report.runner === 'omp' ? rejection : report));
}

/** Proof of isolation: absolute git-dir and git-common-dir both resolve and differ.
 * A failed lookup (non-repo, broken metadata) is not proof and fails closed. */
async function isLinkedWorktree(dir: string): Promise<boolean> {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_WORK_TREE;
  const stdout = await runGit(
    dir,
    ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
    env
  );
  if (stdout === undefined) return false;
  const [gitDir, commonDir] = stdout
    .trim()
    .split('\n')
    .map((line) => path.normalize(line.trim()));
  return Boolean(gitDir) && Boolean(commonDir) && gitDir !== commonDir;
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

async function answeredArtifactFreshnessError(
  step: FlowStep,
  definition: StepDefinition
): Promise<string | undefined> {
  if (definition.completionKind !== 'file' || !definition.expectedOutput) return;
  const resolvedAt = step.interactions?.at(-1)?.resolvedAt;
  if (!resolvedAt) return;

  let modifiedAt: number;
  try {
    modifiedAt = (await fs.stat(definition.expectedOutput)).mtimeMs;
  } catch {
    return;
  }

  const answeredAt = Date.parse(resolvedAt);
  if (Number.isNaN(answeredAt) || modifiedAt > answeredAt) return;
  return `Step ${definition.id} must regenerate its output after answering questions: ${definition.expectedOutput}`;
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

const DESIGN_REVIEW_FRONTMATTER_PATTERN =
  /^---\ntype: design-review\nverdict: (PASS|FAIL)\n---(?:\n|$)/;

/** Pure. The review contract permits only the exact, ordered frontmatter fields. */
function readDesignReviewVerdict(content: string): Verdict | undefined {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(DESIGN_REVIEW_FRONTMATTER_PATTERN);
  return match?.[1] as Verdict | undefined;
}

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

/** Stdout of a git invocation, or undefined when git is missing or exits nonzero. */
async function runGit(
  workRoot: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', workRoot, ...args], { env });
    return stdout;
  } catch {
    return;
  }
}

/**
 * A recorded work root is only useful if it names a real directory now: an
 * absent one means the flow resumed somewhere the work no longer exists.
 */
async function validateWorkRoot(
  definition: StepDefinition,
  workRoot: string
): Promise<string | undefined> {
  if (!path.isAbsolute(workRoot)) {
    return `Step ${definition.id} must provide an absolute --work-root path, got ${workRoot}.`;
  }
  if (!(await pathIsDirectory(workRoot))) {
    return `Work root directory does not exist for step ${definition.id}: ${workRoot}`;
  }
}

/** Resolve a revision expression to the stable commit object ID that HEAD can reach. */
async function resolveCommitSha(
  workRoot: string,
  commit: string
): Promise<{ commit: string } | { error: string }> {
  const resolved = (
    await runGit(workRoot, ['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`])
  )?.trim();
  if (!resolved) return { error: `Commit ${commit} is not a commit object in ${workRoot}.` };

  if ((await runGit(workRoot, ['merge-base', '--is-ancestor', resolved, 'HEAD'])) === undefined) {
    return { error: `Commit ${commit} is not reachable from HEAD in ${workRoot}.` };
  }

  return { commit: resolved };
}

async function completeCommitResult(
  definition: StepDefinition,
  input: FlowCompleteInput,
  recordedRoot: string | undefined
): Promise<FlowStepResult | string> {
  const commit = input.commit?.trim();
  if (!commit) {
    return `Step ${definition.id} must provide a commit SHA with --commit.`;
  }

  if (recordedRoot) {
    const workRootError = await validateWorkRoot(definition, recordedRoot);
    if (workRootError) return workRootError;
  }

  const suppliedRoot = input.workRoot?.trim();
  if (suppliedRoot !== undefined) {
    const workRootError = await validateWorkRoot(definition, suppliedRoot);
    if (workRootError) return workRootError;
  }

  if (
    recordedRoot &&
    suppliedRoot &&
    FileSystemUtils.canonicalizeExistingPath(recordedRoot) !==
      FileSystemUtils.canonicalizeExistingPath(suppliedRoot)
  ) {
    return `Step ${definition.id} --work-root ${suppliedRoot} conflicts with recorded work root ${recordedRoot}.`;
  }

  const workRoot = recordedRoot ?? suppliedRoot;
  let resolvedCommit = commit;
  if (workRoot) {
    const resolution = await resolveCommitSha(workRoot, commit);
    if ('error' in resolution) return resolution.error;
    resolvedCommit = resolution.commit;
  }

  return {
    commit: resolvedCommit,
    summary: input.summary?.trim() || undefined,
    workRoot,
    completedAt: nowIso(),
  };
}

async function validateDesignReviewVerdict(
  definition: StepDefinition
): Promise<string | undefined> {
  if (definition.id !== DESIGN_REVIEW_STEP_ID || !definition.expectedOutput) return;

  const content = await readArtifact(definition.expectedOutput);
  const verdict = content === undefined ? undefined : readDesignReviewVerdict(content);
  if (verdict === 'PASS') return;
  if (verdict === 'FAIL') {
    return `Step ${DESIGN_REVIEW_STEP_ID} recorded a FAIL verdict: ${definition.expectedOutput}`;
  }

  return `Step ${DESIGN_REVIEW_STEP_ID} has no readable verdict (expected strict frontmatter with type: design-review and verdict: PASS or FAIL): ${definition.expectedOutput}`;
}

async function completeStepResult(
  definition: StepDefinition,
  input: FlowCompleteInput,
  recordedRoot?: string
): Promise<FlowStepResult | string> {
  if (definition.completionKind === 'file') {
    const validationError = validateFileCompletion(definition, input);
    if (validationError) return validationError;

    if (!(await pathIsNonEmptyFile(definition.expectedOutput!))) {
      return `Expected output file is missing or empty for step ${definition.id}: ${definition.expectedOutput}`;
    }

    const decisionError = await validateProblemValidationFlowDecision(definition);
    if (decisionError) return decisionError;

    const designReviewError = await validateDesignReviewVerdict(definition);
    if (designReviewError) return designReviewError;

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

    // Omitting --work-root degrades to the pre-work-root behavior; a supplied
    // one is checked here so the commit step never inherits an unusable path.
    const workRoot = input.workRoot?.trim();
    if (workRoot !== undefined) {
      const workRootError = await validateWorkRoot(definition, workRoot);
      if (workRootError) return workRootError;
    }

    return {
      summary,
      workRoot,
      completedAt: nowIso(),
    };
  }

  return completeCommitResult(definition, input, recordedRoot);
}

function repairAttemptsExhaustedReason(expectedOutput: string): string {
  return `Step ${VALIDATE_STEP_ID} exhausted ${MAX_REPAIR_ATTEMPTS} repair attempts and still records a FAIL verdict: ${expectedOutput}`;
}

/**
 * A FAIL with attempts remaining is a successful transition, not a block:
 * blocked responses are ephemeral and could never advance the flow to repair.
 * The validate step completes against its recorded artifact, the [repair,
 * validate] pair extends the flat step list, and the state file is written.
 */
async function spliceRepairCycle(
  state: WorkflowState,
  currentStep: FlowStep,
  definition: StepDefinition
): Promise<FlowResponse> {
  currentStep.status = 'completed';
  currentStep.result = { output: definition.expectedOutput, completedAt: nowIso() };

  state.repairAttempts += 1;
  const spliced = repairCycleDefinitions(
    state.taskDir,
    state.repairAttempts,
    state.profile
  ).map(
    (cycleDefinition) => stepFromDefinition(cycleDefinition, 'pending')
  );
  state.steps.splice(state.steps.indexOf(currentStep) + 1, 0, ...spliced);

  markNextStepReady(state);
  await writeState(state);
  return buildResponse(state, { completedStep: currentStep });
}

/** Epoch ms of the latest completed repair step, or undefined when none completed. */
function lastRepairCompletedAt(state: WorkflowState): number | undefined {
  let latest: number | undefined;
  for (const step of state.steps) {
    if (step.id !== REPAIR_STEP_ID || step.status !== 'completed') continue;
    const completedAt = Date.parse(step.result?.completedAt ?? '');
    if (!Number.isNaN(completedAt) && (latest === undefined || completedAt > latest)) {
      latest = completedAt;
    }
  }
  return latest;
}

/**
 * Query-side terminal check, re-derived from disk on every call (blocked is
 * ephemeral, so the exhausting completion leaves no stored trace). Fires only
 * for a FAIL recorded at or after the last repair completed: the stale FAIL
 * left by the previous validate run must not block dispatching the final
 * validate occurrence.
 */
async function exhaustedRepairBlockReason(state: WorkflowState): Promise<string | undefined> {
  if (state.repairAttempts < MAX_REPAIR_ATTEMPTS) return;

  const current = getCurrentStep(state);
  if (current?.id !== VALIDATE_STEP_ID) return;

  const repairCompletedAt = lastRepairCompletedAt(state);
  if (repairCompletedAt === undefined) return;

  const output = buildFlowStepPaths(state.taskDir).validation;
  let recordedAt: number;
  try {
    recordedAt = (await fs.stat(output)).mtimeMs;
  } catch {
    return; // Absent artifact: the step is simply re-offered, as today.
  }
  if (recordedAt < repairCompletedAt) return; // Stale FAIL from before the final repair.

  const content = await readArtifact(output);
  if (content === undefined || readValidationVerdict(content) !== 'FAIL') return;

  return repairAttemptsExhaustedReason(output);
}

function questionPacketPathError(taskDir: string, packetPath: string): string | undefined {
  const relative = path.relative(taskDir, packetPath);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  return `Questions packet must be inside the task directory ${taskDir}: ${packetPath}`;
}

async function readQuestionPacket(
  taskDir: string,
  inputPath: string
): Promise<FlowQuestion[] | string> {
  const packetPath = path.resolve(inputPath);
  const locationError = questionPacketPathError(taskDir, packetPath);
  if (locationError) return locationError;

  let canonicalTaskDir: string;
  let canonicalPacketPath: string;
  try {
    [canonicalTaskDir, canonicalPacketPath] = await Promise.all([
      fs.realpath(taskDir),
      fs.realpath(packetPath),
    ]);
  } catch {
    return `Questions packet cannot be read: ${packetPath}`;
  }
  if (questionPacketPathError(canonicalTaskDir, canonicalPacketPath)) {
    return `Questions packet must be inside the task directory ${taskDir}: ${packetPath}`;
  }

  let raw: string;
  try {
    raw = await fs.readFile(canonicalPacketPath, 'utf-8');
  } catch {
    return `Questions packet cannot be read: ${packetPath}`;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return `Invalid questions packet JSON: ${packetPath}`;
  }

  const parsed = QuestionPacketSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? 'packet does not match the schema';
    return `Invalid questions packet ${packetPath}: ${detail}`;
  }
  return parsed.data.questions;
}

function repeatedQuestionId(step: FlowStep, questions: FlowQuestion[]): string | undefined {
  const existing = new Set(
    step.interactions?.flatMap((interaction) =>
      interaction.questions.map((question) => question.id)
    ) ?? []
  );
  return questions.find((question) => existing.has(question.id))?.id;
}

export async function pauseFlowStep(
  taskDirInput: string,
  input: FlowPauseInput
): Promise<FlowResponse> {
  const loaded = await loadOrCreateState(taskDirInput);
  if (!loaded.state) {
    const response = buildBlockedResponse(loaded.taskDir, loaded.statePath, loaded.reason!);
    await recordFlowResponse(response, 'flow_pause');
    return response;
  }

  const artifactError = await validateCompletedArtifacts(loaded.state);
  if (artifactError) {
    const response = blockedResponse(loaded.state, artifactError);
    await recordFlowResponse(response, 'flow_pause');
    return response;
  }

  const currentStep = getCurrentStep(loaded.state);
  if (!currentStep) return buildResponse(loaded.state);
  if (input.step !== currentStep.id) {
    const response = blockedResponse(
      loaded.state,
      `Expected step ${currentStep.id}, got ${input.step}.`
    );
    await recordFlowResponse(response, 'flow_pause');
    return response;
  }
  if (loaded.state.status === 'needs-input') {
    const response = blockedResponse(
      loaded.state,
      `Step ${currentStep.id} already has unanswered questions.`
    );
    await recordFlowResponse(response, 'flow_pause');
    return response;
  }

  const questions = await readQuestionPacket(loaded.state.taskDir, input.questions);
  if (typeof questions === 'string') {
    const response = blockedResponse(loaded.state, questions);
    await recordFlowResponse(response, 'flow_pause');
    return response;
  }
  const repeated = repeatedQuestionId(currentStep, questions);
  if (repeated) {
    const response = blockedResponse(
      loaded.state,
      `Question id ${repeated} was already used for step ${currentStep.id}.`
    );
    await recordFlowResponse(response, 'flow_pause');
    return response;
  }

  const timestamp = nowIso();
  currentStep.interactions = [
    ...(currentStep.interactions ?? []),
    {
      round: (currentStep.interactions?.length ?? 0) + 1,
      pausedAt: timestamp,
      questions,
      answers: [],
    },
  ];
  markNextStepReady(loaded.state);
  await writeState(loaded.state);
  const response = buildResponse(loaded.state);
  await recordFlowResponse(response, 'flow_pause');
  return response;
}

export async function answerFlowQuestion(
  taskDirInput: string,
  input: FlowAnswerInput
): Promise<FlowResponse> {
  const loaded = await loadOrCreateState(taskDirInput);
  if (!loaded.state) {
    const response = buildBlockedResponse(loaded.taskDir, loaded.statePath, loaded.reason!);
    await recordFlowResponse(response, 'flow_answer');
    return response;
  }

  const artifactError = await validateCompletedArtifacts(loaded.state);
  if (artifactError) {
    const response = blockedResponse(loaded.state, artifactError);
    await recordFlowResponse(response, 'flow_answer');
    return response;
  }

  const currentStep = getCurrentStep(loaded.state);
  const expected = unansweredQuestions(currentStep)[0];
  if (loaded.state.status !== 'needs-input' || !currentStep || !expected) {
    const response = blockedResponse(loaded.state, 'The flow has no unanswered question.');
    await recordFlowResponse(response, 'flow_answer');
    return response;
  }
  if (input.question !== expected.id) {
    const response = blockedResponse(
      loaded.state,
      `Expected question ${expected.id}, got ${input.question}.`
    );
    await recordFlowResponse(response, 'flow_answer');
    return response;
  }
  const answer = input.answer.trim();
  if (!answer) {
    const response = blockedResponse(loaded.state, `Question ${expected.id} requires an answer.`);
    await recordFlowResponse(response, 'flow_answer');
    return response;
  }

  const interaction = currentStep.interactions?.find((candidate) =>
    candidate.questions.some((question) => question.id === expected.id)
  );
  if (!interaction) {
    const response = blockedResponse(
      loaded.state,
      `Question ${expected.id} has no persisted interaction.`
    );
    await recordFlowResponse(response, 'flow_answer');
    return response;
  }

  const timestamp = nowIso();
  interaction.answers.push({ questionId: expected.id, answer, answeredAt: timestamp });
  const answered = new Set(interaction.answers.map((item) => item.questionId));
  if (interaction.questions.every((question) => answered.has(question.id))) {
    interaction.resolvedAt = timestamp;
  }
  markNextStepReady(loaded.state);
  await writeState(loaded.state);
  const response = buildResponse(loaded.state);
  await recordFlowResponse(response, 'flow_answer');
  return response;
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

  const exhausted = await exhaustedRepairBlockReason(loaded.state);
  if (exhausted) {
    const response = blockedResponse(loaded.state, exhausted);
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

  const exhausted = await exhaustedRepairBlockReason(loaded.state);
  if (exhausted) {
    const response = blockedResponse(loaded.state, exhausted);
    await recordFlowResponse(response, 'flow_next');
    return response;
  }

  await resolveReadyStepRoute(loaded.state);
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

  if (loaded.state.status === 'needs-input') {
    const response = blockedResponse(
      loaded.state,
      `Step ${currentStep.id} has unanswered questions.`
    );
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

  const definition = getDefinitionById(
    loaded.state.taskDir,
    currentStep.id,
    loaded.state.repairAttempts,
    loaded.state.profile
  );
  if (!definition) {
    const response = blockedResponse(loaded.state, `Unknown workflow step: ${currentStep.id}.`);
    await recordFlowResponse(response, 'flow_complete');
    return response;
  }

  const staleArtifactError = await answeredArtifactFreshnessError(currentStep, definition);
  if (staleArtifactError) {
    const response = blockedResponse(loaded.state, staleArtifactError);
    await recordFlowResponse(response, 'flow_complete');
    return response;
  }

  const result = await completeStepResult(definition, input, recordedWorkRoot(loaded.state));
  if (typeof result === 'string') {
    // Only the validate step can produce this code, so expectedOutput is set.
    const isValidationFail =
      currentStep.id === VALIDATE_STEP_ID && flowBlockCode(result) === 'validation_verdict_fail';

    if (isValidationFail && loaded.state.repairAttempts < MAX_REPAIR_ATTEMPTS) {
      const response = await spliceRepairCycle(loaded.state, currentStep, definition);
      await recordFlowResponse(response, 'flow_complete');
      return response;
    }

    const response = blockedResponse(
      loaded.state,
      isValidationFail ? repairAttemptsExhaustedReason(definition.expectedOutput!) : result
    );
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

export async function flowPauseCommand(
  taskDir: string,
  options: FlowPauseCommandOptions
): Promise<void> {
  reportFlowResponse(await pauseFlowStep(taskDir, options), options);
}

export async function flowAnswerCommand(
  taskDir: string,
  options: FlowAnswerCommandOptions
): Promise<void> {
  reportFlowResponse(await answerFlowQuestion(taskDir, options), options);
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
  if (response.state === 'needs-input' && response.question) {
    console.log(`Question: ${response.question.id}`);
    console.log(response.question.prompt);
  }
  if (response.profile) {
    console.log(`Profile: ${response.profile}`);
  }
  printStepRoute(step);
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
  if (response.workRoot) {
    console.log(`Work root: ${response.workRoot}`);
  }
  if (response.workRootWarning) {
    console.log(`Work root warning: ${response.workRootWarning}`);
  }
}

function printStepRoute(step: FlowStep): void {
  if (!step.runner) {
    console.log('Route: unresolved until spok flow next');
    console.log(`Skill: ${step.skill}`);
    return;
  }
  console.log(`Runner: ${step.runner}`);
  console.log(`Skill: ${step.skill}`);
  if (step.model) {
    console.log(`Model: ${step.model}`);
  }
  if (step.effort) {
    console.log(`Effort: ${step.effort}`);
  }
  if (!step.route) return;
  console.log(`Policy: ${step.route.policy}`);
  if (step.route.degraded) {
    console.log(`Degraded: ${step.route.degraded.reason}`);
  }
  for (const rejection of step.route.rejected) {
    const label = [rejection.runner, rejection.model, rejection.effort].filter(Boolean).join(' ');
    console.log(`Rejected: ${label} — ${rejection.reason}`);
  }
}
