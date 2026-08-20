/**
 * FAILING — adversarial review finding (HIGH).
 *
 * The bootstrap code is documented as one-time ("Forget the code. Called the
 * moment it is successfully spent."), and the route's own guard is
 * `accounts.hasAnyUser()`. But between that guard and the row that would make
 * it true, `POST /api/auth/bootstrap` awaits `hashPassword` — a real yield of
 * several hundred milliseconds of scrypt. Two requests that arrive in that
 * window both read "no users yet", both pass the code check, and both go on to
 * `createUser({ role: 'owner' })`.
 *
 * So one code creates as many OWNER accounts as there are concurrent requests
 * carrying it. `clearBootstrapCode()` runs afterwards and is therefore too
 * late; the last-owner guard in `routes/users.ts` then treats the extra owner
 * as legitimate, so it cannot be disabled or demoted away by the real operator
 * without first noticing it exists.
 *
 * Who it hurts: anyone who can read the code but not act on it first — a
 * shared terminal, a log shipper, a screen-shared install session, a container
 * log in a team chat. The intended trust boundary is "can read the console", and
 * the intended cost of crossing it is one account that the operator will
 * immediately see they did not create. The race turns that into a silent second
 * owner beside the operator's own, which is the state the code exists to prevent.
 *
 * Reachable on both builds; only meaningful on a hosted one, where the desktop
 * build's `open` mode never asks for a code at all.
 *
 * The fix is not more validation: it is doing the existence check and the insert
 * without an await between them — hash first, then re-check and insert inside a
 * single transaction (or make `users` refuse a second row while the code is
 * unspent).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { AccountsStore } from '../../server/accounts'

let app: Express
let accounts: AccountsStore
let code: string

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  delete process.env.RESUME_API_TOKENS
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'

  const { createApp } = await import('../../server/app')
  const { getAccounts } = await import('../../server/db')
  const { issueBootstrapCode } = await import('../../server/bootstrap')
  app = createApp()
  accounts = getAccounts()
  code = issueBootstrapCode()
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX']) delete process.env[k]
})

describe('the one-time bootstrap code', () => {
  it('cannot be spent twice, even by two requests in flight together', async () => {
    const bootstrap = (username: string) =>
      request(app).post('/api/auth/bootstrap').send({
        code,
        username,
        display_name: username,
        password: 'a-long-enough-password',
      })

    const [first, second] = await Promise.all([bootstrap('operator'), bootstrap('shoulder')])

    const accepted = [first, second].filter((r) => r.status === 200)
    expect(accepted).toHaveLength(1)

    // The decisive assertion: the instance ends up with exactly the one owner
    // the operator meant to create.
    expect(accounts.countOwners()).toBe(1)
    expect(accounts.listUsers().filter((u) => u.role === 'owner')).toHaveLength(1)
  })
})
