import { defineConfig } from "@playwright/test";

// UI end-to-end tests. They run against throwaway servers on their own ports
// (in-memory store, rule-based assistant), so they never touch your dev data or MongoDB.
// Uses the system Chrome (`channel: "chrome"`), so no browser download is needed.
const apiPort = 4311;
const webPort = 4411;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${webPort}`,
    channel: "chrome",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "yarn workspace api start",
      url: `http://localhost:${apiPort}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(apiPort),
        MONGODB_URI: "",
        LLM_PROVIDER: "rules",
        JWT_SECRET: "playwright-secret-playwright-secret-123456",
        NODE_ENV: "test",
        CLIENT_URL: `http://localhost:${webPort}`
      }
    },
    {
      command: `yarn workspace web vite --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      env: { VITE_API_BASE_URL: `http://localhost:${apiPort}/api` }
    }
  ]
});
