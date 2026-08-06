/**
 * Unit/integration Vitest runs: use emulator-style Admin init (no service-account PEM parse).
 * Local `serve:local` and deployed functions do not set FUNCTIONS_EMULATOR.
 */
if (!process.env.FUNCTIONS_EMULATOR) {
  process.env.FUNCTIONS_EMULATOR = "true";
}

/**
 * River AI kill switch defaults ON in process code (`!== "0"`).
 * Tests expect tools/buddy available unless a case explicitly opts into maintenance.
 */
if (process.env.SMARTREFILL_AI_MAINTENANCE === undefined) {
  process.env.SMARTREFILL_AI_MAINTENANCE = "0";
}

/**
 * Keep supertest in-memory requests off corporate/VPN HTTP proxies.
 * Proxies can return non-HTTP payloads (e.g. {"type":"tier1","version":"1.0"}).
 */
const proxyKeys = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

for (const key of proxyKeys) {
  delete process.env[key];
}
