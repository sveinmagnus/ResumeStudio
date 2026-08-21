#!/usr/bin/env node
/**
 * Incremental mutation testing — one source file at a time.
 *
 * A plain `stryker run` is unusable here, and the reason is the DRY RUN: before
 * trying a single mutant, Stryker executes the whole test suite once per runner
 * process to learn which tests cover what. This suite is ~6,900 tests, so that
 * alone blew past Stryker's timeout and the run died having measured nothing.
 * Raising the timeout only converts a crash into a long wait.
 *
 * The fix is to stop making it read the whole suite. This runs Stryker once per
 * source file against ONLY the tests that exercise it — its own
 * `tests/x.test.ts` where that exists, plus whichever test files import it. The
 * dry run drops from minutes to about a second, and the mutants that survive are
 * the ones those tests should have killed.
 *
 * SCOPE: `src/lib/**` and `server/**`. Both are logic whose failure is silent —
 * in src/lib a wrong branch is a data defect, in server/ it is a wrong answer to
 * "may this person read this row" (access.ts, db.ts), a credential that verifies
 * when it should not (passwords.ts, csrf.ts, auth.ts), or two machines deleting
 * each other's work (backupFiles.ts). Components stay out: mutating one mostly
 * proves that a rendered string changed, which the RTL suite already asserts.
 *
 * The module list is READ OFF DISK every run — there is no checked-in list to
 * fall out of date — and anything no test touches is reported by name rather
 * than quietly left out of the numbers.
 *
 * Modules are keyed by PATH (`lib/richText`, `server/access`,
 * `server/routes/users`), never by basename. Three basenames collide between
 * src/lib and server (backup, glossary, storage) and six more collide inside
 * server itself (auth, backup, llm, settings, summarize, translate), so a
 * basename key would have had two modules overwriting each other's score and
 * mutant detail with no sign that anything was wrong.
 *
 * Properties that matter, each learned the hard way:
 *  - **One file per process.** A crash costs that file, not the run.
 *  - **A hard per-file timeout.** Nothing hangs the batch.
 *  - **Results are written after EVERY file.** A batch interrupted halfway
 *    still leaves everything it measured — the earlier whole-directory attempts
 *    produced nothing at all when they died.
 *  - **Resumable, including a --force sweep.** A plain run measures what has no
 *    result. A whole-tree `--force` starts a SWEEP, which records what it has
 *    finished, so a plain run continues an interrupted one rather than finding
 *    the not-yet-reached modules still holding the previous run's results and
 *    concluding there is nothing to do. `--from` starts at a given module.
 *  - **The surviving mutants are kept, not just the score.** Stryker's json
 *    report lands in reports/mutation/files/<name>.json per file. A score of
 *    62% tells you nothing you can act on; the mutant list is the actual
 *    output, and the first full run produced only the score.
 *
 * Usage:
 *   node scripts/mutation-run.mjs                 # every module with a test
 *   node scripts/mutation-run.mjs richText access # just these (bare name is fine
 *                                                 #   when it is unambiguous;
 *                                                 #   otherwise server/backup)
 *   node scripts/mutation-run.mjs --limit 10      # the next 10 unmeasured
 *   node scripts/mutation-run.mjs --force         # re-measure everything (a sweep)
 *   node scripts/mutation-run.mjs                 # …and this resumes that sweep
 *   node scripts/mutation-run.mjs --from 52       # start at the 52nd queued
 *   node scripts/mutation-run.mjs --from lib/api  # …or name it
 *   node scripts/mutation-run.mjs --force server/db --budget 20
 *                                                 # a true figure for a module
 *                                                 #   the default budget caps
 *   node scripts/mutation-run.mjs --report        # print what's been measured
 *   node scripts/mutation-run.mjs --survivors x   # print x's UNKILLED mutants
 *   node scripts/mutation-run.mjs --survivors --skip StringLiteral
 *                                                 # …minus the prompt wording
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const REPORT = path.join(ROOT, 'reports', 'mutation', 'summary.json')
/** A module key contains slashes; flatten so the detail stays one flat directory. */
const reportName = (key) => key.replace(/\//g, '__')
/** Per-file mutant detail, written by Stryker's own json reporter. */
const detailPath = (key) => path.join(ROOT, 'reports', 'mutation', 'files', `${reportName(key)}.json`)
/**
 * Generous on purpose: richText measures ~1,995s (33 min), so anything near the
 * half-hour mark is already too tight. A file that trips the timeout is recorded
 * as an error and loses its mutant detail, so the ceiling has to sit clear of
 * the worst real file rather than near it.
 */
const PER_FILE_TIMEOUT_MS = 60 * 60 * 1000

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const reportOnly = argv.includes('--report')
const survivorsOnly = argv.includes('--survivors')
const limitIdx = argv.indexOf('--limit')
const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : Infinity
/**
 * `--from 52` or `--from lib/anonCheck` — start the queue at that module.
 *
 * For the module that hangs, or the one a crash landed on: everything before it
 * keeps its result, and the run picks up from there rather than being restarted
 * whole. A position is 1-based and refers to the queue this run prints, which
 * is why a NAME is the stable way to say it.
 */
const fromIdx = argv.indexOf('--from')
const from = fromIdx >= 0 ? String(argv[fromIdx + 1] ?? '') : ''
/**
 * `--budget 20` — raise the per-tier ceiling on how many test files one module
 * may be measured against.
 *
 * The default exists so a whole-tree run terminates, and the run summary names
 * every module that hit it. But the cut within a tier is alphabetical, which is
 * arbitrary: `server/db` is reached by 17 suites, takes 8, and the ones it
 * drops include `scoping.test.ts` — the route × role matrix, i.e. exactly the
 * suite that exercises the authorization rule this module turns into SQL. Its
 * number is therefore not what a reader assumes it is.
 *
 * Rather than guess at a better ranking, this makes the true figure obtainable
 * for one module at a time: `--force server/db --budget 20`. Slow on purpose,
 * which is why it is not the default.
 */
const budgetIdx = argv.indexOf('--budget')
const budgetOverride = budgetIdx >= 0 ? Number(argv[budgetIdx + 1]) : null
/**
 * `--skip StringLiteral,Regex` hides those mutators from a --survivors listing.
 *
 * The audit still RECORDS them — this filters the reading, not the run. That
 * matters: a big share of the surviving mutants in the prompt-building modules
 * are the wording of instructions to a model, which no test should pin, and
 * they bury the conditionals worth acting on. Muting them in the source with
 * `// Stryker disable` would hide them permanently, including from a future
 * reader checking whether an assertion that DOES exist has since been deleted.
 */
const skipIdx = argv.indexOf('--skip')
const skipMutators = new Set(
  skipIdx >= 0 ? String(argv[skipIdx + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [],
)
const names = argv.filter((a, i) => !a.startsWith('--')
  && !(limitIdx >= 0 && i === limitIdx + 1)
  && !(skipIdx >= 0 && i === skipIdx + 1)
  && !(fromIdx >= 0 && i === fromIdx + 1)
  && !(budgetIdx >= 0 && i === budgetIdx + 1))

/**
 * Every mutable module, read off disk each run — never a checked-in list.
 *
 * Keys are paths (`lib/richText`, `server/routes/users`); see the header for the
 * nine basename collisions that forces.
 */
function sourceModules() {
  const out = []
  const walk = (dir, prefix) => {
    const entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (e.isDirectory()) { walk(`${dir}/${e.name}`, `${prefix}/${e.name}`); continue }
      if (!e.name.endsWith('.ts') || e.name.endsWith('.d.ts') || e.name.endsWith('.test.ts')) continue
      out.push({ key: `${prefix}/${e.name.replace(/\.ts$/, '')}`, file: `${dir}/${e.name}` })
    }
  }
  walk('src/lib', 'lib')
  walk('server', 'server')
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

const moduleKeys = () => sourceModules().map((m) => m.key)
const fileFor = (key) => sourceModules().find((m) => m.key === key)?.file
const baseOf = (key) => key.slice(key.lastIndexOf('/') + 1)

/**
 * Which supertest files exercise a route module.
 *
 * A route file is almost never imported by a test — the suites drive it through
 * `createApp()` and a URL. The import scan therefore finds nothing, and would
 * report `server/routes/users.ts` (573 lines, the largest module the accounts
 * work added) as having no test at all, which is the opposite of true.
 *
 * The link between them is the mount path, and app.ts is where it is declared.
 * Parsed rather than listed here, so a route mounted tomorrow is picked up
 * without anyone remembering this file: `import xRouter from './routes/x.js'`
 * gives the module, `app.use('/api/…', …, xRouter)` gives its prefix, and a
 * test that boots the app and mentions that prefix is a test of that route.
 */
let mounts = null
function routeMounts() {
  if (mounts) return mounts
  const text = readFileSync(path.join(ROOT, 'server', 'app.ts'), 'utf8')
  const byIdent = new Map()
  for (const m of text.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([\w-]+)\.js'/g)) {
    byIdent.set(m[1], `server/routes/${m[2]}`)
  }
  mounts = new Map()
  for (const m of text.matchAll(/app\.use\(\s*'(\/api\/[\w-]*)'([^\n]*)/g)) {
    const idents = new Set(m[2].split(/[^\w]+/))
    for (const [ident, key] of byIdent) {
      if (idents.has(ident)) mounts.set(key, m[1])
    }
  }
  return mounts
}

/**
 * Test files that must never enter a mutation test set.
 *
 * `loginTimingRevealsALockedAccount` decides pass/fail from wall clock. A
 * mutation run is the one place that means nothing: the code is instrumented,
 * two runners compete for the same cores, and the mutant may have removed the
 * derivation being timed. The dangerous direction is a FALSE KILL — noise trips
 * the ratio, Stryker records the mutant as caught, and the report claims an
 * assertion nobody wrote, which is worse than no report.
 *
 * `vitest.mutation.config.ts` drops the same file for a bare `npx stryker run`.
 * One reason, two entry points.
 */
const NEVER_MEASURE_WITH = new Set(['tests/server/loginTimingRevealsALockedAccount.test.ts'])

/** Every tests/**\/*.test.ts(x), with its text — walked once per process. */
let testFiles = null
function allTestFiles() {
  if (testFiles) return testFiles
  const out = []
  const walk = (rel) => {
    for (const e of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`
      if (e.isDirectory()) walk(child)
      else if (/\.test\.tsx?$/.test(e.name)) out.push({ path: child, text: readFileSync(path.join(ROOT, child), 'utf8') })
    }
  }
  walk('tests')
  testFiles = out
  return out
}

/**
 * How many test files one module may be measured against — a budget on COST,
 * not on count.
 *
 * A flat six-file ceiling under-measured exactly the modules the whole suite
 * leans on: `viewFilter` is imported by 18 node test files and was measured
 * against 6 of them. Same for `locales`, `viewStyle` and `viewHeader`, all of
 * whose importers are cheap.
 *
 * Measured, so nobody has to guess at the payoff: widening viewFilter from 6 to
 * 19 files moved its score to 84.8% and removed ONE actionable survivor (28 →
 * 27). Most of what the extra suites killed was StringLiteral wording, which a
 * reader filters out anyway. The value here is that the number now means what it
 * says — not that it moves a lot.
 *
 * What made the ceiling necessary was never the number of files — it was the
 * jsdom ones. Stryker re-runs the covering tests per surviving mutant, and a
 * component suite that mounts React costs one to two orders of magnitude more
 * per run than a node suite. So: every cheap importer is included, and only the
 * expensive ones are rationed. `coverageAnalysis: perTest` means the extra
 * cheap files cost one dry run, not a re-run per mutant.
 */
const MAX_COMPONENT_TEST_FILES = budgetOverride ?? 2
/**
 * Adding server/ needed a THIRD tier, not a second use of the second.
 *
 * `tests/server/` was priced as "expensive" only to break ties against the
 * root-level lib suites. Against a server module it is the ONLY kind of test
 * there is, so a ceiling of two would have measured access.ts against two of
 * the eight suites that exercise it and reported the rest of its mutants as
 * survivors. Supertest over an in-memory DB is genuinely cheaper than mounting
 * React, but a login suite pays for scrypt on nearly every request, so it is
 * rationed too — just far higher.
 */
const MAX_SERVER_TEST_FILES = budgetOverride ?? 8
/** A backstop for a module half the suite imports, so a run still terminates. */
const MAX_TEST_FILES = budgetOverride !== null ? Math.max(24, budgetOverride) : 24

/** Modules whose importer list was truncated this run (see testsFor). */
const capped = new Set()

/**
 * The test files that exercise a module: its own same-name test FIRST
 * (tests/<base>.test.ts for lib, tests/server/<base>.test.ts for server), then
 * whichever other test files import it — or, for a route, drive it by URL.
 *
 * Both halves matter, for opposite reasons.
 *
 * The same-name test is what makes a run cheap, and 27 of the 101 lib modules
 * have none (the whole advanced-assist family: cvReview, jobFit, atsAudit, …).
 * Measuring only same-name tests skipped those SILENTLY — a "full" run
 * reported 74 files and never mentioned the 27 it had not touched.
 *
 * The importers matter because a mutant killed by a DIFFERENT suite was being
 * reported as surviving. Most of cefr's 143 "survivors" and most of locales'
 * 245 are label tables that tests/localeCoverage.test.ts covers completely —
 * the run just never loaded it. Reading that report meant re-deriving, by
 * hand, which entries were real; this makes the number mean what it says.
 */
/**
 * Roughly what a test file costs to run, so the MAX_TEST_FILES budget is spent
 * on cheap files first.
 *
 * A jsdom component test is one to two orders of magnitude slower than a node
 * one: it mounts React, and the heaviest of them (ResumeViewsEditor, which
 * drives the live preview) takes ~50s on its own. Stryker re-runs the covering
 * tests once per surviving mutant, so a single such file inside the cut is the
 * difference between a module finishing and a module timing out — which is
 * exactly what happened to viewFilter, whose 739 mutants were being measured
 * against the slowest file in the suite because it sorted sixth by path.
 *
 * Cheap files also lose nothing in coverage terms: an importer that mounts a
 * component touches a lib module incidentally, while a node test that imports
 * it is usually asserting on it directly.
 */
function testCost(p) {
  if (p.startsWith('tests/components/')) return 2
  if (p.startsWith('tests/server/')) return 1
  return 0
}

function testsFor(key) {
  const base = baseOf(key)
  /*
   * The same-name test, and NOT `tests/server/<base>.test.ts` for a route.
   *
   * Six basenames exist in both server/ and server/routes/ (auth, backup, llm,
   * settings, summarize, translate), so for a route that path names the suite
   * for a DIFFERENT module. The keys were made path-shaped to fix exactly this
   * collision and this lookup was left behind: server/routes/summarize was
   * measured against server/summarize.ts's suite alone and died with "No tests
   * were executed", while routes/auth and routes/settings quietly carried an
   * unrelated suite into their numbers.
   *
   * The house convention is `<name>Routes.test.ts`, but it is not derivable in
   * every case (routes/users is covered by userRoutes.test.ts, singular), so
   * where there is no match the mount scan below is what finds the coverage.
   */
  const own = (key.startsWith('server/routes/')
    ? [`tests/server/${base}Routes.test.ts`]
    : key.startsWith('server/')
      ? [`tests/server/${base}.test.ts`]
      : [`tests/${base}.test.ts`, `tests/${base}.test.tsx`])
    .filter((p) => existsSync(path.join(ROOT, p)))
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The key IS the tail of the import specifier, so one pattern serves all
  // three shapes: '…/src/lib/richText', '…/server/access', '…/server/routes/
  // users'. The closing quote is what stops `server/backup` also matching
  // server/backupFiles, backupZip, backupWatcher and the rest.
  const imports = new RegExp(`${escaped}['"]`)
  const mount = routeMounts().get(key)
  const importers = allTestFiles()
    .filter((f) => imports.test(f.text)
      // A route is reached through createApp() and a URL, never an import.
      || (mount !== undefined && f.text.includes('server/app') && f.text.includes(mount)))
    .map((f) => f.path)
    .filter((p) => !own.includes(p) && !NEVER_MEASURE_WITH.has(p))
    // Cheapest first, then by path so the choice is stable between runs.
    .sort((a, b) => testCost(a) - testCost(b) || a.localeCompare(b))

  // Every cheap importer, then as much of each rationed tier as the budget allows.
  const lib = importers.filter((p) => testCost(p) === 0)
  const server = importers.filter((p) => testCost(p) === 1)
  const components = importers.filter((p) => testCost(p) === 2)
  const all = [
    ...own.filter((p) => !NEVER_MEASURE_WITH.has(p)),
    ...lib,
    ...server.slice(0, MAX_SERVER_TEST_FILES),
    ...components.slice(0, MAX_COMPONENT_TEST_FILES),
  ]
  if (server.length > MAX_SERVER_TEST_FILES
    || components.length > MAX_COMPONENT_TEST_FILES
    || all.length > MAX_TEST_FILES) capped.add(key)
  return all.slice(0, MAX_TEST_FILES)
}

/** Modules that can be measured, i.e. some test somewhere touches them. */
function candidates() {
  return moduleKeys().filter((key) => testsFor(key).length > 0)
}

/**
 * Resolve what was typed on the command line to a module key.
 *
 * Bare basenames stay usable — `richText`, `access` — because typing the full
 * key for the ~170 modules that have no twin would be ceremony. The nine that DO
 * have one (backup, glossary and storage across src/lib and server; auth,
 * backup, llm, settings, summarize and translate inside server) are refused
 * with both candidates named, rather than resolved to whichever sorts first
 * and quietly measuring the wrong file.
 */
function resolveName(name) {
  const keys = moduleKeys()
  if (keys.includes(name)) return name
  const hits = keys.filter((k) => baseOf(k) === name)
  if (hits.length === 1) return hits[0]
  console.log(hits.length
    ? `Ambiguous: "${name}" is ${hits.join(' and ')} — name one of them in full.`
    : `Unknown module: "${name}".`)
  return null
}

/**
 * One-time migration of a report written before keys carried paths.
 *
 * Every entry that predates server/ being in scope is a src/lib module, so
 * `richText` maps to `lib/richText` unambiguously. Migrating rather than
 * re-measuring matters because those 105 files cost hours to produce, and the
 * alternative is a resumable runner that silently isn't.
 */
function migrateBareKeys(report) {
  const files = {}
  for (const [k, v] of Object.entries(report.files ?? {})) {
    files[k.includes('/') ? k : `lib/${k}`] = v
  }
  const dir = path.dirname(detailPath('x'))
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.includes('__')) continue
      const key = `lib/${f.replace(/\.json$/, '')}`
      if (fileFor(key)) renameSync(path.join(dir, f), detailPath(key))
    }
  }
  return { ...report, files }
}

const loadReport = () => {
  try { return migrateBareKeys(JSON.parse(readFileSync(REPORT, 'utf8'))) } catch { return { files: {} } }
}
const saveReport = (report) => {
  mkdirSync(path.dirname(REPORT), { recursive: true })
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n')
}

/**
 * Two generated configs per run, both deleted afterwards:
 *
 *  - a vitest config including ONLY this file's own test — what makes the dry
 *    run cheap, and what disables the coverage thresholds (a whole-suite
 *    property; a one-file run always falls short, exits non-zero, and Stryker
 *    reports that as "something went wrong in the initial test run");
 *  - a stryker config pointing at it, because `vitest.configFile` is a config
 *    key with no CLI equivalent.
 */
function writeScopedConfigs(key, tests) {
  // reportName, not the key: a key contains slashes and this is a filename.
  const vitestFile = path.join(ROOT, `vitest.mutation.${reportName(key)}.config.ts`)
  writeFileSync(vitestFile, [
    "/// <reference types=\"vitest\" />",
    "import { defineConfig } from 'vite'",
    "import baseConfig from './vite.config'",
    '',
    '// Generated by scripts/mutation-run.mjs — safe to delete.',
    '//',
    "// Spread, NOT mergeConfig: mergeConfig CONCATENATES arrays, so `include`",
    '// became the base glob PLUS this one file and the dry run still discovered',
    '// all ~161 test files. That silently undid the whole point of the scoped',
    '// config — the run worked, it just took minutes per file instead of',
    '// seconds. Every other setting (plugins, environment, setupFiles,',
    '// testTimeout, maxWorkers) is inherited unchanged; only `include` and',
    '// `coverage` are replaced outright.',
    'export default defineConfig({',
    '  ...baseConfig,',
    '  test: {',
    '    ...baseConfig.test,',
    `    include: [${tests.map((t) => `'${t}'`).join(', ')}],`,
    '    // Replaces the base coverage block entirely, thresholds included: a',
    '    // one-file run can never meet whole-suite thresholds, and the non-zero',
    '    // exit reads as "something went wrong in the initial test run".',
    '    coverage: { enabled: false },',
    '  },',
    '})',
    '',
  ].join('\n'))

  const strykerFile = path.join(ROOT, `stryker.mutation.${reportName(key)}.json`)
  writeFileSync(strykerFile, JSON.stringify({
    packageManager: 'npm',
    testRunner: 'vitest',
    vitest: { configFile: path.basename(vitestFile) },
    // The json report is the only record of WHICH mutants survived. Without it
    // a finished run leaves a score and nothing to act on — you know richText
    // is at 62% and not one thing to write a test about.
    reporters: ['clear-text', 'json'],
    jsonReporter: { fileName: `reports/mutation/files/${reportName(key)}.json` },
    coverageAnalysis: 'perTest',
    mutate: [fileFor(key)],
    // `.claude` is load-bearing, not tidiness: Stryker copies the project into
    // a sandbox per file, and `.claude/worktrees/*` holds full checkouts that
    // OTHER live sessions are editing. A file that vanishes between the scan
    // and the copy fails the whole run with `ENOENT … copyfile`, which is what
    // killed competencyBundles mid-batch. Worktrees are excluded through
    // .git/info/exclude, which Stryker does not read.
    // `data` is the same hazard: a live SQLite DB with WAL files being written.
    // `test-results` is the same class of hazard as the two below, by volume
    // rather than by races: Playwright leaves ~40 MB of traces there, and
    // this config is used once per module, so copying it is gigabytes of
    // pointless I/O across a whole-tree run.
    ignorePatterns: ['dist', 'release', 'release-dist', 'coverage', 'reports', '.stryker-tmp',
      '.claude', 'data', 'test-results', 'playwright-report'],
    concurrency: 2,
    timeoutMS: 60000,
    // A CEILING, not a delay — it costs nothing when the dry run is quick.
    // Five was set when every measurable module was a lib module with one or
    // two node suites. A server module can pull in eight supertest files that
    // each pay for scrypt, and a module that trips this is recorded as an
    // ERROR and loses its mutant detail — the worst outcome for a run left
    // going overnight.
    dryRunTimeoutMinutes: 10,
    thresholds: { high: 80, low: 60, break: null },
  }, null, 2) + '\n')

  return { vitestFile, strykerFile }
}

// Built with fromCharCode so the pattern holds no literal control character
// (which no-control-regex would flag, rightly, in hand-written source).
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const stripAnsi = (s) => s.replace(ANSI, '')

/** Pull the score row out of Stryker's clear-text table. */
function parseScore(output) {
  const line = stripAnsi(output).split('\n').find((l) => /^\s*All files\s*\|/.test(l))
  if (!line) return null
  const c = line.split('|').map((x) => x.trim())
  const num = (i) => (c[i] === undefined || c[i] === '' ? null : Number(c[i]))
  return {
    score: num(1), scoreCovered: num(2), killed: num(3),
    timeout: num(4), survived: num(5), noCoverage: num(6), errors: num(7),
  }
}

/**
 * Failures that say nothing about the tests — the environment moved underneath
 * the run.
 *
 * Both seen in practice, both mid-batch, both costing a module that was fine:
 * a file copied into the sandbox vanished as another session rewrote the tree
 * (`ENOENT ... copyfile`), and a sandbox that came up without its test file, so
 * Stryker found nothing to run and exited ("No tests were executed"). Neither
 * is a verdict on the module, so neither should be recorded as one.
 */
const TRANSIENT = /No tests were executed|ENOENT|EBUSY|EPERM|EACCES|Initial test run timed out/i

function runOne(key, tests) {
  const { vitestFile, strykerFile } = writeScopedConfigs(key, tests)
  const started = Date.now()
  const secs = () => Math.round((Date.now() - started) / 1000)
  try {
    // Stryker's own entry via THIS node, not `npx`: spawning `npx.cmd` on
    // Windows fails with EINVAL unless a shell is used, and a shell would
    // reintroduce quoting problems on paths.
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js'),
        'run', path.basename(strykerFile)],
      { cwd: ROOT, encoding: 'utf8', timeout: PER_FILE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const parsed = parseScore(out)
    return parsed ? { ...parsed, seconds: secs() } : { error: 'no score in output', seconds: secs() }
  } catch (e) {
    // A crash or a timeout costs this file and nothing else — that is the point.
    const text = stripAnsi(`${(e.stdout || '').toString()}\n${(e.stderr || '').toString()}`)
    const parsed = parseScore(text)
    if (parsed) return { ...parsed, seconds: secs() }
    const strykerErr = text.split('\n').find((l) => /ERROR|error:/i.test(l))
    const reason = e.killed || e.signal
      ? `timed out after ${PER_FILE_TIMEOUT_MS / 60000}m`
      : (strykerErr || (e.message || 'failed').split('\n')[0]).trim().slice(0, 200)
    return { error: reason, seconds: secs() }
  } finally {
    rmSync(vitestFile, { force: true })
    rmSync(strykerFile, { force: true })
  }
}

/**
 * Print the surviving (and uncovered) mutants for a measured file.
 *
 * This is the part you actually act on: each line is a change to the source
 * that every test still passed through, i.e. an assertion nobody wrote.
 *
 * A module is measured against its own test file AND the other test files that
 * import it (see testsFor), so a mutant another suite kills is not reported
 * here as surviving. The exception is a module whose EXPENSIVE importers were
 * rationed (see testsFor): those are named in the run summary, and for them this
 * list can still overstate what is missing.
 */
function printSurvivors(key) {
  const file = detailPath(key)
  if (!existsSync(file)) {
    console.log(`\n${key}: no detail report — measured before the json reporter existed. `
      + `Re-run: node scripts/mutation-run.mjs --force ${key}`)
    return
  }
  let report
  try {
    report = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // A run killed mid-write leaves a truncated file; say so rather than throw
    // and take the other 73 files' output down with it.
    console.log(`\n${key}: detail report is unreadable — re-run with --force.`)
    return
  }
  for (const [name, entry] of Object.entries(report.files ?? {})) {
    const lines = String(entry.source ?? '').split('\n')
    const mutants = entry.mutants ?? []
    const unkilled = mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage')
    const open = unkilled.filter((m) => !skipMutators.has(m.mutatorName))
    const hidden = unkilled.length - open.length
    console.log(`\n${name} — ${open.length} unkilled of ${mutants.length}`
      + (hidden ? ` (${hidden} more hidden by --skip)` : ''))
    for (const m of [...open].sort((a, b) => a.location.start.line - b.location.start.line)) {
      const src = (lines[m.location.start.line - 1] ?? '').trim()
      const to = String(m.replacement ?? '').replace(/\s+/g, ' ').slice(0, 60)
      console.log(`  L${String(m.location.start.line).padStart(4)} ${m.status === 'NoCoverage' ? 'uncov' : 'alive'} `
        + `${String(m.mutatorName).padEnd(22)} → ${to}\n         ${src.slice(0, 100)}`)
    }
    // A tally is the triage step: 200 StringLiteral mutants in one file is a
    // different problem (and often a deliberate non-problem) from 20 surviving
    // ConditionalExpression mutants, which are always missing assertions.
    const byMutator = {}
    for (const m of open) byMutator[m.mutatorName] = (byMutator[m.mutatorName] ?? 0) + 1
    const tally = Object.entries(byMutator).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`).join(', ')
    if (tally) console.log(`  — by mutator: ${tally}`)
    // What the run actually loaded, as recorded in the summary — not what
    // testsFor would pick today, which may have changed since.
    const ran = loadReport().files?.[key]?.tests
    console.log(`  — measured against: ${(ran ?? testsFor(key)).join(', ')}`)
  }
}

function summarise(report) {
  if (report.sweep) {
    const left = candidates().filter((k) => !report.sweep.done.includes(k)).length
    if (left === 0) {
      // A finished sweep is not state worth keeping, and announcing it as
      // unfinished is worse than keeping nothing: it warns that the numbers
      // are stale about the very run that just replaced them all. Cleared here
      // too, so --report is self-correcting rather than waiting for a run.
      delete report.sweep
      saveReport(report)
    } else {
      console.log(`A full sweep started ${report.sweep.startedAt} is UNFINISHED: `
        + `${report.sweep.done.length} done, ${left} to go. Plain \`npm run test:mutation\` resumes it.`)
      console.log('Numbers below for a module it has not reached are from the previous run.')
    }
  }
  const measured = Object.entries(report.files).filter(([, v]) => !v.error)
  if (measured.length) {
    const sum = (k) => measured.reduce((n, [, v]) => n + (v[k] || 0), 0)
    const total = sum('killed') + sum('survived') + sum('noCoverage') + sum('timeout')
    console.log(`\nMeasured ${measured.length} file(s): ${sum('killed')}/${total} mutants killed `
      + `(${(100 * sum('killed') / Math.max(total, 1)).toFixed(1)}%).`)
    const weakest = measured
      .filter(([, v]) => typeof v.score === 'number')
      .sort((a, b) => a[1].score - b[1].score)
      .slice(0, 12)
    console.log('\nWeakest files — where assertions are missing:')
    for (const [name, v] of weakest) {
      console.log(`  ${String(v.score).padStart(6)}%  ${name.padEnd(24)} ${v.survived} survived, ${v.noCoverage} uncovered`)
    }
  }
  const failed = Object.entries(report.files).filter(([, v]) => v.error)
  if (failed.length) {
    console.log(`\n${failed.length} file(s) could not be measured:`)
    for (const [name, v] of failed) console.log(`  ${name}: ${v.error}`)
  }
  const stale = measured.filter(([name]) => !existsSync(detailPath(name))).map(([name]) => name)
  if (stale.length) {
    console.log(`\n${stale.length} file(s) have a score but no mutant detail (measured before the`
      + ` json reporter). A plain run re-measures them:\n  ${stale.join(' ')}`)
  }
  reportUnmeasurable()
}

/**
 * Say out loud which lib modules no test touches.
 *
 * An unmeasured module is the one thing a mutation report cannot show you: it
 * has no score, so it is not in the table, so it looks like it isn't there.
 * These are worse than a low score — nothing exercises them at all.
 */
function reportUnmeasurable() {
  const orphans = moduleKeys().filter((key) => testsFor(key).length === 0)
  if (orphans.length) {
    console.log(`\n${orphans.length} module(s) have NO test that reaches them — not measurable,`
      + ` and not in the numbers above:\n  ${orphans.join(' ')}`)
  }
  // testsFor() fills `capped` as a side effect of the call above, so this runs
  // after it.
  if (capped.size) {
    console.log(`\n${capped.size} module(s) exceeded a tier budget — more than`
      + ` ${MAX_COMPONENT_TEST_FILES} component or ${MAX_SERVER_TEST_FILES} server suites reach them,`
      + ` or more than ${MAX_TEST_FILES} in total — so some of their survivors may be mutants one`
      + ` of the excluded suites kills:\n  ${[...capped].sort().join(' ')}`)
  }
}

function main() {
  const report = loadReport()
  if (reportOnly) { summarise(report); return }
  if (survivorsOnly) {
    const keys = names.length
      ? names.map(resolveName).filter(Boolean)
      : Object.keys(report.files).filter((k) => !report.files[k].error).sort()
    for (const k of keys) printSurvivors(k)
    return
  }

  /*
   * A SWEEP is a whole-tree `--force`, tracked so it can be resumed.
   *
   * Without this, --force was resumable only if the tree had never been
   * measured: it re-measures everything, but the entries it has not reached
   * yet still hold the PREVIOUS run's results, so a plain restart saw them as
   * done and had nothing left to do. A ten-hour sweep interrupted at module 52
   * could not be picked up — only started again from the beginning.
   *
   * So a sweep records which keys it has finished, and a plain run continues
   * one that is in progress. Nothing is deleted to achieve that: the previous
   * numbers stay readable through --report until each is replaced, which is
   * what makes an interrupted sweep worth reading at all.
   */
  const unmeasured = (k) => !report.files[k] || report.files[k].error || !existsSync(detailPath(k))
  const wholeTree = !names.length

  if (force && wholeTree) {
    report.sweep = { startedAt: new Date().toISOString(), done: [] }
    saveReport(report)
    console.log('Starting a full sweep. Interrupt it and a plain run resumes where it stopped.\n')
  }
  const sweep = wholeTree ? report.sweep : null

  let todo = names.length ? names.map(resolveName).filter(Boolean) : candidates()
  if (sweep) {
    todo = todo.filter((k) => !sweep.done.includes(k))
    // Front-load what has no result AT ALL, so an interrupted sweep has spent
    // its time on the modules nobody can otherwise say anything about.
    todo = [...todo.filter(unmeasured), ...todo.filter((k) => !unmeasured(k))]
  } else if (!force) {
    // "Measured" means a score AND the mutant detail that makes the score
    // actionable. A run from before the json reporter left only the former, and
    // skipping those would resume into a state you still can't act on.
    todo = todo.filter(unmeasured)
  }

  /*
   * Whether the SWEEP is finished is decided here, before --from and --limit
   * narrow the queue. Deciding it afterwards made `--limit 0` — or a --from at
   * the very end — empty the list, which read as "nothing left" and cleared the
   * sweep, throwing away the resume state that is the whole point of it.
   */
  const sweepFinished = sweep !== null && sweep !== undefined && todo.length === 0

  if (from) {
    const named = /^[0-9]+$/.test(from) ? null : resolveName(from)
    if (!/^[0-9]+$/.test(from) && !named) return
    const at = named ? todo.indexOf(named) : Number(from) - 1
    if (at < 0 || at >= todo.length) {
      console.log(`--from ${from}: not among the ${todo.length} module(s) queued. `
        + 'Give a 1-based position or a module name.')
      return
    }
    console.log(`Starting at ${at + 1}/${todo.length} (${todo[at]}).`)
    todo = todo.slice(at)
  }
  todo = todo.slice(0, limit)

  if (sweepFinished) {
    // The sweep reached the end; the next plain run goes back to measuring
    // only what has no result.
    delete report.sweep
    saveReport(report)
    console.log('Sweep complete — every module measured against the current tree.')
    summarise(report)
    return
  }
  if (!todo.length) {
    // Distinguish the two: "everything is measured" is a false statement when
    // it was a narrowing flag that emptied the queue.
    console.log(from || limit !== Infinity
      ? 'Nothing queued — --from/--limit narrowed the list to nothing.'
      : 'Nothing to do — everything is measured. --force to re-measure, --report to print,\n'
        + '--survivors [file…] to list the mutants no test killed.')
    reportUnmeasurable()
    return
  }
  console.log(`Measuring ${todo.length} file(s); results are saved after each one.\n`)

  for (const [i, key] of todo.entries()) {
    const tests = testsFor(key)
    if (!tests.length) {
      // Named explicitly on the command line but nothing tests it.
      console.log(`[${i + 1}/${todo.length}] ${key} … SKIPPED — no test reaches it`)
      if (sweep) { sweep.done.push(key); saveReport(report) }
      continue
    }
    // Read the test files right before handing them to Stryker. If one is
    // missing or empty NOW, "No tests were executed" is the symptom and this is
    // the cause — say so here rather than leaving it to be guessed at later.
    const unusable = tests.filter((t) => {
      try { return statSync(path.join(ROOT, t)).size === 0 } catch { return true }
    })
    if (unusable.length) {
      console.log(`[${i + 1}/${todo.length}] ${key} … SKIPPED — missing or empty: ${unusable.join(', ')}`)
      if (sweep) { sweep.done.push(key); saveReport(report) }
      continue
    }
    // Show the test set when it isn't the obvious same-name one, so a surprising
    // score (or runtime) is traceable to what actually ran.
    const sameName = `tests/${key.startsWith('server/') ? 'server/' : ''}${baseOf(key)}.test.ts`
    const via = tests.length === 1 && tests[0] === sameName ? '' : ` (via ${tests.join(', ')})`
    process.stdout.write(`[${i + 1}/${todo.length}] ${key}${via} … `)
    let result = runOne(key, tests)
    if (result.error && TRANSIENT.test(result.error)) {
      // The environment, not the module. Retry once rather than record a
      // verdict the module didn't earn — a 10-hour batch shouldn't lose a file
      // because another process touched the tree for a moment.
      process.stdout.write('(environment failure, retrying) ')
      result = runOne(key, tests)
    }
    report.files[key] = { ...result, tests, at: new Date().toISOString() }
    // Marked done even when it errored: a module that cannot be measured will
    // not measure on the retry either, and a sweep that keeps re-reaching it
    // never gets past it.
    if (sweep) sweep.done.push(key)
    // Saved after EVERY file, so an interrupt keeps what it already measured.
    saveReport(report)
    console.log(result.error
      ? `ERROR — ${result.error} [${result.seconds}s]`
      : `${result.score}% (${result.killed} killed, ${result.survived} survived, ${result.noCoverage} no-cov) [${result.seconds}s]`)
  }

  // Close the sweep HERE, not only when the next run starts. Deciding it on
  // entry meant the run that finished the last module still left the sweep
  // open, so --report went on announcing "UNFINISHED: 153 done, 0 to go" and
  // warning that the numbers were from a previous run — about a sweep that had
  // just replaced every one of them.
  if (sweep && candidates().every((k) => sweep.done.includes(k))) {
    delete report.sweep
    saveReport(report)
    console.log('\nSweep complete — every module measured against the current tree.')
  }
  summarise(report)
}

main()
