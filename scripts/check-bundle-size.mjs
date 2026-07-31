#!/usr/bin/env node
/**
 * Bundle-size budget.
 *
 * The project has real, documented bundle discipline — lucide icons imported by
 * name, the DOCX and PDF exporters behind dynamic imports, no fonts CDN — and
 * all of it was enforced by build output that nobody reads on a green run.
 * Vite's own `chunkSizeWarningLimit` prints a warning and exits 0, which is the
 * same as not checking.
 *
 * This asserts the numbers instead. It checks the INITIAL payload — the entry
 * chunk plus its CSS, gzipped, because that is what a user waits for — and the
 * lazy chunks are checked only for still BEING lazy: if pdfmake or the docx
 * exporter ever collapses into the entry chunk, the entry budget catches it,
 * but an explicit assertion says so in one line instead of leaving you to work
 * out why the number moved by a megabyte.
 *
 * Budgets are deliberately close to current: a budget with generous headroom
 * gets consumed silently and teaches nothing. Raise them on purpose, in a
 * commit that says why.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const DIST = path.join(process.cwd(), 'dist', 'assets')

/** Gzipped kB, one decimal — the unit the budgets are written in. */
const gz = (file) => gzipSync(readFileSync(file)).length / 1024

const BUDGETS = {
  /** Entry JS + entry CSS, gzipped. What the browser must fetch before anything renders. */
  initialGzipKb: 340,
  /** Each of these must remain a SEPARATE chunk — never folded into the entry. */
  mustStayLazy: ['pdfmake', 'vfs_fonts', 'exporter'],
}

function main() {
  let files
  try {
    files = readdirSync(DIST)
  } catch {
    console.error(`No build output at ${DIST}. Run \`npm run build\` first.`)
    process.exit(1)
  }

  // The entry chunk is `index-<hash>.js`; everything else is a route/lazy chunk.
  const entryJs = files.filter((f) => /^index-.*\.js$/.test(f))
  const entryCss = files.filter((f) => /^index-.*\.css$/.test(f))
  if (entryJs.length !== 1) {
    console.error(`Expected exactly one entry chunk, found ${entryJs.length}: ${entryJs.join(', ')}`)
    process.exit(1)
  }

  const initial = gz(path.join(DIST, entryJs[0]))
    + entryCss.reduce((n, f) => n + gz(path.join(DIST, f)), 0)

  const problems = []
  if (initial > BUDGETS.initialGzipKb) {
    problems.push(
      `Initial payload ${initial.toFixed(1)} kB gzipped exceeds the ${BUDGETS.initialGzipKb} kB budget `
      + `(+${(initial - BUDGETS.initialGzipKb).toFixed(1)} kB). Something that should be lazy probably isn't — `
      + 'check for a static import of lib/exporter, lib/pdfExporter, or a namespace import of lucide-react.',
    )
  }

  for (const name of BUDGETS.mustStayLazy) {
    if (!files.some((f) => f.startsWith(`${name}-`) || f.startsWith(`${name}.`))) {
      problems.push(`"${name}" is no longer its own chunk — it has been pulled into the initial bundle.`)
    }
  }

  const report = [
    `initial (entry js + css, gzip): ${initial.toFixed(1)} kB / ${BUDGETS.initialGzipKb} kB budget`,
    ...files
      .filter((f) => f.endsWith('.js') && !f.startsWith('index-'))
      .map((f) => `  lazy: ${f} — ${gz(path.join(DIST, f)).toFixed(1)} kB gzip (${(statSync(path.join(DIST, f)).size / 1024).toFixed(0)} kB raw)`)
      .sort(),
  ].join('\n')
  console.log(report)

  if (problems.length) {
    console.error('\nBundle budget exceeded:\n' + problems.map((p) => `  - ${p}`).join('\n'))
    process.exit(1)
  }
  console.log('\nBundle budget OK.')
}

main()
