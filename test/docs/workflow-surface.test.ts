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

  it('documents capabilities as an agent self-discovery escape hatch', async () => {
    const cli = await readDoc('docs/cli.md');
    const commands = await readDoc('docs/commands.md');

    expect(cli).toContain('### `spok capabilities`');
    expect(cli).toContain('spok capabilities --json');
    expect(commands).toContain('spok capabilities --json');
    expect(commands).toContain('self-discovery escape hatch');
  });

  it('documents MEMORY.md as presence-based, capped, and human-promoted', async () => {
    const workflows = await readDoc('docs/workflows.md');
    const commands = await readDoc('docs/commands.md');

    expect(workflows).toContain('spok/MEMORY.md');
    expect(workflows).toContain('presence-based');
    expect(workflows).toContain('At most 20 rules are inlined');
    expect(workflows).toContain('never writes `spok/MEMORY.md`');
    expect(workflows).toContain('`flow.self_learn` stays opt-in');
    expect(commands).toContain('up to 20');
    expect(commands).toContain('prose in the file is ignored by design');
  });

  it('documents current explore without retiring the skill', async () => {
    const migrationGuide = await readDoc('docs/migration-guide.md');
    const retiredSkills = migrationGuide.slice(
      migrationGuide.indexOf('Retired skill directories'),
      migrationGuide.indexOf('### CLI subcommands')
    );

    expect(migrationGuide).toContain('| `/spok-explore` | Replaces the exploratory workflow |');
    expect(retiredSkills).not.toContain('spok-explore');
  });
});
