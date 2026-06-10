import { MarkdownParser, Section } from './markdown-parser.js';
import { Change, Delta, DeltaOperation, Requirement } from '../schemas/index.js';
import path from 'path';
import { promises as fs } from 'fs';

interface DeltaSection {
  operation: DeltaOperation;
  requirements: Requirement[];
  renames?: Array<{ from: string; to: string }>;
}

export class ChangeParser extends MarkdownParser {
  private changeDir: string;

  constructor(content: string, changeDir: string) {
    super(content);
    this.changeDir = changeDir;
  }

  async parseChangeWithDeltas(name: string): Promise<Change> {
    const sections = this.parseSections();
    const why = this.findSection(sections, 'Why')?.content || '';
    const whatChanges = this.findSection(sections, 'What Changes')?.content || '';
    
    if (!why) {
      throw new Error('Change must have a Why section');
    }
    
    if (!whatChanges) {
      throw new Error('Change must have a What Changes section');
    }

    // Parse deltas from the What Changes section (simple format)
    const simpleDeltas = this.parseDeltas(whatChanges);
    
    // Check if there are spec files with delta format
    const specsDir = path.join(this.changeDir, 'specs');
    const deltaDeltas = await this.parseDeltaSpecs(specsDir);
    
    // Combine both types of deltas, preferring delta format if available
    const deltas = deltaDeltas.length > 0 ? deltaDeltas : simpleDeltas;

    return {
      name,
      why: why.trim(),
      whatChanges: whatChanges.trim(),
      deltas,
      metadata: {
        version: '1.0.0',
        format: 'spok-change',
      },
    };
  }

  private async parseDeltaSpecs(specsDir: string): Promise<Delta[]> {
    let specDirs;
    try {
      specDirs = await fs.readdir(specsDir, { withFileTypes: true });
    } catch {
      // Specs directory might not exist, which is okay
      return [];
    }

    const deltas: Delta[] = [];

    for (const dir of specDirs) {
      if (!dir.isDirectory()) continue;

      const specFile = path.join(specsDir, dir.name, 'spec.md');

      try {
        const content = await fs.readFile(specFile, 'utf-8');
        deltas.push(...this.parseSpecDeltas(dir.name, content));
      } catch {
        // Spec file might not exist, which is okay
      }
    }

    return deltas;
  }

  private parseSpecDeltas(specName: string, content: string): Delta[] {
    const sections = this.parseSectionsFromContent(content);
    const deltas: Delta[] = [];

    const requirementRules: Array<{
      title: string;
      operation: DeltaOperation;
      describe: (req: Requirement) => string;
    }> = [
      { title: 'ADDED Requirements', operation: 'ADDED', describe: req => `Add requirement: ${req.text}` },
      { title: 'MODIFIED Requirements', operation: 'MODIFIED', describe: req => `Modify requirement: ${req.text}` },
      { title: 'REMOVED Requirements', operation: 'REMOVED', describe: req => `Remove requirement: ${req.text}` },
    ];

    for (const { title, operation, describe } of requirementRules) {
      const section = this.findSection(sections, title);
      if (!section) continue;

      for (const req of this.parseRequirements(section)) {
        deltas.push({
          spec: specName,
          operation,
          description: describe(req),
          // Provide both single and plural forms for compatibility
          requirement: req,
          requirements: [req],
        });
      }
    }

    const renamedSection = this.findSection(sections, 'RENAMED Requirements');
    if (renamedSection) {
      for (const rename of this.parseRenames(renamedSection.content)) {
        deltas.push({
          spec: specName,
          operation: 'RENAMED' as DeltaOperation,
          description: `Rename requirement from "${rename.from}" to "${rename.to}"`,
          rename,
        });
      }
    }

    return deltas;
  }

  private parseRenames(content: string): Array<{ from: string; to: string }> {
    const renames: Array<{ from: string; to: string }> = [];
    const lines = ChangeParser.normalizeContent(content).split('\n');

    let currentRename: { from?: string; to?: string } = {};

    for (const line of lines) {
      const fromMatch = line.match(/^\s*-?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
      if (fromMatch) {
        currentRename.from = fromMatch[1].trim();
        continue;
      }

      const toMatch = line.match(/^\s*-?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
      if (!toMatch) {
        continue;
      }

      currentRename.to = toMatch[1].trim();
      if (currentRename.from && currentRename.to) {
        renames.push({ from: currentRename.from, to: currentRename.to });
        currentRename = {};
      }
    }

    return renames;
  }

  private parseSectionsFromContent(content: string): Section[] {
    const normalizedContent = ChangeParser.normalizeContent(content);
    const lines = normalizedContent.split('\n');
    const codeFenceLineMask = ChangeParser.buildCodeFenceMask(lines);
    const sections: Section[] = [];
    const stack: Section[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      if (codeFenceLineMask[i]) {
        continue;
      }

      const headerMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
      if (!headerMatch) {
        continue;
      }

      const level = headerMatch[1].length;
      const contentLines = this.getContentUntilNextHeaderFromLines(lines, codeFenceLineMask, i + 1, level);

      const section = {
        level,
        title: headerMatch[2].trim(),
        content: contentLines.join('\n').trim(),
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        sections.push(section);
      } else {
        stack[stack.length - 1].children.push(section);
      }

      stack.push(section);
    }

    return sections;
  }

  private getContentUntilNextHeaderFromLines(
    lines: string[],
    codeFenceLineMask: boolean[],
    startLine: number,
    currentLevel: number
  ): string[] {
    const contentLines: string[] = [];
    
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = codeFenceLineMask[i] ? null : line.match(/^(#{1,6})\s+/);
      
      if (headerMatch && headerMatch[1].length <= currentLevel) {
        break;
      }
      
      contentLines.push(line);
    }
    
    return contentLines;
  }
}
