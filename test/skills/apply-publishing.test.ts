import { describe, expect, it } from 'vitest';
import { getApplyCommandTemplate, getApplySkillTemplate } from '../../src/core/templates/workflows/apply.js';

const instructions = getApplySkillTemplate().instructions;

describe('apply final-change publication recipe', () => {
  it('shares publication instructions across skill and command', () => {
    expect(getApplyCommandTemplate().content).toBe(instructions);
  });

  it('publishes only after the final chunk and retries without rerunning completed chunks', () => {
    expect(instructions).toContain('If every chunk is checked, skip steps 4–8 and go directly to step 9');
    expect(instructions).toContain('If any chunk remains unchecked, STOP');
    expect(instructions).toContain('Ship exactly **one** chunk per invocation');
    expect(instructions).not.toContain('If every chunk is checked, congratulate');
  });

  it('requires authoritative execution context before publication', () => {
    expect(instructions).toContain('spok flow status "<absolute-final-ticket-dir>" --json');
    expect(instructions).toContain('execution.workRoot');
    expect(instructions).toContain('execution.branch');
    expect(instructions).toContain("exactly equals the final flow's recorded commit");
    expect(instructions).toContain('including a recorded no-op');
    expect(instructions).toContain('If HEAD differs, STOP and report both commits');
    expect(instructions).toContain('Never infer a checkout or branch from the current directory');
    expect(instructions).toContain('legacy completed change without execution context');
  });

  it('reuses one exact branch PR and treats lookup errors as blockers', () => {
    expect(instructions).toContain('gh pr list');
    expect(instructions).toContain('--state all');
    expect(instructions).toContain('--repo');
    expect(instructions).toContain('--head <execution.branch>');
    expect(instructions).toContain('Match the exact head repository');
    expect(instructions).toContain('owner, and branch against the verified push destination');
    expect(instructions).toContain('Only a successful lookup with an empty result');
    expect(instructions).toContain('Authentication, network, and JSON errors');
    expect(instructions).toContain('gh pr edit');
    expect(instructions).toContain('If a matching PR is closed or merged, return its URL');
    expect(instructions).toContain('do not push more work, reopen it, or create a duplicate');
    expect(instructions).toContain('gh pr create');
    expect(instructions).toContain('--body-file');
    expect(instructions).toContain('argument arrays');
  });

  it('preserves completion on publication failure and returns URL without review or merge', () => {
    expect(instructions).toContain('leave every completed checkbox checked');
    expect(instructions).toContain('Do not rerun completed chunks or roll back commits');
    expect(instructions).toContain('Return the PR URL immediately');
    expect(instructions).toContain('Do not wait for human review');
    expect(instructions).toContain('Never merge');
    expect(instructions).toContain('On failure: leave the checkbox unchecked');
  });
});
