import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Zod schema for project configuration.
 *
 * Purpose:
 * 1. Documentation - clearly defines the config file structure
 * 2. Type safety - TypeScript infers ProjectConfig type from schema
 * 3. Runtime validation - uses safeParse() for resilient field-by-field validation
 *
 * Why Zod over manual validation:
 * - Helps understand Spok's data interfaces at a glance
 * - Single source of truth for type and validation
 * - Consistent with other Spok schemas
 */
export const ProjectConfigSchema = z.object({
  // Required: which schema to use (e.g., "spec-driven", or project-local schema name)
  schema: z
    .string()
    .min(1)
    .describe('The workflow schema to use (e.g., "spec-driven")'),

  // Optional: project context (injected into all artifact instructions)
  // Max size: 50KB (enforced during parsing)
  context: z
    .string()
    .optional()
    .describe('Project context injected into all artifact instructions'),

  // Optional: per-artifact rules (additive to schema's built-in guidance)
  rules: z
    .record(
      z.string(), // artifact ID
      z.array(z.string()) // list of rules
    )
    .optional()
    .describe('Per-artifact rules, keyed by artifact ID'),

  // Optional: flow-level behavior toggles
  flow: z
    .object({
      self_learn: z
        .boolean()
        .optional()
        .describe('Run an advisory post-commit workflow improvement review'),
    })
    .optional()
    .describe('Flow-level behavior toggles'),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

const MAX_CONTEXT_SIZE = 50 * 1024; // 50KB hard limit
export const PROJECT_CONFIG_FILE_NAMES = ['config.toml', 'config.yaml', 'config.yml'] as const;

export type ProjectConfigFormat = 'toml' | 'yaml';
export type ProjectConfigDiagnosticLevel = 'error' | 'warning';

export interface ProjectConfigDiagnostic {
  level: ProjectConfigDiagnosticLevel;
  message: string;
  path?: string;
  file?: string;
  fix?: string;
}

export interface ProjectConfigReadResult {
  config: ProjectConfig | null;
  configPath?: string;
  format?: ProjectConfigFormat;
  diagnostics: ProjectConfigDiagnostic[];
}

interface ConfigCandidate {
  absolutePath: string;
  relativePath: string;
  format: ProjectConfigFormat;
}

interface BunTomlRuntime {
  Bun?: {
    TOML?: {
      parse(content: string): unknown;
    };
  };
}

const KNOWN_TOP_LEVEL_KEYS = new Set(['schema', 'context', 'rules', 'flow']);
const KNOWN_FLOW_KEYS = new Set(['self_learn']);

function configFormat(fileName: string): ProjectConfigFormat {
  return fileName.endsWith('.toml') ? 'toml' : 'yaml';
}

function configCandidates(projectRoot: string): ConfigCandidate[] {
  return PROJECT_CONFIG_FILE_NAMES.map((fileName) => ({
    absolutePath: path.join(projectRoot, 'spok', fileName),
    relativePath: path.posix.join('spok', fileName),
    format: configFormat(fileName),
  }));
}

function findConfigCandidates(projectRoot: string): ConfigCandidate[] {
  return configCandidates(projectRoot).filter((candidate) => existsSync(candidate.absolutePath));
}

/**
 * Resolve the config file path, preferring TOML, then `.yaml`, then `.yml`.
 * Returns null if no config exists (no config is OK).
 */
function resolveConfigPath(projectRoot: string): ConfigCandidate | null {
  return findConfigCandidates(projectRoot)[0] ?? null;
}

/**
 * Validate the `schema` field. Returns the value when valid, or undefined.
 */
function parseSchemaField(
  rawSchema: unknown,
  diagnostics: ProjectConfigDiagnostic[],
  file: string,
  required: boolean
): string | undefined {
  const result = z.string().min(1).safeParse(rawSchema);
  if (result.success) {
    return result.data;
  }

  if (rawSchema === undefined && !required) {
    return undefined;
  }

  diagnostics.push({
    level: 'error',
    message: rawSchema === undefined ? 'schema is required' : 'schema must be a non-empty string',
    path: 'schema',
    file,
    fix: 'Set schema to a valid schema name, for example: schema = "spec-driven".',
  });
  return undefined;
}

/**
 * Validate the `context` field, enforcing the size limit.
 * Returns the value when valid and within limit, or undefined.
 */
function parseContextField(
  rawContext: unknown,
  diagnostics: ProjectConfigDiagnostic[],
  file: string
): string | undefined {
  if (rawContext === undefined) {
    return undefined;
  }

  const result = z.string().safeParse(rawContext);
  if (!result.success) {
    diagnostics.push({
      level: 'error',
      message: 'context must be a string',
      path: 'context',
      file,
      fix: 'Use a quoted string or TOML triple-quoted string for context.',
    });
    return undefined;
  }

  const contextSize = Buffer.byteLength(result.data, 'utf-8');
  if (contextSize > MAX_CONTEXT_SIZE) {
    diagnostics.push({
      level: 'warning',
      message: `context is too large (${(contextSize / 1024).toFixed(1)}KB, limit: ${MAX_CONTEXT_SIZE / 1024}KB); ignoring context`,
      path: 'context',
      file,
      fix: 'Trim context below 50KB.',
    });
    return undefined;
  }

  return result.data;
}

/**
 * Validate the rules for a single artifact, filtering out empty strings.
 * Returns the non-empty rules, or null when the entry is invalid or fully empty.
 */
function parseArtifactRules(
  artifactId: string,
  rules: unknown,
  diagnostics: ProjectConfigDiagnostic[],
  file: string
): string[] | null {
  const result = z.array(z.string()).safeParse(rules);
  if (!result.success) {
    diagnostics.push({
      level: 'error',
      message: `rules.${artifactId} must be an array of strings`,
      path: `rules.${artifactId}`,
      file,
      fix: `Change rules.${artifactId} to a string array or remove it.`,
    });
    return null;
  }

  const validRules = result.data.filter((r) => r.length > 0);
  if (validRules.length < result.data.length) {
    diagnostics.push({
      level: 'warning',
      message: `rules.${artifactId} contains empty strings; ignoring them`,
      path: `rules.${artifactId}`,
      file,
      fix: 'Remove empty rule entries.',
    });
  }

  return validRules.length > 0 ? validRules : null;
}

/**
 * Validate the `rules` field. Returns the parsed rules when at least one
 * artifact has valid rules, or undefined.
 */
function parseRulesField(
  rawRules: unknown,
  diagnostics: ProjectConfigDiagnostic[],
  file: string
): Record<string, string[]> | undefined {
  if (rawRules === undefined) {
    return undefined;
  }

  // Guard against null since typeof null === 'object', and against arrays.
  if (typeof rawRules !== 'object' || rawRules === null || Array.isArray(rawRules)) {
    diagnostics.push({
      level: 'error',
      message: 'rules must be an object',
      path: 'rules',
      file,
      fix: 'Use a TOML [rules] table or remove the rules field.',
    });
    return undefined;
  }

  const parsedRules: Record<string, string[]> = {};
  for (const [artifactId, rules] of Object.entries(rawRules)) {
    const validRules = parseArtifactRules(artifactId, rules, diagnostics, file);
    if (validRules) {
      parsedRules[artifactId] = validRules;
    }
  }

  return Object.keys(parsedRules).length > 0 ? parsedRules : undefined;
}

/**
 * Validate the `flow` field. Returns parsed flow options when at least one
 * option is valid, or undefined when absent/invalid.
 */
function parseFlowField(
  rawFlow: unknown,
  diagnostics: ProjectConfigDiagnostic[],
  file: string
): ProjectConfig['flow'] | undefined {
  if (rawFlow === undefined) {
    return undefined;
  }

  if (typeof rawFlow !== 'object' || rawFlow === null || Array.isArray(rawFlow)) {
    diagnostics.push({
      level: 'error',
      message: 'flow must be an object',
      path: 'flow',
      file,
      fix: 'Use a TOML [flow] table or remove the flow field.',
    });
    return undefined;
  }

  const rawOptions = rawFlow as Record<string, unknown>;
  const flow: NonNullable<ProjectConfig['flow']> = {};

  if (rawOptions.self_learn !== undefined) {
    const result = z.boolean().safeParse(rawOptions.self_learn);
    if (result.success) {
      flow.self_learn = result.data;
    } else {
      diagnostics.push({
        level: 'error',
        message: 'flow.self_learn must be boolean',
        path: 'flow.self_learn',
        file,
        fix: 'Set flow.self_learn to true or false.',
      });
    }
  }

  for (const key of Object.keys(rawOptions)) {
    if (!KNOWN_FLOW_KEYS.has(key)) {
      diagnostics.push({
        level: 'warning',
        message: `unknown flow key flow.${key}; ignoring it`,
        path: `flow.${key}`,
        file,
        fix: `Remove flow.${key} or replace it with a supported flow setting.`,
      });
    }
  }

  return Object.keys(flow).length > 0 ? flow : undefined;
}

function stripTomlComment(line: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (quote === null || quote === char)) {
      quote = quote === char ? null : char;
      continue;
    }
    if (quote === null && char === '#') {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlString(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  throw new Error(`Unsupported TOML value: ${value}`);
}

function splitTomlArrayItems(value: string): string[] {
  const items: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (quote === null || quote === char)) {
      quote = quote === char ? null : char;
      continue;
    }
    if (quote === null && char === ',') {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(value.slice(start).trim());
  return items.filter((item) => item.length > 0);
}

function parseTomlValue(value: string): unknown {
  const trimmed = stripTomlComment(value).trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitTomlArrayItems(trimmed.slice(1, -1)).map(parseTomlValue);
  }
  return parseTomlString(trimmed);
}

function collectTomlValue(lines: string[], startIndex: number, initialValue: string): {
  value: string;
  nextIndex: number;
} {
  const trimmed = initialValue.trim();
  if (!trimmed.startsWith('[') || trimmed.endsWith(']')) {
    return { value: initialValue, nextIndex: startIndex + 1 };
  }

  const collected = [initialValue];
  let index = startIndex + 1;
  while (index < lines.length) {
    const line = stripTomlComment(lines[index]);
    collected.push(line);
    index += 1;
    if (line.includes(']')) break;
  }
  return { value: collected.join('\n'), nextIndex: index };
}

function collectTomlMultilineString(lines: string[], startIndex: number, initialValue: string): {
  value: string;
  nextIndex: number;
} {
  const start = initialValue.indexOf('"""');
  const afterStart = initialValue.slice(start + 3);
  const sameLineEnd = afterStart.indexOf('"""');
  if (sameLineEnd >= 0) {
    return {
      value: afterStart.slice(0, sameLineEnd),
      nextIndex: startIndex + 1,
    };
  }

  const collected: string[] = afterStart.length > 0 ? [afterStart] : [];
  let index = startIndex + 1;
  while (index < lines.length) {
    const line = lines[index];
    const end = line.indexOf('"""');
    if (end >= 0) {
      collected.push(line.slice(0, end));
      return {
        value: collected.join('\n'),
        nextIndex: index + 1,
      };
    }
    collected.push(line);
    index += 1;
  }

  throw new Error('Unterminated TOML multiline string');
}

function getTomlTable(root: Record<string, unknown>, tableName: string): Record<string, unknown> {
  const parts = tableName.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid TOML table: ${tableName}`);
  }

  let target = root;
  for (const part of parts) {
    const existing = target[part];
    if (existing !== undefined && (typeof existing !== 'object' || existing === null || Array.isArray(existing))) {
      throw new Error(`Invalid TOML table target: ${tableName}`);
    }
    if (existing === undefined) {
      target[part] = {};
    }
    target = target[part] as Record<string, unknown>;
  }

  return target;
}

function assignTomlValue(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid TOML key: ${key}`);
  }

  let current = target;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (existing !== undefined && (typeof existing !== 'object' || existing === null || Array.isArray(existing))) {
      throw new Error(`Invalid TOML dotted key target: ${key}`);
    }
    if (existing === undefined) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

function parseTomlFallback(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const lines = content.split(/\r?\n/u);
  let currentTable = root;
  let index = 0;

  while (index < lines.length) {
    const line = stripTomlComment(lines[index]).trim();
    if (line.length === 0) {
      index += 1;
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const tableName = line.slice(1, -1).trim();
      currentTable = getTomlTable(root, tableName);
      index += 1;
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex < 1) {
      throw new Error(`Invalid TOML assignment: ${line}`);
    }
    const key = line.slice(0, equalsIndex).trim();
    const valueStart = line.slice(equalsIndex + 1);
    if (valueStart.trim().startsWith('"""')) {
      const collected = collectTomlMultilineString(lines, index, valueStart);
      assignTomlValue(currentTable, key, collected.value);
      index = collected.nextIndex;
      continue;
    }
    const collected = collectTomlValue(lines, index, valueStart);
    assignTomlValue(currentTable, key, parseTomlValue(collected.value));
    index = collected.nextIndex;
  }

  return root;
}

function parseToml(content: string): unknown {
  const bunToml = (globalThis as typeof globalThis & BunTomlRuntime).Bun?.TOML;
  return bunToml ? bunToml.parse(content) : parseTomlFallback(content);
}

function parseConfigContent(content: string, format: ProjectConfigFormat): unknown {
  if (format === 'toml') {
    return parseToml(content);
  }
  return parseYaml(content);
}

function validateUnknownTopLevelKeys(
  rawConfig: Record<string, unknown>,
  diagnostics: ProjectConfigDiagnostic[],
  file: string
): void {
  for (const key of Object.keys(rawConfig)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      diagnostics.push({
        level: 'warning',
        message: `unknown config key ${key}; ignoring it`,
        path: key,
        file,
        fix: `Remove ${key} or replace it with a supported setting.`,
      });
    }
  }
}

function parseProjectConfigObject(
  rawConfig: Record<string, unknown>,
  diagnostics: ProjectConfigDiagnostic[],
  file: string
): ProjectConfig | null {
  validateUnknownTopLevelKeys(rawConfig, diagnostics, file);

  // Validate each field independently so a single bad field never discards
  // the rest of the config. Only fields that validate successfully are set.
  const config: Partial<ProjectConfig> = {};

  const schema = parseSchemaField(rawConfig.schema, diagnostics, file, Object.keys(rawConfig).length > 0);
  if (schema !== undefined) {
    config.schema = schema;
  }

  const context = parseContextField(rawConfig.context, diagnostics, file);
  if (context !== undefined) {
    config.context = context;
  }

  const rules = parseRulesField(rawConfig.rules, diagnostics, file);
  if (rules !== undefined) {
    config.rules = rules;
  }

  const flow = parseFlowField(rawConfig.flow, diagnostics, file);
  if (flow !== undefined) {
    config.flow = flow;
  }

  return Object.keys(config).length > 0 ? (config as ProjectConfig) : null;
}

function parseSelectedConfig(candidate: ConfigCandidate): ProjectConfigReadResult {
  const diagnostics: ProjectConfigDiagnostic[] = [];

  try {
    const raw = parseConfigContent(readFileSync(candidate.absolutePath, 'utf-8'), candidate.format);

    if (raw === null || raw === undefined) {
      return {
        config: null,
        configPath: candidate.absolutePath,
        format: candidate.format,
        diagnostics,
      };
    }

    if (typeof raw !== 'object' || Array.isArray(raw)) {
      diagnostics.push({
        level: 'error',
        message: `${candidate.relativePath} is not a valid ${candidate.format.toUpperCase()} object`,
        file: candidate.relativePath,
        fix: 'Replace the file with a table/object-shaped Spok config.',
      });
      return {
        config: null,
        configPath: candidate.absolutePath,
        format: candidate.format,
        diagnostics,
      };
    }

    return {
      config: parseProjectConfigObject(raw as Record<string, unknown>, diagnostics, candidate.relativePath),
      configPath: candidate.absolutePath,
      format: candidate.format,
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push({
      level: 'error',
      message: `Failed to parse ${candidate.relativePath}: ${message}`,
      file: candidate.relativePath,
      fix: `Fix the ${candidate.format.toUpperCase()} syntax in ${candidate.relativePath}.`,
    });
    return {
      config: null,
      configPath: candidate.absolutePath,
      format: candidate.format,
      diagnostics,
    };
  }
}

/**
 * Read and parse the Spok project config from project root.
 * Uses resilient parsing - validates each field independently using Zod safeParse.
 * Returns null if file doesn't exist.
 * Returns partial config if some fields are invalid.
 *
 * Performance note (Jan 2025):
 * Benchmarks showed direct file reads are fast enough without caching:
 * - Typical config (1KB): ~0.5ms per read
 * - Large config (50KB): ~1.6ms per read
 * - Missing config: ~0.01ms per read
 * Config is read 1-2 times per command (schema resolution + instruction loading),
 * adding ~1-3ms total overhead. Caching would add complexity (mtime checks,
 * invalidation logic) for negligible benefit. Direct reads also ensure config
 * changes are reflected immediately without stale cache issues.
 *
 * @param projectRoot - The root directory of the project (where `spok/` lives)
 * @returns Parsed config or null if file doesn't exist
 */
export function readProjectConfig(projectRoot: string): ProjectConfig | null {
  return readProjectConfigWithDiagnostics(projectRoot).config;
}

/**
 * Read and parse the Spok project config with structured diagnostics.
 */
export function readProjectConfigWithDiagnostics(projectRoot: string): ProjectConfigReadResult {
  const candidates = findConfigCandidates(projectRoot);
  if (candidates.length === 0) {
    return {
      config: null,
      diagnostics: [],
    };
  }

  const selected = resolveConfigPath(projectRoot);
  if (!selected) {
    return {
      config: null,
      diagnostics: [],
    };
  }

  const result = parseSelectedConfig(selected);
  if (candidates.length > 1) {
    const ignored = candidates
      .filter((candidate) => candidate.absolutePath !== selected.absolutePath)
      .map((candidate) => candidate.relativePath)
      .join(', ');
    result.diagnostics.unshift({
      level: 'warning',
      message: `multiple Spok config files found; using ${selected.relativePath}`,
      file: selected.relativePath,
      fix: `Remove or migrate ignored config file(s): ${ignored}.`,
    });
  }

  return result;
}

/**
 * Validate artifact IDs in rules against a schema's artifacts.
 * Called during instruction loading (when schema is known).
 * Returns warnings for unknown artifact IDs.
 *
 * @param rules - The rules object from config
 * @param validArtifactIds - Set of valid artifact IDs from the schema
 * @param schemaName - Name of the schema for error messages
 * @returns Array of warning messages for unknown artifact IDs
 */
export function validateConfigRules(
  rules: Record<string, string[]>,
  validArtifactIds: Set<string>,
  schemaName: string
): string[] {
  const warnings: string[] = [];

  for (const artifactId of Object.keys(rules)) {
    if (!validArtifactIds.has(artifactId)) {
      const validIds = Array.from(validArtifactIds).sort().join(', ');
      warnings.push(
        `Unknown artifact ID in rules: "${artifactId}". ` +
          `Valid IDs for schema "${schemaName}": ${validIds}`
      );
    }
  }

  return warnings;
}

/**
 * Suggest valid schema names when user provides invalid schema.
 * Uses fuzzy matching to find similar names.
 *
 * @param invalidSchemaName - The invalid schema name from config
 * @param availableSchemas - List of available schemas with their type (built-in or project-local)
 * @returns Error message with suggestions and available schemas
 */
export function suggestSchemas(
  invalidSchemaName: string,
  availableSchemas: { name: string; isBuiltIn: boolean }[]
): string {
  // Simple fuzzy match: Levenshtein distance
  function levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  // Find closest matches (distance <= 3)
  const suggestions = availableSchemas
    .map((s) => ({ ...s, distance: levenshtein(invalidSchemaName, s.name) }))
    .filter((s) => s.distance <= 3)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  const builtIn = availableSchemas.filter((s) => s.isBuiltIn).map((s) => s.name);
  const projectLocal = availableSchemas.filter((s) => !s.isBuiltIn).map((s) => s.name);

  let message = `Schema '${invalidSchemaName}' not found in Spok config\n\n`;

  if (suggestions.length > 0) {
    message += `Did you mean one of these?\n`;
    suggestions.forEach((s) => {
      const type = s.isBuiltIn ? 'built-in' : 'project-local';
      message += `  - ${s.name} (${type})\n`;
    });
    message += '\n';
  }

  message += `Available schemas:\n`;
  if (builtIn.length > 0) {
    message += `  Built-in: ${builtIn.join(', ')}\n`;
  }
  if (projectLocal.length > 0) {
    message += `  Project-local: ${projectLocal.join(', ')}\n`;
  } else {
    message += `  Project-local: (none found)\n`;
  }

  message += `\nFix: Edit spok/config.toml and set schema = "valid-schema-name"`;

  return message;
}
