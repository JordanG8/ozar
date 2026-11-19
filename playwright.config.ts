import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 75_000,
  workers: 1,
  reporter: "line",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4280" },
  webServer: {
    command: "node e2e/fixtures/server.mjs",
    url: "http://127.0.0.1:4280/?menu=1",
    reuseExistingServer: false,
    timeout: 45_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
