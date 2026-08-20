/**
 * FAILING — adversarial review finding (HIGH).
 *
 * Two defects that compose into a full account takeover that survives the one
 * remedy a victim has.
 *
 *  1. `POST /api/users/me/recovery-codes` mints ten fresh recovery codes from
 *     nothing but a session. Every other credential-shaped edit on that router
 *     costs the current password — `/me/password` does, and `PUT /me` does for
 *     the username and the email — yet a recovery code is the STRONGER
 *     credential: it is long-lived, it is not tied to a session, and on its own
 *     it sets a new password.
 *
 *  2. `accounts.setPassword` deletes the user's sessions in the same
 *     transaction (which is right) but leaves `recovery_codes` untouched. So a
 *     code harvested earlier still redeems afterwards.
 *
 * The exploit, on a hosted (accounts-mode) instance:
 *
 *   - Attacker gets a session for a moment — an unlocked screen on a shared
 *     machine, a borrowed laptop, or XSS (the CSRF token is readable by our own
 *     page by design, so a script on the page can send the header).
 *   - Attacker POSTs /api/users/me/recovery-codes and writes the ten codes down.
 *     Nothing is emailed, nothing is logged, and the victim's own printed set is
 *     silently invalidated at the same time.
 *   - Victim notices something and changes their password. Every session dies.
 *     The victim now believes the incident is closed.
 *   - Attacker POSTs /api/users/recover with a harvested code and takes the
 *     account, locking the victim out of it.
 *
 * Not reachable on the desktop build: `open` mode has `userId: null`, so
 * `requirePerson` refuses the whole /me surface. Hosted only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { SESSION_COOKIE } from '../../server/auth'
import type { AccountsStore, UserRow } from '../../server/accounts'

let app: Express
let accounts: AccountsStore
let victim: UserRow

const CSRF = 'test-csrf-value'
const OLD_PASSWORD = 'victim-password-1'
const NEW_PASSWORD = 'victim-password-2'

const cookie = (sid: string): string => `${SESSION_COOKIE}=${sid}; rs_csrf=${CSRF}`

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  delete process.env.RESUME_API_TOKENS
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  process.env.RESUME_RECOVERY_RATE_LIMIT_MAX = '1000000'

  const { createApp } = await import('../../server/app')
  const { getDefaultDb } = await import('../../server/db')
  const { hashPassword } = await import('../../server/passwords')
  app = createApp()
  accounts = getDefaultDb().accounts
  victim = accounts.createUser({
    username: 'kari',
    displayName: 'Kari',
    pwHash: await hashPassword(OLD_PASSWORD),
    role: 'member',
  })
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_RECOVERY_RATE_LIMIT_MAX']) {
    delete process.env[k]
  }
})

describe('regenerating recovery codes', () => {
  it('costs the current password, like every other credential change on /me', async () => {
    const sid = accounts.createSession(victim.id)
    const res = await request(app)
      .post('/api/users/me/recovery-codes')
      .set('Cookie', cookie(sid))
      .set('x-csrf-token', CSRF)
      .send({})

    // A stolen session must not be able to mint a credential that outlives it.
    expect(res.status).toBe(403)
    expect(res.body.recovery_codes).toBeUndefined()
  })
})

describe('a password change', () => {
  it('invalidates recovery codes issued before it', async () => {
    const stolen = accounts.createSession(victim.id)

    // Step 1 — a set exists. Minting now costs the current password (the first
    // half of this finding), so this goes through the front door; what is being
    // proved below is the SECOND half, which stands on its own: whatever codes
    // exist when a password changes must not survive it.
    const minted = await request(app)
      .post('/api/users/me/recovery-codes')
      .set('Cookie', cookie(stolen))
      .set('x-csrf-token', CSRF)
      .send({ current_password: OLD_PASSWORD })
    const codes = (minted.body.recovery_codes ?? []) as string[]
    expect(codes.length).toBeGreaterThan(0)

    // Step 2 — the victim does the one thing they can: change the password.
    // This ends every session, which is what makes them believe it is over.
    const changed = await request(app)
      .post('/api/users/me/password')
      .set('Cookie', cookie(stolen))
      .set('x-csrf-token', CSRF)
      .send({ current_password: OLD_PASSWORD, password: NEW_PASSWORD })
    expect(changed.status).toBe(200)
    expect(accounts.resolveSession(stolen)).toBeNull()

    // Step 3 — the attacker comes back with a code from before the change.
    const takeover = await request(app)
      .post('/api/users/recover')
      .send({ login: 'kari', code: codes[0], password: 'attacker-chosen-pw' })

    // A reset exists because the old credential may be in somebody else's
    // hands. Anything minted while it was must die with it.
    expect(takeover.status).toBe(400)
    expect(accounts.countRecoveryCodes(victim.id)).toBe(0)
  })
})
