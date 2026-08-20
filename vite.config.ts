import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
// `vitest/config` rather than `vite` so the test block is typed without the
// triple-slash reference; `Plugin` still comes from vite, for the shell worker.
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** The document `src/sw.js` falls back to for every navigation. */
const SHELL_DOCUMENT = '/index.html'

/** The subset of a bundle entry `shellUrls` reads. */
interface ShellBundleEntry {
  type?: string
  fileName?: string
  isEntry?: boolean
  imports?: readonly string[]
  viteMetadata?: { importedCss?: Iterable<string> }
}

/**
 * The service worker's precache list: the shell document, every entry chunk
 * plus the closure of its STATIC imports, their CSS, and the self-hosted fonts.
 *
 * Static imports only is the whole rule. `dynamicImports` is never followed, so
 * pdfmake, the DOCX exporter and pdfmake's per-family font modules — around
 * 2 MB between them — stay out of the cache by construction rather than by an
 * exclusion list that a renamed chunk would slip past. Exports are online-only.
 */
export function shellUrls(
  bundle: Record<string, ShellBundleEntry>,
  fonts: readonly string[],
): string[] {
  const entries = Object.values(bundle)
  const byFileName = new Map(entries.map((entry) => [entry.fileName ?? '', entry]))

  const js = new Set<string>()
  const css = new Set<string>()
  const walk = (fileName: string) => {
    if (js.has(fileName)) return
    const chunk = byFileName.get(fileName)
    if (!chunk || chunk.type !== 'chunk') return
    js.add(fileName)
    for (const sheet of chunk.viteMetadata?.importedCss ?? []) css.add(sheet)
    for (const dep of chunk.imports ?? []) walk(dep)
  }
  for (const entry of entries) {
    if (entry.type === 'chunk' && entry.isEntry && entry.fileName) walk(entry.fileName)
  }

  return [
    SHELL_DOCUMENT,
    ...[...js].sort().map((f) => `/${f}`),
    ...[...css].sort().map((f) => `/${f}`),
    ...[...fonts].sort().map((f) => `/fonts/${f}`),
  ]
}

/**
 * Emits `dist/sw.js` — `src/sw.js` with the build's precache list prepended.
 *
 * The version stamp is a hash of that list, because a browser reinstalls a
 * worker only when the worker's own bytes change: derived from anything else, a
 * deploy whose chunk hashes moved would leave the previous shell precached
 * behind an identical file.
 */
function shellServiceWorker(): Plugin {
  const root = import.meta.dirname
  return {
    name: 'resume-studio:shell-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const fonts = readdirSync(path.join(root, 'public', 'fonts')).filter((f) => f.endsWith('.woff2'))
      const shell = shellUrls(bundle, fonts)
      const version = createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 12)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `self.__SW_VERSION__ = ${JSON.stringify(version)}\n`
          + `self.__SHELL__ = ${JSON.stringify(shell)}\n`
          + readFileSync(path.join(root, 'src', 'sw.js'), 'utf8'),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), shellServiceWorker()],
  // Asset URLs must be absolute: with a relative base, a hard load of a deep
  // route (/r/:id — bookmark or reload) resolves ./assets/* against /r/, the
  // SPA catch-all answers HTML, and strict MIME checking refuses to boot the
  // app. Both the VPS and desktop builds serve the client at the origin root,
  // so '/' is correct everywhere. (Caught by e2e/smoke.spec.ts.)
  base: '/',
  server: {
    proxy: {
      '/api': {
        // Kept in step with scripts/dev-server.mjs, which pins the API port to
        // the same variable. Deliberately NOT `PORT`: launchers inject that to
        // choose the CLIENT's port, and having both processes read it is what
        // made the dev API unreachable from the in-app browser preview.
        target: `http://localhost:${process.env.RESUME_SERVER_PORT ?? 3001}`,
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
      /**
       * A ratchet, not a target.
       *
       * Each number sits a point or two BELOW what the suite actually achieves
       * today, so the gate fires on decay rather than on noise. Raise them when
       * coverage genuinely improves; do not lower them to make a red build
       * green — that is the one move that turns this into decoration.
       *
       * `src/lib` is held to a much higher bar than the global figure because
       * it is the pure logic: importers, exporters, the merge engine, the view
       * filter. It is cheap to test and expensive to get wrong. Components are
       * deliberately not chased to the same number — they are also covered by
       * the Playwright suite and the jest-axe pass, and tests written purely to
       * move a component coverage number tend to assert that render() rendered.
       */
      thresholds: {
        // Raised after the mutation-guided test pass (Aug 2026), which added
        // ~440 assertions and measured 78.61 / 71.03 / 70.48 / 81.56. These sit
        // just under that, as before — and under today's figure, since six more
        // modules gained tests after the measurement. Branches moved most,
        // which is what a pass spent on boundaries and drop paths should do.
        statements: 78,
        branches: 70,
        functions: 70,
        lines: 81,
        // Left where they were: `npm run test:coverage` prints no table on a
        // failing run, and this suite's heaviest jsdom file exceeds the 15s
        // per-test timeout under v8 instrumentation on a loaded machine, so
        // the per-directory figure could not be re-measured honestly. Raise
        // these from a green CI coverage run rather than from a guess.
        'src/lib/**/*.ts': {
          statements: 86,
          branches: 75,
          functions: 88,
          lines: 89,
        },
      },
    },
  },
})
