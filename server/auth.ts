import type { Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'crypto'

/**
 * Name of the HttpOnly session cookie that carries the API token in browsers.
 * The browser client never reads or writes this (it can't — it's HttpOnly);
 * it's set by POST /api/auth/login and cleared by /logout (see routes/auth.ts).
 */
export const SESSION_COOKIE = 'rs_token'

// Read lazily (per request) rather than at import time so tests can vary the
// token with vi.stubEnv. Env doesn't change after boot, so runtime behaviour
// is unchanged.
function configuredToken(): Buffer | null {
  const tok = process.env.RESUME_API_TOKEN?.trim()
  return tok ? Buffer.from(tok, 'utf8') : null
}

/** Whether this deployment requires auth (a token is configured). */
export function isAuthRequired(): boolean {
  return configuredToken() !== null
}

/**
 * Constant-time string comparison. Returns false fast when the lengths differ
 * (length itself isn't a meaningful secret for a fixed-size random token), then
 * compares same-length buffers via crypto.timingSafeEqual. Uses bytes rather
 * than chars because timingSafeEqual requires equal-length buffers.
 */
function safeCompare(a: string, b: Buffer): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  if (aBuf.length !== b.length) return false
  return timingSafeEqual(aBuf, b)
}

/**
 * Validate a presented token against the configured one (constant-time). When
 * no token is configured (auth disabled — local dev / desktop), everything is
 * accepted.
 */
export function tokenIsValid(provided: string | null | undefined): boolean {
  const tok = configuredToken()
  if (!tok) return true
  if (!provided) return false
  return safeCompare(provided, tok)
}

/** Minimal cookie-header parser — avoids pulling in a cookie-parser dependency. */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    if (!k) continue
    out[k] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

/**
 * The token presented on a request: the `Authorization: Bearer` header (kept
 * for non-browser clients / tests) OR the HttpOnly session cookie (browsers).
 */
export function presentedToken(req: Request): string | null {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim()
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  return cookie ? cookie : null
}

/**
 * Auth middleware.
 * - If RESUME_API_TOKEN is not set (local dev / desktop): passes through.
 * - If set: requires a valid `Authorization: Bearer <token>` header OR a valid
 *   session cookie.
 *
 * All failure paths return the same generic 401 — splitting "missing" vs
 * "wrong" used to leak information about what the parser saw.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthRequired()) {
    next()
    return
  }
  if (tokenIsValid(presentedToken(req))) {
    next()
    return
  }
  res.status(401).json({ error: 'Unauthorized' })
}
