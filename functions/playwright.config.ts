import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src/__tests__/bdd",
  testMatch: "**/*.spec.ts",
  // We run tests sequentially because they share the same 'test-id' business in the emulator
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api",
    extraHTTPHeaders: {
      "Accept": "application/json",
    },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /setup\.spec\.ts/,
    },
    {
      name: "bdd",
      testMatch: /.*(?<!setup)\.spec\.ts/,
      dependencies: ["setup"],
    },
  ],
  /* webServer: {
    command: "npm run serve",
    url: "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api/health",
    timeout: 180 * 1000, // 3 minutes
    reuseExistingServer: !process.env.CI,
  }, */
});
