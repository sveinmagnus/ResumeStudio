/**
 * FAILING — adversarial review finding (MEDIUM).
 *
 * `routes/auth.ts` equalises login timing by running a scrypt verification
 * against a dummy hash when no user matched, and the header says so: "an
 * unknown login still runs a scrypt verification against a dummy hash, so
 * response time does not answer 'is there an account with this name'."
 *
 * It does for one class of account. `lockedPasswordHash()` returns
 * `locked$<random>`, which `passwords.decode()` rejects on its first line — so
 * `verifyPassword` returns false immediately, without deriving anything. A
 * login attempt against a locked account therefore answers in ~10-30 ms where
 * a real account and an unknown one both take ~300-700 ms.
 *
 * What that channel says is worse than plain existence. A locked hash is minted
 * in exactly one place: `convertLegacyTokens`, during bootstrap, for every
 * `RESUME_API_TOKENS` entry. So the fast answer means "this account exists, has
 * never had a password, and is waiting for somebody to hand it a reset link" —
 * the most useful account on the instance to target for a social-engineering
 * reset request, and the one whose owner is least likely to notice traffic
 * against it. The same hash shape is what any future "create an account, send
 * them a link" path would use.
 *
 * Hosted builds only (`open` mode never verifies a password).
 *
 * The fix is one line in the login handler: treat a locked hash like an unknown
 * user and run `dummyVerify` before answering.
 *
 * NOTE ON THIS TEST. It measures wall-clock, so it takes the median of three
 * probes per case and asserts a deliberately loose ratio. The real separation
 * measured on this branch is 10-30x, so a 3x bound is not a tight budget — it
 * is far above any plausible scheduling noise and still fails today.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { AccountsStore } from '../../server/accounts'

let app: Express
let accounts: AccountsStore

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  delete process.env.RESUME_API_TOKENS
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'

  const { createApp } = await import('../../server/app')
  const { getDefaultDb } = await import('../../server/db')
  const { hashPassword, lockedPasswordHash } = await import('../../server/passwords')
  app = createApp()
  accounts = getDefaultDb().accounts

  accounts.createUser({
    username: 'migrated', displayName: 'Migrated', pwHash: lockedPasswordHash(), role: 'member',
  })
  accounts.createUser({
    username: 'regular', displayName: 'Regular', pwHash: await hashPassword('a-real-password-x'), role: 'member',
  })
  // Warm the process-wide dummy hash so the first "unknown" probe is not the
  // one that pays to mint it.
  await request(app).post('/api/auth/login').send({ login: 'warm-up', password: 'wrong-password-here' })
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX']) delete process.env[k]
})

async function medianMs(login: string): Promise<number> {
  const runs: number[] = []
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    const res = await request(app).post('/api/auth/login').send({ login, password: 'wrong-password-here' })
    expect(res.status).toBe(401)
    runs.push(performance.now() - t0)
  }
  return runs.sort((a, b) => a - b)[1]
}

describe('a failed login', () => {
  it('costs the same against a locked account as against a real one', async () => {
    const locked = await medianMs('migrated')
    const real = await medianMs('regular')
    const unknown = await medianMs('nobody-at-all')

    // Every wrong answer should cost one scrypt derivation. The locked path
    // costs none, and that is the leak.
    expect(locked * 3).toBeGreaterThan(real)
    expect(locked * 3).toBeGreaterThan(unknown)
  })
})
