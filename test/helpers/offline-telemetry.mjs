// Test preload (`node --import`) for CLI subprocesses that run with telemetry
// ENABLED.
//
// Why: `spok` flushes analytics to the production PostHog endpoint
// (https://edge.spok.dev) on every command via the postAction `shutdown()`
// hook. That outbound request is not bounded by a working timeout and blocks
// ~7s per spawn, which pushes telemetry-enabled CLI tests past vitest's 10s
// `testTimeout` under parallel load and makes the suite flaky.
//
// This preload keeps telemetry logically enabled (so first-run/notice behavior
// is still exercised) but neutralizes the real network egress: any request to
// the telemetry host resolves instantly with a 204. Other hosts pass through
// untouched, so a genuine `fetch` in a future command stays observable.
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  if (url.includes('spok.dev') || url.includes('posthog')) {
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  return realFetch(input, init);
};
