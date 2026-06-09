const REQUIREMENTS_SECTION_HEADER = /^##\s+Requirements\s*$/i;
const TOP_LEVEL_SECTION_HEADER = /^##\s+/;
const DELTA_HEADER = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i;
const REQUIREMENT_HEADER = /^###\s+Requirement:\s*(.+)\s*$/i;

export interface MainSpecStructureIssue {
  kind: 'delta-header' | 'requirement-outside-requirements';
  line: number;
  header: string;
  message: string;
}

export function findMainSpecStructureIssues(content: string): MainSpecStructureIssue[] {
  const normalized = content.replace(/\r\n?/g, '\n');
  const stripped = stripFencedCodeBlocksPreservingLines(normalized);
  const lines = stripped.split('\n');
  const requirements = findRequirementsSectionRange(lines);
  const issues: MainSpecStructureIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (DELTA_HEADER.test(line)) {
      issues.push({
        kind: 'delta-header',
        line: i + 1,
        header: trimmed,
        message:
          `Main spec contains delta header "${trimmed}". ` +
          'Delta headers are only valid inside spok/changes/<name>/specs/<capability>/spec.md ' +
          'and truncate the parsed ## Requirements section.',
      });
      continue;
    }

    if (!REQUIREMENT_HEADER.test(line)) {
      continue;
    }

    if (!requirements.contains(i)) {
      issues.push({
        kind: 'requirement-outside-requirements',
        line: i + 1,
        header: trimmed,
        message:
          `Requirement header "${trimmed}" appears outside the main ## Requirements section. ` +
          'Main specs only parse requirements inside that section, so this requirement is currently invisible to validate, list, and archive.',
      });
    }
  }

  return issues;
}

interface RequirementsSectionRange {
  /** Whether the given line index falls strictly inside the ## Requirements section body. */
  contains(lineIndex: number): boolean;
}

function findRequirementsSectionRange(lines: string[]): RequirementsSectionRange {
  const headerIndex = lines.findIndex(line => REQUIREMENTS_SECTION_HEADER.test(line));
  if (headerIndex === -1) {
    return { contains: () => false };
  }

  let endIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (TOP_LEVEL_SECTION_HEADER.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  return { contains: lineIndex => lineIndex > headerIndex && lineIndex < endIndex };
}

interface Fence {
  marker: '`' | '~';
  length: number;
}

export function stripFencedCodeBlocksPreservingLines(content: string): string {
  const lines = content.split('\n');
  const output: string[] = [];
  let activeFence: Fence | null = null;

  for (const line of lines) {
    if (!activeFence) {
      activeFence = parseOpeningFence(line);
      output.push(activeFence ? '' : line);
      continue;
    }

    output.push('');
    if (isClosingFence(line, activeFence)) {
      activeFence = null;
    }
  }

  return output.join('\n');
}

function parseOpeningFence(line: string): Fence | null {
  const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
  if (!match) {
    return null;
  }
  return { marker: match[1][0] as '`' | '~', length: match[1].length };
}

function isClosingFence(line: string, activeFence: Fence): boolean {
  const match = line.match(/^\s*(`{3,}|~{3,})\s*$/);
  return Boolean(
    match &&
    match[1][0] === activeFence.marker &&
    match[1].length >= activeFence.length
  );
}
