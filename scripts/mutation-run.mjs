#!/usr/bin/env node
/**
 * Incremental mutation testing — one source file at a time.
 *
 * A plain `stryker run` over `src/lib` is unusable here, and the reason is the
 * DRY RUN: before trying a single mutant, Stryker executes the whole test suite
 * once per runner process to learn which tests cover what. This suite is 2,638
 * tests, so that alone blew past Stryker's timeout and the run died having
 * measured nothing. Raising the timeout only converts a crash into a long wait.
 *
 * The fix is to stop making it read the whole suite. This runs Stryker once per
 * source file against ONLY the tests that exercise it — its own
 * `tests/x.test.ts` where that exists, otherwise whichever test files import
 * it. The dry run drops from minutes to about a second, and the mutants that
 * survive are the ones those tests should have killed.
 *
 * The module list is READ OFF DISK every run (`src/lib/*.ts`) — there is no
 * checked-in list to fall out of date — and anything no test touches is
 * reported by name rather than quietly left out of the numbers.
 *
 * Properties that matter, each learned the hard way:
 *  - **One file per process.** A crash costs that file, not the run.
 *  - **A hard per-file timeout.** Nothing hangs the batch.
 *  - **Results are written after EVERY file.** A batch interrupted halfway
 *    still leaves everything it measured — the earlier whole-directory attempts
 *    produced nothing at all when they died.
 *  - **Resumable.** Files already measured are skipped unless --force.
 *  - **The surviving mutants are kept, not just the score.** Stryker's json
 *    report lands in reports/mutation/files/<name>.json per file. A score of
 *    62% tells you nothing you can act on; the mutant list is the actual
 *    output, and the first full run produced only the score.
 *
 * Usage:
 *   node scripts/mutation-run.mjs                 # every lib file with a test
 *   node scripts/mutation-run.mjs richText merge  # just these
 *   node scripts/mutation-run.mjs --limit 10      # the next 10 unmeasured
 *   node scripts/mutation-run.mjs --report        # print what's been measured
 *   node scripts/mutation-run.mjs --survivors x   # print x's UNKILLED mutants
 *   node scripts/mutation-run.mjs --survivors --skip StringLiteral
 *                                                 # …minus the prompt wording
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const REPORT = path.join(ROOT, 'reports', 'mutation', 'summary.json')
/** Per-file mutant detail, written by Stryker's own json reporter. */
const detailPath = (base) => path.join(ROOT, 'reports', 'mutation', 'files', `${base}.json`)
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
  && !(skipIdx >= 0 && i === skipIdx + 1))

/** Every module in src/lib, read off disk each run — never a checked-in list. */
function libModules() {
  return readdirSync(path.join(ROOT, 'src', 'lib'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort()
}

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
 * How many test files one module may be measured against.
 *
 * The whole point of the scoped run is that the dry run loads a handful of
 * files rather than all 165. A census of the repo says the median module has
 * ONE importer besides its own test and only two (api, viewFilter) have more
 * than six, so this ceiling costs nothing for 77 of 82 modules and bounds the
 * two that would otherwise pull in most of the component suite.
 */
const MAX_TEST_FILES = 6

/** Modules whose importer list was truncated by MAX_TEST_FILES this run. */
const capped = new Set()

/**
 * The test files that exercise src/lib/<base>.ts: its own tests/<base>.test.ts
 * FIRST, then whichever other test files import it.
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
function testsFor(base) {
  const own = [`tests/${base}.test.ts`, `tests/${base}.test.tsx`]
    .filter((p) => existsSync(path.join(ROOT, p)))
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const imports = new RegExp(`lib/${escaped}['"]`)
  const importers = allTestFiles()
    .filter((f) => imports.test(f.text))
    .map((f) => f.path)
    .filter((p) => !own.includes(p))

  const all = [...own, ...importers]
  if (all.length > MAX_TEST_FILES) capped.add(base)
  return all.slice(0, MAX_TEST_FILES)
}

/** Modules that can be measured, i.e. some test somewhere touches them. */
function candidates() {
  return libModules().filter((base) => testsFor(base).length > 0)
}

const loadReport = () => {
  try { return JSON.parse(readFileSync(REPORT, 'utf8')) } catch { return { files: {} } }
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
function writeScopedConfigs(base, tests) {
  const vitestFile = path.join(ROOT, `vitest.mutation.${base}.config.ts`)
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

  const strykerFile = path.join(ROOT, `stryker.mutation.${base}.json`)
  writeFileSync(strykerFile, JSON.stringify({
    packageManager: 'npm',
    testRunner: 'vitest',
    vitest: { configFile: path.basename(vitestFile) },
    // The json report is the only record of WHICH mutants survived. Without it
    // a finished run leaves a score and nothing to act on — you know richText
    // is at 62% and not one thing to write a test about.
    reporters: ['clear-text', 'json'],
    jsonReporter: { fileName: `reports/mutation/files/${base}.json` },
    coverageAnalysis: 'perTest',
    mutate: [`src/lib/${base}.ts`],
    // `.claude` is load-bearing, not tidiness: Stryker copies the project into
    // a sandbox per file, and `.claude/worktrees/*` holds full checkouts that
    // OTHER live sessions are editing. A file that vanishes between the scan
    // and the copy fails the whole run with `ENOENT … copyfile`, which is what
    // killed competencyBundles mid-batch. Worktrees are excluded through
    // .git/info/exclude, which Stryker does not read.
    // `data` is the same hazard: a live SQLite DB with WAL files being written.
    ignorePatterns: ['dist', 'release', 'release-dist', 'coverage', 'reports', '.stryker-tmp', '.claude', 'data'],
    concurrency: 2,
    timeoutMS: 60000,
    dryRunTimeoutMinutes: 5,
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

function runOne(base, tests) {
  const { vitestFile, strykerFile } = writeScopedConfigs(base, tests)
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
 * here as surviving. The exception is a module with more importers than
 * MAX_TEST_FILES: those are named in the run summary, and for them this list
 * can still overstate what is missing.
 */
function printSurvivors(base) {
  const file = detailPath(base)
  if (!existsSync(file)) {
    console.log(`\n${base}: no detail report — measured before the json reporter existed. `
      + `Re-run: node scripts/mutation-run.mjs --force ${base}`)
    return
  }
  let report
  try {
    report = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // A run killed mid-write leaves a truncated file; say so rather than throw
    // and take the other 73 files' output down with it.
    console.log(`\n${base}: detail report is unreadable — re-run with --force.`)
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
    const ran = loadReport().files?.[base]?.tests
    console.log(`  — measured against: ${(ran ?? testsFor(base)).join(', ')}`)
  }
}

function summarise(report) {
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
  const orphans = libModules().filter((base) => testsFor(base).length === 0)
  if (orphans.length) {
    console.log(`\n${orphans.length} lib module(s) have NO test that imports them — not measurable,`
      + ` and not in the numbers above:\n  ${orphans.join(' ')}`)
  }
  // testsFor() fills `capped` as a side effect of the call above, so this runs
  // after it.
  if (capped.size) {
    console.log(`\n${capped.size} module(s) have more importing tests than the ${MAX_TEST_FILES}-file`
      + ` ceiling, so their survivors may include mutants another suite kills:\n  ${[...capped].sort().join(' ')}`)
  }
}

function main() {
  const report = loadReport()
  if (reportOnly) { summarise(report); return }
  if (survivorsOnly) {
    const bases = names.length
      ? names
      : Object.keys(report.files).filter((b) => !report.files[b].error).sort()
    for (const b of bases) printSurvivors(b)
    return
  }

  let todo = names.length ? names : candidates()
  // "Measured" means a score AND the mutant detail that makes the score
  // actionable. A run from before the json reporter left only the former, and
  // skipping those would resume into a state you still can't act on.
  if (!force) {
    todo = todo.filter((b) => !report.files[b] || report.files[b].error || !existsSync(detailPath(b)))
  }
  todo = todo.slice(0, limit)

  if (!todo.length) {
    console.log('Nothing to do — everything is measured. --force to re-measure, --report to print,\n'
      + '--survivors [file…] to list the mutants no test killed.')
    reportUnmeasurable()
    return
  }
  console.log(`Measuring ${todo.length} file(s); results are saved after each one.\n`)

  for (const [i, base] of todo.entries()) {
    const tests = testsFor(base)
    if (!tests.length) {
      // Named explicitly on the command line but nothing tests it.
      console.log(`[${i + 1}/${todo.length}] ${base} … SKIPPED — no test imports it`)
      continue
    }
    // Read the test files right before handing them to Stryker. If one is
    // missing or empty NOW, "No tests were executed" is the symptom and this is
    // the cause — say so here rather than leaving it to be guessed at later.
    const unusable = tests.filter((t) => {
      try { return statSync(path.join(ROOT, t)).size === 0 } catch { return true }
    })
    if (unusable.length) {
      console.log(`[${i + 1}/${todo.length}] ${base} … SKIPPED — missing or empty: ${unusable.join(', ')}`)
      continue
    }
    // Show the test set when it isn't the obvious same-name one, so a surprising
    // score (or runtime) is traceable to what actually ran.
    const via = tests.length === 1 && tests[0] === `tests/${base}.test.ts` ? '' : ` (via ${tests.join(', ')})`
    process.stdout.write(`[${i + 1}/${todo.length}] ${base}${via} … `)
    let result = runOne(base, tests)
    if (result.error && TRANSIENT.test(result.error)) {
      // The environment, not the module. Retry once rather than record a
      // verdict the module didn't earn — a 10-hour batch shouldn't lose a file
      // because another process touched the tree for a moment.
      process.stdout.write('(environment failure, retrying) ')
      result = runOne(base, tests)
    }
    report.files[base] = { ...result, tests, at: new Date().toISOString() }
    // Saved after EVERY file, so an interrupt keeps what it already measured.
    saveReport(report)
    console.log(result.error
      ? `ERROR — ${result.error} [${result.seconds}s]`
      : `${result.score}% (${result.killed} killed, ${result.survived} survived, ${result.noCoverage} no-cov) [${result.seconds}s]`)
  }
  summarise(report)
}

main()
