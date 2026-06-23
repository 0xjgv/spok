import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

// Mock posthog-node before importing the module
vi.mock('posthog-node', () => {
  return {
    // Use a function (not an arrow) so `new PostHog()` records the instance on
    // `this`, making it readable via `PostHog.mock.results[].value`.
    PostHog: vi.fn().mockImplementation(function (this: any) {
      this.capture = vi.fn();
      this.captureException = vi.fn();
      this.shutdown = vi.fn().mockResolvedValue(undefined);
    }),
  };
});

// Import after mocking
import { isTelemetryEnabled, maybeShowTelemetryNotice, shutdown, trackCommand, trackError } from '../../src/telemetry/index.js';
import { PostHog } from 'posthog-node';

describe('telemetry/index', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;

  beforeEach(() => {
    // Create unique temp directory for each test using UUID
    tempDir = path.join(os.tmpdir(), `spok-telemetry-test-${randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Save original env
    originalEnv = { ...process.env };

    // Mock HOME to point to temp dir
    process.env.HOME = tempDir;

    // Clear all mocks
    vi.clearAllMocks();

    // Re-establish the PostHog mock implementation. afterEach's
    // restoreAllMocks() strips the vi.mock factory implementation, so without
    // this the constructor would be a no-op in later tests.
    (PostHog as any).mockImplementation(function (this: any) {
      this.capture = vi.fn();
      this.captureException = vi.fn();
      this.shutdown = vi.fn().mockResolvedValue(undefined);
    });

    // Spy on console.log for notice tests
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(async () => {
    // Restore original env
    process.env = originalEnv;

    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    await shutdown();

    // Restore all mocks
    vi.restoreAllMocks();
  });

  describe('isTelemetryEnabled', () => {
    it('should return false when SPOK_TELEMETRY=0', () => {
      process.env.SPOK_TELEMETRY = '0';
      expect(isTelemetryEnabled()).toBe(false);
    });

    it('should return false when DO_NOT_TRACK=1', () => {
      process.env.DO_NOT_TRACK = '1';
      expect(isTelemetryEnabled()).toBe(false);
    });

    it('should return false when CI=true', () => {
      process.env.CI = 'true';
      expect(isTelemetryEnabled()).toBe(false);
    });

    it('should return true when no opt-out is set', () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;
      expect(isTelemetryEnabled()).toBe(true);
    });

    it('should prioritize SPOK_TELEMETRY=0 over other settings', () => {
      process.env.SPOK_TELEMETRY = '0';
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;
      expect(isTelemetryEnabled()).toBe(false);
    });
  });

  describe('maybeShowTelemetryNotice', () => {
    it('should not show notice when telemetry is disabled', async () => {
      process.env.SPOK_TELEMETRY = '0';

      await maybeShowTelemetryNotice();

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('trackCommand', () => {
    it('should not track when telemetry is disabled', async () => {
      process.env.SPOK_TELEMETRY = '0';

      await trackCommand('test', '1.0.0');

      expect(PostHog).not.toHaveBeenCalled();
    });

    it('should track when telemetry is enabled', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;

      await trackCommand('test', '1.0.0');

      expect(PostHog).toHaveBeenCalled();
    });

    it('should construct PostHog with bounded silent-failure settings', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;

      await trackCommand('test', '1.0.0');

      expect(PostHog).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          host: 'https://edge.spok.dev',
          flushAt: 1,
          flushInterval: 0,
          fetchRetryCount: 0,
          requestTimeout: 1000,
          preloadFeatureFlags: false,
          disableRemoteConfig: true,
          disableSurveys: true,
          fetch: expect.any(Function),
        })
      );
    });

    it('should return a synthetic success response when fetch throws a network error', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;
      await trackCommand('test', '1.0.0');

      const fetchFn = (PostHog as any).mock.calls[0][1].fetch as typeof fetch;
      fetchSpy.mockRejectedValueOnce(new Error('network down'));

      const response = await fetchFn('https://edge.spok.dev/batch/', { method: 'POST' });

      expect(response.status).toBe(204);
    });

    it('should return a synthetic success response when fetch aborts', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;
      await trackCommand('test', '1.0.0');

      const fetchFn = (PostHog as any).mock.calls[0][1].fetch as typeof fetch;
      fetchSpy.mockRejectedValueOnce(new DOMException('This operation was aborted', 'AbortError'));

      const response = await fetchFn('https://edge.spok.dev/batch/', { method: 'POST' });

      expect(response.status).toBe(204);
    });

    it('should return a synthetic success response for non-2xx responses', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;
      await trackCommand('test', '1.0.0');

      const fetchFn = (PostHog as any).mock.calls[0][1].fetch as typeof fetch;
      fetchSpy.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

      const response = await fetchFn('https://edge.spok.dev/batch/', { method: 'POST' });

      expect(response.status).toBe(204);
    });

    it('should pass through successful responses from fetch', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;
      await trackCommand('test', '1.0.0');

      const fetchFn = (PostHog as any).mock.calls[0][1].fetch as typeof fetch;
      const expectedResponse = new Response(null, { status: 200 });
      fetchSpy.mockResolvedValueOnce(expectedResponse);

      const response = await fetchFn('https://edge.spok.dev/batch/', { method: 'POST' });

      expect(response).toBe(expectedResponse);
    });
  });

  describe('trackError', () => {
    it('should not track when telemetry is disabled', async () => {
      process.env.SPOK_TELEMETRY = '0';

      await trackError('test', '1.0.0', new Error('boom'));

      expect(PostHog).not.toHaveBeenCalled();
    });

    function lastClient(): any {
      return (PostHog as any).mock.results.at(-1).value;
    }

    it('should capture a sanitized exception with classification properties', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;

      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${process.env.HOME}/secret.txt missing`);
      err.code = 'ENOENT';

      await trackError('init', '1.2.3', err);

      const instance = lastClient();
      expect(instance.captureException).toHaveBeenCalledTimes(1);

      const [sentError, distinctId, props] = instance.captureException.mock.calls[0];
      expect(distinctId).toEqual(expect.any(String));
      expect(props).toMatchObject({
        command: 'init',
        version: '1.2.3',
        surface: 'cli',
        error_name: 'Error',
        error_code: 'ENOENT',
        error_kind: 'user_error',
        $ip: null,
      });
      // Sanitized: the raw message and home path must not leak.
      expect(sentError.message).toBe('Error [ENOENT]');
      expect(sentError.message).not.toContain('secret.txt');
    });

    it('should classify programmer errors as crashes', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;

      await trackError('flow:next', '1.0.0', new TypeError('x is not a function'));

      expect(lastClient().captureException.mock.calls[0][2].error_kind).toBe('crash');
    });

    it('should honor a kind override for uncaught failures', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;

      // A plain Error would classify as user_error; the override forces crash.
      await trackError('init', '1.0.0', new Error('boom'), 'crash');

      expect(lastClient().captureException.mock.calls[0][2].error_kind).toBe('crash');
    });
  });

  describe('shutdown', () => {
    it('should not throw when no client exists', async () => {
      await expect(shutdown()).resolves.not.toThrow();
    });

    it('should handle shutdown errors silently', async () => {
      const mockPostHog = {
        capture: vi.fn(),
        shutdown: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      (PostHog as any).mockImplementation(() => mockPostHog);

      await expect(shutdown()).resolves.not.toThrow();
    });
  });
});
