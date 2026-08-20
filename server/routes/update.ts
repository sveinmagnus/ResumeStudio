/**
 * Auto-update API (auth-gated, mounted at /api/update).
 *
 * INSTALLING is desktop-only: the updater runtime is seeded only by the desktop
 * launcher (`isUpdateSupported()`), and a server must never rewrite its own
 * files. Drives the same runtime the system tray uses.
 *
 * ASKING is not. A hosted owner could otherwise never find out a release exists
 * — the one thing they need in order to update deliberately, by pulling and
 * restarting. `POST /check-only` performs the version comparison and reports
 * it, without staging or touching anything.
 *
 * On demand rather than on a timer, on purpose: PRIVACY.md's line is that
 * nothing leaves the machine unless you configure it, and a background poll
 * would make a hosted instance contact GitHub by default. A button the owner
 * presses keeps that true and still answers the question.
 */

import { Router, type Request, type Response } from 'express'
import {
  getUpdateStatus, isUpdateSupported, runCheck, runInstall,
} from '../desktop/updateRuntime.js'
import { checkForUpdate } from '../desktop/updater.js'
import { APP_VERSION } from '../version.js'
import { requireOwner } from '../auth.js'

const router = Router()

/**
 * POST /api/update/check-only — is there a newer release? Owner only.
 *
 * Available on every build. On the desktop it duplicates what `/check` already
 * reports; on a server it is the only way to ask. It never stages, downloads or
 * installs — the answer is a version string and a boolean.
 */
router.post('/check-only', (_req: Request, res: Response): void => {
  if (!requireOwner(res)) return
  void (async () => {
    try {
      const info = await checkForUpdate(APP_VERSION)
      res.json({
        ok: true,
        current: APP_VERSION,
        latest: info.latestVersion,
        update_available: info.updateAvailable,
        notes: info.notes,
        // Says plainly that finding out and acting are different things here.
        installable: isUpdateSupported(),
      })
    } catch {
      // Never echo the upstream error: it can carry a URL or a rate-limit body.
      res.status(502).json({ ok: false, error: 'Could not reach the release feed.' })
    }
  })()
})

/** GET /api/update/status — current version + update state (always available). */
router.get('/status', (_req: Request, res: Response): void => {
  res.json(getUpdateStatus())
})

/** POST /api/update/check — force a GitHub check (desktop only). */
router.post('/check', (_req: Request, res: Response): void => {
  if (!requireOwner(res)) return
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
  if (!requireOwner(res)) return
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
  // Fire-and-forget: progress is reported via /status, then the app restarts.
  void runInstall()
  res.status(202).json({ ok: true })
})

export default router
