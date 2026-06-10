/**
 * New Change Command
 *
 * Creates a new change directory with optional description and schema.
 */

import ora from 'ora';
import path from 'path';
import { createChange, validateChangeName } from '../../utils/change-utils.js';
import {
  formatChangeLocation,
  resolveCurrentPlanningHomeSync,
  type PlanningHome,
} from '../../core/planning-home.js';
import { validateSchemaExists } from './shared.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface NewChangeOptions {
  description?: string;
  goal?: string;
  areas?: string;
  schema?: string;
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

function parseAffectedAreas(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((area) => area.trim())
    .filter((area) => area.length > 0);
}

function validateWorkspaceAffectedAreas(planningHome: PlanningHome, affectedAreas: string[]): void {
  if (affectedAreas.length === 0) {
    return;
  }

  if (planningHome.kind !== 'workspace') {
    throw new Error('--areas can only be used when creating a workspace-scoped change');
  }

  const validAreas = new Set(planningHome.workspace?.links ?? []);
  const invalidAreas = affectedAreas.filter((area) => !validAreas.has(area));

  if (invalidAreas.length > 0) {
    const validList = [...validAreas].sort((a, b) => a.localeCompare(b));
    const validMessage = validList.length > 0 ? validList.join(', ') : '(no registered links)';
    throw new Error(
      `Invalid affected area${invalidAreas.length === 1 ? '' : 's'}: ${invalidAreas.join(', ')}. ` +
        `Valid workspace link names: ${validMessage}`
    );
  }
}

function buildChangeMetadata(
  planningHome: PlanningHome,
  options: NewChangeOptions,
  affectedAreas: string[]
): { goal?: string; affected_areas?: string[] } {
  const goal = planningHome.kind === 'workspace'
    ? options.goal ?? options.description
    : options.goal;

  return {
    ...(goal ? { goal } : {}),
    ...(affectedAreas.length > 0 ? { affected_areas: affectedAreas } : {}),
  };
}

async function writeChangeReadme(changeDir: string, name: string, description: string): Promise<void> {
  const { promises: fs } = await import('fs');
  const readmePath = path.join(changeDir, 'README.md');
  await fs.writeFile(readmePath, `# ${name}\n\n${description}\n`, 'utf-8');
}

function reportWorkspaceNextSteps(name: string, affectedAreas: string[]): void {
  if (affectedAreas.length > 0) {
    console.log(`Affected areas: ${affectedAreas.join(', ')}`);
  } else {
    console.log('Affected areas: unresolved; identify them in workspace specs or tasks as planning continues.');
  }
  console.log('Next: run spok status --change "' + name + '" to inspect workspace planning artifacts.');
}

export async function newChangeCommand(name: string | undefined, options: NewChangeOptions): Promise<void> {
  if (!name) {
    throw new Error('Missing required argument <name>');
  }

  const validation = validateChangeName(name);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const planningHome = resolveCurrentPlanningHomeSync();
  const projectRoot = planningHome.root;
  const affectedAreas = parseAffectedAreas(options.areas);
  validateWorkspaceAffectedAreas(planningHome, affectedAreas);

  // Validate schema if provided
  if (options.schema) {
    validateSchemaExists(options.schema, projectRoot);
  }

  const resolvedSchema = options.schema ?? planningHome.defaultSchema;
  const spinner = ora(`Creating change '${name}' with schema '${resolvedSchema}'...`).start();

  try {
    const result = await createChange(projectRoot, name, {
      schema: options.schema,
      defaultSchema: planningHome.defaultSchema,
      changesDir: planningHome.changesDir,
      metadata: buildChangeMetadata(planningHome, options, affectedAreas),
    });

    if (options.description) {
      await writeChangeReadme(result.changeDir, name, options.description);
    }

    const location = formatChangeLocation(planningHome, name);
    const scope = planningHome.kind === 'workspace' ? 'workspace change' : 'change';
    spinner.succeed(`Created ${scope} '${name}' at ${location}/ (schema: ${result.schema})`);

    if (planningHome.kind === 'workspace') {
      reportWorkspaceNextSteps(name, affectedAreas);
    }
  } catch (error) {
    spinner.fail(`Failed to create change '${name}'`);
    throw error;
  }
}
