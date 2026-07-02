import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Rate limiting is failure-focused (skipSuccessfulRequests): only responses
// with status >= 400 accumulate against the window, so a brute-force run of
// 401s trips it while a stream of successful saves never does. We drive the
// limit down via env so the test is fast and deterministic.
//
// Each createApp() builds its own rate-limit MemoryStore, so the two suites
// below don't bleed into each other.

const MAX = 3

async function buildApp(): Promise<Express> {
  const { createApp } = await import('../../server/app')
  return createApp()
}

describe('API rate limiting — failed-auth brute force', () => {
  let app: Express

  beforeAll(async () => {
    process.env.RESUME_DB_PATH = ':memory:'
    process.env.RESUME_API_TOKEN = 'correct-horse'
    process.env.RESUME_RATE_LIMIT_MAX = String(MAX)
    app = await buildApp()
  })
  afterAll(() => {
    delete process.env.RESUME_DB_PATH
    delete process.env.RESUME_API_TOKEN
    delete process.env.RESUME_RATE_LIMIT_MAX
  })

  it('429s after too many failed-auth attempts, then blocks even a valid token', async () => {
    // MAX failures with a wrong token — each should be a normal 401.
    for (let i = 0; i < MAX; i++) {
      const res = await request(app).get('/api/resumes').set('Authorization', 'Bearer wrong')
      expect(res.status).toBe(401)
    }
    // The next request (still wrong) is rate-limited.
    const blocked = await request(app).get('/api/resumes').set('Authorization', 'Bearer wrong')
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many requests' })

    // Once the IP is limited, even the CORRECT token is refused — the limiter
    // runs ahead of auth. (Demonstrates the brake is real, not auth-dependent.)
    const correctButBlocked = await request(app)
      .get('/api/resumes')
      .set('Authorization', 'Bearer correct-horse')
    expect(correctButBlocked.status).toBe(429)
  })

  it('leaves the health check unthrottled', async () => {
    // Even after the window is exhausted above, health stays available.
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('API rate limiting — successful traffic is exempt', () => {
  let app: Express

  beforeAll(async () => {
    process.env.RESUME_DB_PATH = ':memory:'
    delete process.env.RESUME_API_TOKEN // no auth → all reads are 200
    process.env.RESUME_RATE_LIMIT_MAX = String(MAX)
    app = await buildApp()
  })
  afterAll(() => {
    delete process.env.RESUME_DB_PATH
    delete process.env.RESUME_RATE_LIMIT_MAX
  })

  it('does not count 2xx responses (auto-save never trips the limit)', async () => {
    // Far more successful requests than MAX — none should be rate-limited,
    // because skipSuccessfulRequests un-counts every < 400 response.
    for (let i = 0; i < MAX * 3; i++) {
      const res = await request(app).get('/api/resumes')
      expect(res.status).toBe(200)
    }
  })
})

describe('Translation rate limiting — successful (billable) calls ARE counted', () => {
  let app: Express
  const T_MAX = 3

  beforeAll(async () => {
    process.env.RESUME_DB_PATH = ':memory:'
    delete process.env.RESUME_API_TOKEN // no auth so the request reaches the limiter/route
    process.env.RESUME_RATE_LIMIT_MAX = '100000' // keep the main (failure) limiter out of the way
    process.env.RESUME_TRANSLATE_RATE_LIMIT_MAX = String(T_MAX)
    app = await buildApp()
  })
  afterAll(() => {
    delete process.env.RESUME_DB_PATH
    delete process.env.RESUME_RATE_LIMIT_MAX
    delete process.env.RESUME_TRANSLATE_RATE_LIMIT_MAX
  })

  it('429s after too many translate calls even without any failures', async () => {
    // Translation isn't configured here, so each call is a 503 — but the point
    // is the *count*: unlike the main limiter, this one tallies every response.
    for (let i = 0; i < T_MAX; i++) {
      const res = await request(app)
        .post('/api/translate')
        .send({ text: 'hei', source: 'no', target: 'en' })
      expect(res.status).not.toBe(429)
    }
    const blocked = await request(app)
      .post('/api/translate')
      .send({ text: 'hei', source: 'no', target: 'en' })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many translation requests' })
  })
})
