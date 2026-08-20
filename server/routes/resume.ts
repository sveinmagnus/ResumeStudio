import { Router, type Request, type Response } from 'express'
import {
  listResumes, createResume, getResume, saveResume,
  deleteResume, renameResume, listSnapshots, getSnapshot,
  storageStats, setVisibility,
} from '../db.js'
import { viewerOf } from '../auth.js'
import { configuredBackupDir, recordDeletion } from '../backupFiles.js'

/**
 * Every handler passes `viewerOf(res)` into the db layer rather than deciding
 * anything itself — the rules live in `server/access.ts`, and a route that
 * reimplemented one would be a second copy to keep in step.
 *
 * The consequence worth knowing when reading the 404s below: a resume that
 * exists but is not this viewer's to see is reported exactly as one that does
 * not exist. Anything else would let a member enumerate ids.
 */
const router = Router()

// Local param shapes — `req.params` would otherwise widen to string | string[].
type IdParams = { id: string }
type IdSidParams = { id: string; sid: string }

// ─── Resume collection ────────────────────────────────────────────────────────

/** GET /api/resumes — list every resume's metadata, newest saved_at first. */
router.get('/', (_req: Request, res: Response): void => {
  res.json({ resumes: listResumes(viewerOf(res)) })
})

/**
 * POST /api/resumes — create a new resume. Body: { name, data?, primary_locale?, secondary_locale? }.
 * Returns the new ResumeMeta.
 */
router.post('/', (req: Request, res: Response): void => {
  const body = req.body as Record<string, unknown> | undefined
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' })
    return
  }
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    res.status(400).json({ error: 'name must be a non-empty string' })
    return
  }
  const meta = createResume(viewerOf(res), {
    name: body.name.trim(),
    data: body.data,
    primary_locale: typeof body.primary_locale === 'string' ? body.primary_locale : undefined,
    secondary_locale:
      body.secondary_locale === null || typeof body.secondary_locale === 'string'
        ? (body.secondary_locale as string | null)
        : undefined,
  })
  res.status(201).json({ resume: meta })
})

/**
 * GET /api/resumes/storage — per-resume payload weights + DB size (roadmap A4
 * "measure first"). Registered BEFORE `/:id` so 'storage' isn't matched as an id.
 */
router.get('/storage', (_req: Request, res: Response): void => {
  res.json(storageStats(viewerOf(res)))
})

// ─── Single-resume snapshot history ───────────────────────────────────────────
// These come BEFORE `/:id` so Express doesn't match `snapshots` as an id.

/** GET /api/resumes/:id/snapshots — list restore points (metadata only). */
router.get('/:id/snapshots', (req: Request<IdParams>, res: Response): void => {
  // listSnapshots returns [] for an unknown id; tell the caller so they can
  // distinguish "empty history" from "no such resume".
  const viewer = viewerOf(res)
  if (!getResume(viewer, req.params.id)) {
    res.status(404).json({ error: 'Resume not found' })
    return
  }
  res.json({ snapshots: listSnapshots(viewer, req.params.id) })
})

/** GET /api/resumes/:id/snapshots/:sid — return one snapshot's full data. */
router.get('/:id/snapshots/:sid', (req: Request<IdSidParams>, res: Response): void => {
  const sid = Number(req.params.sid)
  if (!Number.isInteger(sid) || sid < 1) {
    res.status(400).json({ error: 'Invalid snapshot id' })
    return
  }
  const data = getSnapshot(viewerOf(res), req.params.id, sid)
  if (!data) {
    res.status(404).json({ error: 'Snapshot not found' })
    return
  }
  res.json({ data })
})

// ─── Single resume ────────────────────────────────────────────────────────────

/** GET /api/resumes/:id — return one resume's full data + metadata. */
router.get('/:id', (req: Request<IdParams>, res: Response): void => {
  const full = getResume(viewerOf(res), req.params.id)
  if (!full) {
    res.status(404).json({ error: 'Resume not found' })
    return
  }
  // ETag mirrors meta.version — the optimistic-concurrency token the client
  // echoes back as base_version on the next save.
  res.setHeader('ETag', `"${full.meta.version}"`)
  res.json({ data: full.data, meta: full.meta })
})

/**
 * PUT /api/resumes/:id — replace data (and optionally locales).
 * Body: { data, primary_locale?, secondary_locale?, base_version? }.
 *
 * When `base_version` is supplied it is an optimistic-concurrency check: if the
 * stored version has moved on (another tab/device saved in between) the write
 * is refused with 409 and the live server state, so the client can diff and
 * resolve. Omit it to force-write (e.g. after the user picks "keep mine").
 */
router.put('/:id', (req: Request<IdParams>, res: Response): void => {
  const body = req.body as Record<string, unknown> | undefined
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' })
    return
  }
  // For backwards continuity with the old shape we accept either {data: ...}
  // OR the resume payload itself as the body. The client sends {data, ...}.
  const data = 'data' in body ? body.data : body
  if (!data || typeof data !== 'object') {
    res.status(400).json({ error: 'data must be a JSON object' })
    return
  }

  // Locales are optional; if either is supplied, both must be (so we never
  // half-update the pair).
  const hasPrimary = typeof body.primary_locale === 'string'
  const hasSecondary =
    body.secondary_locale === null || typeof body.secondary_locale === 'string'
  let locales: { primary_locale: string; secondary_locale: string | null } | undefined
  if (hasPrimary || hasSecondary) {
    if (!hasPrimary || !hasSecondary) {
      res.status(400).json({
        error: 'primary_locale and secondary_locale must be supplied together',
      })
      return
    }
    locales = {
      primary_locale: body.primary_locale as string,
      secondary_locale: body.secondary_locale as string | null,
    }
  }

  // Optional concurrency token. Must be a non-negative integer if present.
  let expectedVersion: number | undefined
  if ('base_version' in body && body.base_version !== undefined) {
    const v = body.base_version
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      res.status(400).json({ error: 'base_version must be a non-negative integer' })
      return
    }
    expectedVersion = v
  }

  // Attribution: a signed-in user's display name, a named service token's
  // label, or null for the anonymous token / when auth is disabled.
  const viewer = viewerOf(res)
  const result = saveResume(viewer, req.params.id, data, locales, expectedVersion, viewer.name)
  if (result.status === 'not-found') {
    res.status(404).json({ error: 'Resume not found' })
    return
  }
  if (result.status === 'conflict') {
    res.status(409).json({
      error: 'Resume changed elsewhere',
      current: { data: result.current.data, meta: result.current.meta },
    })
    return
  }
  res.setHeader('ETag', `"${result.version}"`)
  res.json({ ok: true, saved_at: result.saved_at, version: result.version })
})

/**
 * PATCH /api/resumes/:id — rename only. Avoids re-sending the full CV blob
 * just to update a name. Body: { name }.
 */
router.patch('/:id', (req: Request<IdParams>, res: Response): void => {
  const body = req.body as Record<string, unknown> | undefined
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' })
    return
  }
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    res.status(400).json({ error: 'name must be a non-empty string' })
    return
  }
  const ok = renameResume(viewerOf(res), req.params.id, body.name.trim())
  if (!ok) {
    res.status(404).json({ error: 'Resume not found' })
    return
  }
  res.json({ ok: true })
})

/**
 * POST /api/resumes/:id/visibility — { visibility: 'private' | 'instance' }.
 *
 * Its own route rather than a field on PATCH because it is a different kind of
 * decision: PATCH edits a resume, this changes who else in the firm can read
 * it. `canReshare` (in db.setVisibility) follows the WRITE rule — the person
 * who owns it decides, and an owner can always intervene — so a member cannot
 * share a colleague's CV on their behalf.
 *
 * Sharing grants READ only. A shared resume stays uneditable by everyone but
 * its owner, which is what makes the toggle safe to switch on.
 */
router.post('/:id/visibility', (req: Request<IdParams>, res: Response): void => {
  const raw = (req.body as Record<string, unknown> | undefined)?.visibility
  if (raw !== 'private' && raw !== 'instance') {
    res.status(400).json({ error: "visibility must be 'private' or 'instance'" })
    return
  }
  // Not-found rather than forbidden for a resume this viewer cannot reshare —
  // the same rule as every other single-row route, so the response set does not
  // tell a member which resume ids exist.
  if (!setVisibility(viewerOf(res), req.params.id, raw)) {
    res.status(404).json({ error: 'Resume not found' })
    return
  }
  res.json({ ok: true, visibility: raw })
})

/**
 * DELETE /api/resumes/:id — hard delete (snapshots cascade).
 *
 * A resume is one identified person's data, so deleting it has to mean deleting
 * it — including from the sync folder, and on the other machines syncing that
 * folder. `recordDeletion` removes this resume's file(s) and leaves a tombstone
 * (id + timestamp only, no personal data) for the other machines' watchers.
 * Without it the next machine to sync would simply publish the resume back and
 * the erasure would silently undo itself.
 *
 * Best-effort by design: the DB row is already gone, so an unwritable sync
 * folder (offline network share) must not turn a completed delete into an error.
 */
router.delete('/:id', (req: Request<IdParams>, res: Response): void => {
  const ok = deleteResume(viewerOf(res), req.params.id)
  if (!ok) {
    res.status(404).json({ error: 'Resume not found' })
    return
  }
  const dir = configuredBackupDir()
  if (dir) recordDeletion(dir, req.params.id)
  res.json({ ok: true })
})

export default router
