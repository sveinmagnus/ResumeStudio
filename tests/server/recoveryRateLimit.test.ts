import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

/**
 * The recovery routes carry their own ceiling.
 *
 * `apiLimiter` sets `skipSuccessfulRequests` so auto-save is never throttled,
 * and `/forgot` answers 200 in every case so it cannot be used to discover
 * whether an account exists. Together those made the one endpoint that sends
 * mail to a caller-chosen address the one endpoint with no limit at all.
 */

let app: Express

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  process.env.RESUME_RECOVERY_RATE_LIMIT_MAX = '3'
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_RECOVERY_RATE_LIMIT_MAX']) {
    delete process.env[k]
  }
})

describe('POST /api/users/forgot', () => {
  it('is throttled even though every answer is a success', async () => {
    // The general limiter would never fire here: it skips 2xx, and this route
    // returns 200 for an unknown login by design.
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/users/forgot').send({ login: 'nobody' })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200])
    expect(statuses.at(-1)).toBe(429)
  })
})

describe('the ordinary API is not caught by it', () => {
  it('leaves resume listing on the general limiter', async () => {
    // Auto-save and listing must stay unthrottled; a shared ceiling would have
    // made five password attempts lock the editor.
    for (let i = 0; i < 8; i++) {
      expect((await request(app).get('/api/resumes')).status).toBe(200)
    }
  })
})
