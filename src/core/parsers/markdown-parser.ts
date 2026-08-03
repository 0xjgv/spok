import { Spec, Change, Requirement, Scenario, Delta, DeltaOperation } from '../schemas/index.js';
import {
  buildCodeFenceMask,
  extractRequirementText,
} from './requirement-text.js';

export interface Section {
  level: number;
  title: string;
  content: string;
  children: Section[];
}

const HEADER = /^(#{1,6})\s+(.+)$/;
const HEADER_PREFIX = /^(#{1,6})\s+/;
const DELTA_LINE = /^\s*-\s*\*\*([^*:]+)(?::\*\*|\*\*:)\s*(.+)$/;

export class MarkdownParser {
  private lines: string[];
  private codeFenceLineMask: boolean[];
  private currentLine: number;

  constructor(content: string) {
    const normalized = MarkdownParser.normalizeContent(content);
    this.lines = normalized.split('\n');
    this.codeFenceLineMask = buildCodeFenceMask(this.lines);
    this.currentLine = 0;
  }

  protected static normalizeContent(content: string): string {
    return content.replace(/\r\n?/g, '\n');
  }

  protected static buildCodeFenceMask(lines: string[]): boolean[] {
    return buildCodeFenceMask(lines);
  }

  parseSpec(name: string): Spec {
    const sections = this.parseSections();
    const purpose = this.findSection(sections, 'Purpose')?.content || '';
    if (!purpose) {
      throw new Error('Spec must have a Purpose section');
    }

    const requirementsSection = this.findSection(sections, 'Requirements');
    if (!requirementsSection) {
      throw new Error('Spec must have a Requirements section');
    }

    return {
      name,
      overview: purpose.trim(),
      requirements: this.parseRequirements(requirementsSection),
      metadata: {
        version: '1.0.0',
        format: 'spok',
      },
    };
  }

  parseChange(name: string): Change {
    const sections = this.parseSections();
    const why = this.findSection(sections, 'Why')?.content || '';
    if (!why) {
      throw new Error('Change must have a Why section');
    }

    const whatChanges = this.findSection(sections, 'What Changes')?.content || '';
    if (!whatChanges) {
      throw new Error('Change must have a What Changes section');
    }

    return {
      name,
      why: why.trim(),
      whatChanges: whatChanges.trim(),
      deltas: this.parseDeltas(whatChanges),
      metadata: {
        version: '1.0.0',
        format: 'spok-change',
      },
    };
  }

  protected parseSections(): Section[] {
    const sections: Section[] = [];
    const stack: Section[] = [];

    for (let i = 0; i < this.lines.length; i++) {
      if (this.codeFenceLineMask[i]) {
        continue;
      }

      const headerMatch = this.lines[i].match(HEADER);
      if (!headerMatch) {
        continue;
      }

      const level = headerMatch[1].length;
      const section: Section = {
        level,
        title: headerMatch[2].trim(),
        content: this.getContentUntilNextHeader(i + 1, level),
        children: [],
      };

      MarkdownParser.attachSection(section, sections, stack);
    }

    return sections;
  }

  private static attachSection(section: Section, sections: Section[], stack: Section[]): void {
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      sections.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }

    stack.push(section);
  }

  protected getContentUntilNextHeader(startLine: number, currentLevel: number): string {
    const contentLines: string[] = [];

    for (let i = startLine; i < this.lines.length; i++) {
      const line = this.lines[i];
      const headerMatch = this.codeFenceLineMask[i] ? null : line.match(HEADER_PREFIX);

      if (headerMatch && headerMatch[1].length <= currentLevel) {
        break;
      }

      contentLines.push(line);
    }

    return contentLines.join('\n').trim();
  }

  protected findSection(sections: Section[], title: string): Section | undefined {
    for (const section of sections) {
      if (section.title.toLowerCase() === title.toLowerCase()) {
        return section;
      }
      const child = this.findSection(section.children, title);
      if (child) {
        return child;
      }
    }
    return undefined;
  }

  protected parseRequirements(section: Section): Requirement[] {
    return section.children.map(child => ({
      text: MarkdownParser.requirementText(child),
      scenarios: this.parseScenarios(child),
    }));
  }

  private static requirementText(child: Section): string {
    return extractRequirementText(child.title, child.content.split('\n'));
  }

  protected parseScenarios(requirementSection: Section): Scenario[] {
    return requirementSection.children
      .filter(scenario => scenario.content.trim())
      .map(scenario => ({ rawText: scenario.content }));
  }

  protected parseDeltas(content: string): Delta[] {
    const deltas: Delta[] = [];

    for (const line of content.split('\n')) {
      // Match both formats: **spec:** and **spec**:
      const deltaMatch = line.match(DELTA_LINE);
      if (!deltaMatch) {
        continue;
      }

      const description = deltaMatch[2].trim();
      deltas.push({
        spec: deltaMatch[1].trim(),
        operation: MarkdownParser.classifyDeltaOperation(description),
        description,
      });
    }

    return deltas;
  }

  private static classifyDeltaOperation(description: string): DeltaOperation {
    const lowerDesc = description.toLowerCase();

    // Use word boundaries to avoid false matches (e.g., "address" matching "add").
    // Check RENAMED first since it's more specific than patterns containing "new".
    if (/\brename(s|d|ing)?\b/.test(lowerDesc) || /\brenamed\s+(to|from)\b/.test(lowerDesc)) {
      return 'RENAMED';
    }
    if (/\badd(s|ed|ing)?\b/.test(lowerDesc) || /\bcreate(s|d|ing)?\b/.test(lowerDesc) || /\bnew\b/.test(lowerDesc)) {
      return 'ADDED';
    }
    if (/\bremove(s|d|ing)?\b/.test(lowerDesc) || /\bdelete(s|d|ing)?\b/.test(lowerDesc)) {
      return 'REMOVED';
    }
    return 'MODIFIED';
  }
}
