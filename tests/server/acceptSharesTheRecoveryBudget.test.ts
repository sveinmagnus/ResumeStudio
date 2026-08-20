import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { AccountsStore } from '../../server/accounts'

/**
 * Accepting an invitation is throttled against GUESSING, not against arriving.
 *
 * `/accept` sat in the success-inclusive recovery bucket beside `/forgot`,
 * `/reset` and `/recover`. That bucket counts successes for one specific
 * reason: `/forgot` answers 200 whatever happens, so a failure-counted budget
 * would never fire on it. `/accept` answers 400 on a token it does not know, so
 * that reason has never applied to it.
 *
 * What it cost is the one thing here several DIFFERENT people do at once.
 * Colleagues onboarding from one office share one address, so the sixth
 * acceptance was refused with "Too many attempts. Try again later." — which
 * reads as a broken invitation, not a limit. The e2e suite hit it doing nothing
 * more unusual than inviting somebody.
 */

let app: Express
let accounts: AccountsStore

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  process.env.RESUME_RECOVERY_RATE_LIMIT_MAX = '3'
  delete process.env.RESUME_API_TOKEN
  const { createApp } = await import('../../server/app')
  const { getDefaultDb } = await import('../../server/db')
  app = createApp()
  accounts = getDefaultDb().accounts
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_RECOVERY_RATE_LIMIT_MAX']) {
    delete process.env[k]
  }
})

const accept = (token: string, username: string) =>
  request(app).post('/api/users/accept').send({
    token, username, display_name: username, password: 'correct-horse-battery',
  })

describe('POST /api/users/accept', () => {
  it('lets a whole team through one address, well past the recovery ceiling', async () => {
    // Five real invitations, one office. The ceiling is three.
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const token = accounts.mintGrant('invite', { role: 'member' })
      statuses.push((await accept(token, `colleague${i}`)).status)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200])
  })

  it('still stops somebody working through tokens', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      statuses.push((await accept(`guess-${i}`, `intruder${i}`)).status)
    }
    // The ceiling is unchanged; only what counts against it moved.
    expect(statuses.slice(0, 3)).toEqual([400, 400, 400])
    expect(statuses.at(-1)).toBe(429)
  })
})
