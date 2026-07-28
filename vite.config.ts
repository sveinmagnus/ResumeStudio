/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Asset URLs must be absolute: with a relative base, a hard load of a deep
  // route (/r/:id — bookmark or reload) resolves ./assets/* against /r/, the
  // SPA catch-all answers HTML, and strict MIME checking refuses to boot the
  // app. Both the VPS and desktop builds serve the client at the origin root,
  // so '/' is correct everywhere. (Caught by e2e/smoke.spec.ts.)
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    // Default env is node; component tests opt into jsdom via the
    // `@vitest-environment jsdom` pragma (see tests/components/*.test.tsx).
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // The jsdom component tests (live-preview iframe, large editors) can take
    // several seconds under full-suite parallelism on slower machines; the
    // default 5s per-test timeout flakes there. 15s is comfortably above the
    // real worst case without masking a genuine hang.
    testTimeout: 15000,
    /**
     * Cap worker concurrency.
     *
     * Vitest defaults to one worker per core. On a 12-core machine that put
     * ~370s of jsdom environment setup against ~100s of wall clock, and the
     * heavier component tests missed even the raised 15s budget — the suite
     * failed intermittently with a DIFFERENT test each run (ResumeViewsEditor's
     * pop-out, Autocomplete's debounce), every one of which passed in
     * isolation. That is contention, not a bad test.
     *
     * 4 is green repeatedly here and costs ~30% wall clock (≈130s vs ≈100s) —
     * a good trade for a suite you can believe. CI runners with fewer cores
     * were never over-subscribed and are unaffected (this is a ceiling, not a
     * floor).
     */
    maxWorkers: 4,
    /**
     * Undo spies and env stubs between tests automatically, rather than relying
     * on every file remembering an afterEach.
     *
     * 23 files use `vi.spyOn`; three of them never restored — and one
     * (ImportScreen) left `HTMLInputElement.prototype.click` permanently
     * neutered for every later test in the file, which is the kind of thing
     * that silently passes until a new test depends on a real click.
     *
     * Both options run before each test, so a `beforeEach` that installs a spy
     * (exporter.test.ts) still works. No spy is installed in `beforeAll`, so
     * nothing depends on one surviving between tests.
     */
    restoreMocks: true,
    unstubEnvs: true,
    // Registers @testing-library/jest-dom matchers on Vitest's `expect`.
    // Safe to load in either env — registration has no DOM-side effects.
    setupFiles: ['tests/setup-rtl.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/components/**/*.{ts,tsx}'],
      reporter: ['text', 'html'],
    },
  },
})
