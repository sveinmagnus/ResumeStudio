import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { AccountsStore } from '../../server/accounts'

/**
 * The D3 migration: named tokens become real accounts, once, at bootstrap.
 *
 * `RESUME_API_TOKENS` parsing has tests; the CONVERSION had none. That is the
 * half that runs on a real upgrade, creates rows, and decides whether an
 * operator's existing colleagues still exist afterwards — and mutation testing
 * found 109 mutants in `routes/auth` that no test reaches at all.
 *
 * Why it runs inside bootstrap rather than at boot: creating these accounts
 * flips the instance into `accounts` mode, where bootstrap 404s. Doing it at
 * boot would therefore lock everybody out of a server whose owner had not been
 * created yet.
 *
 * Each converted account gets a LOCKED password, because the shared secret it
 * came from must not keep working as that person's credential. The owner hands
 * each of them a reset link, which is the ordinary forgotten-password flow.
 */

let app: Express
let accounts: AccountsStore
let code: string

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  // A display name with a space and capitals, one that collides with the
  // owner's chosen username, and one that survives slugging as nothing.
  process.env.RESUME_API_TOKENS = 'CI Runner:tok-ci,ola:tok-ola,!!!:tok-junk'
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'

  const { createApp } = await import('../../server/app')
  const { getAccounts } = await import('../../server/db')
  const { issueBootstrapCode } = await import('../../server/bootstrap')
  app = createApp()
  accounts = getAccounts()
  code = issueBootstrapCode()
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_API_TOKENS']) {
    delete process.env[k]
  }
})

describe('bootstrap converts named tokens', () => {
  it('creates one account per token, reports them, and locks every password', async () => {
    const res = await request(app).post('/api/auth/bootstrap').send({
      code, username: 'ola', display_name: 'Ola Eier', password: 'a-long-enough-password',
    })
    expect(res.status).toBe(200)

    // Reported back, because named tokens stop authenticating from here on and
    // the owner needs to know which accounts are now waiting for a reset link.
    expect(res.body.converted_tokens).toHaveLength(3)

    const users = accounts.listUsers()
    // The owner plus one per token.
    expect(users).toHaveLength(4)

    for (const name of res.body.converted_tokens as string[]) {
      const u = accounts.findByLogin(name)
      expect(u, name).not.toBeNull()
      expect(u?.role).toBe('member')
      // Locked, not merely different: the token must not keep working.
      expect(accounts.getHash(u!.id)?.startsWith('locked$')).toBe(true)
    }
  }, 30_000)

  it('slugs a display name, and does not collide with the owner it just created', () => {
    const names = accounts.listUsers().map((u) => u.username)
    // 'CI Runner' is not a legal username; it is folded to one.
    expect(names).toContain('ci-runner')
    // The owner took 'ola' in the same request, so the token of that name is
    // given a suffix rather than failing the whole migration.
    expect(names).toContain('ola')
    expect(names.some((n) => /^ola-\d+$/.test(n))).toBe(true)
    // Punctuation slugs to nothing usable, so it falls back to a placeholder.
    expect(names.some((n) => /^legacy-user-\d+$/.test(n))).toBe(true)
    // Every username is unique — the whole point of the collision handling.
    expect(new Set(names).size).toBe(names.length)
  })

  it('leaves the instance in accounts mode, with the code spent', async () => {
    const res = await request(app).get('/api/auth/status')
    expect(res.body.mode).toBe('accounts')
    expect(res.body.bootstrap_available).toBe(false)
  })
})
