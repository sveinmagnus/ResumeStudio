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
import { createResume } from './helpers'
import { firstVisit, signIn, signOut, startServer, type ServerHandle } from './serverHarness'

/*
 * Serial, because every test below stands on the one before it — an account
 * exists because the previous test created it. Serial mode reports the first
 * break and skips the rest, instead of a cascade of failures about one cause.
 *
 * The budget is generous because WebKit is: measured here, a click Chromium
 * settles in under a second costs it four to ten, so the journey below spends
 * roughly a minute per test on that engine. A timeout tuned to Chromium reports
 * WebKit as broken when it is only slow — which is the reading that got this
 * suite skipped on WebKit, so the number is load-bearing.
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 })

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

let server: ServerHandle | null = null
let ownerContext: BrowserContext
let memberContext: BrowserContext
let ownerPage: Page
let memberPage: Page

/** Read off the server's console in `beforeAll`, spent by the first test. */
let bootstrapCode = ''

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000)
  // No token and no `RESUME_SETUP`: an empty database with neither is what a
  // first-time operator following DEPLOYING.md §3 actually has, and it is the
  // case the accounts feature has to be reachable from — the instance is in
  // `open` mode, so nothing answers 401 and no sign-in gate is ever mounted.
  server = await startServer({
    port: PORT,
    // Makes the invite and reset links absolute, which is what an owner copies
    // out of the team screen and hands over.
    env: { RESUME_APP_BASE_URL: BASE },
  })
  bootstrapCode = server.bootstrapCode
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
  await server?.stop()
})

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

  // Continue has to leave `/setup` as well as drop the gate: the gate used to be
  // an overlay on top of the app, where clearing a flag was enough, and `/setup`
  // is a route of its own now — clearing the flag alone re-renders the same
  // screen with the codes still in its state, and the only way out is the
  // address bar.
  await expect(ownerPage).toHaveURL(new RegExp(`^${BASE}/$`))
  // Signed in, on an instance that still has no resumes.
  await expect(ownerPage.getByRole('heading', { name: 'Cartavio Resume Studio' })).toBeVisible()
  // And the setup notice is gone: an instance with accounts is not offering to
  // create its first one.
  await expect(ownerPage.getByRole('button', { name: 'Set up accounts' })).toHaveCount(0)
})

// ─── A resume of one's own ───────────────────────────────────────────────────

test('a resume the owner creates is private until they say otherwise', async () => {
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
  await ownerPage.goto('/profile')
  await expect(ownerPage.getByRole('heading', { name: 'Your account' })).toBeVisible()
  // The codes really were a one-time showing: the profile reports a count.
  await expect(ownerPage.getByText('10 unused codes left')).toBeVisible()
  await expect(ownerPage.getByRole('heading', { name: 'Your recovery codes' })).toHaveCount(0)

  // An address is what makes the second login identifier testable at all
  // (bootstrap does not ask for one), and it costs the current password.
  await ownerPage.getByLabel('Email address', { exact: true }).fill(OWNER.email)
  // Scoped to the card: three of the four now carry a current-password field,
  // which is why each is a named region rather than a bare <section>.
  await ownerPage.getByRole('region', { name: 'How you sign in' })
    .getByLabel('Your current password').fill(OWNER.password)
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
  await ownerPage.getByRole('button', { name: OWNER.displayName }).click()
  await ownerPage.getByRole('link', { name: 'Team' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Team' })).toBeVisible()

  await ownerPage.getByRole('button', { name: 'Create an invitation' }).click()
  const inviteLink = await ownerPage.getByLabel('Invitation link').inputValue()
  // ABSOLUTE, because the server was told its own address. A relative path is
  // what the route falls back to when it does not know it, and an owner pasting
  // that into a chat window hands over something nobody else can open.
  expect(inviteLink).toBe(`${BASE}/accept?token=${inviteLink.split('token=')[1]}`)

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
  // The filled name shows as the write-once display; the pencil reopens the
  // input (component state only — refusing the WRITE is the store's job, and
  // is exactly what the next lines prove).
  await memberPage.getByRole('button', { name: 'Edit full name' }).click()
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
  await memberPage.getByRole('button', { name: 'Edit full name' }).click()
  await expect(memberPage.getByLabel('Full name', { exact: true })).toHaveValue(FULL_NAME)

  // And the owner's own copy is untouched.
  await ownerPage.goto('/')
  await ownerPage.getByRole('link', { name: RESUME_NAME }).click()
  await ownerPage.getByRole('link', { name: 'Personal Details' }).click()
  await ownerPage.getByRole('button', { name: 'Edit full name' }).click()
  await expect(ownerPage.getByLabel('Full name', { exact: true })).toHaveValue(FULL_NAME)
})

// ─── Getting back in ─────────────────────────────────────────────────────────

test('an owner-issued reset link sets a new password and ends the old session', async () => {
  await ownerPage.goto('/admin')
  const memberCard = ownerPage.locator('section').filter({ hasText: `@${MEMBER.username}` })
  await memberCard.getByRole('button', { name: 'Reset link' }).click()
  const resetLink = await ownerPage.getByLabel(`Reset link for ${MEMBER.displayName}`).inputValue()
  expect(resetLink).toBe(`${BASE}/reset?token=${resetLink.split('token=')[1]}`)

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
