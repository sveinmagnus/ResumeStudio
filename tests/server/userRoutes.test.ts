import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'

/**
 * The outbound-mail boundary, captured rather than sent. Everything else in
 * server/mail stays real — `isMailConfigured` keeps reading the environment, so
 * the tests drive the same configured/unconfigured branches the routes do.
 * Transporting a real message would need an MTA; recording (to, link) is the
 * whole observable contract of these two functions from the router's side.
 */
const mailbox = vi.hoisted(() => ({
  reset: [] as Array<{ to: string; link: string }>,
  verify: [] as Array<{ to: string; link: string }>,
}))

vi.mock('../../server/mail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/mail')>()
  const record = (box: Array<{ to: string; link: string }>) =>
    (to: string, link: string): Promise<{ ok: true }> => {
      box.push({ to, link })
      return Promise.resolve({ ok: true })
    }
  return { ...actual, sendResetMail: record(mailbox.reset), sendVerifyMail: record(mailbox.verify) }
})

/**
 * The account-lifecycle routes, mounted directly rather than through
 * `createApp()`.
 *
 * Mounting the router on a bare app keeps this suite about authorization and
 * the reset grammar, and lets it run while `app.ts` is still being wired. The
 * CSRF and rate-limit layers are `createApp`'s job and are tested there.
 *
 * Each role is driven by a REAL session cookie rather than a stubbed
 * `res.locals.viewer`. That is not ceremony: the router applies the real
 * `authMiddleware` partway down (the public reset routes sit above it), and
 * that middleware overwrites whatever a stub put there — with, in a test
 * without an accounts store, an open-mode viewer holding the owner role. A
 * stub would therefore have quietly granted every case owner rights and passed.
 */

let app: Express
let accounts: Awaited<typeof import('../../server/db')>['getAccounts'] extends () => infer A ? A : never
let hashPassword: (p: string) => Promise<string>
/** The session cookie sent with the next request, or '' for anonymous. */
let cookie: string

const PASSWORD = 'correct horse battery staple'
const SLOW = { timeout: 40_000 }

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  const db = await import('../../server/db')
  const pw = await import('../../server/passwords')
  const usersRouter = (await import('../../server/routes/users')).default
  const auth = await import('../../server/auth')
  hashPassword = pw.hashPassword
  accounts = db.getAccounts()
  // Without this the module has no store, `authMode()` reports `open`, and
  // every request resolves to a service viewer with owner rights.
  auth.setAccountsStore(accounts)

  app = express()
  app.use(express.json())
  app.use('/api/users', usersRouter)
})

afterAll(() => {
  delete process.env.RESUME_DB_PATH
})

let owner: { id: string }
let kari: { id: string }
let ola: { id: string }

beforeEach(async () => {
  // A fresh cast of characters per test, since several mutate passwords and
  // sessions. Usernames are suffixed so the UNIQUE constraint survives reuse.
  const n = Math.random().toString(36).slice(2, 8)
  const hash = await hashPassword(PASSWORD)
  owner = accounts.createUser({ username: `owner-${n}`, displayName: 'The Owner', pwHash: hash, role: 'owner' })
  kari = accounts.createUser({ username: `kari-${n}`, displayName: 'Kari Nordmann', pwHash: hash, role: 'member' })
  ola = accounts.createUser({ username: `ola-${n}`, displayName: 'Ola Nordmann', pwHash: hash, role: 'member' })
  cookie = ''
}, 40_000)

const signIn = (userId: string) => { cookie = `rs_session=${encodeURIComponent(accounts.createSession(userId))}` }
const asOwner = () => { signIn(owner.id) }
const asKari = () => { signIn(kari.id) }
const SERVICE_TOKEN = 'service-token-value'

/**
 * The env that decides whether the mail-sending branches run. Cleared for every
 * test — the pre-existing tests all assumed an unconfigured server, and an
 * ambient MAIL_TRANSPORT from a developer's shell would have flipped their
 * branches silently. Restored afterwards so this file stays a good neighbour.
 */
const OUTBOUND_ENV = ['MAIL_TRANSPORT', 'MAIL_FROM', 'RESUME_APP_BASE_URL'] as const
const savedOutbound: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of OUTBOUND_ENV) { savedOutbound[k] = process.env[k]; delete process.env[k] }
  mailbox.reset.length = 0
  mailbox.verify.length = 0
})
afterEach(() => {
  for (const k of OUTBOUND_ENV) {
    if (savedOutbound[k] === undefined) delete process.env[k]
    else process.env[k] = savedOutbound[k]
  }
})

/** Sendmail transport: configured the moment MAIL_FROM is valid (path defaults). */
const configureMail = () => {
  process.env.MAIL_TRANSPORT = 'sendmail'
  process.env.MAIL_FROM = 'noreply@example.no'
  process.env.RESUME_APP_BASE_URL = 'https://cv.example.no'
}

/** Unique per call — users.email is UNIQUE and this file shares one DB. */
const freshEmail = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}@example.no`

describe('POST /forgot — indistinguishable by construction', SLOW, () => {
  // The reset form must not become a "does this person have an account here"
  // oracle. For a CV tool that answer is itself the sensitive one.
  it('answers identically for an unknown login, a known one, and one with no email', async () => {
    const unknown = await request(app).post('/api/users/forgot').set('Cookie', cookie).send({ login: 'nobody-at-all' })
    const known = await request(app).post('/api/users/forgot').set('Cookie', cookie).send({ login: `kari-x` })
    const noEmail = await request(app).post('/api/users/forgot').set('Cookie', cookie).send({ login: kari.id })
    for (const r of [unknown, known, noEmail]) {
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ ok: true, sent: null })
    }
  })

  it('answers the same for an empty login', async () => {
    const r = await request(app).post('/api/users/forgot').set('Cookie', cookie).send({})
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, sent: null })
  })
})

describe('POST /reset — the single redemption path', SLOW, () => {
  it('sets the password and refuses the same link twice', async () => {
    const token = accounts.mintGrant('reset', { userId: kari.id })
    const first = await request(app).post('/api/users/reset').set('Cookie', cookie).send({ token, password: 'a brand new passphrase' })
    expect(first.status).toBe(200)

    const second = await request(app).post('/api/users/reset').set('Cookie', cookie).send({ token, password: 'another passphrase here' })
    expect(second.status).toBe(400)
  })

  it('ends every existing session, which is the point of a reset', async () => {
    const live = accounts.createSession(kari.id)
    expect(accounts.resolveSession(live)).not.toBeNull()
    const token = accounts.mintGrant('reset', { userId: kari.id })
    await request(app).post('/api/users/reset').set('Cookie', cookie).send({ token, password: 'a brand new passphrase' })
    expect(accounts.resolveSession(live)).toBeNull()
  })

  it('rejects an unknown token', async () => {
    const r = await request(app).post('/api/users/reset').set('Cookie', cookie).send({ token: 'nope', password: 'a brand new passphrase' })
    expect(r.status).toBe(400)
  })

  it('will not accept an invite grant as a reset', async () => {
    // Grant kinds share one table; a route that ignored `kind` would let an
    // invitation set an existing user's password.
    const token = accounts.mintGrant('invite', { role: 'member' })
    const r = await request(app).post('/api/users/reset').set('Cookie', cookie).send({ token, password: 'a brand new passphrase' })
    expect(r.status).toBe(400)
  })

  it('will not accept a reset grant as an invitation — the mirror image', async () => {
    /*
     * The other direction of the same rule, and it was unasserted: mutation
     * testing could delete `/accept`'s kind check with every test still green.
     *
     * Without it a reset link becomes an account-creation link. It would not
     * escalate — a reset grant carries no role, so the new account defaults to
     * member — but it burns the grant creating a stranger's account instead of
     * letting the real user back in.
     */
    const before = accounts.listUsers().length
    const token = accounts.mintGrant('reset', { userId: kari.id })
    const r = await request(app).post('/api/users/accept').set('Cookie', cookie)
      .send({ token, username: 'gatecrasher', display_name: 'Gate Crasher', password: 'a brand new passphrase' })
    expect(r.status).toBe(400)
    expect(accounts.listUsers().length).toBe(before)
    // And the grant is not spent, so the person it belongs to can still use it.
    expect(accounts.peekGrant(token)?.kind).toBe('reset')
  })

  it('enforces the password policy before spending the grant', async () => {
    const token = accounts.mintGrant('reset', { userId: kari.id })
    const short = await request(app).post('/api/users/reset').set('Cookie', cookie).send({ token, password: 'short' })
    expect(short.status).toBe(400)
    // The grant survives a rejected attempt, so a typo does not cost the link.
    const ok = await request(app).post('/api/users/reset').set('Cookie', cookie).send({ token, password: 'a brand new passphrase' })
    expect(ok.status).toBe(200)
  })
})

describe('POST /recover — recovery codes', SLOW, () => {
  it('spends a code and hands back a fresh set', async () => {
    // Setting a password clears every code, so a harvested one cannot outlive
    // the change. Re-issuing here is what stops that leaving somebody who just
    // used their last resort with nothing.
    const codes = accounts.issueRecoveryCodes(kari.id)
    const user = accounts.getUser(kari.id)
    const r = await request(app).post('/api/users/recover').set('Cookie', cookie)
      .send({ login: user?.username, code: codes[0], password: 'a brand new passphrase' })
    expect(r.status).toBe(200)
    expect(r.body.recovery_codes).toHaveLength(10)
    // And the spent one is genuinely dead, not merely replaced.
    expect(accounts.redeemRecoveryCode(kari.id, codes[0])).toBe(false)
  })

  it('will not spend one account’s code against another', async () => {
    const codes = accounts.issueRecoveryCodes(kari.id)
    const olaUser = accounts.getUser(ola.id)
    const r = await request(app).post('/api/users/recover').set('Cookie', cookie)
      .send({ login: olaUser?.username, code: codes[0], password: 'a brand new passphrase' })
    expect(r.status).toBe(400)
  })

  it('rejects a disabled account even with a valid code', async () => {
    const codes = accounts.issueRecoveryCodes(kari.id)
    const user = accounts.getUser(kari.id)
    accounts.setDisabled(kari.id, true)
    const r = await request(app).post('/api/users/recover').set('Cookie', cookie)
      .send({ login: user?.username, code: codes[0], password: 'a brand new passphrase' })
    expect(r.status).toBe(400)
  })
})

describe('POST /accept — invitations', SLOW, () => {
  it('takes the role from the grant, not from the request body', async () => {
    const token = accounts.mintGrant('invite', { role: 'member' })
    const r = await request(app).post('/api/users/accept').set('Cookie', cookie)
      .send({ token, username: 'newcomer', display_name: 'New Comer', password: PASSWORD, role: 'owner' })
    expect(r.status).toBe(200)
    expect(r.body.user.role).toBe('member')
  })

  it('does not burn the invitation on a rejected attempt', async () => {
    const token = accounts.mintGrant('invite', { role: 'member' })
    const bad = await request(app).post('/api/users/accept').set('Cookie', cookie)
      .send({ token, username: 'ok-name', password: 'short' })
    expect(bad.status).toBe(400)
    const good = await request(app).post('/api/users/accept').set('Cookie', cookie)
      .send({ token, username: 'ok-name', display_name: 'Ok Name', password: PASSWORD })
    expect(good.status).toBe(200)
  })

  it('issues recovery codes once, at creation', async () => {
    const token = accounts.mintGrant('invite', { role: 'member' })
    const r = await request(app).post('/api/users/accept').set('Cookie', cookie)
      .send({ token, username: 'coded-user', display_name: 'Coded', password: PASSWORD })
    expect(r.body.recovery_codes).toHaveLength(10)
  })
})

describe('/me — a service credential is not a person', SLOW, () => {
  it('refuses a profile to a service token', async () => {
    // A service credential authenticates but is nobody, so it gets 403 (known,
    // not permitted) rather than 401 (unknown) — the profile routes have no
    // user to act for.
    process.env.RESUME_API_TOKEN = SERVICE_TOKEN
    try {
      const r = await request(app).get('/api/users/me').set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      expect(r.status).toBe(403)
    } finally {
      delete process.env.RESUME_API_TOKEN
    }
  })

  it('returns the signed-in user', async () => {
    asKari()
    const r = await request(app).get('/api/users/me').set('Cookie', cookie)
    expect(r.status).toBe(200)
    expect(r.body.display_name).toBe('Kari Nordmann')
  })
})

describe('PUT /me — which edits cost a password', SLOW, () => {
  it('changes the display name freely, since it is cosmetic', async () => {
    asKari()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie).send({ display_name: 'Kari N. Nordmann' })
    expect(r.status).toBe(200)
    expect(accounts.getUser(kari.id)?.display_name).toBe('Kari N. Nordmann')
  })

  it('refuses a username change without the current password', async () => {
    // A stolen session must not be able to lock the real user out by renaming
    // the identifier they log in with.
    asKari()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie).send({ username: 'kari-renamed' })
    expect(r.status).toBe(403)
  })

  it('refuses an email change without the current password', async () => {
    asKari()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie).send({ email: 'attacker@example.no' })
    expect(r.status).toBe(403)
  })

  it('allows both when the current password is supplied', async () => {
    asKari()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ username: 'kari-renamed', email: 'kari@example.no', current_password: PASSWORD })
    expect(r.status).toBe(200)
    const after = accounts.getUser(kari.id)
    expect(after?.username).toBe('kari-renamed')
    expect(after?.email).toBe('kari@example.no')
    // A newly set address is unproven until its link is followed (D5).
    expect(after?.email_verified_at).toBeNull()
  })

  it('refuses a username already taken', async () => {
    asKari()
    const olaUser = accounts.getUser(ola.id)
    const r = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ username: olaUser?.username, current_password: PASSWORD })
    expect(r.status).toBe(409)
  })

  it('refuses a WRONG current password, not merely a missing one', async () => {
    // The guard is three conditions and the tests above only exercised the
    // "absent" one, so a verification that always passed would have gone
    // unnoticed — which is the whole protection against a stolen session.
    asKari()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ username: 'kari-hijacked', current_password: 'not-the-password' })
    expect(r.status).toBe(403)
    expect(accounts.getUser(kari.id)?.username).not.toBe('kari-hijacked')
  })

  it('does not ask for a password to change only the display name', async () => {
    // `changesLogin` is what decides. If it read as always-true, a cosmetic
    // edit would start demanding a password; always-false and an identifier
    // change would stop needing one.
    asKari()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ display_name: 'Kari Only' })
    expect(r.status).toBe(200)
  })

  it('refuses to blank its own display name', async () => {
    asKari()
    const before = accounts.getUser(kari.id)?.display_name
    const r = await request(app).put('/api/users/me').set('Cookie', cookie).send({ display_name: '  ' })
    expect(r.status).toBe(400)
    expect(accounts.getUser(kari.id)?.display_name).toBe(before)
  })

  it('applies the username rules to itself', async () => {
    asKari()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ username: 'a', current_password: PASSWORD })
    expect(r.status).toBe(400)
  })

  it('refuses an address that is not one', async () => {
    asKari()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: 'not-an-address', current_password: PASSWORD })
    expect(r.status).toBe(400)
  })

  it('refuses an address another account already holds', async () => {
    const taken = `taken-me-${Math.random().toString(36).slice(2, 8)}@example.no`
    asOwner()
    await request(app).put(`/api/users/${ola.id}`).set('Cookie', cookie).send({ email: taken })
    asKari()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: taken, current_password: PASSWORD })
    expect(r.status).toBe(409)
  })

  it('clears its own address when given an empty one', async () => {
    asKari()
    await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: `mine-${Math.random().toString(36).slice(2, 8)}@example.no`, current_password: PASSWORD })
    expect(accounts.getUser(kari.id)?.email).not.toBeNull()
    const r = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: '', current_password: PASSWORD })
    expect(r.status).toBe(200)
    expect(accounts.getUser(kari.id)?.email).toBeNull()
  })

  it('refuses a service credential, which is nobody', async () => {
    // requirePerson: a token authenticates but has no account to edit.
    process.env.RESUME_API_TOKEN = SERVICE_TOKEN
    try {
      const r = await request(app).put('/api/users/me')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`).send({ display_name: 'Nobody' })
      expect(r.status).toBe(403)
    } finally {
      delete process.env.RESUME_API_TOKEN
    }
  })
})

describe('owner administration', SLOW, () => {
  it('refuses the user list to a member', async () => {
    asKari()
    expect((await request(app).get('/api/users').set('Cookie', cookie)).status).toBe(403)
  })

  it('lists users for an owner', async () => {
    asOwner()
    const r = await request(app).get('/api/users').set('Cookie', cookie)
    expect(r.status).toBe(200)
    expect(r.body.users.length).toBeGreaterThanOrEqual(3)
  })

  it('lets an owner edit somebody else without their password', async () => {
    asOwner()
    const r = await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ display_name: 'Corrected Name' })
    expect(r.status).toBe(200)
    expect(accounts.getUser(kari.id)?.display_name).toBe('Corrected Name')
  })

  it('refuses that same edit to a member', async () => {
    asKari()
    const r = await request(app).put(`/api/users/${ola.id}`).set('Cookie', cookie).send({ display_name: 'Hijacked' })
    expect(r.status).toBe(403)
  })

  it('leaves an owner-set address unverified', async () => {
    asOwner()
    await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ email: 'typo@example.no' })
    expect(accounts.getUser(kari.id)?.email_verified_at).toBeNull()
  })

  /*
   * The rest of PUT /:id. It had three tests for eight decision points, and the
   * mutation report showed 21 survivors in it — the largest cluster in this
   * router. It is an owner-only route that rewrites another person's login
   * identifiers, so each refusal is worth stating.
   */
  it('404s for a user id that does not exist', async () => {
    asOwner()
    const r = await request(app).put('/api/users/no-such-user').set('Cookie', cookie).send({ display_name: 'X' })
    expect(r.status).toBe(404)
  })

  it('refuses to blank a display name', async () => {
    asOwner()
    const before = accounts.getUser(kari.id)?.display_name
    const r = await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ display_name: '   ' })
    expect(r.status).toBe(400)
    expect(accounts.getUser(kari.id)?.display_name).toBe(before)
  })

  it('trims a display name rather than storing the padding', async () => {
    asOwner()
    await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ display_name: '  Kari N.  ' })
    expect(accounts.getUser(kari.id)?.display_name).toBe('Kari N.')
  })

  it('applies the username rules on another persons behalf', async () => {
    asOwner()
    const r = await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ username: 'has space' })
    expect(r.status).toBe(400)
  })

  it('refuses a username another account already holds', async () => {
    asOwner()
    const taken = accounts.getUser(ola.id)?.username
    const r = await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ username: taken })
    expect(r.status).toBe(409)
    expect(accounts.getUser(kari.id)?.username).not.toBe(taken)
  })

  it('renames when the username is free', async () => {
    asOwner()
    const fresh = `kari-renamed-${Math.random().toString(36).slice(2, 8)}`
    const r = await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ username: fresh })
    expect(r.status).toBe(200)
    expect(accounts.getUser(kari.id)?.username).toBe(fresh)
  })

  it('refuses an address that is not one', async () => {
    asOwner()
    const r = await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ email: 'not-an-address' })
    expect(r.status).toBe(400)
  })

  it('refuses an address another account already holds', async () => {
    asOwner()
    const taken = `taken-${Math.random().toString(36).slice(2, 8)}@example.no`
    await request(app).put(`/api/users/${ola.id}`).set('Cookie', cookie).send({ email: taken })
    const r = await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ email: taken })
    expect(r.status).toBe(409)
  })

  it('clears an address when given an empty one', async () => {
    // Distinct from omitting the key: `'email' in body` is the switch, so an
    // explicit empty value is how an owner removes a wrong address.
    asOwner()
    await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ email: 'temp@example.no' })
    expect(accounts.getUser(kari.id)?.email).toBe('temp@example.no')
    await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ email: '' })
    expect(accounts.getUser(kari.id)?.email).toBeNull()
  })

  it('leaves an identifier alone when the key is absent', async () => {
    // The opposite of the case above: no key means no change, so a partial
    // update cannot wipe a field it never mentioned.
    asOwner()
    const before = accounts.getUser(kari.id)
    await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ display_name: 'Only This' })
    const after = accounts.getUser(kari.id)
    expect(after?.username).toBe(before?.username)
    expect(after?.email).toBe(before?.email)
  })

  /** Owners accumulate across this file's shared DB, so make `owner` the last. */
  const leaveOneOwner = () => {
    for (const u of accounts.listUsers()) {
      if (u.role === 'owner' && u.id !== owner.id && !u.disabled_at) accounts.setDisabled(u.id, true)
    }
    expect(accounts.countOwners()).toBe(1)
  }

  it('will not disable the last owner', async () => {
    /*
     * Called as the SERVICE credential, not as the owner themselves.
     *
     * Signed in as the owner, this asserted nothing: the route refuses to
     * disable the last owner AND refuses to disable your own account, and an
     * owner disabling themselves trips the second one first. The test passed
     * with the last-owner guard deleted — which mutation testing is how we
     * found out. A service credential is role owner with no user id, so it
     * clears requireOwner and cannot be the target.
     */
    leaveOneOwner()
    process.env.RESUME_API_TOKEN = SERVICE_TOKEN
    try {
      const r = await request(app).post(`/api/users/${owner.id}/disabled`)
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`).send({ disabled: true })
      expect(r.status).toBe(409)
      expect(r.body.error).toMatch(/only owner/i)
      expect(accounts.getUser(owner.id)?.disabled_at).toBeNull()
    } finally {
      delete process.env.RESUME_API_TOKEN
    }
  })

  it('refuses an owner disabling their own account', async () => {
    /*
     * The second guard on that route, which now needs its own test.
     *
     * It used to be covered by accident: the last-owner test signed in as the
     * owner and disabled themselves, so it passed through here on the way.
     * Driving that test by the service credential — which is what makes it test
     * the rule it names — took this path's only coverage with it, and the
     * mutation report showed the mutants here dropping to no-coverage.
     *
     * A second owner exists for the duration so the last-owner rule cannot
     * fire, leaving this as the only thing that can refuse the request.
     */
    const second = accounts.createUser({
      username: `owner2-${Math.random().toString(36).slice(2, 8)}`,
      displayName: 'Second Owner',
      pwHash: accounts.getHash(owner.id) as string,
      role: 'owner',
    })
    try {
      asOwner()
      const r = await request(app).post(`/api/users/${owner.id}/disabled`).set('Cookie', cookie).send({ disabled: true })
      expect(r.status).toBe(409)
      expect(r.body.error).toMatch(/your own account/i)
      expect(accounts.getUser(owner.id)?.disabled_at).toBeNull()
    } finally {
      // Owners accumulate across this file's shared DB — see leaveOneOwner.
      accounts.setDisabled(second.id, true)
    }
  })

  it('will not demote the last owner', async () => {
    // Restored: an earlier edit of mine deleted it along with the span it sat
    // in. The /role route has no self-guard, so signing in as the owner is a
    // valid way to reach the last-owner rule here.
    asOwner()
    leaveOneOwner()
    const r = await request(app).post(`/api/users/${owner.id}/role`).set('Cookie', cookie).send({ role: 'member' })
    expect(r.status).toBe(409)
  })

  it('mints a reset link for another account', async () => {
    asOwner()
    const r = await request(app).post(`/api/users/${kari.id}/reset-link`).set('Cookie', cookie)
    expect(r.status).toBe(200)
    expect(r.body.url).toContain('token=')
  })

  it('refuses a reset link to a member', async () => {
    asKari()
    expect((await request(app).post(`/api/users/${ola.id}/reset-link`).set('Cookie', cookie)).status).toBe(403)
  })
})

describe('POST /forgot — the mail path behind the constant answer', SLOW, () => {
  // The response is pinned above; these pin what happens (and must not happen)
  // BEHIND it. The mock records instead of sending, so "a mail went out" is
  // observable without an MTA, and "no mail went out" is a real assertion
  // rather than an absence of evidence.
  const verifiedKari = (): string => {
    const address = freshEmail('kari')
    accounts.setEmail(kari.id, address)
    expect(accounts.markEmailVerified(kari.id, address)).toBe(true)
    return address
  }

  it('mails a verified address a link that redeems at POST /reset', async () => {
    configureMail()
    const address = verifiedKari()
    const live = accounts.createSession(kari.id)
    const r = await request(app).post('/api/users/forgot').send({ login: address })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, sent: null })
    expect(mailbox.reset).toHaveLength(1)
    expect(mailbox.reset[0].to).toBe(address)
    expect(mailbox.reset[0].link).toMatch(/^https:\/\/cv\.example\.no\/reset\?token=/)
    // The emailed trigger ends at the same redemption as every other, and that
    // redemption ends every session.
    const token = new URL(mailbox.reset[0].link).searchParams.get('token') ?? ''
    const reset = await request(app).post('/api/users/reset').send({ token, password: 'a brand new passphrase' })
    expect(reset.status).toBe(200)
    expect(accounts.resolveSession(live)).toBeNull()
  })

  it('sends nothing for an unverified address, with the identical answer', async () => {
    configureMail()
    const address = freshEmail('kari')
    accounts.setEmail(kari.id, address)
    const r = await request(app).post('/api/users/forgot').send({ login: address })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, sent: null })
    expect(mailbox.reset).toHaveLength(0)
  })

  it('sends nothing for a disabled account with a verified address', async () => {
    configureMail()
    const address = verifiedKari()
    accounts.setDisabled(kari.id, true)
    const r = await request(app).post('/api/users/forgot').send({ login: address })
    expect(r.body).toEqual({ ok: true, sent: null })
    expect(mailbox.reset).toHaveLength(0)
  })

  it('sends nothing when mail is not configured, even for a verified address', async () => {
    process.env.RESUME_APP_BASE_URL = 'https://cv.example.no'
    const address = verifiedKari()
    const r = await request(app).post('/api/users/forgot').send({ login: address })
    expect(r.body).toEqual({ ok: true, sent: null })
    expect(mailbox.reset).toHaveLength(0)
  })

  it('sends nothing when the server has no base URL to build the link on', async () => {
    process.env.MAIL_TRANSPORT = 'sendmail'
    process.env.MAIL_FROM = 'noreply@example.no'
    const address = verifiedKari()
    const r = await request(app).post('/api/users/forgot').send({ login: address })
    expect(r.body).toEqual({ ok: true, sent: null })
    expect(mailbox.reset).toHaveLength(0)
  })

  it('answers a bodyless request like any other', async () => {
    // Without a JSON body req.body is undefined; the optional chain is what
    // keeps this from being a 500 — and a distinct failure here would be a tell.
    const r = await request(app).post('/api/users/forgot')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, sent: null })
  })
})

describe('POST /reset — what the one redemption refuses', SLOW, () => {
  it('refuses a verify_email grant: kind is checked, not just existence', async () => {
    // The invite-as-reset case above passes even without the kind check,
    // because an invite grant carries no user_id. A verify_email grant DOES,
    // so this is the case that actually proves the kind check exists — without
    // it, an email-confirmation link rotates the password.
    const before = accounts.getHash(kari.id)
    const token = accounts.mintGrant('verify_email', { userId: kari.id, email: 'kari@example.no' })
    const r = await request(app).post('/api/users/reset').send({ token, password: 'a brand new passphrase' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/expired|already/i)
    expect(accounts.getHash(kari.id)).toBe(before)
  })

  it('refuses a link minted before the account was disabled', async () => {
    const before = accounts.getHash(kari.id)
    const token = accounts.mintGrant('reset', { userId: kari.id })
    accounts.setDisabled(kari.id, true)
    const r = await request(app).post('/api/users/reset').send({ token, password: 'a brand new passphrase' })
    expect(r.status).toBe(400)
    expect(accounts.getHash(kari.id)).toBe(before)
  })

  it('says the recovery codes were cleared, because they were', async () => {
    accounts.issueRecoveryCodes(kari.id)
    expect(accounts.countRecoveryCodes(kari.id)).toBe(10)
    const token = accounts.mintGrant('reset', { userId: kari.id })
    const r = await request(app).post('/api/users/reset').send({ token, password: 'a brand new passphrase' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, recovery_codes_cleared: true })
    expect(accounts.countRecoveryCodes(kari.id)).toBe(0)
  })
})

describe('POST /recover — refusals leave the code unspent', SLOW, () => {
  it('enforces the password policy before spending the code', async () => {
    const codes = accounts.issueRecoveryCodes(kari.id)
    const user = accounts.getUser(kari.id)
    const bad = await request(app).post('/api/users/recover')
      .send({ login: user?.username, code: codes[0], password: 'short' })
    expect(bad.status).toBe(400)
    // The code survives the rejected attempt and still works.
    const ok = await request(app).post('/api/users/recover')
      .send({ login: user?.username, code: codes[0], password: 'a brand new passphrase' })
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)
  })

  it('ends every existing session, like any password change', async () => {
    const codes = accounts.issueRecoveryCodes(kari.id)
    const live = accounts.createSession(kari.id)
    const user = accounts.getUser(kari.id)
    const r = await request(app).post('/api/users/recover')
      .send({ login: user?.username, code: codes[0], password: 'a brand new passphrase' })
    expect(r.status).toBe(200)
    expect(accounts.resolveSession(live)).toBeNull()
  })

  it('names the refusal without saying which part failed', async () => {
    const r = await request(app).post('/api/users/recover')
      .send({ login: 'nobody-here', code: 'AAAAA-AAAAA-AAAAA-AAAAA', password: 'a brand new passphrase' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/recovery code/i)
  })
})

describe('POST /accept — more ways a rejected attempt keeps the invitation', SLOW, () => {
  it('refuses an unknown token, naming it as expired-or-used', async () => {
    const r = await request(app).post('/api/users/accept')
      .send({ token: 'nope', username: 'whoever', display_name: 'W', password: PASSWORD })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/invitation/i)
  })

  it('rejects a bad username without burning the invitation', async () => {
    const token = accounts.mintGrant('invite', { role: 'member' })
    const bad = await request(app).post('/api/users/accept')
      .send({ token, username: 'has space', display_name: 'X', password: PASSWORD })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/username/i)
    expect(accounts.peekGrant(token)?.kind).toBe('invite')
  })

  it('rejects a taken username without burning the invitation', async () => {
    const token = accounts.mintGrant('invite', { role: 'member' })
    const taken = accounts.getUser(kari.id)?.username
    const bad = await request(app).post('/api/users/accept')
      .send({ token, username: taken, display_name: 'X', password: PASSWORD })
    expect(bad.status).toBe(409)
    expect(bad.body.error).toMatch(/taken/i)
    const good = await request(app).post('/api/users/accept')
      .send({ token, username: `fresh-${Math.random().toString(36).slice(2, 8)}`, display_name: 'X', password: PASSWORD })
    expect(good.status).toBe(200)
  })

  it('signs the new account in: session and CSRF cookies on the response', async () => {
    const token = accounts.mintGrant('invite', { role: 'member' })
    const r = await request(app).post('/api/users/accept')
      .send({ token, username: `cookie-${Math.random().toString(36).slice(2, 8)}`, display_name: 'C', password: PASSWORD })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    const setCookies = ([] as string[]).concat(r.headers['set-cookie'] ?? [])
    expect(setCookies.some((c) => c.startsWith('rs_session='))).toBe(true)
    expect(setCookies.some((c) => c.startsWith('rs_csrf='))).toBe(true)
  })

  it('falls back to the username when the display name is blank, and trims one that is not', async () => {
    const t1 = accounts.mintGrant('invite', { role: 'member' })
    const name1 = `plain-${Math.random().toString(36).slice(2, 8)}`
    const r1 = await request(app).post('/api/users/accept')
      .send({ token: t1, username: name1, display_name: '', password: PASSWORD })
    expect(r1.body.user.display_name).toBe(name1)

    const t2 = accounts.mintGrant('invite', { role: 'member' })
    const r2 = await request(app).post('/api/users/accept')
      .send({ token: t2, username: `padded-${Math.random().toString(36).slice(2, 8)}`, display_name: '  Padded Name  ', password: PASSWORD })
    expect(r2.body.user.display_name).toBe('Padded Name')
  })
})

describe('GET /invite/:token — describing without spending', SLOW, () => {
  it('reports the role and address the grant carries, and does not spend it', async () => {
    const token = accounts.mintGrant('invite', { role: 'owner', email: 'invitee@example.no' })
    const r = await request(app).get(`/api/users/invite/${encodeURIComponent(token)}`)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, role: 'owner', email: 'invitee@example.no' })
    expect(accounts.peekGrant(token)?.kind).toBe('invite')
  })

  it('defaults the role to member when the grant names none', async () => {
    const token = accounts.mintGrant('invite')
    const r = await request(app).get(`/api/users/invite/${encodeURIComponent(token)}`)
    expect(r.status).toBe(200)
    expect(r.body.role).toBe('member')
  })

  it('404s an unknown token and a token of the wrong kind alike', async () => {
    expect((await request(app).get('/api/users/invite/nope')).status).toBe(404)
    const reset = accounts.mintGrant('reset', { userId: kari.id })
    expect((await request(app).get(`/api/users/invite/${encodeURIComponent(reset)}`)).status).toBe(404)
  })
})

describe('POST /verify-email — confirming an address', SLOW, () => {
  it('verifies the address the link was minted for, exactly once', async () => {
    const address = freshEmail('kari')
    accounts.setEmail(kari.id, address)
    const token = accounts.mintGrant('verify_email', { userId: kari.id, email: address })
    const first = await request(app).post('/api/users/verify-email').send({ token })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ ok: true })
    expect(accounts.getUser(kari.id)?.email_verified_at).not.toBeNull()
    const again = await request(app).post('/api/users/verify-email').send({ token })
    expect(again.status).toBe(400)
  })

  it('refuses when the address has changed since the link was minted', async () => {
    const old = freshEmail('old')
    accounts.setEmail(kari.id, old)
    const token = accounts.mintGrant('verify_email', { userId: kari.id, email: old })
    accounts.setEmail(kari.id, freshEmail('new'))
    const r = await request(app).post('/api/users/verify-email').send({ token })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/no longer/i)
    expect(accounts.getUser(kari.id)?.email_verified_at).toBeNull()
  })

  it('refuses a reset grant and a bodyless request without crashing', async () => {
    const reset = accounts.mintGrant('reset', { userId: kari.id })
    expect((await request(app).post('/api/users/verify-email').send({ token: reset })).status).toBe(400)
    expect((await request(app).post('/api/users/verify-email')).status).toBe(400)
  })
})

describe('GET /me — the fields beyond the name', SLOW, () => {
  it('reports email verification honestly in both states', async () => {
    asKari()
    const address = freshEmail('kari')
    accounts.setEmail(kari.id, address)
    const before = await request(app).get('/api/users/me').set('Cookie', cookie)
    expect(before.body.email).toBe(address)
    expect(before.body.email_verified).toBe(false)
    accounts.markEmailVerified(kari.id, address)
    const after = await request(app).get('/api/users/me').set('Cookie', cookie)
    expect(after.body.email_verified).toBe(true)
  })

  it('counts the unused recovery codes', async () => {
    asKari()
    expect((await request(app).get('/api/users/me').set('Cookie', cookie)).body.recovery_codes_left).toBe(0)
    accounts.issueRecoveryCodes(kari.id)
    expect((await request(app).get('/api/users/me').set('Cookie', cookie)).body.recovery_codes_left).toBe(10)
  })
})

describe('PUT /me — the email verification loop', SLOW, () => {
  it('leaves the email alone when the key is absent', async () => {
    // The switch is `'email' in body`; misread as always-on, a cosmetic edit
    // would silently clear the reset channel.
    asKari()
    const address = freshEmail('keep')
    await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: address, current_password: PASSWORD })
    const r = await request(app).put('/api/users/me').set('Cookie', cookie).send({ display_name: 'Still Kari' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect(accounts.getUser(kari.id)?.email).toBe(address)
  })

  it('mails a verification link for a new address — lower-cased — and the link verifies it', async () => {
    configureMail()
    asKari()
    const lower = freshEmail('kari.new')
    const mixed = `${lower[0].toUpperCase()}${lower.slice(1).replace('@example.no', '@Example.NO')}`
    const r = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: mixed, current_password: PASSWORD })
    expect(r.status).toBe(200)
    expect(mailbox.verify).toHaveLength(1)
    expect(mailbox.verify[0].to).toBe(lower)
    expect(mailbox.verify[0].link).toMatch(/^https:\/\/cv\.example\.no\/verify-email\?token=/)
    const token = new URL(mailbox.verify[0].link).searchParams.get('token') ?? ''
    expect((await request(app).post('/api/users/verify-email').send({ token })).status).toBe(200)
    const after = accounts.getUser(kari.id)
    expect(after?.email).toBe(lower)
    expect(after?.email_verified_at).not.toBeNull()
  })

  it('sends nothing when mail is unconfigured, and nothing when clearing the address', async () => {
    process.env.RESUME_APP_BASE_URL = 'https://cv.example.no'
    asKari()
    const set = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: freshEmail('kari'), current_password: PASSWORD })
    expect(set.status).toBe(200)
    expect(mailbox.verify).toHaveLength(0)

    configureMail()
    const clear = await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: '', current_password: PASSWORD })
    expect(clear.status).toBe(200)
    expect(mailbox.verify).toHaveLength(0)
  })

  it('names each refusal', async () => {
    asKari()
    expect((await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ username: 'kari-take-two' })).body.error).toMatch(/current password/i)
    expect((await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ display_name: ' ' })).body.error).toMatch(/display name/i)
    expect((await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ username: 'a', current_password: PASSWORD })).body.error).toMatch(/username/i)
    expect((await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: 'nope', current_password: PASSWORD })).body.error).toMatch(/email/i)
    const olaAddress = freshEmail('ola-owns')
    accounts.setEmail(ola.id, olaAddress)
    expect((await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ email: olaAddress, current_password: PASSWORD })).body.error).toMatch(/already used/i)
    const takenName = accounts.getUser(ola.id)?.username
    expect((await request(app).put('/api/users/me').set('Cookie', cookie)
      .send({ username: takenName, current_password: PASSWORD })).body.error).toMatch(/taken/i)
  })
})

describe('POST /me/password', SLOW, () => {
  it('changes the password and ends every session, saying so', async () => {
    asKari()
    const other = accounts.createSession(kari.id)
    const before = accounts.getHash(kari.id)
    const r = await request(app).post('/api/users/me/password').set('Cookie', cookie)
      .send({ current_password: PASSWORD, password: 'a brand new passphrase' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, signed_out: true })
    expect(accounts.getHash(kari.id)).not.toBe(before)
    expect(accounts.resolveSession(other)).toBeNull()
  })

  it('refuses the wrong current password and changes nothing', async () => {
    asKari()
    const other = accounts.createSession(kari.id)
    const before = accounts.getHash(kari.id)
    const r = await request(app).post('/api/users/me/password').set('Cookie', cookie)
      .send({ current_password: 'not-the-password', password: 'a brand new passphrase' })
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/current password/i)
    expect(accounts.getHash(kari.id)).toBe(before)
    expect(accounts.resolveSession(other)).not.toBeNull()
  })

  it('refuses a weak replacement and changes nothing', async () => {
    asKari()
    const before = accounts.getHash(kari.id)
    const r = await request(app).post('/api/users/me/password').set('Cookie', cookie)
      .send({ current_password: PASSWORD, password: 'short' })
    expect(r.status).toBe(400)
    expect(accounts.getHash(kari.id)).toBe(before)
  })
})

describe('POST /me/recovery-codes', SLOW, () => {
  it('replaces the set for the current password', async () => {
    asKari()
    const old = accounts.issueRecoveryCodes(kari.id)
    const r = await request(app).post('/api/users/me/recovery-codes').set('Cookie', cookie)
      .send({ current_password: PASSWORD })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.recovery_codes).toHaveLength(10)
    // The set a borrowed screen may have photographed is dead.
    expect(accounts.redeemRecoveryCode(kari.id, old[0])).toBe(false)
  })

  it('refuses a wrong or missing password and keeps the existing set', async () => {
    asKari()
    const old = accounts.issueRecoveryCodes(kari.id)
    const wrong = await request(app).post('/api/users/me/recovery-codes').set('Cookie', cookie)
      .send({ current_password: 'not-the-password' })
    expect(wrong.status).toBe(403)
    expect(wrong.body.error).toMatch(/current password/i)
    // No body at all: the optional chain answers 403, never a 500.
    const missing = await request(app).post('/api/users/me/recovery-codes').set('Cookie', cookie)
    expect(missing.status).toBe(403)
    expect(accounts.countRecoveryCodes(kari.id)).toBe(10)
    expect(accounts.redeemRecoveryCode(kari.id, old[0])).toBe(true)
  })

  it('refuses a service credential, which has no codes to replace', async () => {
    process.env.RESUME_API_TOKEN = SERVICE_TOKEN
    try {
      const r = await request(app).post('/api/users/me/recovery-codes')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`).send({ current_password: PASSWORD })
      expect(r.status).toBe(403)
      expect(r.body.error).toMatch(/service token/i)
    } finally {
      delete process.env.RESUME_API_TOKEN
    }
  })
})

describe('POST /me/verify-email — resend', SLOW, () => {
  it('refuses when no address is on the account', async () => {
    configureMail()
    asKari()
    const r = await request(app).post('/api/users/me/verify-email').set('Cookie', cookie)
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/email address first/i)
    expect(mailbox.verify).toHaveLength(0)
  })

  it('refuses when the server cannot send, or has no base URL', async () => {
    asKari()
    accounts.setEmail(kari.id, freshEmail('kari'))
    const noMail = await request(app).post('/api/users/me/verify-email').set('Cookie', cookie)
    expect(noMail.status).toBe(400)
    expect(noMail.body.error).toMatch(/cannot send/i)

    process.env.MAIL_TRANSPORT = 'sendmail'
    process.env.MAIL_FROM = 'noreply@example.no'
    const noBase = await request(app).post('/api/users/me/verify-email').set('Cookie', cookie)
    expect(noBase.status).toBe(400)
    expect(mailbox.verify).toHaveLength(0)
  })

  it('sends a link that verifies the address', async () => {
    configureMail()
    asKari()
    const address = freshEmail('kari')
    accounts.setEmail(kari.id, address)
    const r = await request(app).post('/api/users/me/verify-email').set('Cookie', cookie)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect(mailbox.verify).toHaveLength(1)
    expect(mailbox.verify[0].to).toBe(address)
    const token = new URL(mailbox.verify[0].link).searchParams.get('token') ?? ''
    expect((await request(app).post('/api/users/verify-email').send({ token })).status).toBe(200)
    expect(accounts.getUser(kari.id)?.email_verified_at).not.toBeNull()
  })
})

describe('owner administration — links, roles and the disable switch', SLOW, () => {
  /** Owners accumulate across this file's shared DB; keep only the current one. */
  const soleOwner = () => {
    for (const u of accounts.listUsers()) {
      if (u.role === 'owner' && u.id !== owner.id && !u.disabled_at) accounts.setDisabled(u.id, true)
    }
    expect(accounts.countOwners()).toBe(1)
  }

  it('builds links on the trimmed, slash-stripped base URL', async () => {
    process.env.RESUME_APP_BASE_URL = '  https://cv.example.no//  '
    asOwner()
    const r = await request(app).post(`/api/users/${kari.id}/reset-link`).set('Cookie', cookie)
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.url).toMatch(/^https:\/\/cv\.example\.no\/reset\?token=/)
  })

  it('an owner-minted reset link ends at the same redemption', async () => {
    asOwner()
    const live = accounts.createSession(kari.id)
    const before = accounts.getHash(kari.id)
    const minted = await request(app).post(`/api/users/${kari.id}/reset-link`).set('Cookie', cookie)
    const token = new URLSearchParams(String(minted.body.url).split('?')[1]).get('token') ?? ''
    const reset = await request(app).post('/api/users/reset').send({ token, password: 'a brand new passphrase' })
    expect(reset.status).toBe(200)
    expect(accounts.getHash(kari.id)).not.toBe(before)
    expect(accounts.resolveSession(live)).toBeNull()
  })

  it('an owner invite makes an owner; an unrecognised role makes a member', async () => {
    asOwner()
    const inv = await request(app).post('/api/users/invite').set('Cookie', cookie).send({ role: 'owner' })
    expect(inv.status).toBe(200)
    expect(inv.body.ok).toBe(true)
    const accepted = await request(app).post('/api/users/accept')
      .send({ token: inv.body.token, username: `boss-${Math.random().toString(36).slice(2, 8)}`, display_name: 'B', password: PASSWORD })
    expect(accepted.body.user.role).toBe('owner')
    // Owners accumulate across this file's shared DB; retire this one.
    accounts.setDisabled(accepted.body.user.id, true)

    const junk = await request(app).post('/api/users/invite').set('Cookie', cookie).send({ role: 'admin' })
    const member = await request(app).post('/api/users/accept')
      .send({ token: junk.body.token, username: `mem-${Math.random().toString(36).slice(2, 8)}`, display_name: 'M', password: PASSWORD })
    expect(member.body.user.role).toBe('member')
  })

  it('lower-cases an invite address and refuses one that is not an address', async () => {
    asOwner()
    const good = await request(app).post('/api/users/invite').set('Cookie', cookie)
      .send({ email: 'Invitee@Example.NO' })
    expect(good.status).toBe(200)
    const peek = await request(app).get(`/api/users/invite/${encodeURIComponent(good.body.token)}`)
    expect(peek.body.email).toBe('invitee@example.no')

    const bad = await request(app).post('/api/users/invite').set('Cookie', cookie)
      .send({ email: 'not-an-address' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/email/i)
  })

  it('returns the updated row to the owner', async () => {
    asOwner()
    const r = await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ display_name: 'Refreshed' })
    expect(r.body.ok).toBe(true)
    expect(r.body.user.display_name).toBe('Refreshed')
  })

  it('names each refusal of the profile edit', async () => {
    asOwner()
    expect((await request(app).put('/api/users/no-such').set('Cookie', cookie)
      .send({})).body.error).toMatch(/not found/i)
    expect((await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie)
      .send({ display_name: ' ' })).body.error).toMatch(/display name/i)
    expect((await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie)
      .send({ username: 'a' })).body.error).toMatch(/username/i)
    expect((await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie)
      .send({ email: 'nope' })).body.error).toMatch(/email/i)
    const takenName = accounts.getUser(ola.id)?.username
    expect((await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie)
      .send({ username: takenName })).body.error).toMatch(/taken/i)
    const olaAddress = freshEmail('ola-admin')
    accounts.setEmail(ola.id, olaAddress)
    expect((await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie)
      .send({ email: olaAddress })).body.error).toMatch(/already used/i)
  })

  it('leaves an existing email alone when the owner edit does not name it', async () => {
    // The pre-existing absent-key test ran against a user whose email was
    // already null, so a branch misread as always-on still passed it. This one
    // starts from a SET address, which is what the misread would destroy.
    asOwner()
    const address = freshEmail('keep')
    await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ email: address })
    await request(app).put(`/api/users/${kari.id}`).set('Cookie', cookie).send({ display_name: 'Only This' })
    expect(accounts.getUser(kari.id)?.email).toBe(address)
  })

  it('404s the administration routes for an unknown user id', async () => {
    asOwner()
    expect((await request(app).post('/api/users/no-such/reset-link').set('Cookie', cookie)).status).toBe(404)
    expect((await request(app).post('/api/users/no-such/disabled').set('Cookie', cookie).send({ disabled: true })).status).toBe(404)
    expect((await request(app).post('/api/users/no-such/role').set('Cookie', cookie).send({ role: 'owner' })).status).toBe(404)
  })

  it('disables a member (ending their sessions) and re-enables them', async () => {
    asOwner()
    const live = accounts.createSession(kari.id)
    // No body at all: absent means "disable", and the optional chain is what
    // keeps a bodyless request from being a 500.
    const off = await request(app).post(`/api/users/${kari.id}/disabled`).set('Cookie', cookie)
    expect(off.status).toBe(200)
    expect(off.body).toEqual({ ok: true })
    expect(accounts.getUser(kari.id)?.disabled_at).not.toBeNull()
    expect(accounts.resolveSession(live)).toBeNull()

    const on = await request(app).post(`/api/users/${kari.id}/disabled`).set('Cookie', cookie).send({ disabled: false })
    expect(on.status).toBe(200)
    expect(accounts.getUser(kari.id)?.disabled_at).toBeNull()
  })

  it('a member reaches neither the disable nor the role switch, and nothing changes', async () => {
    asKari()
    const role = await request(app).post(`/api/users/${kari.id}/role`).set('Cookie', cookie).send({ role: 'owner' })
    expect(role.status).toBe(403)
    expect(accounts.getUser(kari.id)?.role).toBe('member')
    const dis = await request(app).post(`/api/users/${ola.id}/disabled`).set('Cookie', cookie).send({ disabled: true })
    expect(dis.status).toBe(403)
    expect(accounts.getUser(ola.id)?.disabled_at).toBeNull()
  })

  it('promotes and demotes freely while another owner remains', async () => {
    asOwner()
    const up = await request(app).post(`/api/users/${kari.id}/role`).set('Cookie', cookie).send({ role: 'owner' })
    expect(up.status).toBe(200)
    expect(up.body).toEqual({ ok: true })
    expect(accounts.getUser(kari.id)?.role).toBe('owner')
    // Two owners now, so demoting kari back is allowed.
    const down = await request(app).post(`/api/users/${kari.id}/role`).set('Cookie', cookie).send({ role: 'member' })
    expect(down.status).toBe(200)
    expect(accounts.getUser(kari.id)?.role).toBe('member')
  })

  it('the last-owner rule blocks only the last owner, not members beside them', async () => {
    asOwner()
    soleOwner()
    // Demoting a member is a no-op the rule must not catch…
    const noop = await request(app).post(`/api/users/${kari.id}/role`).set('Cookie', cookie).send({ role: 'member' })
    expect(noop.status).toBe(200)
    // …and promoting one is exactly how the sole owner stops being the last.
    const up = await request(app).post(`/api/users/${kari.id}/role`).set('Cookie', cookie).send({ role: 'owner' })
    expect(up.status).toBe(200)
    expect(accounts.getUser(kari.id)?.role).toBe('owner')
    await request(app).post(`/api/users/${kari.id}/role`).set('Cookie', cookie).send({ role: 'member' })
  })

  it('disabling a member is allowed even when only one owner exists', async () => {
    asOwner()
    soleOwner()
    const r = await request(app).post(`/api/users/${kari.id}/disabled`).set('Cookie', cookie).send({ disabled: true })
    expect(r.status).toBe(200)
    expect(accounts.getUser(kari.id)?.disabled_at).not.toBeNull()
  })
})
