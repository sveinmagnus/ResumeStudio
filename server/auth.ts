import type { Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'crypto'

// Read lazily (per request) rather than at import time so tests can vary the
// token with vi.stubEnv. Env doesn't change after boot, so runtime behaviour
// is unchanged.
function configuredToken(): Buffer | null {
  const tok = process.env.RESUME_API_TOKEN?.trim()
  return tok ? Buffer.from(tok, 'utf8') : null
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
 * Token-based auth middleware.
 * - If RESUME_API_TOKEN is not set (local dev): passes through with no check.
 * - If set: requires `Authorization: Bearer <token>` header.
 *
 * All failure paths return the same generic 401 — splitting "missing header"
 * vs "wrong token" used to leak information about what the parser saw.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tokenBytes = configuredToken()
  if (!tokenBytes) {
    next()
    return
  }

  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const provided = header.slice(7).trim()
  if (!safeCompare(provided, tokenBytes)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  next()
}
