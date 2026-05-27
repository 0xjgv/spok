import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { extractFrontmatter } from '../helpers/frontmatter';

const FILES = [
  'docs/cli.md',
  'docs/commands.md',
  'docs/concepts.md',
  'docs/customization.md',
  'docs/getting-started.md',
  'docs/installation.md',
  'docs/migration-guide.md',
  'docs/multi-language.md',
  'docs/supported-tools.md',
  'docs/workflows.md',
  'README.md',
  'CHANGELOG.md',
] as const;

describe('spok doc frontmatter', () => {
  it.each(FILES)('%s declares version "0.1.0"', async (rel) => {
    const file = path.resolve(__dirname, '../../', rel);
    const raw = await fs.readFile(file, 'utf-8');
    const fm = parseYaml(extractFrontmatter(raw)) as {
      version?: unknown;
    } | null;
    expect(fm?.version).toBe('0.1.0');
  });
});
