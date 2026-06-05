import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Drives the real createApp() with a configured token, exercising the
// /api/auth login/logout/status grammar and the cookie → authenticated-request
// round-trip. Auth modules read env lazily, so toggling RESUME_API_TOKEN at
// runtime flips between the "auth required" and "auth disabled" behaviours.

let app: Express
const TOKEN = 'test-token-value'

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  process.env.RESUME_API_TOKEN = TOKEN
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_API_TOKEN']) {
    delete process.env[k]
  }
})

/** First cookie pair (name=value) of a Set-Cookie header, without attributes. */
function cookiePair(setCookie: string[] | undefined): string {
  const header = (setCookie ?? [])[0] ?? ''
  return header.split(';')[0]
}

describe('GET /api/auth/status', () => {
  it('reports auth_required:true when a token is configured', async () => {
    const res = await request(app).get('/api/auth/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ auth_required: true })
  })
})

describe('POST /api/auth/login', () => {
  it('rejects a wrong token with 401 and sets no cookie', async () => {
    const res = await request(app).post('/api/auth/login').send({ token: 'wrong' })
    expect(res.status).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('rejects a non-string token with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ token: 12345 })
    expect(res.status).toBe(401)
  })

  it('accepts the correct token and sets an HttpOnly, SameSite=Strict cookie', async () => {
    const res = await request(app).post('/api/auth/login').send({ token: TOKEN })
    expect(res.status).toBe(200)
    const setCookie = (res.headers['set-cookie'] ?? [])[0] ?? ''
    expect(setCookie).toMatch(/^rs_token=/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Strict/i)
  })
})

describe('cookie → authenticated request', () => {
  it('a request carrying the login cookie is authorized; without it, 401', async () => {
    const login = await request(app).post('/api/auth/login').send({ token: TOKEN })
    const cookie = cookiePair(login.headers['set-cookie'])

    const noCookie = await request(app).get('/api/resumes')
    expect(noCookie.status).toBe(401)

    const withCookie = await request(app).get('/api/resumes').set('Cookie', cookie)
    expect(withCookie.status).toBe(200)
    expect(withCookie.body).toHaveProperty('resumes')
  })
})

describe('POST /api/auth/logout', () => {
  it('clears the cookie (Max-Age=0)', async () => {
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(200)
    const setCookie = (res.headers['set-cookie'] ?? [])[0] ?? ''
    expect(setCookie).toMatch(/^rs_token=/)
    expect(setCookie).toMatch(/Max-Age=0/i)
  })
})

describe('auth disabled (no token configured)', () => {
  it('status reports auth_required:false and login succeeds without a cookie', async () => {
    const saved = process.env.RESUME_API_TOKEN
    delete process.env.RESUME_API_TOKEN
    try {
      const status = await request(app).get('/api/auth/status')
      expect(status.body).toEqual({ auth_required: false })

      const login = await request(app).post('/api/auth/login').send({})
      expect(login.status).toBe(200)
      expect(login.body).toMatchObject({ ok: true, auth_required: false })
      expect(login.headers['set-cookie']).toBeUndefined()

      // And the API is reachable with no credentials.
      const list = await request(app).get('/api/resumes')
      expect(list.status).toBe(200)
    } finally {
      if (saved !== undefined) process.env.RESUME_API_TOKEN = saved
    }
  })
})
