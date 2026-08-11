/**
 * Installs Spok-owned native agent definitions into supported home directories.
 * Source catalogs are validated as a pair before any destination is inspected.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export const MANAGED_AGENT_MARKER = 'spok-managed-agent';

export type ManagedAgentToolId = 'claude' | 'codex';

interface ManagedAgentToolDefinition {
  label: string;
  extension: string;
  homeDirectory: string;
}

const TOOL_DEFINITIONS: Record<ManagedAgentToolId, ManagedAgentToolDefinition> = {
  claude: {
    label: 'Claude',
    extension: '.md',
    homeDirectory: '.claude',
  },
  codex: {
    label: 'Codex',
    extension: '.toml',
    homeDirectory: '.codex',
  },
};

const require = createRequire(import.meta.url);
const { version: DEFAULT_VERSION } = require('../../package.json') as { version: string };
const DEFAULT_SOURCE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../assets/agents'
);

interface SourceAgent {
  name: string;
  content: string;
}

type AgentCatalog = Record<ManagedAgentToolId, SourceAgent[]>;

interface ExpectedAgentFile {
  name: string;
  filename: string;
  filepath: string;
  content: string;
}

interface PreparedToolInstall {
  toolId: ManagedAgentToolId;
  targetDir: string;
  expectedFiles: ExpectedAgentFile[];
}

const PREPARED_INSTALL = Symbol('prepared-managed-agent-install');

export interface PreparedManagedAgentInstall {
  readonly [PREPARED_INSTALL]: true;
  readonly force: boolean;
  readonly tools: readonly PreparedToolInstall[];
}

export interface PrepareManagedAgentInstallOptions {
  homeDir?: string;
  toolIds: readonly string[];
  version?: string;
  force?: boolean;
  sourceDir?: string;
}

export interface ManagedAgentStateOptions {
  homeDir?: string;
  toolId: string;
  version?: string;
  sourceDir?: string;
}

export interface ManagedAgentState {
  toolId: ManagedAgentToolId;
  targetDir: string;
  expectedCount: number;
  hasManagedAgents: boolean;
  needsUpdate: boolean;
}

export interface ManagedAgentInstallResult {
  toolId: ManagedAgentToolId;
  targetDir: string;
  expectedCount: number;
  writtenCount: number;
  removedCount: number;
  changed: boolean;
  writtenFiles: string[];
  removedFiles: string[];
}

interface ClaudeFrontmatter {
  yaml: string;
  end: number;
  newline: string;
}

interface TargetSnapshot {
  entries: Map<string, fs.Dirent>;
  contents: Map<string, string>;
}

interface DestinationAnalysis {
  tool: PreparedToolInstall;
  writes: ExpectedAgentFile[];
  removals: string[];
  hasManagedAgents: boolean;
}

interface AnalyzeOptions {
  force: boolean;
  rejectCollisions: boolean;
}

export function isManagedAgentToolId(toolId: string): toolId is ManagedAgentToolId {
  return toolId === 'claude' || toolId === 'codex';
}

function assertManagedAgentToolId(toolId: string): asserts toolId is ManagedAgentToolId {
  if (!isManagedAgentToolId(toolId)) {
    throw new Error(
      `Unsupported managed agent tool "${toolId}". Supported tools: claude, codex.`
    );
  }
}

export function getManagedAgentTargetDir(
  toolId: string,
  homeDir: string = os.homedir()
): string {
  assertManagedAgentToolId(toolId);
  return path.join(path.resolve(homeDir), TOOL_DEFINITIONS[toolId].homeDirectory, 'agents');
}

function validateVersion(version: string): string {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u.test(version)) {
    throw new Error(
      `Invalid managed agent version "${version}". Use a single version token without whitespace.`
    );
  }
  return version;
}

function catalogError(message: string): Error {
  return new Error(`Invalid managed agent catalog: ${message}`);
}

function findClaudeFrontmatter(content: string): ClaudeFrontmatter | null {
  const match = /^(?:\uFEFF)?---(\r?\n)([\s\S]*?)\r?\n---(?=\r?\n|$)/u.exec(content);
  if (!match) return null;
  return {
    yaml: match[2] ?? '',
    end: match[0].length,
    newline: match[1] ?? '\n',
  };
}

function getClaudeNativeName(content: string, filepath: string): string {
  const frontmatter = findClaudeFrontmatter(content);
  if (!frontmatter) {
    throw catalogError(`${filepath} has no valid YAML frontmatter.`);
  }

  let document: unknown;
  try {
    document = parseYaml(frontmatter.yaml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw catalogError(`${filepath} has invalid YAML frontmatter: ${message}`);
  }

  const name = typeof document === 'object' && document !== null
    ? (document as Record<string, unknown>).name
    : undefined;
  if (typeof name !== 'string') {
    throw catalogError(`${filepath} must declare a string native name in YAML frontmatter.`);
  }
  return name;
}

function getCodexNativeName(content: string, filepath: string): string {
  const match = /^[ \t]*name[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*(?:#.*)?$/mu.exec(content);
  if (!match?.[1]) {
    throw catalogError(`${filepath} must declare a string native TOML name.`);
  }
  return match[1];
}

function getNativeName(
  toolId: ManagedAgentToolId,
  content: string,
  filepath: string
): string {
  return toolId === 'claude'
    ? getClaudeNativeName(content, filepath)
    : getCodexNativeName(content, filepath);
}

async function readSourceAgents(
  sourceDir: string,
  toolId: ManagedAgentToolId
): Promise<SourceAgent[]> {
  const definition = TOOL_DEFINITIONS[toolId];
  const toolSourceDir = path.join(sourceDir, toolId);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(toolSourceDir, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw catalogError(
      `missing or unreadable ${definition.label} source directory "${toolSourceDir}": ${message}`
    );
  }

  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(definition.extension))
    .map((entry) => entry.name)
    .sort();
  if (filenames.length === 0) {
    throw catalogError(
      `no ${definition.label} ${definition.extension} agent files found in "${toolSourceDir}".`
    );
  }

  return Promise.all(filenames.map(async (filename) => {
    const filepath = path.join(toolSourceDir, filename);
    const content = await fs.promises.readFile(filepath, 'utf8');
    const name = filename.slice(0, -definition.extension.length);
    const nativeName = getNativeName(toolId, content, filepath);
    if (nativeName !== name) {
      throw catalogError(
        `${filepath}: native name "${nativeName}" does not match filename stem "${name}".`
      );
    }
    return { name, content };
  }));
}

function validateCatalogNames(catalog: AgentCatalog): void {
  const claudeNames = catalog.claude.map(({ name }) => name);
  const codexNames = catalog.codex.map(({ name }) => name);
  const invalidName = [...claudeNames, ...codexNames]
    .find((name) => !name.startsWith('spok-'));
  if (invalidName) {
    throw catalogError(`agent name "${invalidName}" must start with "spok-".`);
  }

  const claudeOnly = claudeNames.filter((name) => !codexNames.includes(name));
  const codexOnly = codexNames.filter((name) => !claudeNames.includes(name));
  if (claudeOnly.length > 0 || codexOnly.length > 0) {
    throw catalogError(
      `Claude/Codex stem parity failed. Claude-only: ${claudeOnly.join(', ') || 'none'}; `
      + `Codex-only: ${codexOnly.join(', ') || 'none'}.`
    );
  }
}

async function loadAgentCatalog(sourceDir: string): Promise<AgentCatalog> {
  const resolvedSourceDir = path.resolve(sourceDir);
  const claude = await readSourceAgents(resolvedSourceDir, 'claude');
  const codex = await readSourceAgents(resolvedSourceDir, 'codex');
  const catalog = { claude, codex };
  validateCatalogNames(catalog);
  return catalog;
}

export async function getManagedAgentNames(
  sourceDir: string = DEFAULT_SOURCE_DIR
): Promise<string[]> {
  const catalog = await loadAgentCatalog(sourceDir);
  return catalog.claude.map(({ name }) => name);
}

function markerLine(toolId: ManagedAgentToolId, version: string): string {
  return toolId === 'claude'
    ? `<!-- ${MANAGED_AGENT_MARKER} version=${version} -->`
    : `# ${MANAGED_AGENT_MARKER} version=${version}`;
}

function addMarker(
  toolId: ManagedAgentToolId,
  content: string,
  version: string
): string {
  const line = markerLine(toolId, version);
  if (toolId === 'codex') {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    return `${line}${newline}${content}`;
  }

  const frontmatter = findClaudeFrontmatter(content);
  if (!frontmatter) {
    throw catalogError('Claude source lost its YAML frontmatter during preparation.');
  }
  return content.slice(0, frontmatter.end)
    + frontmatter.newline
    + line
    + content.slice(frontmatter.end);
}

function markerVersionFromLine(
  toolId: ManagedAgentToolId,
  line: string
): string | null {
  const escapedMarker = MANAGED_AGENT_MARKER.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = toolId === 'claude'
    ? new RegExp(`^<!-- ${escapedMarker} version=([0-9A-Za-z][0-9A-Za-z.+_-]*) -->$`, 'u')
    : new RegExp(`^# ${escapedMarker} version=([0-9A-Za-z][0-9A-Za-z.+_-]*)$`, 'u');
  return pattern.exec(line)?.[1] ?? null;
}

function getManagedMarkerVersion(
  toolId: ManagedAgentToolId,
  content: string
): string | null {
  if (toolId === 'codex') {
    return markerVersionFromLine(toolId, content.split(/\r?\n/u, 1)[0] ?? '');
  }

  const frontmatter = findClaudeFrontmatter(content);
  if (!frontmatter) return null;
  const markerStart = frontmatter.end + frontmatter.newline.length;
  if (content.slice(frontmatter.end, markerStart) !== frontmatter.newline) return null;
  const markerEnd = content.indexOf(frontmatter.newline, markerStart);
  const line = markerEnd === -1
    ? content.slice(markerStart)
    : content.slice(markerStart, markerEnd);
  return markerVersionFromLine(toolId, line);
}

function createExpectedFiles(
  toolId: ManagedAgentToolId,
  targetDir: string,
  catalog: AgentCatalog,
  version: string
): ExpectedAgentFile[] {
  const extension = TOOL_DEFINITIONS[toolId].extension;
  return catalog[toolId].map((agent) => {
    const filename = `${agent.name}${extension}`;
    return {
      name: agent.name,
      filename,
      filepath: path.join(targetDir, filename),
      content: addMarker(toolId, agent.content, version),
    };
  });
}

function isRelevantTargetName(toolId: ManagedAgentToolId, filename: string): boolean {
  return filename.startsWith('spok-')
    && filename.endsWith(TOOL_DEFINITIONS[toolId].extension);
}

async function readTargetSnapshot(tool: PreparedToolInstall): Promise<TargetSnapshot> {
  let entries: fs.Dirent[];
  try {
    const targetStat = await fs.promises.lstat(tool.targetDir);
    if (!targetStat.isDirectory()) {
      throw new Error(`target exists but is not a directory: ${tool.targetDir}`);
    }
    entries = await fs.promises.readdir(tool.targetDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: new Map(), contents: new Map() };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot inspect managed agent target "${tool.targetDir}": ${message}`);
  }

  const relevant = entries.filter((entry) => isRelevantTargetName(tool.toolId, entry.name));
  const contents = new Map<string, string>();
  await Promise.all(relevant.filter((entry) => entry.isFile()).map(async (entry) => {
    const content = await fs.promises.readFile(path.join(tool.targetDir, entry.name), 'utf8');
    contents.set(entry.name, content);
  }));
  return {
    entries: new Map(relevant.map((entry) => [entry.name, entry])),
    contents,
  };
}

function collisionError(filepath: string, regularFile: boolean): Error {
  if (!regularFile) {
    return new Error(
      `Managed agent destination collision at ${filepath}: the path is not a regular file; `
      + '--force cannot safely replace it.'
    );
  }
  return new Error(
    `Managed agent destination collision at ${filepath}: the file is not managed by Spok. `
    + 'Re-run with --force to replace this exact catalog file.'
  );
}

function inspectExpectedFile(
  tool: PreparedToolInstall,
  expected: ExpectedAgentFile,
  snapshot: TargetSnapshot,
  options: AnalyzeOptions
): { write: boolean; managed: boolean } {
  const entry = snapshot.entries.get(expected.filename);
  if (!entry) return { write: true, managed: false };
  if (!entry.isFile()) {
    if (options.rejectCollisions) throw collisionError(expected.filepath, false);
    return { write: true, managed: false };
  }

  const content = snapshot.contents.get(expected.filename) ?? '';
  const managed = getManagedMarkerVersion(tool.toolId, content) !== null;
  if (content === expected.content) return { write: false, managed };
  if (!managed && !options.force && options.rejectCollisions) {
    throw collisionError(expected.filepath, true);
  }
  return { write: true, managed };
}

async function analyzeDestination(
  tool: PreparedToolInstall,
  options: AnalyzeOptions
): Promise<DestinationAnalysis> {
  const snapshot = await readTargetSnapshot(tool);
  const expectedNames = new Set(tool.expectedFiles.map(({ filename }) => filename));
  const writes: ExpectedAgentFile[] = [];
  const removals: string[] = [];
  let hasManagedAgents = false;

  for (const expected of tool.expectedFiles) {
    const inspected = inspectExpectedFile(tool, expected, snapshot, options);
    if (inspected.write) writes.push(expected);
    if (inspected.managed) hasManagedAgents = true;
  }

  for (const [filename, content] of snapshot.contents) {
    const managed = getManagedMarkerVersion(tool.toolId, content) !== null;
    if (managed) hasManagedAgents = true;
    if (managed && !expectedNames.has(filename)) {
      removals.push(path.join(tool.targetDir, filename));
    }
  }

  return { tool, writes, removals, hasManagedAgents };
}

function requestedToolIds(toolIds: readonly string[]): ManagedAgentToolId[] {
  const supported: ManagedAgentToolId[] = [];
  for (const toolId of toolIds) {
    assertManagedAgentToolId(toolId);
    if (!supported.includes(toolId)) supported.push(toolId);
  }
  return supported;
}

async function preflightPreparedInstall(
  prepared: PreparedManagedAgentInstall
): Promise<DestinationAnalysis[]> {
  return Promise.all(prepared.tools.map((tool) => analyzeDestination(tool, {
    force: prepared.force,
    rejectCollisions: true,
  })));
}

export async function prepareManagedAgentInstall(
  options: PrepareManagedAgentInstallOptions
): Promise<PreparedManagedAgentInstall> {
  const toolIds = requestedToolIds(options.toolIds);
  const version = validateVersion(options.version ?? DEFAULT_VERSION);
  const catalog = await loadAgentCatalog(options.sourceDir ?? DEFAULT_SOURCE_DIR);
  const tools = toolIds.map((toolId): PreparedToolInstall => {
    const targetDir = getManagedAgentTargetDir(toolId, options.homeDir);
    return {
      toolId,
      targetDir,
      expectedFiles: createExpectedFiles(toolId, targetDir, catalog, version),
    };
  });
  const prepared: PreparedManagedAgentInstall = {
    [PREPARED_INSTALL]: true,
    force: options.force ?? false,
    tools,
  };
  await preflightPreparedInstall(prepared);
  return prepared;
}

async function applyDestination(
  analysis: DestinationAnalysis
): Promise<ManagedAgentInstallResult> {
  if (analysis.writes.length > 0) {
    await fs.promises.mkdir(analysis.tool.targetDir, { recursive: true });
  }
  for (const expected of analysis.writes) {
    await fs.promises.writeFile(expected.filepath, expected.content, 'utf8');
  }
  for (const filepath of analysis.removals) {
    await fs.promises.unlink(filepath);
  }

  const writtenFiles = analysis.writes.map(({ filepath }) => filepath);
  return {
    toolId: analysis.tool.toolId,
    targetDir: analysis.tool.targetDir,
    expectedCount: analysis.tool.expectedFiles.length,
    writtenCount: writtenFiles.length,
    removedCount: analysis.removals.length,
    changed: writtenFiles.length > 0 || analysis.removals.length > 0,
    writtenFiles,
    removedFiles: [...analysis.removals],
  };
}

export async function applyManagedAgentInstall(
  prepared: PreparedManagedAgentInstall
): Promise<ManagedAgentInstallResult[]> {
  if (prepared[PREPARED_INSTALL] !== true) {
    throw new Error('Managed agent install was not prepared by prepareManagedAgentInstall().');
  }
  const analyses = await preflightPreparedInstall(prepared);
  const results: ManagedAgentInstallResult[] = [];
  for (const analysis of analyses) {
    results.push(await applyDestination(analysis));
  }
  return results;
}

export async function getManagedAgentState(
  options: ManagedAgentStateOptions
): Promise<ManagedAgentState> {
  assertManagedAgentToolId(options.toolId);
  const version = validateVersion(options.version ?? DEFAULT_VERSION);
  const catalog = await loadAgentCatalog(options.sourceDir ?? DEFAULT_SOURCE_DIR);
  const targetDir = getManagedAgentTargetDir(options.toolId, options.homeDir);
  const tool: PreparedToolInstall = {
    toolId: options.toolId,
    targetDir,
    expectedFiles: createExpectedFiles(options.toolId, targetDir, catalog, version),
  };
  const analysis = await analyzeDestination(tool, {
    force: false,
    rejectCollisions: false,
  });
  return {
    toolId: options.toolId,
    targetDir,
    expectedCount: tool.expectedFiles.length,
    hasManagedAgents: analysis.hasManagedAgents,
    needsUpdate: analysis.writes.length > 0 || analysis.removals.length > 0,
  };
}
