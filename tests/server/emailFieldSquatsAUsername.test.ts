/**
 * FAILING — adversarial review finding (MEDIUM).
 *
 * `PUT /api/users/me` and `PUT /api/users/:id` accept `email` as any string.
 * There is no format check anywhere on the write path: `str(body.email)
 * .toLowerCase()` goes to `accounts.setEmail`, which only lower-cases it again.
 * `usernameProblem` guards the username charset carefully; its counterpart for
 * the OTHER login identifier does not exist.
 *
 * That matters because `findByLogin` searches both columns with one value:
 *
 *     WHERE username = ? OR (email IS NOT NULL AND email = ?)
 *
 * — with no ORDER BY and no tie-break. So a member who sets their email to a
 * bare word has planted that word in the login namespace:
 *
 *  - `POST /api/users/accept` refuses the username, because its collision check
 *    is `findByLogin`. A member can therefore permanently deny any username to
 *    every future colleague, and the owner debugging it is told "That username
 *    is taken" about a username no account holds. Ten squatted words is a
 *    minute's work and there is no route that lists them.
 *  - Two rows can answer to one login identifier at all. Which one `.get()`
 *    returns is whatever SQLite's plan for that OR happens to yield; today the
 *    username row wins, so this stops short of a login hijack — but nothing in
 *    the schema, the query or a test says it must, and an index change or a
 *    SQLite upgrade is free to reorder it.
 *  - `/forgot` and `/recover` resolve their subject through the same call.
 *
 * The address is also never checked for length or shape before it becomes the
 * reset channel; `mail.ts` refuses to SEND to it (correctly, by rejection), so
 * this is not header injection — it is a junk value sitting in the identifier
 * namespace and in `GET /api/users`.
 *
 * Hosted builds only. The fix is to validate the address on the way in with the
 * validator that already exists — `mail.ts`'s `isValidEmailAddress` — rather
 * than only on the way out.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { SESSION_COOKIE } from '../../server/auth'
import type { AccountsStore, UserRow } from '../../server/accounts'

let app: Express
let accounts: AccountsStore
let owner: UserRow
let squatter: UserRow

const CSRF = 'test-csrf-value'
const SQUATTER_PASSWORD = 'squatter-password'
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
  owner = accounts.createUser({ username: 'stine', displayName: 'Stine', pwHash: 'x', role: 'owner' })
  squatter = accounts.createUser({
    username: 'ola', displayName: 'Ola', pwHash: await hashPassword(SQUATTER_PASSWORD), role: 'member',
  })
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_RECOVERY_RATE_LIMIT_MAX']) {
    delete process.env[k]
  }
})

describe('the email field', () => {
  it('refuses a value that is not an address', async () => {
    const sid = accounts.createSession(squatter.id)
    const res = await request(app)
      .put('/api/users/me')
      .set('Cookie', cookie(sid))
      .set('x-csrf-token', CSRF)
      .send({ email: 'newhire', current_password: SQUATTER_PASSWORD })

    expect(res.status).toBe(400)
    expect(accounts.getUser(squatter.id)?.email).toBeNull()
  })

  it('cannot be used to deny a username to a future colleague', async () => {
    // Plant the word directly, so this case still stands if the route above is
    // fixed but the stored data is not (an instance that has already been
    // squatted, or a row set by an owner through PUT /:id).
    accounts.setEmail(squatter.id, 'newhire')

    const ownerSid = accounts.createSession(owner.id)
    const invite = await request(app)
      .post('/api/users/invite')
      .set('Cookie', cookie(ownerSid))
      .set('x-csrf-token', CSRF)
      .send({ role: 'member' })
    expect(invite.status).toBe(200)

    const accepted = await request(app)
      .post('/api/users/accept')
      .send({
        token: invite.body.token,
        username: 'newhire',
        display_name: 'New Hire',
        password: 'a-long-enough-password',
      })

    // A username nobody holds must be available.
    expect(accepted.status).toBe(200)
  })
})
