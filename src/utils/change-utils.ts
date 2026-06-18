import path from 'path';
import { FileSystemUtils } from './file-system.js';
import { writeChangeMetadata, validateSchemaName } from './change-metadata.js';
import { readProjectConfig } from '../core/project-config.js';
import type { ChangeMetadata } from '../core/artifact-graph/types.js';

const DEFAULT_SCHEMA = 'spec-driven';

/**
 * Options for creating a change.
 */
export interface CreateChangeOptions {
  /** The workflow schema to use (default: 'spec-driven') */
  schema?: string;
  /** Default schema to use when no explicit schema or project config is present */
  defaultSchema?: string;
  /** Directory that should contain the change directories */
  changesDir?: string;
  /** Additional metadata to persist in the change's .spok.yaml */
  metadata?: Partial<Pick<ChangeMetadata, 'goal' | 'affected_areas'>>;
}

/**
 * Result of creating a change.
 */
export interface CreateChangeResult {
  /** The schema that was actually used (resolved from options, config, or default) */
  schema: string;
  /** Absolute path to the created change directory */
  changeDir: string;
}

/**
 * Result of validating a change name.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that a change name follows kebab-case conventions.
 *
 * Valid names:
 * - Start with a lowercase letter
 * - Contain only lowercase letters, numbers, and hyphens
 * - Do not start or end with a hyphen
 * - Do not contain consecutive hyphens
 *
 * @param name - The change name to validate
 * @returns Validation result with `valid: true` or `valid: false` with an error message
 *
 * @example
 * validateChangeName('add-auth') // { valid: true }
 * validateChangeName('Add-Auth') // { valid: false, error: '...' }
 */
export function validateChangeName(name: string): ValidationResult {
  if (!name) {
    return { valid: false, error: 'Change name cannot be empty' };
  }

  // Pattern: starts with lowercase letter, followed by lowercase letters/numbers,
  // optionally followed by hyphen + lowercase letters/numbers (repeatable)
  const kebabCasePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  if (kebabCasePattern.test(name)) {
    return { valid: true };
  }

  return { valid: false, error: describeKebabCaseViolation(name) };
}

/**
 * Returns a specific error message explaining why a name is not valid kebab-case.
 * Assumes the name has already failed the kebab-case pattern.
 */
function describeKebabCaseViolation(name: string): string {
  if (/[A-Z]/.test(name)) {
    return 'Change name must be lowercase (use kebab-case)';
  }
  if (/\s/.test(name)) {
    return 'Change name cannot contain spaces (use hyphens instead)';
  }
  if (/_/.test(name)) {
    return 'Change name cannot contain underscores (use hyphens instead)';
  }
  if (name.startsWith('-')) {
    return 'Change name cannot start with a hyphen';
  }
  if (name.endsWith('-')) {
    return 'Change name cannot end with a hyphen';
  }
  if (/--/.test(name)) {
    return 'Change name cannot contain consecutive hyphens';
  }
  if (/[^a-z0-9-]/.test(name)) {
    return 'Change name can only contain lowercase letters, numbers, and hyphens';
  }
  if (/^[0-9]/.test(name)) {
    return 'Change name must start with a letter';
  }

  return 'Change name must follow kebab-case convention (e.g., add-auth, refactor-db)';
}

/**
 * Resolves the schema name from an explicit option, project config, or default.
 *
 * Resolution order: explicit `options.schema` → Spok project config → supplied default.
 */
function resolveSchemaName(projectRoot: string, options: CreateChangeOptions): string {
  if (options.schema) {
    return options.schema;
  }

  const defaultSchema = options.defaultSchema ?? DEFAULT_SCHEMA;
  try {
    const config = readProjectConfig(projectRoot);
    return config?.schema ?? defaultSchema;
  } catch {
    // If config read fails, use default
    return defaultSchema;
  }
}

/**
 * Creates a new change directory with metadata file.
 *
 * @param projectRoot - The root directory of the project (where `spok/` lives)
 * @param name - The change name (must be valid kebab-case)
 * @param options - Optional settings for the change
 * @throws Error if the change name is invalid
 * @throws Error if the schema name is invalid
 * @throws Error if the change directory already exists
 *
 * @returns Result containing the resolved schema name
 *
 * @example
 * // Creates spok/changes/add-auth/ with default schema
 * const result = await createChange('/path/to/project', 'add-auth')
 * console.log(result.schema) // 'spec-driven' or value from config
 *
 * @example
 * // Creates spok/changes/add-auth/ with custom schema
 * const result = await createChange('/path/to/project', 'add-auth', { schema: 'my-workflow' })
 * console.log(result.schema) // 'my-workflow'
 */
export async function createChange(
  projectRoot: string,
  name: string,
  options: CreateChangeOptions = {}
): Promise<CreateChangeResult> {
  // Validate the name first
  const validation = validateChangeName(name);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Determine schema: explicit option → project config → supplied default
  const schemaName = resolveSchemaName(projectRoot, options);

  // Validate the resolved schema
  validateSchemaName(schemaName, projectRoot);

  // Build the change directory path
  const changeDir = path.join(options.changesDir ?? path.join(projectRoot, 'spok', 'changes'), name);

  // Check if change already exists
  if (await FileSystemUtils.directoryExists(changeDir)) {
    throw new Error(`Change '${name}' already exists at ${changeDir}`);
  }

  // Create the directory (including parent directories if needed)
  await FileSystemUtils.createDirectory(changeDir);

  // Write metadata file with schema and creation date
  const today = new Date().toISOString().split('T')[0];
  writeChangeMetadata(changeDir, {
    schema: schemaName,
    created: today,
    ...options.metadata,
  }, projectRoot);

  return { schema: schemaName, changeDir };
}
