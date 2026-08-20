/**
 * Cookie construction — and the one decision that matters, `Secure`.
 *
 * WHY THIS IS ITS OWN MODULE. The flag was decided from `NODE_ENV` in four
 * separate places, and that is wrong in both directions:
 *
 *  - **Production over plain http** — a LAN box at `http://192.168.1.5` — set
 *    `Secure` on a cookie the browser then discarded. Safari is strictest about
 *    it, so a sign-in there "succeeded" and returned the user to the form
 *    forever with no error; Chrome and Firefox hid the same bug behind their
 *    trustworthy-origin exemption for `http://localhost`, which does NOT extend
 *    to an arbitrary host.
 *  - **TLS terminated at a proxy with `trust proxy` unset** — the reverse
 *    mismatch, where the connection is secure and the app cannot tell.
 *
 * So the flag follows the CONNECTION, not the build: `Secure` exactly when the
 * request arrived over HTTPS. `req.secure` is Express's answer, computed from
 * the socket or from `X-Forwarded-Proto` when `trust proxy` is configured —
 * which is what `RESUME_TRUST_PROXY` is for.
 *
 * THE RESIDUAL, stated because it is a downgrade rather than a break: an
 * operator who terminates TLS upstream and does not set `RESUME_TRUST_PROXY`
 * gets a cookie without `Secure`. `server/index.ts` warns loudly at startup for
 * exactly that case — previously the same misconfiguration produced a login
 * loop, which was at least visible.
 */

import type { Request } from 'express'

export interface CookieOptions {
  /** Omitted for a session cookie; `Max-Age=0` clears one. */
  maxAge?: number
  /** The CSRF token must be readable by the page, so it opts out. */
  httpOnly?: boolean
}

/**
 * Did this request arrive over HTTPS?
 *
 * `req.secure` already honours `trust proxy`. The explicit `X-Forwarded-Proto`
 * read is deliberately NOT here: without `trust proxy` that header is
 * attacker-supplied, and trusting it would let a client talk the server into
 * believing a plaintext connection was secure.
 */
export function isSecureRequest(req: Request): boolean {
  return req.secure === true
}

/**
 * Build a `Set-Cookie` value.
 *
 * `SameSite=Strict` on all of them: the session cookie must not ride a
 * cross-site request, and the CSRF cookie matching it keeps the double-submit
 * pair consistent.
 */
export function buildCookie(
  req: Request,
  name: string,
  value: string,
  opts: CookieOptions = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict']
  if (opts.httpOnly !== false) parts.push('HttpOnly')
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`)
  if (isSecureRequest(req)) parts.push('Secure')
  return parts.join('; ')
}

/**
 * The session cookie. No `Max-Age`: sessions end when something makes them
 * untrustworthy, not on a clock (plan D2).
 */
export function sessionCookie(req: Request, name: string, sessionId: string): string {
  return buildCookie(req, name, sessionId)
}

/** Clear a cookie. Must match the original's attributes to actually replace it. */
export function clearCookie(req: Request, name: string): string {
  return buildCookie(req, name, '', { maxAge: 0 })
}

/**
 * True when a production server is very likely behind a TLS proxy it cannot
 * see. Drives the startup warning rather than any runtime behaviour.
 */
export function mayLoseSecureFlag(): boolean {
  return process.env.NODE_ENV === 'production' && !process.env.RESUME_TRUST_PROXY?.trim()
}
