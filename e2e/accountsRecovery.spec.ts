/**
 * The ways back in, and the ways an owner takes access away — in a real browser,
 * against a server that can actually send mail.
 *
 * `accounts.spec.ts` covers the journey that needs no mailbox: setup, sign-in,
 * an invitation, scoping, and the reset link an owner hands over by hand. What
 * is left is everything that only exists once a transport is configured, plus
 * the two administrative acts whose whole point is that they take effect at
 * once rather than at the next login.
 *
 * MAIL IS CAPTURED, NOT MOCKED. The server talks SMTP to a sink this file
 * listens on (`serverHarness.ts`), so the message asserted below is the one
 * `server/mail.ts` actually put on the wire — headers, framing and all. A test
 * that stubbed the send would prove the route was reached and nothing about
 * what reached the reader.
 *
 * WHY THE MESSAGE IS READ AT ALL. Two of the rules this feature is built on are
 * only checkable from the message itself: that no CV content is ever emailed,
 * and that an unverified address receives nothing. Neither is visible from the
 * API, which answers identically either way on purpose.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { createResume } from './helpers'
import {
  firstVisit, signIn, signOut, startMailSink, startServer,
  type MailSink, type ServerHandle,
} from './serverHarness'

// Serial for the same two reasons as `accounts.spec.ts`: each test stands on the
// state the last one left, and WebKit spends four to ten seconds on clicks that
// cost Chromium under one.
test.describe.configure({ mode: 'serial', timeout: 180_000 })

const PORT = 3212
const SMTP_PORT = 3214
const BASE = `http://127.0.0.1:${PORT}`

/**
 * The mailbox is deliberately unrelated to the username and display name, so
 * "the message names no account" is a claim the assertions can actually test.
 */
const OWNER = {
  username: 'ola',
  displayName: 'Ola Eier',
  email: 'postkasse@example.test',
  firstPassword: 'owner-passphrase-one',
  mailedPassword: 'owner-passphrase-two',
  recoveredPassword: 'owner-passphrase-three',
}
const MEMBER = {
  username: 'mina',
  displayName: 'Mina Medlem',
  password: 'member-passphrase-one',
}

/** Content of the owner's CV, and its name in the picker. Neither may be emailed. */
const CV_FULL_NAME = 'Kari Hemmelig'
const RESUME_NAME = 'Confidential Client CV'

const SUBJECT_VERIFY = /Confirm your Resume Studio email address/
const SUBJECT_RESET = /Reset your Resume Studio password/

/** The wording `/forgot` gives back. Identical for every outcome, by design. */
const FORGOT_ANSWER = /If that account exists and has a verified address/

let server: ServerHandle | null = null
let mail: MailSink | null = null
let ownerContext: BrowserContext
let memberContext: BrowserContext
let ownerPage: Page
let memberPage: Page

/** Shown once, at setup. One of them is spent below. */
let recoveryCodes: string[] = []

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  mail = await startMailSink(SMTP_PORT)
  server = await startServer({
    port: PORT,
    env: {
      RESUME_APP_BASE_URL: BASE,
      // `smtp` rather than `sendmail` because this suite runs on Windows too;
      // see serverHarness.ts. No user, so no AUTH is attempted.
      MAIL_TRANSPORT: 'smtp',
      MAIL_FROM: 'resume-studio@example.test',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(SMTP_PORT),
      SMTP_SECURITY: 'none',
      // `/forgot`, `/reset`, `/recover` and `/accept` share ONE success-inclusive
      // budget of five per fifteen minutes, keyed by address. This file walks all
      // four in about a minute, which trips it at the invitation — "Too many
      // attempts. Try again later." on the accept form. Raised so the suite
      // measures the flows rather than the brake.
      RESUME_RECOVERY_RATE_LIMIT_MAX: '50',
    },
  })

  ownerContext = await browser.newContext({ baseURL: BASE })
  memberContext = await browser.newContext({ baseURL: BASE })
  ownerPage = await ownerContext.newPage()
  memberPage = await memberContext.newPage()
  await firstVisit(ownerPage)
  await firstVisit(memberPage)

  // Setup itself is `accounts.spec.ts`'s subject; here it is only the ground the
  // rest stands on — except for the codes, which are shown once and never again,
  // so this is the only place they can be captured.
  await ownerPage.goto('/setup')
  await ownerPage.getByLabel('One-time setup code').fill(server.bootstrapCode)
  await ownerPage.getByLabel('Username').fill(OWNER.username)
  await ownerPage.getByLabel('Display name').fill(OWNER.displayName)
  await ownerPage.getByLabel('Password', { exact: true }).fill(OWNER.firstPassword)
  await ownerPage.getByRole('button', { name: 'Create the owner account' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible()
  recoveryCodes = await ownerPage.getByRole('listitem').allTextContents()
  await ownerPage.getByRole('checkbox', { name: 'I have saved these codes' }).check()
  await ownerPage.getByRole('button', { name: 'Continue' }).click()

  // A real CV, so "no CV content is emailed" is asserted against content that
  // exists rather than against an empty instance.
  await createResume(ownerPage)
  await ownerPage.getByRole('link', { name: 'Personal Details' }).click()
  await ownerPage.getByLabel('Full name', { exact: true }).fill(CV_FULL_NAME)
  await expect(ownerPage.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 })
  await ownerPage.goto('/')
  await ownerPage.getByRole('button', { name: 'Rename My resume' }).click()
  const nameField = ownerPage.getByLabel('Resume name')
  await nameField.fill(RESUME_NAME)
  await nameField.press('Enter')
  await expect(ownerPage.getByRole('link', { name: RESUME_NAME })).toBeVisible()
})

test.afterAll(async () => {
  await ownerContext?.close()
  await memberContext?.close()
  server?.stop()
  await mail?.close()
})

/** Everything this app is allowed to put in a message: one link, and no names. */
function expectCarriesNothingPrivate(raw: string): void {
  expect(raw).not.toContain(CV_FULL_NAME)
  expect(raw).not.toContain(RESUME_NAME)
  // Not even whose account it is: a message that says so is worth more to
  // somebody who reached the mailbox by mistake than it is to its owner.
  expect(raw).not.toContain(OWNER.displayName)
}

/** Ask for a reset link and wait for the one answer the server ever gives. */
async function askForAReset(page: Page, login: string): Promise<void> {
  await page.goto('/forgot')
  await page.getByLabel('Username or email address').fill(login)
  await page.getByRole('button', { name: 'Send a reset link' }).click()
  await expect(page.getByRole('status').filter({ hasText: FORGOT_ANSWER })).toBeVisible()
}

// ─── D5: an address proves itself before it can carry a credential ───────────

test('an address receives nothing until its confirmation link is followed', async () => {
  await ownerPage.goto('/profile')
  await expect(ownerPage.getByRole('heading', { name: 'Your account' })).toBeVisible()
  await ownerPage.getByLabel('Email address', { exact: true }).fill(OWNER.email)
  await ownerPage.getByLabel('Your current password').fill(OWNER.firstPassword)
  await ownerPage.getByRole('button', { name: 'Save sign-in details' }).click()

  // Saving the address sends the confirmation by itself — the resend button is
  // for when that message never arrived, not for the first one.
  const verify = await mail!.waitFor(SUBJECT_VERIFY)
  expect(verify.to).toBe(OWNER.email)
  expectCarriesNothingPrivate(verify.raw)
  expect(verify.link).toContain(`${BASE}/verify-email?token=`)

  // The half that matters: until that link is followed, the address is not a
  // channel. A mistyped one would otherwise post a credential to a stranger.
  const before = mail!.messages.length
  await askForAReset(ownerPage, OWNER.username)
  // Long enough for a send to have happened if one were coming. Asserting the
  // absence sooner would pass whether or not the address was gated.
  await ownerPage.waitForTimeout(3_000)
  expect(mail!.messages.length).toBe(before)

  await ownerPage.goto(verify.link)
  await expect(ownerPage.getByText(/Confirmed\. This address can now receive/)).toBeVisible()

  // And the profile agrees, which is what the owner sees the next time they look.
  await ownerPage.goto('/profile')
  await expect(ownerPage.getByText('Confirmed', { exact: true })).toBeVisible()
})

// ─── The trigger that needs neither an administrator nor a mailbox ───────────

/*
 * Spent BEFORE the emailed reset below, and the order is the product's rather
 * than this file's convenience: setting a password clears every recovery code,
 * so a reset performed first leaves nothing here to spend.
 */
test('a recovery code sets a password, and a fresh set replaces the one it spent', async () => {
  await ownerPage.goto('/')
  await signOut(ownerPage, OWNER.displayName)
  await ownerPage.getByRole('link', { name: 'Use a recovery code' }).click()
  await expect(ownerPage).toHaveURL(/\/recover$/)

  await ownerPage.getByLabel('Username or email address').fill(OWNER.username)
  await ownerPage.getByLabel('Recovery code').fill(recoveryCodes[0])
  await ownerPage.getByLabel('New password', { exact: true }).fill(OWNER.recoveredPassword)
  await ownerPage.getByRole('button', { name: 'Set new password' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Password changed' })).toBeVisible()

  /*
   * The replacement set, on screen, once.
   *
   * Setting a password clears every code, so the server mints a new set and
   * returns it here. This screen used to render a COUNT the server has never
   * sent — so `?? 0` made every recovery announce "that was your last recovery
   * code" while dropping the ten it had just been handed. They are stored
   * hashed: nothing could have recovered them afterwards.
   */
  await expect(ownerPage.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible()
  const replacements = await ownerPage.locator('.rc-codes code').allInnerTexts()
  expect(replacements.length).toBe(10)
  // Genuinely a new set, not the one just spent from.
  expect(replacements).not.toContain(recoveryCodes[0])
  recoveryCodes = replacements

  await ownerPage.getByRole('checkbox', { name: 'I have saved these codes' }).check()
  await ownerPage.getByRole('button', { name: 'Continue' }).click()

  await ownerPage.goto('/')
  await signIn(ownerPage, OWNER.username, OWNER.recoveredPassword)
  await expect(ownerPage.getByRole('heading', { name: 'Your resumes' })).toBeVisible()

  // Spending a code would otherwise leave the account with none — one forgotten
  // password from needing the owner or the server console. The server re-issues;
  // the profile is where that shows up.
  await ownerPage.goto('/profile')
  await expect(ownerPage.getByText('10 unused codes left')).toBeVisible()
})

// ─── The fourth reset trigger: a message the user asked for ──────────────────

test('the sign-in screen offers a forgotten-password link, and it mails a working reset', async () => {
  await ownerPage.goto('/')
  await signOut(ownerPage, OWNER.displayName)
  // Offered only because a transport is configured — hidden, never disabled,
  // on an instance that cannot send.
  await ownerPage.getByRole('link', { name: 'Forgotten password?' }).click()
  await expect(ownerPage).toHaveURL(/\/forgot$/)

  await ownerPage.getByLabel('Username or email address').fill(OWNER.email)
  await ownerPage.getByRole('button', { name: 'Send a reset link' }).click()
  await expect(ownerPage.getByRole('status').filter({ hasText: FORGOT_ANSWER })).toBeVisible()

  const reset = await mail!.waitFor(SUBJECT_RESET)
  expect(reset.to).toBe(OWNER.email)
  expectCarriesNothingPrivate(reset.raw)
  expect(reset.link).toContain(`${BASE}/reset?token=`)

  await ownerPage.goto(reset.link)
  await expect(ownerPage.getByRole('heading', { name: 'Set a new password' })).toBeVisible()
  await ownerPage.getByLabel('New password', { exact: true }).fill(OWNER.mailedPassword)
  await ownerPage.getByLabel('Repeat the new password').fill(OWNER.mailedPassword)
  await ownerPage.getByRole('button', { name: 'Set password' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Password changed' })).toBeVisible()

  await ownerPage.goto('/')
  await signIn(ownerPage, OWNER.username, OWNER.recoveredPassword)
  await expect(ownerPage.getByRole('alert')).toHaveText('Wrong username or password.')
  await signIn(ownerPage, OWNER.username, OWNER.mailedPassword)
  await expect(ownerPage.getByRole('heading', { name: 'Your resumes' })).toBeVisible()

  // Single-use: the link cannot set a second password.
  await ownerPage.goto(reset.link)
  await ownerPage.getByLabel('New password', { exact: true }).fill('some-other-passphrase')
  await ownerPage.getByLabel('Repeat the new password').fill('some-other-passphrase')
  await ownerPage.getByRole('button', { name: 'Set password' }).click()
  await expect(ownerPage.getByRole('alert')).toHaveText(/expired or has already been used/)
})

test('a login that does not exist gets the same answer and no message', async () => {
  const before = mail!.messages.length
  await askForAReset(ownerPage, 'nobody-at-all')
  await ownerPage.waitForTimeout(3_000)
  expect(mail!.messages.length).toBe(before)
})

// ─── What an owner can take away ─────────────────────────────────────────────

test('a member has no team page', async () => {
  await ownerPage.goto('/admin')
  await ownerPage.getByRole('button', { name: 'Create an invitation' }).click()
  const inviteLink = await ownerPage.getByLabel('Invitation link').inputValue()

  await memberPage.goto(inviteLink)
  await memberPage.getByLabel('Username').fill(MEMBER.username)
  await memberPage.getByLabel('Display name').fill(MEMBER.displayName)
  await memberPage.getByLabel('Password', { exact: true }).fill(MEMBER.password)
  await memberPage.getByRole('button', { name: 'Create my account' }).click()
  await expect(memberPage.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible()
  await memberPage.getByRole('checkbox', { name: 'I have saved these codes' }).check()
  await memberPage.getByRole('button', { name: 'Continue' }).click()

  // The menu does not offer what the route would refuse.
  await memberPage.getByRole('button', { name: MEMBER.displayName }).click()
  await expect(memberPage.getByRole('link', { name: 'Your account' })).toBeVisible()
  await expect(memberPage.getByRole('link', { name: 'Team' })).toHaveCount(0)

  // And the route refuses it in its own right, not only in the chrome.
  await memberPage.goto('/admin')
  await expect(memberPage.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('promoting a member to owner opens the team page to them', async () => {
  await ownerPage.goto('/admin')
  const card = ownerPage.locator('section').filter({ hasText: `@${MEMBER.username}` })
  await card.getByRole('button', { name: 'Make an owner' }).click()
  await ownerPage
    .getByRole('dialog', { name: `Make ${MEMBER.displayName} an owner?` })
    .getByRole('button', { name: 'Make owner' })
    .click()
  await expect(card.getByText('Owner ·')).toBeVisible()

  // The identity is memoized for the page's lifetime, so a fresh document is
  // what a role change costs the person it happened to — not a fresh sign-in.
  await memberPage.goto('/')
  await memberPage.getByRole('button', { name: MEMBER.displayName }).click()
  await memberPage.getByRole('link', { name: 'Team' }).click()
  await expect(memberPage.getByRole('heading', { name: 'Team' })).toBeVisible()
})

test('disabling an account ends the session it already had', async () => {
  await ownerPage.goto('/admin')
  const card = ownerPage.locator('section').filter({ hasText: `@${MEMBER.username}` })
  await card.getByRole('button', { name: 'Disable' }).click()
  await ownerPage
    .getByRole('dialog', { name: `Disable ${MEMBER.displayName}?` })
    .getByRole('button', { name: 'Disable' })
    .click()
  // Exact: the card also shows the transient "Disabled." note after the action.
  await expect(card.getByText('Disabled', { exact: true })).toBeVisible()

  // Immediately, on the session they were already holding — a disable that only
  // took effect at the next sign-in would be no disable at all.
  await memberPage.goto('/')
  await expect(memberPage.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  // And the refusal is the same sentence a wrong password gets: "your account is
  // disabled" tells whoever is at the keyboard that the account exists.
  await signIn(memberPage, MEMBER.username, MEMBER.password)
  await expect(memberPage.getByRole('alert')).toHaveText('Wrong username or password.')
})

// ─── Keeping a way back in after using one ──────────────────────────────────

/*
 * The profile's own way to replace the set — the escape route every "you are
 * running low" message points at. It has to work, or somebody who spent their
 * last code is sent to a control that refuses them.
 */
test('the profile can replace the set, and asks for the password before it does', async () => {
  const recovery = ownerPage.getByRole('region', { name: 'Recovery codes' })
  await ownerPage.goto('/profile')

  // The endpoint has always required the current password, and the form never
  // asked for it, so this button answered 403 on every click. A recovery code
  // outlives the session that minted it and on its own sets a new password, so
  // a borrowed screen could otherwise mint ten and void the set the real user
  // had saved.
  await expect(recovery.getByRole('button', { name: 'Generate a new set' })).toBeDisabled()

  await recovery.getByLabel('Your current password').fill(OWNER.recoveredPassword)
  await recovery.getByRole('button', { name: 'Generate a new set' }).click()
  await ownerPage
    .getByRole('dialog', { name: 'Generate new recovery codes?' })
    .getByRole('button', { name: 'Generate new codes' })
    .click()

  await expect(recovery.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible()
  expect((await recovery.locator('.rc-codes code').allInnerTexts()).length).toBe(10)
})
