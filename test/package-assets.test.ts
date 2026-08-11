import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_JSON = path.resolve(__dirname, '../package.json');

describe('npm package assets', () => {
  it('publishes skill and agent assets', async () => {
    const manifest = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as {
      files?: string[];
    };

    expect(manifest.files).toEqual(
      expect.arrayContaining(['assets/skills', 'assets/agents']),
    );
  });
});
