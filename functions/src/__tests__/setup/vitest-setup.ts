/**
 * Unit/integration Vitest runs: use emulator-style Admin init (no service-account PEM parse).
 * Local `serve:local` and deployed functions do not set FUNCTIONS_EMULATOR.
 */
if (!process.env.FUNCTIONS_EMULATOR) {
  process.env.FUNCTIONS_EMULATOR = "true";
}

/**
 * Keep supertest in-memory requests off corporate/VPN HTTP proxies.
 * Proxies can return non-HTTP payloads (e.g. {"type":"Tier1","version":"1.0"}).
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
