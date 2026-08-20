/**
 * FAILING — adversarial review finding (MEDIUM).
 *
 * `csrf.ts`'s EXEMPT list holds absolute paths (`/api/users/reset`, …) and
 * carries a paragraph about why they are matched exactly rather than by prefix.
 * But `app.ts` mounts the middleware as `app.use('/api', csrfMiddleware(…))`,
 * and Express strips the mount path from `req.url` before a mounted middleware
 * runs. Inside it, `req.path` is `/users/reset`, never `/api/users/reset` — so
 * `EXEMPT.has(req.path)` is false for every entry on the list. The exempt list
 * is dead code in the only configuration that ships.
 *
 * `tests/server/csrf.test.ts` does not catch this because it mounts the
 * middleware at the ROOT (`a.use(csrfMiddleware(SESSION))`), where `req.path`
 * is the full path. The unit under test is not the unit that runs.
 *
 * Two consequences, in order of importance:
 *
 *  1. A deliberate, documented security decision is not enforced, and nothing
 *     says so. The next person to touch this reads the comment, believes the
 *     list is live, and adds to it. Worse, the obvious repair — switching to
 *     `req.originalUrl` — reintroduces the query string, and the obvious repair
 *     for THAT is a `startsWith`, which is exactly the prefix widening the
 *     comment exists to forbid.
 *
 *  2. It fails closed, not open, so it is not a bypass — but it breaks the
 *     recovery flows for anyone whose browser holds a session cookie without a
 *     matching `rs_csrf` (a cookie cleared by hand, a `rs_csrf` expiry policy
 *     added later, a client that posts the reset form without reading the
 *     cookie). Those are the routes that exist for people who are already
 *     locked out, and the failure they get is a 403 about a token nobody
 *     mentioned to them.
 *
 * Both assertions below are on the REAL `createApp()` stack, which is the point.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { SESSION_COOKIE } from '../../server/auth'

let app: Express

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  delete process.env.RESUME_API_TOKENS
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  process.env.RESUME_RECOVERY_RATE_LIMIT_MAX = '1000000'
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_RECOVERY_RATE_LIMIT_MAX']) {
    delete process.env[k]
  }
})

/** A session cookie the server will not resolve — all these routes are public. */
const STALE_SESSION = `${SESSION_COOKIE}=a-cookie-left-over-from-before`

describe('the routes csrf.ts exempts', () => {
  it('reaches POST /api/users/reset without a CSRF header', async () => {
    const res = await request(app)
      .post('/api/users/reset')
      .set('Cookie', STALE_SESSION)
      .send({ token: 'not-a-real-grant', password: 'a-long-enough-password' })

    // 400 "that link has expired" = the handler ran, which is what exemption
    // means. 403 = the brake fired on a route the list says it must not.
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(400)
  })

  it('reaches POST /api/auth/login without a CSRF header', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', STALE_SESSION)
      .send({ login: 'nobody', password: 'a-long-enough-password' })

    expect(res.status).not.toBe(403)
  })

  it('still refuses a non-exempt route without one, so the brake is really on', async () => {
    const res = await request(app)
      .post('/api/resumes')
      .set('Cookie', STALE_SESSION)
      .send({ name: 'x' })

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/CSRF/i)
  })
})
