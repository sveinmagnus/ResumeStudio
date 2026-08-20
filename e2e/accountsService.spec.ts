/**
 * `RESUME_API_TOKEN` — the credential that authenticates but is nobody.
 *
 * It survives accounts as a SERVICE credential: scripts, CI and curl get it,
 * real people get accounts. Two things about it the route suites cannot show.
 *
 * The first is what the UI does with it. A shared secret cannot identify a
 * person, so `GET /api/auth/me` answers `service: true` and the app must not
 * offer a profile or a team page behind it — there is no account there to edit,
 * and a menu item leading to a "Page not found" is a promise the app cannot
 * keep. Only a real browser mounts that chrome.
 *
 * The second is that it keeps working once the instance HAS accounts. `authMode`
 * is derived from what exists, so creating the first account moves the whole
 * server from `token` to `accounts` mode — and a deployment's backup script must
 * not stop working because somebody signed up. That transition happens once per
 * database, which is why this spec boots a server of its own.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { firstVisit, startServer, type ServerHandle } from './serverHarness'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

const PORT = 3213
const BASE = `http://127.0.0.1:${PORT}`
const TOKEN = 'service-token-for-the-e2e-suite'

let server: ServerHandle | null = null

test.beforeAll(async () => {
  test.setTimeout(120_000)
  // No `RESUME_SETUP`: a token instance that has not asked to migrate prints no
  // bootstrap code and therefore offers no setup form — which is the state the
  // token sign-in form is reachable in. With the flag set, `bootstrap_available`
  // wins and the gate offers first-run setup instead.
  server = await startServer({
    port: PORT,
    env: { RESUME_API_TOKEN: TOKEN },
    expectBootstrapCode: false,
  })
})

test.afterAll(() => {
  server?.stop()
})

/**
 * A non-browser client. It sends no `Sec-Fetch-Site`, so `app.ts`'s cross-site
 * brake never fires, and it presents no session cookie, so `csrf.ts` requires no
 * token — which between them is what "curl and CI get this" means in practice.
 *
 * It DOES keep cookies across calls, so a context that has signed in is no
 * longer a pure bearer client. One per identity below.
 */
async function bearer(token: string | null) {
  return playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

test('the API answers a bearer client and nobody else', async () => {
  const good = await bearer(TOKEN)
  expect((await good.get('/api/resumes')).status()).toBe(200)

  const me = await (await good.get('/api/auth/me')).json() as {
    service: boolean; role: string; user_id: string | null; mode: string
  }
  // Everything, but nobody: a resume it creates is left unowned precisely
  // because there is no person to attribute it to.
  expect(me).toMatchObject({ service: true, role: 'owner', user_id: null, mode: 'token' })

  const wrong = await bearer('not-the-token')
  expect((await wrong.get('/api/resumes')).status()).toBe(401)
  const none = await bearer(null)
  expect((await none.get('/api/resumes')).status()).toBe(401)

  await good.dispose()
  await wrong.dispose()
  await none.dispose()
})

test('a browser holding only the token is offered no profile and no team', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE })
  const page = await context.newPage()
  await firstVisit(page)

  // Token mode shows the pre-accounts form, not a username and password the
  // instance has no accounts for.
  await page.goto('/')
  await page.getByLabel('API token').fill(TOKEN)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('heading', { name: 'Cartavio Resume Studio' })).toBeVisible()

  await page.getByRole('button', { name: 'Service access' }).click()
  await expect(page.getByText('A shared service credential, not a person.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Your account' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Team' })).toHaveCount(0)
  // Sign-out stays, because ending the session is the one thing a shared
  // credential still needs to be able to do at a keyboard.
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  // Not merely unlinked: the routes themselves have nothing to show it.
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  await context.close()
})

test('creating the first account does not revoke the service credential', async () => {
  // A second server, because the migration has to be ASKED for: `RESUME_SETUP=1`
  // is what an operator of a running token instance passes to be offered it, and
  // it is the only way a bootstrap code exists to spend.
  server?.stop()
  server = await startServer({
    port: PORT,
    env: { RESUME_API_TOKEN: TOKEN, RESUME_SETUP: '1' },
  })

  // Bootstrapped WITHOUT the token, because that is how it happens: whoever
  // spends the code is at a browser, and the response hands back a session.
  const person = await bearer(null)
  const res = await person.post('/api/auth/bootstrap', {
    data: {
      code: server.bootstrapCode,
      username: 'ola',
      display_name: 'Ola Eier',
      password: 'owner-passphrase-one',
    },
  })
  expect(res.status()).toBe(200)

  // The instance is in `accounts` mode now — the same token, the same answer.
  const client = await bearer(TOKEN)
  expect((await client.get('/api/resumes')).status()).toBe(200)
  const me = await (await client.get('/api/auth/me')).json() as { service: boolean; mode: string }
  expect(me).toMatchObject({ service: true, mode: 'accounts' })
  await client.dispose()

  // A request carrying BOTH resolves to the person, never to the shared secret:
  // a service token must not be able to shadow a real user's identity, or the
  // saves it stamps would be attributed to nobody.
  const both = await (await person.get('/api/auth/me', {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })).json() as { service: boolean; user_id: string | null }
  expect(both.service).toBe(false)
  expect(both.user_id).not.toBeNull()
  await person.dispose()

  // Still the only token that works — the mode change is not a widening.
  const wrong = await bearer('not-the-token')
  expect((await wrong.get('/api/resumes')).status()).toBe(401)
  await wrong.dispose()
})
