import { describe, it, expect } from 'vitest';
import {
  rewriteSkillReferences,
  normalizeFrontmatterName,
} from '../../scripts/vendor-skills.mjs';

describe('vendor-skills rewrite helpers', () => {
  it('rewrites skill references without touching "data flow"', () => {
    const input = [
      'Call the `create-plan` skill after `flow` completes.',
      'Traces data flow and key functions',
    ].join('\n');

    const out = rewriteSkillReferences(input);

    expect(out).toContain('`spok-create-plan`');
    expect(out).toContain('`spok-flow`');
    expect(out).toContain('Traces data flow and key functions');
    expect(out).not.toContain('data spok-flow');
  });

  it('normalizes SKILL.md frontmatter name to the vendored directory name', () => {
    const input = `---
name: research-codebase
description: research the codebase
---

# Research
`;

    expect(normalizeFrontmatterName(input, 'spok-create-research')).toBe(`---
name: spok-create-research
description: research the codebase
---

# Research
`);
  });
});
