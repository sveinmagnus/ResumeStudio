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

interface NamedToken {
  name: string
  token: Buffer
}

/**
 * Named tokens for small-team attribution (roadmap F10):
 * `RESUME_API_TOKENS="kari:s3cret1,ola:s3cret2"`. The name is stamped as
 * `saved_by` on saves/snapshots — attribution only, NOT a permissions model
 * (every valid token can do everything). Coexists with the single
 * RESUME_API_TOKEN, which authenticates anonymously (saved_by stays null).
 * Malformed pairs (no colon, empty name/token) are skipped.
 */
function configuredNamedTokens(): NamedToken[] {
  const raw = process.env.RESUME_API_TOKENS?.trim()
  if (!raw) return []
  const out: NamedToken[] = []
  for (const pair of raw.split(',')) {
    const i = pair.indexOf(':')
    if (i <= 0) continue
    const name = pair.slice(0, i).trim()
    const token = pair.slice(i + 1).trim()
    if (name && token) out.push({ name, token: Buffer.from(token, 'utf8') })
  }
  return out
}

/** Whether this deployment requires auth (any token is configured). */
export function isAuthRequired(): boolean {
  return configuredToken() !== null || configuredNamedTokens().length > 0
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
 * Validate a presented token against the configured single token AND every
 * named token (constant-time per comparison). When nothing is configured
 * (auth disabled — local dev / desktop), everything is accepted.
 */
export function tokenIsValid(provided: string | null | undefined): boolean {
  if (!isAuthRequired()) return true
  if (!provided) return false
  const single = configuredToken()
  // Deliberately evaluate every candidate (no early return) so response time
  // doesn't reveal which configured token half-matched.
  let ok = single ? safeCompare(provided, single) : false
  for (const nt of configuredNamedTokens()) {
    if (safeCompare(provided, nt.token)) ok = true
  }
  return ok
}

/**
 * The display name behind a presented token: the matching named token's name,
 * or null for the anonymous single token / disabled auth. Call only after
 * tokenIsValid — this is attribution, not authentication.
 */
export function identifyToken(provided: string | null | undefined): string | null {
  if (!provided) return null
  for (const nt of configuredNamedTokens()) {
    if (safeCompare(provided, nt.token)) return nt.name
  }
  return null
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
  const provided = presentedToken(req)
  if (tokenIsValid(provided)) {
    // Attribution for downstream routes (saved_by stamping). Null for the
    // anonymous single token.
    res.locals.userName = identifyToken(provided)
    next()
    return
  }
  res.status(401).json({ error: 'Unauthorized' })
}
