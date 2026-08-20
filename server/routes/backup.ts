/**
 * Backup / sync API (auth-gated, mounted at /api/backup).
 *
 * Two halves that share one file format (`server/backupFiles.ts` — one file per
 * resume, plus `resume-studio-registry.json`):
 *
 *   FOLDER SYNC (desktop) — the folder is configured server-side
 *   (RESUME_BACKUP_DIR) because a browser can't pick an arbitrary filesystem
 *   path, and the path is better kept with the server than the client.
 *     GET  /api/backup/status   → where/whether sync is configured + freshness
 *     POST /api/backup/now      → publish every resume to the folder now
 *     POST /api/backup/restore  → merge the folder into this DB
 *
 *   MANUAL BACKUP (every build) — the same files in one zip.
 *     GET  /api/backup/export   → download the zip
 *     POST /api/backup/import   → upload a zip (or a single/legacy JSON file)
 *
 * `/import` is also what the picker's drop-zone uses for our OWN content, and
 * that is the point: it merges BY RESUME ID via `restoreResumes`, so re-importing
 * a backup updates the resumes it names instead of minting new ones. The old
 * path ran every import through `createResume`, which gave a second machine a
 * fresh id for every resume and then synced the duplicates back to the first.
 *
 * Reads RESUME_BACKUP_DIR lazily per request (env is fixed after boot, but this
 * keeps the module side-effect free and test-friendly, like the rest of server/).
 *
 * AUTHORIZATION. `/export` and `/restore` are owner-only: one hands back every
 * CV on the instance as a file, the other rewrites the instance from one. The
 * remaining three are scoped by viewer instead of blocked, so a member's
 * `/status` counts their own resumes, their `/now` publishes their own, and
 * their `/import` merges into rows they own — with the tombstone pass scoped
 * too, since a tombstone arrives in an uploaded file.
 */

import { Router, type Request, type Response } from 'express'
import express from 'express'
import { dumpResumes, restoreResumes, listRegistry, mergeRegistry, deleteResume } from '../db.js'
import { requireOwner, viewerOf } from '../auth.js'
import type { Viewer } from '../accounts.js'
import { backupSignature, UnreadableBackupError } from '../backup.js'
import {
  configuredBackupDir, folderLastWrite, reconcileSources, scanBackupDir,
  writeResumeFiles, type ScannedFolder,
} from '../backupFiles.js'
import { buildBackupZip, readBackupZip, zipFileName } from '../backupZip.js'
import { isBackupRuntimeActive } from '../backupRuntime.js'

const router = Router()

/** GET /api/backup/status — sync configuration + whether the folder is current. */
router.get('/status', (_req: Request, res: Response): void => {
  const dir = configuredBackupDir()
  if (!dir) {
    res.json({ configured: false })
    return
  }
  const localEntries = dumpResumes(viewerOf(res))
  const localSig = backupSignature(localEntries)
  const scan = scanBackupDir(dir)
  const exists = scan.resumes.length > 0 || scan.filesByResumeId.size > 0

  res.json({
    configured: true,
    dir,
    exists,
    /**
     * Whether anything is polling to push edits out and watching to pull other
     * machines' in. Only the desktop launcher starts those; a hosted instance
     * has the manual write and restore and nothing else, so a client that
     * assumed a background service would show a sync panel promising one.
     */
    continuous: isBackupRuntimeActive(),
    lastBackupAt: folderLastWrite(dir),
    // Every resume this machine holds is present in the folder at the same
    // saved_at. A folder holding EXTRA resumes (another machine published one we
    // haven't merged) is still "up to date" for our outbound half — the watcher
    // owns pulling those in.
    upToDate: exists && backupSignature(scan.resumes.filter((e) =>
      localEntries.some((l) => l.id === e.id))) === localSig,
    resumeCount: localEntries.length,
    backupResumeCount: exists ? scan.resumes.length : null,
    fileCount: scan.filesByResumeId.size,
    /** A pre-split folder still holding the old combined file. Cleared on the next write. */
    legacyFile: scan.legacyFile,
    unreadable: scan.unreadable,
  })
})

/** POST /api/backup/now — publish every resume to the sync folder. */
router.post('/now', (_req: Request, res: Response): void => {
  const dir = configuredBackupDir()
  if (!dir) {
    res.status(400).json({ error: 'No backup folder configured (set RESUME_BACKUP_DIR).' })
    return
  }
  try {
    const entries = dumpResumes(viewerOf(res))
    const { written, bytes, removed } = writeResumeFiles(dir, entries, listRegistry())
    // fileCount is one more than the resume count: resume-studio-registry.json.
    res.json({
      ok: true, bytes, removed: removed.length,
      resumeCount: written, fileCount: written + 1,
      saved_at: new Date().toISOString(),
    })
  } catch (err) {
    // Don't echo the raw message — it can carry a filesystem path.
    console.error('[backup] write failed:', err)
    res.status(500).json({ error: 'Backup failed' })
  }
})

/**
 * Merge a reconciled set of files into this DB. Shared by /restore (folder) and
 * /import (upload) so both inbound paths behave identically — identity by
 * resume id, newest `saved_at` wins, the shared registry unions by key.
 *
 * `replace` additionally deletes local resumes the source doesn't mention. It is
 * only ever reachable from the explicit "make this machine match" action, never
 * from a background sync.
 */
function mergeScanned(viewer: Viewer, scan: ScannedFolder, mode: 'merge' | 'replace') {
  const summary = restoreResumes(viewer, scan.resumes, { mode })
  const registry = mergeRegistry(scan.registry)
  // Honour erasures: a tombstone deletes a local resume only when the deletion
  // is at or after that resume's last save (a later edit is a revival). Scoped
  // like every other write: a tombstone file is user-supplied, so an unscoped
  // delete here would make an upload a way to erase anyone's CV.
  const local = new Map(dumpResumes(viewer).map((e) => [e.id, e.saved_at]))
  let erased = 0
  for (const t of scan.tombstones) {
    const savedAt = local.get(t.id)
    if (savedAt !== undefined && savedAt <= t.deleted_at && deleteResume(viewer, t.id)) erased++
  }
  return { ...summary, deleted: summary.deleted + erased, registry }
}

/**
 * POST /api/backup/restore — merge the sync folder into this DB.
 * Body: { mode?: 'merge' | 'replace' }. Default 'merge' (newest-wins, no
 * deletes). 'replace' additionally removes local resumes absent from the folder.
 *
 * Owner-only: it rewrites resumes across the whole instance from a folder no
 * individual member controls.
 */
router.post('/restore', (req: Request, res: Response): void => {
  if (!requireOwner(res)) return
  const dir = configuredBackupDir()
  if (!dir) {
    res.status(400).json({ error: 'No backup folder configured (set RESUME_BACKUP_DIR).' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const mode = body.mode === 'replace' ? 'replace' : 'merge'
  try {
    const scan = scanBackupDir(dir)
    if (!scan.resumes.length) {
      // Distinguish "nothing here yet" from "something's here but broken" —
      // silently reporting an empty folder when a file failed to parse is how a
      // user concludes their backup is fine when it isn't.
      if (scan.unreadable.length) {
        res.status(422).json({
          error: `Could not read ${scan.unreadable.length} file(s) in the sync folder: ` +
            `${scan.unreadable.join(', ')}. They may be mid-sync, or not Resume Studio backups.`,
        })
        return
      }
      res.status(404).json({ error: 'No resume files found in the sync folder yet.' })
      return
    }
    res.json({ ok: true, mode, ...mergeScanned(viewerOf(res), scan, mode) })
  } catch (err) {
    if (err instanceof UnreadableBackupError) {
      // A controlled, path-free message describing why the backup won't parse.
      res.status(422).json({ error: err.message })
      return
    }
    console.error('[backup] restore failed:', err)
    res.status(500).json({ error: 'Restore failed' })
  }
})

/**
 * GET /api/backup/export — download every resume as one zip, in exactly the
 * layout the sync folder uses. Available on every build (it needs no configured
 * folder), because it is the portable "take my data with me" artifact.
 *
 * An owner gets the whole instance — this is the supported off-box backup
 * route. A member gets the resumes they OWN, and not the ones merely shared
 * with them: they can already read a colleague's shared CV in the app, but
 * taking a copy off the machine is a different act, and "export" here means
 * "take my own data with me". `dumpResumes` scopes to everything the viewer may
 * READ, so the narrowing happens here, at the one call site that needs it.
 */
router.get('/export', (_req: Request, res: Response): void => {
  const viewer = viewerOf(res)
  try {
    const all = dumpResumes(viewer)
    const mine = viewer.role === 'owner'
      ? all
      : all.filter((entry) => entry.owner_id === viewer.userId)
    const zip = buildBackupZip(mine, listRegistry())
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName()}"`)
    res.setHeader('Content-Length', String(zip.length))
    res.end(Buffer.from(zip))
  } catch (err) {
    console.error('[backup] export failed:', err)
    res.status(500).json({ error: 'Export failed' })
  }
})

/** Zip uploads are binary and can carry embedded images for several resumes. */
const rawZip = express.raw({
  type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
  limit: '64mb',
})

/**
 * POST /api/backup/import — merge an uploaded backup into this DB.
 *
 * Accepts either a zip (`application/zip`, as produced by /export) or a single
 * JSON file (`application/json`): a per-resume sync file, `resume-studio-registry.json`, or a
 * legacy combined store backup. Everything routes through the same reconcile +
 * merge, so identity is preserved regardless of which one the user grabbed.
 *
 * Always 'merge' — an upload never deletes local resumes. Erasure is explicit
 * (delete the resume, or import a folder whose tombstones say so).
 */
router.post('/import', rawZip, (req: Request, res: Response): void => {
  try {
    let scan: ScannedFolder
    if (Buffer.isBuffer(req.body)) {
      if (!req.body.length) {
        res.status(400).json({ error: 'Empty upload.' })
        return
      }
      try {
        scan = readBackupZip(new Uint8Array(req.body))
      } catch {
        res.status(422).json({ error: 'That file is not a readable zip archive.' })
        return
      }
    } else if (req.body && typeof req.body === 'object') {
      scan = reconcileSources([{ name: 'upload.json', json: req.body }])
    } else {
      res.status(400).json({ error: 'Expected a zip archive or a JSON backup file.' })
      return
    }

    if (!scan.resumes.length && !scan.registry.length) {
      res.status(422).json({
        error: 'No Resume Studio backup files found in that upload.',
      })
      return
    }
    res.json({ ok: true, mode: 'merge', ...mergeScanned(viewerOf(res), scan, 'merge'), unreadable: scan.unreadable })
  } catch (err) {
    if (err instanceof UnreadableBackupError) {
      res.status(422).json({ error: err.message })
      return
    }
    console.error('[backup] import failed:', err)
    res.status(500).json({ error: 'Import failed' })
  }
})

export default router
