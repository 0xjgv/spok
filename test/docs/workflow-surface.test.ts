import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.resolve(__dirname, '../../', relativePath), 'utf-8');
}

describe('workflow surface docs', () => {
  it('lists explore as a thinking-only pre-proposal command', async () => {
    const commands = await readDoc('docs/commands.md');

    expect(commands).toContain('/spok-explore');
    expect(commands).toContain('thinking-only mode');
    expect(commands).toContain('before proposing');
  });

  it('maps old explore to current explore without retiring the current skill', async () => {
    const migrationGuide = await readDoc('docs/migration-guide.md');
    const retiredSkills = migrationGuide.slice(
      migrationGuide.indexOf('Retired skill directories'),
      migrationGuide.indexOf('### CLI subcommands')
    );

    expect(migrationGuide).toContain('| `/opsx:explore` | `/spok-explore` |');
    expect(retiredSkills).not.toContain('spok-explore');
  });
});
