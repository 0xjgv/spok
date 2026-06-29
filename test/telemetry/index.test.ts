import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

// Mock posthog-node before importing the module
vi.mock('posthog-node', () => {
  return {
    PostHog: vi.fn().mockImplementation(function () {
      const client = {
        capture: (payload: unknown) => {
          const key = Symbol.for('spok.test.posthog.captureCalls');
          ((globalThis as any)[key] ??= []).push(payload);
        },
        shutdown: vi.fn().mockResolvedValue(undefined),
      };
      const key = Symbol.for('spok.test.posthog.clients');
      ((globalThis as any)[key] ??= []).push(client);
      return client;
    }),
  };
});

function posthogClients(): Array<{
  capture: (payload: unknown) => void;
  shutdown: ReturnType<typeof vi.fn>;
}> {
  const key = Symbol.for('spok.test.posthog.clients');
  return ((globalThis as any)[key] ??= []);
}

function posthogCaptureCalls(): unknown[] {
  const key = Symbol.for('spok.test.posthog.captureCalls');
  return ((globalThis as any)[key] ??= []);
}

// Import after mocking
import {
  isTelemetryEnabled,
  maybeShowTelemetryNotice,
  shutdown,
  trackCommand,
  trackTelemetryEvent,
} from '../../src/telemetry/index.js';
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
    posthogClients().length = 0;
    posthogCaptureCalls().length = 0;

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

    it('should track redacted CLI events when telemetry is enabled', async () => {
      delete process.env.SPOK_TELEMETRY;
      delete process.env.DO_NOT_TRACK;
      delete process.env.CI;

      await trackTelemetryEvent('cli_help_checked', '1.0.0', {
        command: 'flow complete',
        invocation: 'help_option',
      });

      expect(posthogCaptureCalls()).toContainEqual({
        distinctId: expect.any(String),
        event: 'cli_help_checked',
        properties: {
          command: 'flow complete',
          invocation: 'help_option',
          version: '1.0.0',
          surface: 'cli',
          $ip: null,
        },
      });
    });

    it('should not track redacted CLI events when telemetry is disabled', async () => {
      process.env.SPOK_TELEMETRY = '0';

      await trackTelemetryEvent('cli_invalid_invocation', '1.0.0', {
        command: 'flow <unknown>',
        code: 'unknown_flow_subcommand',
      });

      expect(PostHog).not.toHaveBeenCalled();
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

  describe('shutdown', () => {
    it('should not throw when no client exists', async () => {
      await expect(shutdown()).resolves.toBeUndefined();
    });

    it('should handle shutdown errors silently', async () => {
      const mockPostHog = {
        capture: vi.fn(),
        shutdown: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      (PostHog as any).mockImplementation(() => mockPostHog);

      await expect(shutdown()).resolves.toBeUndefined();
    });
  });
});
