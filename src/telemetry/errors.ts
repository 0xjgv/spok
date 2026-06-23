/**
 * Privacy-safe error classification and sanitization for telemetry.
 *
 * Mirrors the telemetry privacy promise: error reports carry the error class,
 * an optional error code, and a path-redacted stack — never the raw message,
 * command arguments, file contents, or absolute user paths.
 */
import os from 'os';

export type ErrorKind = 'user_error' | 'crash';

/**
 * Built-in error types that signal a programming defect rather than an expected
 * user-facing failure (bad input, missing file). These are always crashes.
 */
const PROGRAMMER_ERRORS = new Set([
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
]);

const MAX_FRAMES = 10;

export interface ClassifiedError {
  name: string;
  code: string | null;
  kind: ErrorKind;
}

/**
 * Reduce an unknown thrown value to its error class, optional code, and whether
 * it represents an expected user error or a bug.
 */
export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof Error) {
    const name = error.name || 'Error';
    const rawCode = (error as { code?: unknown }).code;
    const code = typeof rawCode === 'string' ? rawCode : null;
    const kind: ErrorKind = PROGRAMMER_ERRORS.has(name) ? 'crash' : 'user_error';
    return { name, code, kind };
  }

  // A non-Error throw (string, object, undefined) is never expected.
  return { name: 'NonError', code: null, kind: 'crash' };
}

/**
 * Replace absolute user paths in a single line with stable placeholders.
 * The working directory is redacted before the home directory because it is
 * usually nested under home, so the more specific path must win.
 */
function redactPaths(line: string): string {
  let out = line;
  const cwd = process.cwd();
  const home = os.homedir();
  if (cwd) out = out.split(cwd).join('.');
  if (home) out = out.split(home).join('~');
  return out;
}

/**
 * Build a path-redacted stack trace that drops the original message line (which
 * may contain user content) and keeps only the top, path-redacted frames.
 */
function redactStack(stack: string | undefined, header: string): string {
  if (!stack) return header;

  const frames = stack
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, MAX_FRAMES)
    .map(redactPaths);

  return [header, ...frames].join('\n');
}

/**
 * Produce a fresh Error safe to hand to PostHog's exception capture.
 *
 * Preserves the error class and code so PostHog can group issues, while
 * replacing the raw message with a class+code label and redacting absolute
 * paths from the stack.
 */
export function sanitizeError(error: unknown): Error {
  const { name, code } = classifyError(error);
  const message = code ? `${name} [${code}]` : name;

  const sanitized = new Error(message);
  sanitized.name = name;
  const originalStack = error instanceof Error ? error.stack : undefined;
  sanitized.stack = redactStack(originalStack, `${name}: ${message}`);
  return sanitized;
}
