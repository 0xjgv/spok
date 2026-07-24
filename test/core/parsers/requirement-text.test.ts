import { describe, expect, it } from 'vitest';
import {
  containsShallOrMust,
  countScenarios,
  extractRequirementBody,
  extractRequirementText,
} from '../../../src/core/parsers/requirement-text.js';

describe('requirement text', () => {
  it('keeps multiline prose and finds a normative keyword on a later line', () => {
    const body = [
      'A completed review remains unavailable while CI is blocked.',
      'The system SHALL keep that review held until the blocking state clears.',
      '',
      '#### Scenario: CI blocks publication',
      '- **WHEN** CI is blocked',
    ];

    const text = extractRequirementBody(body);

    expect(text).toBe(
      [
        'A completed review remains unavailable while CI is blocked.',
        'The system SHALL keep that review held until the blocking state clears.',
      ].join('\n')
    );
    expect(containsShallOrMust(text)).toBe(true);
  });

  it('ignores metadata and fenced examples when prose exists', () => {
    const body = [
      '**ID**: REVIEW-1',
      '```markdown',
      'The example MUST not satisfy validation.',
      '#### Scenario: Fenced scenario',
      '```',
      'The system SHALL use the real prose.',
      '#### Scenario: Real scenario',
    ];

    expect(extractRequirementBody(body)).toBe('The system SHALL use the real prose.');
    expect(countScenarios(body)).toBe(1);
  });

  it('retains metadata-only bodies and falls back to the requirement heading when empty', () => {
    expect(extractRequirementBody(['**Constraint**: The system MUST retain this line.'])).toBe(
      '**Constraint**: The system MUST retain this line.'
    );
    expect(extractRequirementText('The system SHALL use its heading', ['', '#### Scenario: Test'])).toBe(
      'The system SHALL use its heading'
    );
  });

  it('matches normative keywords as whole words', () => {
    expect(containsShallOrMust('The system SHALL publish.')).toBe(true);
    expect(containsShallOrMust('The MARSHALL service publishes.')).toBe(false);
  });
});
