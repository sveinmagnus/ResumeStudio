/**
 * FAILING — the third write path into `users.email`, missed by the fix (LOW).
 *
 * Addresses are now validated on `PUT /api/users/me` and `PUT /api/users/:id`
 * with `isValidEmailAddress`. `POST /api/users/invite` is the third door and
 * still takes `str(body.email).toLowerCase()` unchecked. The grant carries the
 * value, and `/accept` hands it straight to `accounts.createUser`, which only
 * lower-cases it — so a bare word still reaches the column that `findByLogin`
 * searches beside `username`.
 *
 * The squatting consequence IS closed (that check now uses `usernameInUse`), so
 * this is low: it takes an owner to plant it, and an owner can already do worse
 * deliberately. What remains is the ambiguity — two rows answering to one login
 * identifier, with no ORDER BY and no tie-break deciding which `.get()` returns
 * — plus a junk value sitting in the reset channel and in `GET /api/users`.
 *
 * Validating at the one boundary and not the other two is also how the original
 * defect happened: the value was checked on the way OUT (`mail.ts` refuses to
 * send to it) and not on the way in.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { SESSION_COOKIE } from '../../server/auth'
import type { AccountsStore, UserRow } from '../../server/accounts'

let app: Express
let accounts: AccountsStore
let owner: UserRow

const CSRF = 'test-csrf-value'
const cookie = (sid: string): string => `${SESSION_COOKIE}=${sid}; rs_csrf=${CSRF}`

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  delete process.env.RESUME_API_TOKENS
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  process.env.RESUME_RECOVERY_RATE_LIMIT_MAX = '1000000'

  const { createApp } = await import('../../server/app')
  const { getDefaultDb } = await import('../../server/db')
  app = createApp()
  accounts = getDefaultDb().accounts
  owner = accounts.createUser({ username: 'stine', displayName: 'Stine', pwHash: 'x', role: 'owner' })
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_RECOVERY_RATE_LIMIT_MAX']) {
    delete process.env[k]
  }
})

describe('POST /api/users/invite', () => {
  it('refuses an email that is not an address, like the other two write paths', async () => {
    const sid = accounts.createSession(owner.id)
    const res = await request(app)
      .post('/api/users/invite')
      .set('Cookie', cookie(sid))
      .set('x-csrf-token', CSRF)
      .send({ role: 'member', email: 'not-an-address' })

    expect(res.status).toBe(400)
  })

  it('does not let an accepted invite plant a bare word in the email column', async () => {
    const sid = accounts.createSession(owner.id)
    const invite = await request(app)
      .post('/api/users/invite')
      .set('Cookie', cookie(sid))
      .set('x-csrf-token', CSRF)
      .send({ role: 'member', email: 'stine' })

    if (invite.status === 400) return // already refused above — nothing to plant

    const accepted = await request(app).post('/api/users/accept').send({
      token: invite.body.token,
      username: 'newhire',
      display_name: 'New Hire',
      password: 'a-long-enough-password',
    })
    expect(accepted.status).toBe(200)

    const planted = accounts.getUser(accepted.body.user.id)
    // Either the address is a real one or there is none. A bare word that
    // collides with `stine`'s username must never reach the login namespace.
    expect(planted?.email).toBeNull()
  })
})
