/**
 * Auto-update API (auth-gated, mounted at /api/update).
 *
 * Desktop-only in effect: the updater runtime is seeded only by the desktop
 * launcher (`isUpdateSupported()`), so on a VPS build GET reports
 * `supported:false` and the mutating routes 403 — a server must never rewrite
 * its own files. Drives the same runtime the system tray uses.
 */

import { Router, type Request, type Response } from 'express'
import {
  getUpdateStatus, isUpdateSupported, runCheck, runInstall,
} from '../desktop/updateRuntime.js'

const router = Router()

/** GET /api/update/status — current version + update state (always available). */
router.get('/status', (_req: Request, res: Response): void => {
  res.json(getUpdateStatus())
})

/** POST /api/update/check — force a GitHub check (desktop only). */
router.post('/check', (_req: Request, res: Response): void => {
  if (!isUpdateSupported()) {
    res.status(403).json({ error: 'Automatic updates are only available in the desktop build.' })
    return
  }
  void runCheck().then((status) => res.json(status))
})

/**
 * POST /api/update/install — download + install the available update (desktop
 * only). Returns 202 immediately; the app then downloads, swaps files and
 * restarts. 409 if no update is currently staged/available.
 */
router.post('/install', (_req: Request, res: Response): void => {
  if (!isUpdateSupported()) {
    res.status(403).json({ error: 'Automatic updates are only available in the desktop build.' })
    return
  }
  const { state, updateAvailable, downloadable } = getUpdateStatus()
  if (!updateAvailable || (state !== 'available' && state !== 'staged')) {
    res.status(409).json({ error: 'No update is ready to install. Check for updates first.' })
    return
  }
  if (!downloadable) {
    res.status(409).json({ error: 'No downloadable build for this platform. Use the release page to update manually.' })
    return
  }
  void runInstall() // fire-and-forget: progresses via /status, then restarts
  res.status(202).json({ ok: true })
})

export default router
