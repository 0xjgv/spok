import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGlobalDataDir } from '../global-config.js';
import { parseSchema, SchemaValidationError } from './schema.js';
import type { SchemaYaml } from './types.js';

type SchemaSource = 'project' | 'user' | 'package';

interface SchemaLocation {
  dir: string;
  source: SchemaSource;
}

/**
 * Error thrown when loading a schema fails.
 */
export class SchemaLoadError extends Error {
  constructor(
    message: string,
    public readonly schemaPath: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SchemaLoadError';
  }
}

/**
 * Gets the package's built-in schemas directory path.
 * Uses import.meta.url to resolve relative to the current module.
 */
export function getPackageSchemasDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  // Navigate from dist/core/artifact-graph/ to package root's schemas/
  return path.join(path.dirname(currentFile), '..', '..', '..', 'schemas');
}

/**
 * Gets the user's schema override directory path.
 */
export function getUserSchemasDir(): string {
  return path.join(getGlobalDataDir(), 'schemas');
}

/**
 * Gets the project-local schemas directory path.
 * @param projectRoot - The project root directory
 * @returns The path to the project's schemas directory
 */
export function getProjectSchemasDir(projectRoot: string): string {
  return path.join(projectRoot, 'spok', 'schemas');
}

function getSchemaLocations(projectRoot?: string): SchemaLocation[] {
  const locations: SchemaLocation[] = [];
  if (projectRoot) {
    locations.push({ dir: getProjectSchemasDir(projectRoot), source: 'project' });
  }
  locations.push({ dir: getUserSchemasDir(), source: 'user' });
  locations.push({ dir: getPackageSchemasDir(), source: 'package' });
  return locations;
}

function getSchemaPath(schemaDir: string): string {
  return path.join(schemaDir, 'schema.yaml');
}

/**
 * Resolves a schema name to its directory path.
 *
 * Resolution order (when projectRoot is provided):
 * 1. Project-local: <projectRoot>/spok/schemas/<name>/schema.yaml
 * 2. User override: ${XDG_DATA_HOME}/spok/schemas/<name>/schema.yaml
 * 3. Package built-in: <package>/schemas/<name>/schema.yaml
 *
 * When projectRoot is not provided, only user override and package built-in are checked
 * (backward compatible behavior).
 *
 * @param name - Schema name (e.g., "spec-driven")
 * @param projectRoot - Optional project root directory for project-local schema resolution
 * @returns The path to the schema directory, or null if not found
 */
export function getSchemaDir(
  name: string,
  projectRoot?: string
): string | null {
  for (const location of getSchemaLocations(projectRoot)) {
    const schemaDir = path.join(location.dir, name);
    if (fs.existsSync(getSchemaPath(schemaDir))) {
      return schemaDir;
    }
  }

  return null;
}

/**
 * Resolves a schema name to a SchemaYaml object.
 *
 * Resolution order (when projectRoot is provided):
 * 1. Project-local: <projectRoot>/spok/schemas/<name>/schema.yaml
 * 2. User override: ${XDG_DATA_HOME}/spok/schemas/<name>/schema.yaml
 * 3. Package built-in: <package>/schemas/<name>/schema.yaml
 *
 * When projectRoot is not provided, only user override and package built-in are checked
 * (backward compatible behavior).
 *
 * @param name - Schema name (e.g., "spec-driven")
 * @param projectRoot - Optional project root directory for project-local schema resolution
 * @returns The resolved schema object
 * @throws Error if schema is not found in any location
 */
export function resolveSchema(name: string, projectRoot?: string): SchemaYaml {
  // Normalize name (remove .yaml extension if provided)
  const normalizedName = name.replace(/\.ya?ml$/, '');

  const schemaDir = getSchemaDir(normalizedName, projectRoot);
  if (!schemaDir) {
    const availableSchemas = listSchemas(projectRoot);
    throw new Error(
      `Schema '${normalizedName}' not found. Available schemas: ${availableSchemas.join(', ')}`
    );
  }

  const schemaPath = getSchemaPath(schemaDir);

  // Load and parse the schema
  let content: string;
  try {
    content = fs.readFileSync(schemaPath, 'utf-8');
  } catch (err) {
    const ioError = err instanceof Error ? err : new Error(String(err));
    throw new SchemaLoadError(
      `Failed to read schema at '${schemaPath}': ${ioError.message}`,
      schemaPath,
      ioError
    );
  }

  try {
    return parseSchema(content);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw new SchemaLoadError(
        `Invalid schema at '${schemaPath}': ${err.message}`,
        schemaPath,
        err
      );
    }
    const parseError = err instanceof Error ? err : new Error(String(err));
    throw new SchemaLoadError(
      `Failed to parse schema at '${schemaPath}': ${parseError.message}`,
      schemaPath,
      parseError
    );
  }
}

/**
 * Yields the names of schema directories (those containing a `schema.yaml`)
 * directly under the given directory. Yields nothing if the directory is absent.
 */
function* schemaEntryNames(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'schema.yaml'))) {
      yield entry.name;
    }
  }
}

/**
 * Lists all available schema names.
 * Combines project-local, user override, and package built-in schemas.
 *
 * @param projectRoot - Optional project root directory for project-local schema resolution
 */
export function listSchemas(projectRoot?: string): string[] {
  const schemas = new Set<string>();

  for (const { dir } of getSchemaLocations(projectRoot)) {
    for (const name of schemaEntryNames(dir)) {
      schemas.add(name);
    }
  }

  return Array.from(schemas).sort();
}

/**
 * Schema info with metadata (name, description, artifacts).
 */
export interface SchemaInfo {
  name: string;
  description: string;
  artifacts: string[];
  source: SchemaSource;
}

/**
 * Reads and parses the schema in `dir/<name>`, returning its info, or null if
 * the schema is invalid (parse failure) and should be skipped.
 */
function readSchemaInfo(
  dir: string,
  name: string,
  source: SchemaSource
): SchemaInfo | null {
  try {
    const schema = parseSchema(
      fs.readFileSync(getSchemaPath(path.join(dir, name)), 'utf-8')
    );
    return {
      name,
      description: schema.description || '',
      artifacts: schema.artifacts.map((a) => a.id),
      source,
    };
  } catch {
    // Skip invalid schemas
    return null;
  }
}

/**
 * Lists all available schemas with their descriptions and artifact lists.
 * Useful for agent skills to present schema selection to users.
 *
 * @param projectRoot - Optional project root directory for project-local schema resolution
 */
export function listSchemasWithInfo(projectRoot?: string): SchemaInfo[] {
  const schemas: SchemaInfo[] = [];
  const seenNames = new Set<string>();

  for (const { dir, source } of getSchemaLocations(projectRoot)) {
    for (const name of schemaEntryNames(dir)) {
      if (seenNames.has(name)) {
        continue;
      }
      const info = readSchemaInfo(dir, name, source);
      if (info) {
        schemas.push(info);
        seenNames.add(name);
      }
    }
  }

  return schemas.sort((a, b) => a.name.localeCompare(b.name));
}
