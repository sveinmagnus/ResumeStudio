import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { csrfMiddleware, csrfCookie, newCsrfToken, CSRF_COOKIE, CSRF_HEADER } from '../../server/csrf'

/**
 * The double-submit brake.
 *
 * What it defends: an attacker's page making the victim's browser fire a
 * state-changing request, with the session cookie attached automatically. The
 * attacker cannot READ a cookie from another origin, so they cannot reproduce
 * it in a header — which is the whole mechanism.
 *
 * These cases are written from the attacker's side: each "refuses" test is a
 * thing a forged request can actually do (omit the header, guess it, send a
 * stale one), and each "allows" test is a thing that must keep working.
 */

const SESSION = 'rs_session'
const TOKEN = 'a-csrf-token-value'

function app() {
  const a = express()
  a.use(express.json())
  // Mounted at '/api', exactly as createApp does. Mounting it at the root here
  // is what let a broken exempt list pass: inside a mount Express strips the
  // prefix from `req.path`, so a list of `/api/...` entries matched nothing.
  a.use('/api', csrfMiddleware(SESSION))
  a.post('/api/resumes', (_req, res) => { res.json({ ok: true }) })
  a.put('/api/resumes/x', (_req, res) => { res.json({ ok: true }) })
  a.delete('/api/resumes/x', (_req, res) => { res.json({ ok: true }) })
  a.get('/api/resumes', (_req, res) => { res.json({ ok: true }) })
  a.post('/api/auth/login', (_req, res) => { res.json({ ok: true }) })
  a.post('/api/users/reset', (_req, res) => { res.json({ ok: true }) })
  a.post('/api/auth/somethingnew', (_req, res) => { res.json({ ok: true }) })
  return a
}

const signedIn = `${SESSION}=sid; ${CSRF_COOKIE}=${TOKEN}`

describe('refuses a forged request', () => {
  it('when the header is missing entirely', async () => {
    const r = await request(app()).post('/api/resumes').set('Cookie', signedIn)
    expect(r.status).toBe(403)
  })

  it('when the header does not match the cookie', async () => {
    const r = await request(app()).post('/api/resumes')
      .set('Cookie', signedIn).set(CSRF_HEADER, 'a-different-value')
    expect(r.status).toBe(403)
  })

  it('when the header is present but the cookie is not', async () => {
    // An attacker can set a header on a request they script; they cannot set
    // our cookie. Accepting a header alone would defeat the whole scheme.
    const r = await request(app()).post('/api/resumes')
      .set('Cookie', `${SESSION}=sid`).set(CSRF_HEADER, TOKEN)
    expect(r.status).toBe(403)
  })

  it('when both are empty strings', async () => {
    const r = await request(app()).post('/api/resumes')
      .set('Cookie', `${SESSION}=sid; ${CSRF_COOKIE}=`).set(CSRF_HEADER, '')
    expect(r.status).toBe(403)
  })

  it('on PUT and DELETE, not just POST', async () => {
    expect((await request(app()).put('/api/resumes/x').set('Cookie', signedIn)).status).toBe(403)
    expect((await request(app()).delete('/api/resumes/x').set('Cookie', signedIn)).status).toBe(403)
  })
})

describe('allows what must keep working', () => {
  it('a matching pair', async () => {
    const r = await request(app()).post('/api/resumes')
      .set('Cookie', signedIn).set(CSRF_HEADER, TOKEN)
    expect(r.status).toBe(200)
  })

  it('a GET, which changes nothing', async () => {
    const r = await request(app()).get('/api/resumes').set('Cookie', signedIn)
    expect(r.status).toBe(200)
  })

  it('a request with no session cookie at all', async () => {
    // A bearer service client is not ambient — a browser never attaches that
    // header on its own — so there is nothing for an attacker to ride on.
    const r = await request(app()).post('/api/resumes')
    expect(r.status).toBe(200)
  })

  it('the exempt endpoints, which carry their own proof', async () => {
    for (const path of ['/api/auth/login', '/api/users/reset']) {
      const r = await request(app()).post(path).set('Cookie', signedIn)
      expect(r.status).toBe(200)
    }
  })
})

describe('the exempt list is exact, not a prefix', () => {
  it('does not exempt a new route added under an exempt parent', async () => {
    // A prefix match on `/api/auth` would silently exempt whatever is added
    // there next. This is the test that stops the list widening by accident.
    const r = await request(app()).post('/api/auth/somethingnew').set('Cookie', signedIn)
    expect(r.status).toBe(403)
  })
})

describe('csrfCookie', () => {
  /** `Secure` follows the connection now, so the cookie is built per request. */
  const overHttps = { secure: true } as unknown as Parameters<typeof csrfCookie>[0]
  const overHttp = { secure: false } as unknown as Parameters<typeof csrfCookie>[0]

  it('is readable by the page, which is the point', () => {
    // HttpOnly would make the client unable to echo it, breaking every write.
    expect(csrfCookie(overHttps, TOKEN)).not.toContain('HttpOnly')
  })

  it('is SameSite=Strict and path-wide', () => {
    const c = csrfCookie(overHttps, TOKEN)
    expect(c).toContain('SameSite=Strict')
    expect(c).toContain('Path=/')
  })

  it('tracks the session cookie on Secure, so the pair cannot disagree', () => {
    // A CSRF cookie the browser keeps beside a session cookie it discarded (or
    // the reverse) would fail every write for a reason nobody could see.
    expect(csrfCookie(overHttps, TOKEN)).toContain('Secure')
    expect(csrfCookie(overHttp, TOKEN)).not.toContain('Secure')
  })

  it('mints a distinct high-entropy value each time', () => {
    const a = newCsrfToken()
    const b = newCsrfToken()
    expect(a).not.toEqual(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
  })
})
