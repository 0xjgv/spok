interface ActiveFence {
  marker: '`' | '~';
  length: number;
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const HEADER_LINE = /^#{1,6}\s/;
const METADATA_LINE = /^\*\*[^*]+\*\*:/;
const SCENARIO_HEADER = /^####\s+/;

/**
 * Mark every line inside a fenced code block, including the fence lines.
 */
export function buildCodeFenceMask(lines: string[]): boolean[] {
  const mask = new Array(lines.length).fill(false);
  let activeFence: ActiveFence | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (!activeFence) {
      activeFence = getFenceMarker(lines[i]);
      if (activeFence) {
        mask[i] = true;
      }
      continue;
    }

    mask[i] = true;
    if (isClosingFence(lines[i], activeFence)) {
      activeFence = null;
    }
  }

  return mask;
}

function getFenceMarker(line: string): ActiveFence | null {
  const match = line.match(FENCE_OPEN);
  if (!match) {
    return null;
  }

  return {
    marker: match[1][0] as '`' | '~',
    length: match[1].length,
  };
}

function isClosingFence(line: string, activeFence: ActiveFence): boolean {
  const match = line.match(FENCE_CLOSE);
  return Boolean(
    match &&
    match[1][0] === activeFence.marker &&
    match[1].length >= activeFence.length
  );
}

/**
 * Read all prose before the first non-fenced markdown header.
 * Metadata is ignored when prose exists and retained for metadata-only bodies.
 */
export function analyzeRequirementBody(bodyLines: string[]): {
  text: string;
  scenarioCount: number;
} {
  const fenceMask = buildCodeFenceMask(bodyLines);
  const prose: string[] = [];
  const metadata: string[] = [];
  let scenarioCount = 0;
  let reachedHeader = false;

  for (let i = 0; i < bodyLines.length; i++) {
    if (fenceMask[i]) {
      continue;
    }

    const line = bodyLines[i];
    if (SCENARIO_HEADER.test(line)) {
      scenarioCount++;
    }

    if (reachedHeader) {
      continue;
    }

    if (HEADER_LINE.test(line)) {
      reachedHeader = true;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (METADATA_LINE.test(trimmed)) {
      metadata.push(trimmed);
      continue;
    }

    prose.push(trimmed);
  }

  return {
    text: prose.length > 0 ? prose.join('\n') : metadata.join('\n'),
    scenarioCount,
  };
}

export function extractRequirementBody(bodyLines: string[]): string {
  return analyzeRequirementBody(bodyLines).text;
}

export function extractRequirementText(headerTitle: string, bodyLines: string[]): string {
  return extractRequirementBody(bodyLines) || headerTitle.trim();
}

export function containsShallOrMust(text: string): boolean {
  return /\b(SHALL|MUST)\b/.test(text);
}

export function countScenarios(bodyLines: string[]): number {
  return analyzeRequirementBody(bodyLines).scenarioCount;
}
