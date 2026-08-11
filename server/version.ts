/**
 * The running app's version — a semver for machines, and a label for humans.
 *
 * `APP_VERSION` resolution order:
 *   1. `RESUME_APP_VERSION` — baked into the desktop bundle at build time
 *      (`scripts/build-desktop.mjs` passes it via esbuild `define`), and also a
 *      convenient override for tests / the VPS deployment.
 *   2. The repo `package.json` `version` — used under `tsx` (dev, `npm run
 *      desktop`, the VPS entry) where the file is on disk next to the source.
 *   3. `'0.0.0'` — last-ditch fallback so callers always get a valid semver.
 *
 * The auto-updater compares this against the latest GitHub release, so it must
 * stay a bare semver whatever build this is.
 *
 * `APP_VERSION_LABEL` is the separate thing users read. Only a build produced
 * by the tagged release workflow may claim a version number: everything else —
 * `npm run dev`, `npm run desktop`, a local `build:desktop`, a VPS checkout —
 * reports `Dev-<commit>`. A development server that answers "0.10.2" is
 * indistinguishable from the artifact users downloaded, which is the same
 * version-drift class the release workflow's tag check exists to prevent, only
 * this half was invisible: a bug report says 0.10.2 and nobody can tell whether
 * it came from the release or from someone's working tree.
 */

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

function fromPackageJson(): string | null {
  // import.meta.url is "" in the esbuild CJS bundle (see app.ts/db.ts), but in
  // that build RESUME_APP_VERSION is always set, so this branch isn't reached.
  // Under tsx it resolves normally and we can walk up to the repo package.json.
  try {
    const here = import.meta.url ? path.dirname(fileURLToPath(import.meta.url)) : process.cwd()
    // server/ → repo root
    const candidates = [
      path.join(here, '..', 'package.json'),
      path.join(process.cwd(), 'package.json'),
    ]
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown }
        if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim()
      }
    }
  } catch {
    /* fall through to the default */
  }
  return null
}

/**
 * The short commit this is running from.
 *
 * Env first, because a built bundle has no `.git` beside it — `build-desktop`
 * bakes `RESUME_BUILD_COMMIT`. Otherwise ask git, which is what makes this work
 * from a worktree: `.git` there is a FILE pointing elsewhere, so reading refs
 * by hand gets it wrong exactly where development actually happens.
 */
function commitId(): string | null {
  const baked = process.env.RESUME_BUILD_COMMIT?.trim()
  if (baked) return baked.slice(0, 7)
  try {
    const out = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim() || null
  } catch {
    return null
  }
}

export const APP_VERSION: string =
  process.env.RESUME_APP_VERSION?.trim() || fromPackageJson() || '0.0.0'

/**
 * Was this build produced by the tagged release workflow?
 *
 * Declared, never inferred — `release.yml` sets `RESUME_BUILD_CHANNEL=release`
 * and `build-desktop.mjs` bakes whatever it was given, defaulting to dev. A
 * local `build:desktop` produces an artifact byte-similar to the released one,
 * so sniffing (env set? file layout?) would call it a release. The build that
 * users can actually download is the one CI made, and only CI can say so.
 */
export const IS_RELEASE_BUILD: boolean =
  process.env.RESUME_BUILD_CHANNEL?.trim().toLowerCase() === 'release'

export const BUILD_COMMIT: string | null = commitId()

/** What the tray, the Version tab and the picker footer show. */
export const APP_VERSION_LABEL: string =
  IS_RELEASE_BUILD ? `v${APP_VERSION}` : `Dev-${BUILD_COMMIT ?? 'local'}`
