/**
 * Double-submit CSRF token (plan D4).
 *
 * WHY, GIVEN THERE ARE ALREADY TWO DEFENCES. `SameSite=Strict` on the session
 * cookie and the `Sec-Fetch-Site` guard in `app.ts` both stop cross-site
 * requests — but both are signals the BROWSER volunteers. A browser that omits
 * `Sec-Fetch-Site` and mishandles `SameSite` leaves nothing between an
 * attacker's page and a state-changing request carrying the user's cookie.
 *
 * This does not ask the browser for anything. The server sets a random value in
 * a READABLE cookie; the client echoes it in a header; the two must match. An
 * attacker's page cannot read a cookie from another origin, so it cannot
 * produce the header — no matter what the browser volunteers.
 *
 * NOT SECRET, AND NOT HttpOnly. The token's whole job is to be readable by our
 * own page's JavaScript. It is not a credential: knowing it grants nothing
 * without also holding the session cookie, and anyone who can read it from the
 * page could already act as the user.
 *
 * WHAT IS EXEMPT, AND WHY. CSRF protects actions authorised by an AMBIENT
 * credential — one the browser attaches on its own. The unauthenticated
 * endpoints carry their own proof (a password, a one-time code, a grant token),
 * so an attacker who could forge a request to them would have to already know
 * that proof, at which point they do not need the victim's browser. Requiring a
 * token there would also make the login page unusable on a first visit, since
 * no cookie exists yet.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { parseCookies } from './auth.js'

/** Readable by design — see the header. */
export const CSRF_COOKIE = 'rs_csrf'
export const CSRF_HEADER = 'x-csrf-token'

/** Methods that can change something. GET/HEAD/OPTIONS are not protected. */
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Paths under `/api` that establish or repair a credential and therefore cannot
 * require one. Matched as exact paths, not prefixes: a prefix match on
 * `/api/auth` would exempt anything added under it later, which is the kind of
 * quiet widening this list exists to prevent.
 */
const EXEMPT = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/bootstrap',
  '/api/users/accept',
  '/api/users/reset',
  '/api/users/recover',
  '/api/users/forgot',
  '/api/users/verify-email',
])

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Set-Cookie for the token. No HttpOnly (the page must read it), SameSite=Strict
 * and Secure in production to match the session cookie's posture.
 */
export function csrfCookie(token: string): string {
  const parts = [`${CSRF_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'SameSite=Strict']
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length === 0 || ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Reject a state-changing request whose header does not match its cookie.
 *
 * Only enforced for requests that actually carry the session cookie: a bearer
 * token is not ambient — a browser never attaches it on its own — so a service
 * client has nothing to forge and nothing to prove here.
 */
export function csrfMiddleware(sessionCookieName: string) {
  return function csrf(req: Request, res: Response, next: NextFunction): void {
    if (!UNSAFE.has(req.method)) {
      next()
      return
    }
    if (EXEMPT.has(req.path)) {
      next()
      return
    }
    const cookies = parseCookies(req.headers.cookie)
    if (!cookies[sessionCookieName]) {
      next()
      return
    }
    const sent = req.headers[CSRF_HEADER]
    const header = Array.isArray(sent) ? sent[0] : sent
    if (!header || !equal(header, cookies[CSRF_COOKIE] ?? '')) {
      res.status(403).json({ error: 'Missing or invalid CSRF token.' })
      return
    }
    next()
  }
}
