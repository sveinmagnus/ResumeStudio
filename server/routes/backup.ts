/**
 * Store backup / sync API (auth-gated, mounted at /api/backup).
 *
 * Lets the UI observe and drive the whole-store JSON backup that the desktop
 * build keeps in a cloud-synced folder. The folder is configured server-side
 * (RESUME_BACKUP_DIR) — a browser can't pick an arbitrary filesystem path, and
 * we want the secret-ish path to live with the server, not the client.
 *
 *   GET  /api/backup/status   → where/whether sync is configured + freshness
 *   POST /api/backup/now      → write a backup immediately
 *   POST /api/backup/restore  → merge the synced backup into this DB
 *
 * Reads RESUME_BACKUP_DIR lazily per request (env is fixed after boot, but this
 * keeps the module side-effect free and test-friendly, like the rest of server/).
 */

import { Router, type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'
import { dumpResumes, restoreResumes } from '../db.js'
import {
  BACKUP_FILENAME, backupSignature, buildStoreBackup, readBackupFile,
  writeBackupAtomic, UnreadableBackupError,
} from '../backup.js'

const router = Router()

function backupDir(): string | null {
  const dir = process.env.RESUME_BACKUP_DIR?.trim()
  return dir ? dir : null
}

/** GET /api/backup/status — sync configuration + whether the file is current. */
router.get('/status', (_req: Request, res: Response): void => {
  const dir = backupDir()
  if (!dir) {
    res.json({ configured: false })
    return
  }
  const file = path.join(dir, BACKUP_FILENAME)
  const exists = fs.existsSync(file)
  const localEntries = dumpResumes()
  const localSig = backupSignature(localEntries)

  let lastBackupAt: string | null = null
  let backupResumeCount: number | null = null
  let upToDate = false
  if (exists) {
    try {
      lastBackupAt = fs.statSync(file).mtime.toISOString()
      const fileEntries = readBackupFile(dir) ?? []
      backupResumeCount = fileEntries.length
      upToDate = backupSignature(fileEntries) === localSig
    } catch {
      // A present-but-unreadable file → report it as not-up-to-date so the user
      // is nudged to re-write it, rather than silently trusting it.
      upToDate = false
    }
  }

  res.json({
    configured: true,
    dir,
    file,
    exists,
    lastBackupAt,
    upToDate,
    resumeCount: localEntries.length,
    backupResumeCount,
  })
})

/** POST /api/backup/now — write the current store to the sync folder. */
router.post('/now', (_req: Request, res: Response): void => {
  const dir = backupDir()
  if (!dir) {
    res.status(400).json({ error: 'No backup folder configured (set RESUME_BACKUP_DIR).' })
    return
  }
  try {
    const entries = dumpResumes()
    const { file, bytes } = writeBackupAtomic(dir, buildStoreBackup(entries))
    res.json({ ok: true, file, bytes, resumeCount: entries.length, saved_at: new Date().toISOString() })
  } catch (err) {
    res.status(500).json({ error: `Backup failed: ${(err as Error).message}` })
  }
})

/**
 * POST /api/backup/restore — merge the synced backup into this DB.
 * Body: { mode?: 'merge' | 'replace' }. Default 'merge' (newest-wins, no
 * deletes). 'replace' additionally removes local resumes absent from the file.
 */
router.post('/restore', (req: Request, res: Response): void => {
  const dir = backupDir()
  if (!dir) {
    res.status(400).json({ error: 'No backup folder configured (set RESUME_BACKUP_DIR).' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const mode = body.mode === 'replace' ? 'replace' : 'merge'
  try {
    const entries = readBackupFile(dir)
    if (!entries) {
      res.status(404).json({ error: 'No backup file found in the sync folder yet.' })
      return
    }
    const summary = restoreResumes(entries, { mode })
    res.json({ ok: true, mode, ...summary })
  } catch (err) {
    if (err instanceof UnreadableBackupError) {
      res.status(422).json({ error: err.message })
      return
    }
    res.status(500).json({ error: `Restore failed: ${(err as Error).message}` })
  }
})

export default router
