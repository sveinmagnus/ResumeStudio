import type { Request, Response, NextFunction } from 'express'

const TOKEN = process.env.RESUME_API_TOKEN?.trim() || null

/**
 * Token-based auth middleware.
 * - If RESUME_API_TOKEN is not set (local dev): passes through with no check.
 * - If set: requires `Authorization: Bearer <token>` header.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!TOKEN) {
    next()
    return
  }

  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header required' })
    return
  }

  const provided = header.slice(7).trim()
  if (provided !== TOKEN) {
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  next()
}
