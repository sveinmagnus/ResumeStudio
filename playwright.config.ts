import { defineConfig } from '@playwright/test'

// E2E smoke suite (roadmap A6): boots the REAL production server (Express
// serving dist/) on a dedicated port with an in-memory DB and drives it with
// a real browser. Requires a fresh `npm run build` first — CI runs it after
// the build step; locally use `npm run test:e2e` (which builds for you).
const PORT = 3210

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false, // one shared server + in-memory DB → run specs serially
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx server/index.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      RESUME_DB_PATH: ':memory:', // fresh, isolated DB per run; nothing touches data/
    },
  },
})
