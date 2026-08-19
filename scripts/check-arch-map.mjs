#!/usr/bin/env node
/**
 * Every module is named in CLAUDE.md's architecture map (§3).
 *
 * The map opens by calling itself a "one-line-per-file navigation aid", and an
 * agent reads it to decide where a thing lives before opening anything. When it
 * silently stops being complete it does worse than go quiet: a module absent
 * from the map reads as a module that does not exist, so the next reader writes
 * a second one beside it. That is not hypothetical — the map was missing 48 of
 * the ~100 modules in `src/lib` when this check was written, including the
 * entire advanced-assist family, and it named an editor component
 * (`ProfileCompetenciesEditor`) that had not existed for several releases.
 *
 * A prose promise of completeness is exactly the kind of claim CLAUDE.md §2 says
 * to move into a gate rather than trust: a check cannot rot into a lie the way a
 * sentence can. Adding a module under `src/lib`, `src/store`, `server/` or
 * `scripts/` now fails CI until the map mentions it.
 *
 * WHAT THIS DOES NOT CATCH: the other direction — a name still in the map whose
 * file is gone. Telling a stale module name apart from the function names,
 * section references and prose the map also carries needs an allowlist, and an
 * allowlist rots the same way the map does. Written-out PATHS are checked (see
 * `deadPaths`); bare names stay a review concern — the code-comments skill's
 * "is it still true?" pass.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DOC = 'CLAUDE.md'
const SECTION = '## 3. Architecture map'

/**
 * Source directory → the REGION of the map that must name its files.
 *
 * Regions, not the whole map, because basenames repeat: `backup`, `glossary`
 * and `storage` are each a client module and a server one, and six route
 * modules share a name with the implementation module they wrap. Searched
 * globally, deleting `server/storage.ts` from the map would still pass on the
 * strength of `lib/storage` — the exact silent-completeness failure this exists
 * to stop.
 *
 * `src/components` is deliberately absent: the map groups components by role
 * and folds whole families into one phrase ("the advisor result panels"), which
 * is the right altitude for ~80 files and is not a per-file promise. Holding it
 * to this rule would force either noise in the map or an exception list here.
 */
const COVERED = [
  { root: 'src/lib', region: 'src' },
  { root: 'src/store', region: 'src' },
  { root: 'server/routes', region: 'server-routes' },
  { root: 'server', region: 'server', notUnder: 'server/routes/' },
  { root: 'scripts', region: 'scripts' },
]

/** Source extensions. Anything else in these trees is not a module. */
const MODULE_EXT = new Set(['.ts', '.mjs'])

/**
 * `git ls-files -z` separator. Built with fromCharCode, never typed: a raw NUL
 * in a source file is the thing `npm run check:text` exists to reject, and it
 * makes git and grep read the whole file as binary.
 */
const NUL = String.fromCharCode(0)

/** Tracked files under `root`, so an untracked scratch file cannot fail the build. */
function trackedUnder(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--', root], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  })
  return out.toString('utf8').split(NUL).filter(Boolean)
}

/**
 * The fenced code blocks inside §3 — the map itself, without the prose around
 * it. Reading the whole section would let a passing mention in a paragraph
 * satisfy the rule, which is not what the map promises.
 */
function readMapBlock(doc) {
  const start = doc.indexOf(SECTION)
  if (start < 0) throw new Error(`${DOC} has no "${SECTION}" heading`)
  const rest = doc.slice(start + SECTION.length)
  const end = rest.indexOf('\n## ')
  const section = end < 0 ? rest : rest.slice(0, end)
  const fences = [...section.matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)].map((m) => m[1])
  if (fences.length === 0) throw new Error(`${SECTION} has no fenced block to check`)
  return fences.join('\n')
}

/**
 * Cut the map into the regions `COVERED` refers to.
 *
 * The top-level trees are the lines starting at column 0 (`src/`, `server/`,
 * `scripts/`, `tests/`). The server tree is then cut again at its `routes/`
 * line, because that line lists the route modules by bare name and would
 * otherwise vouch for the same-named module each one wraps.
 */
function mapRegions(block) {
  const lines = block.split('\n')
  const heads = []
  lines.forEach((line, i) => {
    const m = /^([A-Za-z0-9_.-]+)\//.exec(line)
    if (m) heads.push([i, m[1]])
  })

  const regions = new Map()
  heads.forEach(([from, name], k) => {
    const to = k + 1 < heads.length ? heads[k + 1][0] : lines.length
    regions.set(name, lines.slice(from, to))
  })

  const server = regions.get('server') ?? []
  const routesAt = server.findIndex((line) => /\broutes\//.test(line))
  regions.set('server-routes', routesAt < 0 ? [] : server.slice(routesAt))
  regions.set('server', routesAt < 0 ? server : server.slice(0, routesAt))

  return new Map([...regions].map(([name, lines_]) => [name, lines_.join('\n')]))
}

/**
 * A module counts as named when its basename appears as a whole word. Word
 * boundaries are what keep `backup` from being satisfied by `backupFiles` —
 * separate modules with separate jobs, and one standing in for the other is the
 * failure this is here to catch.
 *
 * The name is escaped because `path.basename` strips only the LAST extension: a
 * `foo.config.ts` would arrive here as `foo.config`, where an unescaped dot
 * matches any character and quietly widens the search.
 */
const namedIn = (text, name) => {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9_])${literal}(?![A-Za-z0-9_])`).test(text)
}

/** Paths written out in the map, so a rename cannot leave a dead one behind. */
function deadPaths(block) {
  const written = new Set(
    [...block.matchAll(/[A-Za-z0-9_.\-/]+\/[A-Za-z0-9_.-]+\.(?:ts|tsx|mjs|js|css|json|ya?ml)/g)]
      .map((m) => m[0]),
  )
  // `src/` is elided through most of the map, so a bare `types/index.ts` is a
  // legitimate way to write `src/types/index.ts`.
  return [...written].filter((p) => !existsSync(p) && !existsSync(path.join('src', p)))
}

function main() {
  let doc
  try {
    doc = readFileSync(DOC, 'utf8')
  } catch {
    console.error(`[check:arch] cannot read ${DOC} — run this from the repo root.`)
    process.exit(1)
  }

  let block
  let regions
  try {
    block = readMapBlock(doc)
    regions = mapRegions(block)
  } catch (err) {
    console.error(`[check:arch] ${err.message}`)
    process.exit(1)
  }

  const missing = []
  let checked = 0
  for (const { root, region, notUnder } of COVERED) {
    const text = regions.get(region)
    if (!text) {
      console.error(`[check:arch] the map has no "${region}" region for ${root}.`)
      process.exit(1)
    }
    for (const file of trackedUnder(root)) {
      if (notUnder && file.startsWith(notUnder)) continue
      if (!MODULE_EXT.has(path.extname(file))) continue
      checked++
      const name = path.basename(file, path.extname(file))
      if (!namedIn(text, name)) missing.push(`${file}  (expected in the map's ${region} region)`)
    }
  }

  const dead = deadPaths(block)

  if (missing.length > 0 || dead.length > 0) {
    if (missing.length > 0) {
      console.error(`[check:arch] ${missing.length} module(s) missing from ${DOC} ${SECTION}:\n`)
      for (const f of missing) console.error(`  ${f}`)
      console.error(
        '\nAdd each to the map, in the group it belongs to, with the one clause a'
        + '\nreader needs to decide whether to open it. The map is how an agent finds'
        + '\nyour module; absent from it, it reads as a module that does not exist.',
      )
    }
    if (dead.length > 0) {
      console.error(`\n[check:arch] ${dead.length} path(s) written in the map do not exist:\n`)
      for (const p of dead) console.error(`  ${p}`)
    }
    process.exit(1)
  }

  console.log(`[check:arch] ${checked} modules named in ${DOC} ${SECTION}.`)
}

main()
