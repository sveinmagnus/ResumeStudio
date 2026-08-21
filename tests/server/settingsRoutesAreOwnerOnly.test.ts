import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { AccountsStore } from '../../server/accounts'

/**
 * The settings endpoints that spend the operator's money are owner-only.
 *
 * `settingsRoutes.test.ts` runs the app in `open` mode, where every viewer
 * carries the owner role, so `requireOwner` there can never refuse anybody —
 * and the mutation report duly showed those guards deletable. This drives the
 * same routes in `accounts` mode with a real member session, which is the only
 * arrangement in which the guard has anything to do.
 *
 * What it protects: `/translate/test`, `/llm/test` and `/llm/models` all reach
 * the configured provider with the operator's key. A member who could call them
 * at wire speed would be running up somebody else's bill, and the general
 * limiter skips successful responses so it never spends its budget on a 200.
 */

let app: Express
let accounts: AccountsStore
let ownerCookie = ''
let memberCookie = ''

/**
 * The CSRF pair. `createApp` mounts the double-submit brake, so a
 * state-changing request carrying a session cookie and no matching header is
 * refused with a 403 — the same status `requireOwner` uses. Without this every
 * case below would pass for the wrong reason, which is how the first draft of
 * this file "worked" until the OWNER cases failed too.
 */
const TEST_CSRF = 'test-csrf-value'
const send = (path: string, cookie: string, body: Record<string, unknown> = {}) =>
  request(app).post(path).set('Cookie', `${cookie}; rs_csrf=${TEST_CSRF}`)
    .set('x-csrf-token', TEST_CSRF).send(body)
const put = (cookie: string, body: Record<string, unknown>) =>
  request(app).put('/api/settings').set('Cookie', `${cookie}; rs_csrf=${TEST_CSRF}`)
    .set('x-csrf-token', TEST_CSRF).send(body)

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  delete process.env.RESUME_API_TOKEN
  delete process.env.RESUME_API_TOKENS
  // NOT the desktop build: there the machine's user is the operator and the
  // whole surface is theirs.
  delete process.env.RESUME_DESKTOP

  const { createApp } = await import('../../server/app')
  const { getDefaultDb } = await import('../../server/db')
  const { hashPassword } = await import('../../server/passwords')
  app = createApp()
  accounts = getDefaultDb().accounts

  const hash = await hashPassword('a-long-enough-password')
  const owner = accounts.createUser({ username: 'eier', displayName: 'Eier', pwHash: hash, role: 'owner' })
  const member = accounts.createUser({ username: 'medlem', displayName: 'Medlem', pwHash: hash, role: 'member' })
  ownerCookie = `rs_session=${encodeURIComponent(accounts.createSession(owner.id))}`
  memberCookie = `rs_session=${encodeURIComponent(accounts.createSession(member.id))}`
}, 40_000)

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX']) delete process.env[k]
})

/** The billable probes, each of which reaches a provider with the operator's key. */
const BILLABLE: [string, Record<string, unknown>][] = [
  ['/api/settings/translate/test', { translate_provider: 'off' }],
  ['/api/settings/llm/test', {}],
  ['/api/settings/llm/models', {}],
]

describe('a member', () => {
  it.each(BILLABLE)('is refused %s', async (path, body) => {
    expect((await send(path, memberCookie, body)).status).toBe(403)
  })

  it('cannot write settings either', async () => {
    expect((await put(memberCookie, { mail_from: 'x@y.no' })).status).toBe(403)
  })
})

describe('an owner', () => {
  it.each(BILLABLE)('reaches %s', async (path, body) => {
    // Any answer but 403: what matters is that the guard let them past. The
    // probes themselves report unreachable providers as a 200 with a message.
    expect((await send(path, ownerCookie, body)).status).not.toBe(403)
  })

  it('may write the keys a hosted owner owns', async () => {
    expect((await put(ownerCookie, { mail_from: 'noreply@example.no' })).status).toBe(200)
  })

  it('still cannot write a machine-level key', async () => {
    // Ports, the sync folder and the local hostname are properties of the
    // machine; a web request that could move one is how an instance talks
    // itself off the network.
    expect((await put(ownerCookie, { backup_dir: '/tmp/elsewhere' })).status).toBe(403)
  })
})
