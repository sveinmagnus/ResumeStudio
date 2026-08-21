import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'

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
