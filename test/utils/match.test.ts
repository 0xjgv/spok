import { describe, expect, it } from 'vitest';

import { levenshtein, nearestMatches } from '../../src/utils/match.js';

describe('match utilities', () => {
  it('computes Levenshtein distance for empty, equal, inserted, deleted, and substituted strings', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('flaw', 'lawn')).toBe(2);
  });

  it('returns nearest candidates in distance order with a max limit', () => {
    expect(nearestMatches('specc', ['tasks', 'specs', 'design', 'proposal'], 2)).toEqual([
      'specs',
      'tasks',
    ]);
  });
});
