import { loadDotEnv } from './env.js'
import { createApp } from './app.js'
import { getAccounts, getDefaultDb, isCorruptDbError, describeCorruptDb } from './db.js'
import { resolvePaths } from './config.js'
import { isTokenConfigured } from './auth.js'
import { issueBootstrapCode, bootstrapBanner } from './bootstrap.js'

/**
 * Runs before `PORT` below and before `createApp()` is CALLED — not before the
 * imports, which ESM evaluates first whatever order the statements are written
 * in. That is enough only because server modules read env lazily rather than at
 * import time (CLAUDE.md §10), which is the invariant this line depends on: put
 * an import-time `process.env` read in one of them and it would see the
 * environment as it was before `.env` was applied.
 */
const dotenv = loadDotEnv()

const PORT    = parseInt(process.env.PORT ?? '3001', 10)
const IS_PROD = process.env.NODE_ENV === 'production'

/**
 * Open the database before serving anything.
 *
 * Without this the server starts, answers the health check, and then throws
 * from `node:sqlite` on the first request that touches storage — so a damaged
 * file presents as intermittent 500s rather than as the one thing it is. The
 * desktop launcher has explained this properly for a while; there is no reason
 * a server operator should get less.
 */
try {
  getDefaultDb()
} catch (err) {
  if (!isCorruptDbError(err)) throw err
  for (const line of describeCorruptDb(resolvePaths().dbPath, err)) console.error(line)
  process.exit(1)
}

const app = createApp()

app.listen(PORT, () => {
  const mode = IS_PROD ? 'production' : 'development (API only)'
  const url = `http://localhost:${PORT}`
  console.log(`Resume Studio server [${mode}] → ${url}`)

  if (dotenv.file) {
    const skipped = dotenv.skipped.length
      ? `, ${dotenv.skipped.length} already set in the environment`
      : ''
    console.log(`[env] .env: ${dotenv.applied.length} variable(s) applied${skipped}`)
  }

  /**
   * An instance with no accounts needs a way to create the first one, and the
   * code is printed here because stdout and the log are the two places an
   * operator can reach without already being inside the app.
   *
   * Skipped once any account exists, and skipped on a token-only instance that
   * has not chosen to migrate — printing a setup code at every boot of a
   * working server is noise that trains people to ignore it.
   */
  try {
    const accounts = getAccounts()
    if (!accounts.hasAnyUser()) {
      const wantsAccounts = !isTokenConfigured() || process.env.RESUME_SETUP === '1'
      if (wantsAccounts) {
        console.log(bootstrapBanner(issueBootstrapCode(), url))
      } else {
        console.log(
          '\n  This instance authenticates with RESUME_API_TOKEN and has no user accounts.'
          + '\n  Start with RESUME_SETUP=1 to create the first account and migrate.\n',
        )
      }
    }
  } catch (err) {
    // A server that cannot read its own accounts table still serves; the first
    // request touching the database will report the real problem.
    console.warn('[bootstrap] could not check for existing accounts:', err)
  }
})
