/**
 * Auth endpoints (mounted at /api/auth, rate-limited, NOT behind authMiddleware
 * — this is how a browser authenticates).
 *
 * The token is exchanged for an HttpOnly session cookie so it never lives in
 * JS-readable storage (sessionStorage/localStorage). That closes the
 * token-exfiltration path that any XSS would otherwise have. Non-browser
 * clients can still use `Authorization: Bearer` directly (see auth.ts).
 *
 *   GET  /api/auth/status  → { auth_required }  (no secret leaked)
 *   POST /api/auth/login   → validate token, Set-Cookie on success
 *   POST /api/auth/logout  → clear the cookie
 */

import { Router, type Request, type Response } from 'express'
import { SESSION_COOKIE, isAuthRequired, tokenIsValid } from '../auth.js'

const router = Router()

function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Set-Cookie for the session. HttpOnly so page JS (and any XSS) can't read the
 * token; SameSite=Strict so it isn't sent on cross-site requests (CSRF brake);
 * Secure in production; no Max-Age → a session cookie that mirrors the previous
 * sessionStorage lifetime (cleared when the browser closes).
 */
function setCookieValue(token: string): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict']
  if (isProd()) parts.push('Secure')
  return parts.join('; ')
}

function clearCookieValue(): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
  if (isProd()) parts.push('Secure')
  return parts.join('; ')
}

/** GET /api/auth/status — whether auth is required. Leaks no secret. */
router.get('/status', (_req: Request, res: Response): void => {
  res.json({ auth_required: isAuthRequired() })
})

/** POST /api/auth/login — body { token }. Sets the session cookie on success. */
router.post('/login', (req: Request, res: Response): void => {
  // Auth disabled → nothing to log into; report success so the client proceeds.
  if (!isAuthRequired()) {
    res.json({ ok: true, auth_required: false })
    return
  }
  const token = (req.body as Record<string, unknown> | undefined)?.token
  if (typeof token !== 'string' || !tokenIsValid(token)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  res.setHeader('Set-Cookie', setCookieValue(token))
  res.json({ ok: true, auth_required: true })
})

/** POST /api/auth/logout — clear the session cookie. */
router.post('/logout', (_req: Request, res: Response): void => {
  res.setHeader('Set-Cookie', clearCookieValue())
  res.json({ ok: true })
})

export default router
