import { describe, it, expect } from 'vitest';
import { getWelcomeText } from '../../src/ui/welcome-screen.js';

describe('welcome-screen', () => {
  describe('getWelcomeText', () => {
    it('advertises the workflow skills, not retired opsx commands', () => {
      const lines = getWelcomeText();
      const text = lines.join('\n');

      expect(text).toContain('/spok-explore');
      expect(text).toContain('/spok-propose');
      expect(text).toContain('/spok-apply');
      expect(text).toContain('/spok-archive');
      expect(text).not.toContain('/opsx:');
      expect(text).not.toContain('/opsx-');
      expect(text).not.toContain('/spok:');
    });

    it('mentions vendored helper skills', () => {
      const text = getWelcomeText().join('\n');

      expect(text).toContain('spok-flow');
      expect(text).toContain('spok-create-scoped-chunks');
    });
  });
});
