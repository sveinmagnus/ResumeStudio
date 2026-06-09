import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// The Sec-Fetch-Site guard (server/app.ts) rejects state-changing requests a
// browser reports as cross-site — the CSRF brake for the auth-less desktop
// build. Non-browser clients send no such header and must be unaffected.

let app: Express

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  delete process.env.RESUME_API_TOKEN // auth disabled (the desktop-like case)
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX']) delete process.env[k]
})

describe('cross-site request guard', () => {
  it('blocks a cross-site POST with 403', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({})
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Cross-site request blocked' })
  })

  it('allows a same-origin POST', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({})
    expect(res.status).not.toBe(403)
  })

  it('allows a POST with no Sec-Fetch-Site header (non-browser client)', async () => {
    const res = await request(app).post('/api/auth/login').send({})
    expect(res.status).not.toBe(403)
  })

  it('does NOT block a cross-site GET (safe method)', async () => {
    const res = await request(app).get('/api/health').set('Sec-Fetch-Site', 'cross-site')
    expect(res.status).toBe(200)
  })

  it('blocks a cross-site request to a powerful mutating route too', async () => {
    const res = await request(app)
      .post('/api/update/check')
      .set('Sec-Fetch-Site', 'cross-site')
    expect(res.status).toBe(403)
  })
})
