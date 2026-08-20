import { createApp } from './app.js'
import { getAccounts } from './db.js'
import { isTokenConfigured } from './auth.js'
import { issueBootstrapCode, bootstrapBanner } from './bootstrap.js'

const PORT    = parseInt(process.env.PORT ?? '3001', 10)
const IS_PROD = process.env.NODE_ENV === 'production'

const app = createApp()

app.listen(PORT, () => {
  const mode = IS_PROD ? 'production' : 'development (API only)'
  const url = `http://localhost:${PORT}`
  console.log(`Resume Studio server [${mode}] → ${url}`)

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
