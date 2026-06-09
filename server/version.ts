/**
 * The running app's version string (e.g. "0.1.1").
 *
 * Resolution order:
 *   1. `RESUME_APP_VERSION` — baked into the desktop bundle at build time
 *      (`scripts/build-desktop.mjs` passes it via esbuild `define`), and also a
 *      convenient override for tests / the VPS deployment.
 *   2. The repo `package.json` `version` — used under `tsx` (dev, `npm run
 *      desktop`, the VPS entry) where the file is on disk next to the source.
 *   3. `'0.0.0'` — last-ditch fallback so callers always get a valid semver.
 *
 * The auto-updater compares this against the latest GitHub release. Keeping it
 * env-first means the esbuild bundle never has to read package.json at runtime
 * (it can't reliably resolve a path there), while dev/VPS still get a real value.
 */

import fs from 'fs'
import path from 'path'
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

export const APP_VERSION: string =
  process.env.RESUME_APP_VERSION?.trim() || fromPackageJson() || '0.0.0'
