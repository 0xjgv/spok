import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { classifyError, sanitizeError } from '../../src/telemetry/errors.js';

describe('telemetry/errors', () => {
  describe('classifyError', () => {
    it('classifies thrown Errors as user errors and keeps the code', () => {
      const err: NodeJS.ErrnoException = new Error('nope');
      err.code = 'EACCES';

      expect(classifyError(err)).toEqual({ name: 'Error', code: 'EACCES', kind: 'user_error' });
    });

    it('classifies programmer errors as crashes', () => {
      expect(classifyError(new TypeError('boom'))).toEqual({
        name: 'TypeError',
        code: null,
        kind: 'crash',
      });
    });

    it('classifies non-Error throws as crashes', () => {
      expect(classifyError('a string')).toEqual({ name: 'NonError', code: null, kind: 'crash' });
    });

    it('preserves custom error class names as user errors', () => {
      class ChangeMetadataError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'ChangeMetadataError';
        }
      }

      const classified = classifyError(new ChangeMetadataError('bad metadata'));
      expect(classified.name).toBe('ChangeMetadataError');
      expect(classified.kind).toBe('user_error');
    });
  });

  describe('sanitizeError', () => {
    it('drops the raw message and keeps class + code', () => {
      const err: NodeJS.ErrnoException = new Error(`cannot read ${os.homedir()}/private/notes.md`);
      err.code = 'ENOENT';

      const safe = sanitizeError(err);

      expect(safe.name).toBe('Error');
      expect(safe.message).toBe('Error [ENOENT]');
      expect(safe.message).not.toContain('notes.md');
    });

    it('uses the class name alone when there is no code', () => {
      expect(sanitizeError(new TypeError('boom')).message).toBe('TypeError');
    });

    it('redacts home and cwd paths from the stack', () => {
      const err = new Error('boom');
      err.stack = [
        'Error: boom',
        `    at fn (${process.cwd()}/src/foo.ts:1:1)`,
        `    at gn (${os.homedir()}/.bun/spok/dist/bar.js:2:2)`,
      ].join('\n');

      const safe = sanitizeError(err);

      expect(safe.stack).not.toContain(process.cwd());
      expect(safe.stack).not.toContain(os.homedir());
      expect(safe.stack).toContain('./src/foo.ts');
      expect(safe.stack).toContain('~/.bun/spok/dist/bar.js');
    });

    it('caps the number of stack frames', () => {
      const frames = Array.from({ length: 30 }, (_, i) => `    at fn${i} (/abs/file.js:${i}:1)`);
      const err = new Error('boom');
      err.stack = ['Error: boom', ...frames].join('\n');

      const safe = sanitizeError(err);
      const frameLines = (safe.stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at '));
      expect(frameLines).toHaveLength(10);
    });

    it('falls back to the header when there is no stack', () => {
      const err = new Error('boom');
      delete err.stack;

      expect(sanitizeError(err).stack).toBe('Error: Error');
    });
  });
});
