/**
 * The multi-user journey, in a real browser — the half that supertest and jsdom
 * structurally cannot reach.
 *
 * The route suites prove the SERVER refuses what it should; the component suites
 * prove each screen renders. Neither can tell you whether the cookie the server
 * sets is one a browser accepts (`Secure` over http, `SameSite=Strict` across a
 * link), whether the CSRF echo survives a real reload, or whether two people
 * signed in at once actually stay apart — which is the whole promise of the
 * feature and the one failure that is silent when it breaks.
 *
 * So this suite drives TWO browser contexts against ONE server: an owner and the
 * member they invite. Separate contexts rather than one signed in and out
 * repeatedly, because a shared cookie jar cannot prove session isolation.
 *
 * It boots its own server rather than reusing the suite-wide one in
 * `playwright.config.ts`, because the first thing it tests is a thing that can
 * only happen once per database: the creation of the very first account. Sharing
 * a server with the other specs would make that step depend on the order they
 * ran in.
 *
 * The bootstrap code is read from the server's STDOUT, the way an operator reads
 * it off their console. Reading it from the API instead would test a path no
 * human takes.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createResume } from './helpers'

// Every test below stands on the one before it — an account exists because the
// previous test created it. Serial mode reports the first break and skips the
// rest, instead of a cascade of failures about the same cause.
test.describe.configure({ mode: 'serial' })

/**
 * Not applicable on WebKit, and it is the harness rather than the app that is
 * wrong here.
 *
 * A production server marks the session cookie `Secure`, and this harness — like
 * the suite-wide one — serves plain http on a loopback address. Chromium and
 * Firefox treat 127.0.0.1 as a trustworthy origin and keep the cookie; WebKit
 * does not, so the session never sticks: bootstrap succeeds, the app asks for a
 * sign-in, and signing in sets the same discarded cookie. Measured, not assumed
 * — dropping `Secure` from the same server carried WebKit through the journey.
 *
 * A real deployment terminates TLS in front (DEPLOYING.md §5), where the flag is
 * exactly right. Testing it properly needs a certificate this harness has no
 * business owning; asserting Chromium's cookie policy on Safari would only teach
 * us to ignore a red suite. The Safari-over-plain-http case is reported instead.
 */
test.skip(({ browserName }) => browserName === 'webkit', 'WebKit refuses a Secure cookie over http')

const PORT = 3211
const BASE = `http://127.0.0.1:${PORT}`

const OWNER = {
  username: 'olav',
  displayName: 'Olav Owner',
  password: 'owner-passphrase-1',
  email: 'olav@example.test',
}
const MEMBER = {
  username: 'mia',
  displayName: 'Mia Member',
  password: 'member-passphrase-1',
  newPassword: 'member-passphrase-2',
}

/** The owner's resume, renamed so it is identifiable in the member's picker. */
const RESUME_NAME = 'Owner Only CV'
/** Content inside that resume, distinct from any account display name. */
const FULL_NAME = 'Olav Nordmann'

let server: ChildProcess | null = null
let ownerContext: BrowserContext
let memberContext: BrowserContext
let ownerPage: Page
let memberPage: Page

/** Read off the server's console in `beforeAll`, spent by the first test. */
let bootstrapCode = ''

/**
 * Start a genuinely fresh server and resolve with the one-time code it prints.
 *
 * No token and no `RESUME_SETUP`: an empty database with neither is what a
 * first-time operator following DEPLOYING.md §3 actually has, and it is the case
 * the accounts feature has to be reachable from — the instance is in `open`
 * mode, so nothing answers 401 and no sign-in gate is ever mounted.
 *
 * The banner is written from inside the `listen` callback, so the code arriving
 * is also the readiness signal — there is nothing left to poll for.
 */
function startFreshServer(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('npx tsx server/index.ts', {
      shell: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(PORT),
        RESUME_DB_PATH: ':memory:',
        // Makes the invite and reset links absolute, which is what an owner
        // copies out of the team screen and hands over.
        RESUME_APP_BASE_URL: BASE,
      },
    })
    server = child

    let out = ''
    const read = (buf: Buffer) => {
      out += buf.toString()
      const m = /\b([0-9A-Z]{5}(?:-[0-9A-Z]{5}){3})\b/.exec(out)
      if (m) resolve(m[1])
    }
    child.stdout?.on('data', read)
    child.stderr?.on('data', read)
    child.on('exit', (code) => reject(new Error(`server exited (${code}):\n${out}`)))
    setTimeout(() => reject(new Error(`no bootstrap code within 60s. Server said:\n${out}`)), 60_000)
  })
}

function stopServer(): void {
  const child = server
  server = null
  if (!child?.pid) return
  // The server runs under a shell, so killing the shell alone leaves node
  // holding the port and the next run fails at boot. Synchronous because the
  // test process can exit before an async kill has run — which is how the port
  // stayed bound after the first failing run here.
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

/**
 * Open the app once in a fresh browser profile and let it settle.
 *
 * A first visit to an origin registers the service worker, which claims the
 * open page as soon as it activates; `swRegister.ts` reloads on
 * `controllerchange`, so roughly a second after the first paint the document is
 * replaced and anything typed into it is gone. Every screen a first-time
 * visitor types into — setup, sign-in, an invitation — is inside that window.
 *
 * Absorbed here rather than asserted, because a suite racing one defect cannot
 * report any other. It is filed separately as the defect it is.
 */
async function firstVisit(page: Page): Promise<void> {
  // The app's reload can land mid-navigation, which Playwright reports as
  // "interrupted by another navigation". One retry is enough: the worker claims
  // a profile once, so the second attempt has nothing left to race.
  const open = async () => {
    try {
      await page.goto('/')
    } catch {
      await page.goto('/')
    }
  }

  await open()
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller,
      null,
      { timeout: 20_000 },
    )
    .catch(() => { /* no worker here: nothing will claim the page, nothing to wait for */ })
  // Taking the next navigation ourselves guarantees the document every test
  // below works in is one the worker was already controlling.
  await open()
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000)
  bootstrapCode = await startFreshServer()
  ownerContext = await browser.newContext({ baseURL: BASE })
  memberContext = await browser.newContext({ baseURL: BASE })
  ownerPage = await ownerContext.newPage()
  memberPage = await memberContext.newPage()
  await firstVisit(ownerPage)
  await firstVisit(memberPage)
})

test.afterAll(async () => {
  await ownerContext?.close()
  await memberContext?.close()
  stopServer()
})

// ─── Shared steps ────────────────────────────────────────────────────────────

async function signIn(page: Page, login: string, password: string): Promise<void> {
  await page.getByLabel('Username or email address').fill(login)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function signOut(page: Page, displayName: string): Promise<void> {
  await page.getByRole('button', { name: displayName }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
}

// ─── First run ───────────────────────────────────────────────────────────────

test('a fresh instance offers setup, and the one-time code creates the owner', async () => {
  // The operator's actual starting point: an instance with no accounts, which
  // therefore answers no 401 and mounts no sign-in gate. Whatever offers setup
  // here is the ONLY way the feature can be found from a browser.
  await ownerPage.goto('/')
  await expect(ownerPage.getByRole('heading', { name: 'Cartavio Resume Studio' })).toBeVisible()
  await ownerPage.getByRole('button', { name: 'Set up accounts' }).click()
  await expect(ownerPage).toHaveURL(/\/setup$/)
  await expect(ownerPage.getByRole('heading', { name: 'Set up your account' })).toBeVisible()

  await ownerPage.getByLabel('One-time setup code').fill(bootstrapCode)
  await ownerPage.getByLabel('Username').fill(OWNER.username)
  await ownerPage.getByLabel('Display name').fill(OWNER.displayName)
  await ownerPage.getByLabel('Password', { exact: true }).fill(OWNER.password)
  await ownerPage.getByRole('button', { name: 'Create the owner account' }).click()

  await expect(ownerPage.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible()
  await expect(ownerPage.getByRole('listitem')).toHaveCount(10)

  // The gate is not ceremony: the codes are stored hashed, so this is the last
  // moment they exist in readable form.
  const carryOn = ownerPage.getByRole('button', { name: 'Continue' })
  await expect(carryOn).toBeDisabled()
  await ownerPage.getByRole('checkbox', { name: 'I have saved these codes' }).check()
  await expect(carryOn).toBeEnabled()
  await carryOn.click()

  /**
   * The app should be on screen by now, and it is not: Continue leaves the
   * operator on the recovery-codes panel with nothing else to click.
   * `AcceptInviteScreen` calls `navigate('/')` after its identical panel;
   * `AuthGate`'s only drops the gate, which was enough while the gate was an
   * overlay on top of the app and is a dead end now that `/setup` is a route of
   * its own. Reported rather than fixed — the navigation below stands in for the
   * one the app owes the user, so the rest of the journey can be verified.
   */
  await ownerPage.goto('/')
  // Signed in, on an instance that still has no resumes.
  await expect(ownerPage.getByRole('heading', { name: 'Cartavio Resume Studio' })).toBeVisible()
  // And the setup notice is gone: an instance with accounts is not offering to
  // create its first one.
  await expect(ownerPage.getByRole('button', { name: 'Set up accounts' })).toHaveCount(0)
})

// ─── A resume of one's own ───────────────────────────────────────────────────

test('a resume the owner creates is private until they say otherwise', async () => {
  test.setTimeout(60_000)
  await createResume(ownerPage)
  // The editor knows who is looking, which it never could before accounts.
  await expect(ownerPage.getByRole('button', { name: OWNER.displayName })).toBeVisible()

  await ownerPage.getByRole('link', { name: 'Personal Details' }).click()
  await ownerPage.getByLabel('Full name', { exact: true }).fill(FULL_NAME)
  await expect(ownerPage.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

  await ownerPage.goto('/')
  await ownerPage.getByRole('button', { name: 'Rename My resume' }).click()
  const nameField = ownerPage.getByLabel('Resume name')
  await nameField.fill(RESUME_NAME)
  await nameField.press('Enter')

  await expect(ownerPage.getByRole('link', { name: RESUME_NAME })).toBeVisible()
  await expect(
    ownerPage.getByRole('button', { name: `Share ${RESUME_NAME} with the team` }),
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(ownerPage.getByText('Shared with the team')).toHaveCount(0)
})

// ─── Sign out, and back in by either identifier ──────────────────────────────

test('sign-in takes the username or the email address, and refuses both alike', async () => {
  test.setTimeout(90_000)
  await ownerPage.goto('/profile')
  await expect(ownerPage.getByRole('heading', { name: 'Your account' })).toBeVisible()
  // The codes really were a one-time showing: the profile reports a count.
  await expect(ownerPage.getByText('10 unused codes left')).toBeVisible()
  await expect(ownerPage.getByRole('heading', { name: 'Your recovery codes' })).toHaveCount(0)

  // An address is what makes the second login identifier testable at all
  // (bootstrap does not ask for one), and it costs the current password.
  await ownerPage.getByLabel('Email address', { exact: true }).fill(OWNER.email)
  await ownerPage.getByLabel('Your current password').fill(OWNER.password)
  await ownerPage.getByRole('button', { name: 'Save sign-in details' }).click()
  await expect(ownerPage.getByText(/A new address has to be confirmed/)).toBeVisible()

  await ownerPage.goto('/')
  await signOut(ownerPage, OWNER.displayName)

  // The refusal is deliberately the same sentence for a wrong password and for
  // an account that does not exist. Asserting both is the only way that stays
  // true — a helpful "no such user" is a one-line change away.
  await signIn(ownerPage, OWNER.username, 'not-the-password')
  await expect(ownerPage.getByRole('alert')).toHaveText('Wrong username or password.')
  await signIn(ownerPage, 'nobody-at-all', 'not-the-password')
  await expect(ownerPage.getByRole('alert')).toHaveText('Wrong username or password.')

  await signIn(ownerPage, OWNER.username, OWNER.password)
  await expect(ownerPage.getByRole('heading', { name: 'Your resumes' })).toBeVisible()

  await signOut(ownerPage, OWNER.displayName)
  await signIn(ownerPage, OWNER.email, OWNER.password)
  await expect(ownerPage.getByRole('heading', { name: 'Your resumes' })).toBeVisible()
})

// ─── Inviting somebody ───────────────────────────────────────────────────────

test('the owner mints an invitation and the invitee redeems it in their own browser', async () => {
  test.setTimeout(60_000)
  await ownerPage.getByRole('button', { name: OWNER.displayName }).click()
  await ownerPage.getByRole('link', { name: 'Team' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Team' })).toBeVisible()

  await ownerPage.getByRole('button', { name: 'Create an invitation' }).click()
  const inviteLink = await ownerPage.getByLabel('Invitation link').inputValue()
  expect(inviteLink).toContain('/accept?token=')

  // A different browser context: no cookie, no cache, nothing carried over —
  // which is what the person receiving the link actually has.
  await memberPage.goto(inviteLink)
  await expect(memberPage.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible()
  await memberPage.getByLabel('Username').fill(MEMBER.username)
  await memberPage.getByLabel('Display name').fill(MEMBER.displayName)
  await memberPage.getByLabel('Password', { exact: true }).fill(MEMBER.password)
  await memberPage.getByRole('button', { name: 'Create my account' }).click()

  await expect(memberPage.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible()
  await memberPage.getByRole('checkbox', { name: 'I have saved these codes' }).check()
  await memberPage.getByRole('button', { name: 'Continue' }).click()

  // Signed in and on their own (empty) picker — never at a login form.
  await expect(memberPage.getByRole('heading', { name: 'Cartavio Resume Studio' })).toBeVisible()

  // Single-use: the same link cannot mint a second account.
  const second = await memberContext.newPage()
  await second.goto(inviteLink)
  await expect(second.getByText(/expired or has already been used/)).toBeVisible()
  await second.close()
})

// ─── Scoping, with two people signed in at once ──────────────────────────────

test('a member cannot see the owner resume until it is shared, and then only reads it', async () => {
  test.setTimeout(90_000)
  // Wait for the picker to have ANSWERED before asserting an absence: the
  // fresh-install screen only renders once the list came back empty, so the
  // loading state cannot be mistaken for "they cannot see it".
  await memberPage.goto('/')
  await expect(memberPage.getByRole('heading', { name: 'Cartavio Resume Studio' })).toBeVisible()
  await expect(memberPage.getByText(RESUME_NAME)).toHaveCount(0)

  await ownerPage.goto('/')
  await ownerPage.getByRole('button', { name: `Share ${RESUME_NAME} with the team` }).click()
  await expect(
    ownerPage.getByRole('button', { name: `Share ${RESUME_NAME} with the team` }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(ownerPage.getByText('Shared with the team')).toBeVisible()

  await memberPage.goto('/')
  await expect(memberPage.getByRole('link', { name: RESUME_NAME })).toBeVisible()
  // Said before it is opened: an editor that silently refuses everything typed
  // into it is worse found out than announced.
  await expect(memberPage.getByText(/read only/i)).toBeVisible()
  await expect(memberPage.getByRole('button', { name: `Rename ${RESUME_NAME}` })).toHaveCount(0)
  await expect(memberPage.getByRole('button', { name: `Delete ${RESUME_NAME}` })).toHaveCount(0)

  await memberPage.getByRole('link', { name: RESUME_NAME }).click()
  await expect(memberPage.getByRole('button', { name: MEMBER.displayName })).toBeVisible()
  await expect(memberPage.getByRole('status').filter({ hasText: /read only/i })).toBeVisible()

  await memberPage.getByRole('link', { name: 'Personal Details' }).click()
  const fullName = memberPage.getByLabel('Full name', { exact: true })
  await expect(fullName).toHaveValue(FULL_NAME)
  await fullName.fill('Member Was Here')

  // Two proofs, because either alone can lie. The value snapping back says the
  // store refused the write; the reload says nothing reached the server, which
  // is what would survive a store that quietly accepted it.
  await expect(fullName).toHaveValue(FULL_NAME)
  // Long enough for a save to have happened if one were coming: the editor
  // debounces 1s before it PUTs. Asserting the absence sooner would pass
  // whether or not the write was refused.
  await memberPage.waitForTimeout(2_000)
  await expect(memberPage.getByText('Saved', { exact: true })).toHaveCount(0)
  await memberPage.reload()
  await expect(memberPage.getByLabel('Full name', { exact: true })).toHaveValue(FULL_NAME)

  // And the owner's own copy is untouched.
  await ownerPage.goto('/')
  await ownerPage.getByRole('link', { name: RESUME_NAME }).click()
  await ownerPage.getByRole('link', { name: 'Personal Details' }).click()
  await expect(ownerPage.getByLabel('Full name', { exact: true })).toHaveValue(FULL_NAME)
})

// ─── Getting back in ─────────────────────────────────────────────────────────

test('an owner-issued reset link sets a new password and ends the old session', async () => {
  test.setTimeout(90_000)
  await ownerPage.goto('/admin')
  const memberCard = ownerPage.locator('section').filter({ hasText: `@${MEMBER.username}` })
  await memberCard.getByRole('button', { name: 'Reset link' }).click()
  const resetLink = await ownerPage.getByLabel(`Reset link for ${MEMBER.displayName}`).inputValue()
  expect(resetLink).toContain('/reset?token=')

  await memberPage.goto(resetLink)
  await expect(memberPage.getByRole('heading', { name: 'Set a new password' })).toBeVisible()
  await memberPage.getByLabel('New password', { exact: true }).fill(MEMBER.newPassword)
  await memberPage.getByLabel('Repeat the new password').fill(MEMBER.newPassword)
  await memberPage.getByRole('button', { name: 'Set password' }).click()
  await expect(memberPage.getByRole('heading', { name: 'Password changed' })).toBeVisible()

  // A reset exists because the old credential may be in somebody else's hands,
  // so the session it opened has to be gone — including this browser's.
  await memberPage.goto('/')
  await expect(memberPage.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await signIn(memberPage, MEMBER.username, MEMBER.password)
  await expect(memberPage.getByRole('alert')).toHaveText('Wrong username or password.')

  await signIn(memberPage, MEMBER.username, MEMBER.newPassword)
  await expect(memberPage.getByRole('link', { name: RESUME_NAME })).toBeVisible()
})
