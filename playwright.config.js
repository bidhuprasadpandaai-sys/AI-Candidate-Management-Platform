import os from "node:os";
import path from "node:path";
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
  workers: 1, // tests share one server and one in-memory database
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
        // Emails go to a fake SMTP server that the tests start themselves (see e2e/roles-otp.spec.js).
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "4325",
        EMAIL_FROM: "TalentOS <no-reply@example.com>",
        ADMIN_EMAILS: "",
        DEFAULT_ROLE: "",
        AUTH_RATE_LIMIT: "1000",
        RESUME_STORAGE_DIR: path.join(os.tmpdir(), "acmp-playwright-resumes"),
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
