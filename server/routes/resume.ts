import { Router, type Request, type Response } from 'express'
import { getResume, saveResume, getLastSavedAt } from '../db.js'

const router = Router()

/** GET /api/resume — return stored resume data, 404 if empty. */
router.get('/', (_req: Request, res: Response): void => {
  const data = getResume()
  if (!data) {
    res.status(404).json({ error: 'No resume stored yet' })
    return
  }
  res.json({ data, saved_at: getLastSavedAt() })
})

/** PUT /api/resume — replace stored resume data. */
router.put('/', (req: Request, res: Response): void => {
  const body = req.body as unknown
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' })
    return
  }
  const saved_at = saveResume(body)
  res.json({ ok: true, saved_at })
})

export default router
