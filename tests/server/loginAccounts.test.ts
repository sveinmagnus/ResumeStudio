import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { AccountsStore } from '../../server/accounts'

/**
 * POST /api/auth/login in ACCOUNTS mode — the door every person walks through.
 *
 * It had no unit coverage at all: authRoutes.test.ts drives token mode, and
 * every accounts-mode suite signs in by MINTING a session directly, which skips
 * this route entirely. The mutation report showed 76 unreached mutants here,
 * and they include the route's whole point — the dummy verification that makes
 * an unknown login cost what a wrong password costs, the identical refusal for
 * a disabled account, and the silent hash upgrade at the one moment the
 * plaintext is in hand. (The locked-hash TIMING lives in its own wall-clock
 * suite; what belongs here is that the ANSWER is the same.)
 */

let app: Express
let accounts: AccountsStore
const PASSWORD = 'a-long-enough-password'

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  delete process.env.RESUME_API_TOKEN
  delete process.env.RESUME_API_TOKENS

  const { createApp } = await import('../../server/app')
  const { getDefaultDb } = await import('../../server/db')
  const { hashPassword, lockedPasswordHash } = await import('../../server/passwords')
  app = createApp()
  accounts = getDefaultDb().accounts

  const hash = await hashPassword(PASSWORD)
  accounts.createUser({ username: 'kari', displayName: 'Kari', pwHash: hash, email: 'kari@example.no', role: 'member' })
  const off = accounts.createUser({ username: 'avskrudd', displayName: 'Av', pwHash: hash, role: 'member' })
  accounts.setDisabled(off.id, true)
  accounts.createUser({ username: 'migrert', displayName: 'Migrert', pwHash: lockedPasswordHash(), role: 'member' })
  // A REAL hash of the same password at a LOWER cost, as an old install would
  // hold — derived here because hashPassword only speaks today's parameters.
  const { scryptSync, randomBytes } = await import('node:crypto')
  const salt = randomBytes(16)
  const key = scryptSync(PASSWORD.normalize('NFC'), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
  accounts.createUser({
    username: 'gammel', displayName: 'Gammel', role: 'member',
    pwHash: `scrypt$N=16384,r=8,p=1$${salt.toString('base64url')}$${key.toString('base64url')}`,
  })
}, 60_000)

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX']) delete process.env[k]
})

const login = (body: Record<string, unknown>) =>
  request(app).post('/api/auth/login').send(body)

describe('signing in', () => {
  it('sets an HttpOnly session cookie AND the readable CSRF twin', async () => {
    const res = await login({ login: 'kari', password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ username: 'kari', role: 'member' })

    const cookies = res.headers['set-cookie'] as unknown as string[]
    const session = cookies.find((c) => c.startsWith('rs_session='))
    const csrf = cookies.find((c) => c.startsWith('rs_csrf='))
    expect(session).toContain('HttpOnly')
    // The CSRF cookie must be READABLE — the client echoes it in a header.
    expect(csrf).toBeDefined()
    expect(csrf).not.toContain('HttpOnly')
  })

  it('accepts the email address as the login identifier (D1)', async () => {
    expect((await login({ login: 'kari@example.no', password: PASSWORD })).status).toBe(200)
  })

  it('resolves the session it just issued', async () => {
    const res = await login({ login: 'kari', password: PASSWORD })
    const cookie = (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('rs_session='))!.split(';')[0]
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie)
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ name: 'Kari', role: 'member', service: false, mode: 'accounts' })
  })

  it('upgrades a lower-cost hash at sign-in, without ending the session it makes', async () => {
    // The one moment the plaintext is in hand is a successful login, so it is
    // the one moment a hash stored at an older cost can be re-derived at
    // today's. Deliberately not via setPassword, which ends every session —
    // including the one being created.
    const { needsRehash } = await import('../../server/passwords')
    const before = accounts.findByLogin('gammel')!
    expect(needsRehash(before.pw_hash)).toBe(true)

    const res = await login({ login: 'gammel', password: PASSWORD })
    expect(res.status).toBe(200)

    const after = accounts.getHash(before.id)!
    expect(after).not.toBe(before.pw_hash)
    expect(needsRehash(after)).toBe(false)
    // And the session issued during that very login still works.
    const cookie = (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('rs_session='))!.split(';')[0]
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200)
  })
})

describe('every wrong answer is the same wrong answer', () => {
  const WRONG = { error: 'Wrong username or password.' }

  it('for a wrong password', async () => {
    const res = await login({ login: 'kari', password: 'not-the-password' })
    expect(res.status).toBe(401)
    expect(res.body).toEqual(WRONG)
  })

  it('for a login nobody holds', async () => {
    const res = await login({ login: 'ingen', password: PASSWORD })
    expect(res.status).toBe(401)
    expect(res.body).toEqual(WRONG)
  })

  it('for a DISABLED account, even with the correct password', async () => {
    // "your account is disabled" would confirm the account exists and that the
    // password was right — to exactly the person who should learn neither.
    const res = await login({ login: 'avskrudd', password: PASSWORD })
    expect(res.status).toBe(401)
    expect(res.body).toEqual(WRONG)
  })

  it('for a LOCKED (token-converted) account, whatever is typed', async () => {
    const res = await login({ login: 'migrert', password: PASSWORD })
    expect(res.status).toBe(401)
    expect(res.body).toEqual(WRONG)
  })

  it('for a missing or non-string login or password', async () => {
    for (const body of [{}, { login: 'kari' }, { password: PASSWORD }, { login: 42, password: PASSWORD }]) {
      const res = await login(body as Record<string, unknown>)
      expect(res.status, JSON.stringify(body)).toBe(401)
    }
  })

  it('and none of them sets any cookie', async () => {
    const res = await login({ login: 'kari', password: 'not-the-password' })
    expect(res.headers['set-cookie']).toBeUndefined()
  })
})

describe('logout', () => {
  it('ends the session on the server, not merely in the browser', async () => {
    const res = await login({ login: 'kari', password: PASSWORD })
    const cookie = (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('rs_session='))!.split(';')[0]

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie)
    expect(out.status).toBe(200)
    // The cleared cookie is the courtesy; the dead session row is the security.
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401)
  })
})
