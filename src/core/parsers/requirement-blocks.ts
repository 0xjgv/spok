export interface RequirementBlock {
  headerLine: string; // e.g., '### Requirement: Something'
  name: string; // e.g., 'Something'
  raw: string; // full block including headerLine and following content
}

export interface RequirementsSectionParts {
  before: string;
  headerLine: string; // the '## Requirements' line
  preamble: string; // content between headerLine and first requirement block
  bodyBlocks: RequirementBlock[]; // parsed requirement blocks in order
  after: string;
}

export function normalizeRequirementName(name: string): string {
  return name.trim();
}

const REQUIREMENT_HEADER_REGEX = /^###\s*Requirement:\s*(.+)\s*$/i;
const REQUIREMENTS_SECTION_REGEX = /^##\s+Requirements\s*$/i;
const TOP_LEVEL_SECTION_REGEX = /^##\s+/;

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

function isRequirementHeader(line: string): boolean {
  return REQUIREMENT_HEADER_REGEX.test(line);
}

function isTopLevelSection(line: string): boolean {
  return TOP_LEVEL_SECTION_REGEX.test(line);
}

/**
 * Parse requirement blocks from a list of lines. Leading non-header lines are
 * ignored; each block runs from its header line until the next requirement
 * header or top-level section header.
 */
function parseRequirementBlocks(lines: string[]): RequirementBlock[] {
  const blocks: RequirementBlock[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const headerLine = lines[cursor];
    const headerMatch = headerLine.match(REQUIREMENT_HEADER_REGEX);
    if (!headerMatch) {
      cursor++;
      continue;
    }

    const name = normalizeRequirementName(headerMatch[1]);
    const bodyLines = [headerLine];
    cursor++;
    while (cursor < lines.length && !isRequirementHeader(lines[cursor]) && !isTopLevelSection(lines[cursor])) {
      bodyLines.push(lines[cursor]);
      cursor++;
    }

    blocks.push({ headerLine, name, raw: bodyLines.join('\n').trimEnd() });
  }

  return blocks;
}

function emptyRequirementsSection(content: string): RequirementsSectionParts {
  const before = content.trimEnd();
  return {
    before: before ? before + '\n\n' : '',
    headerLine: '## Requirements',
    preamble: '',
    bodyBlocks: [],
    after: '\n',
  };
}

/**
 * Extracts the Requirements section from a spec file and parses requirement blocks.
 */
export function extractRequirementsSection(content: string): RequirementsSectionParts {
  const lines = normalizeLineEndings(content).split('\n');
  const reqHeaderIndex = lines.findIndex(line => REQUIREMENTS_SECTION_REGEX.test(line));

  if (reqHeaderIndex === -1) {
    return emptyRequirementsSection(content);
  }

  // Section ends at the next top-level header (or end of file).
  let endIndex = lines.length;
  for (let i = reqHeaderIndex + 1; i < lines.length; i++) {
    if (isTopLevelSection(lines[i])) {
      endIndex = i;
      break;
    }
  }

  const before = lines.slice(0, reqHeaderIndex).join('\n');
  const headerLine = lines[reqHeaderIndex];
  const sectionBodyLines = lines.slice(reqHeaderIndex + 1, endIndex);
  const after = lines.slice(endIndex).join('\n');

  // Preamble is everything before the first requirement header.
  const firstHeaderIndex = sectionBodyLines.findIndex(isRequirementHeader);
  const preambleEnd = firstHeaderIndex === -1 ? sectionBodyLines.length : firstHeaderIndex;
  const preamble = sectionBodyLines.slice(0, preambleEnd).join('\n').trimEnd();
  const bodyBlocks = parseRequirementBlocks(sectionBodyLines.slice(preambleEnd));

  return {
    before: before.trimEnd() ? before + '\n' : before,
    headerLine,
    preamble,
    bodyBlocks,
    after: after.startsWith('\n') ? after : '\n' + after,
  };
}

export interface DeltaPlan {
  added: RequirementBlock[];
  modified: RequirementBlock[];
  removed: string[]; // requirement names
  renamed: Array<{ from: string; to: string }>;
  sectionPresence: {
    added: boolean;
    modified: boolean;
    removed: boolean;
    renamed: boolean;
  };
}

/**
 * Parse a delta-formatted spec change file content into a DeltaPlan with raw blocks.
 */
export function parseDeltaSpec(content: string): DeltaPlan {
  const sections = splitTopLevelSections(normalizeLineEndings(content));
  const added = getSectionCaseInsensitive(sections, 'ADDED Requirements');
  const modified = getSectionCaseInsensitive(sections, 'MODIFIED Requirements');
  const removed = getSectionCaseInsensitive(sections, 'REMOVED Requirements');
  const renamed = getSectionCaseInsensitive(sections, 'RENAMED Requirements');

  return {
    added: parseRequirementBlocksFromSection(added.body),
    modified: parseRequirementBlocksFromSection(modified.body),
    removed: parseRemovedNames(removed.body),
    renamed: parseRenamedPairs(renamed.body),
    sectionPresence: {
      added: added.found,
      modified: modified.found,
      removed: removed.found,
      renamed: renamed.found,
    },
  };
}

function splitTopLevelSections(content: string): Record<string, string> {
  const lines = content.split('\n');
  const headers: Array<{ title: string; index: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^##\s+(.+)$/);
    if (match) {
      headers.push({ title: match[1].trim(), index: i });
    }
  }

  const result: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const current = headers[i];
    const next = headers[i + 1];
    result[current.title] = lines.slice(current.index + 1, next ? next.index : lines.length).join('\n');
  }
  return result;
}

function getSectionCaseInsensitive(sections: Record<string, string>, desired: string): { body: string; found: boolean } {
  const target = desired.toLowerCase();
  for (const [title, body] of Object.entries(sections)) {
    if (title.toLowerCase() === target) return { body, found: true };
  }
  return { body: '', found: false };
}

function parseRequirementBlocksFromSection(sectionBody: string): RequirementBlock[] {
  if (!sectionBody) return [];
  return parseRequirementBlocks(normalizeLineEndings(sectionBody).split('\n'));
}

function parseRemovedNames(sectionBody: string): string[] {
  if (!sectionBody) return [];
  const names: string[] = [];
  for (const line of normalizeLineEndings(sectionBody).split('\n')) {
    const headerMatch = line.match(REQUIREMENT_HEADER_REGEX);
    if (headerMatch) {
      names.push(normalizeRequirementName(headerMatch[1]));
      continue;
    }
    // Also support bullet list of headers
    const bulletMatch = line.match(/^\s*-\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
    if (bulletMatch) {
      names.push(normalizeRequirementName(bulletMatch[1]));
    }
  }
  return names;
}

function parseRenamedPairs(sectionBody: string): Array<{ from: string; to: string }> {
  if (!sectionBody) return [];
  const pairs: Array<{ from: string; to: string }> = [];
  let current: { from?: string; to?: string } = {};
  for (const line of normalizeLineEndings(sectionBody).split('\n')) {
    const fromMatch = line.match(/^\s*-?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
    if (fromMatch) {
      current.from = normalizeRequirementName(fromMatch[1]);
      continue;
    }
    const toMatch = line.match(/^\s*-?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
    if (toMatch) {
      current.to = normalizeRequirementName(toMatch[1]);
      if (current.from && current.to) {
        pairs.push({ from: current.from, to: current.to });
        current = {};
      }
    }
  }
  return pairs;
}
