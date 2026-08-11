import { defineConfig, devices } from '@playwright/test'

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

  /**
   * Three engines, because the two things this suite actually guards are both
   * engine-specific.
   *
   * The export flow runs a ~350 kB dynamic import and a Blob download; the
   * editor is built on contentEditable + execCommand, whose behaviour differs
   * more between WebKit and Chromium than anything else in the app. Testing
   * only Chromium tests the one engine least likely to surprise us — and the
   * desktop build opens the user's default browser, which on macOS is Safari.
   *
   * The same seven specs run on each: they are thin happy paths, so triple is
   * still under a minute and a half.
   *
   * WINDOWS: keep the browsers OUT of %LOCALAPPDATA% — set
   * PLAYWRIGHT_BROWSERS_PATH to a plain path and install there. Firefox alone
   * resolves a private side-by-side assembly (`mozglue`), and SxS probing does
   * not follow MSIX file-system redirection, so under a packaged app — whose
   * %LOCALAPPDATA% maps into its own LocalCache — the launch dies at
   * `spawn UNKNOWN` with "Dependent Assembly mozglue could not be found" while
   * the identical binary runs from its un-redirected path. Chromium and WebKit
   * declare no private assemblies and pass either way, so dropping the firefox
   * project would hide that misconfiguration instead of fixing it.
   */
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
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
