/**
 * Process-wide holder for the active BackupScheduler.
 *
 * The launcher starts the periodic backup writer at boot, but the in-app
 * Settings screen can change the backup folder/interval at runtime — and the
 * route handler (which lives outside the launcher) needs a way to restart the
 * scheduler with the new config. This tiny module is that handoff point: the
 * launcher seeds it, the settings route calls `reconfigureBackup`, and shutdown
 * flushes/stops through it.
 *
 * Desktop-only in practice (the VPS build never seeds it), so on a server these
 * functions are inert unless something deliberately calls reconfigure.
 */

import { BackupScheduler } from './backupScheduler.js'
import { BackupWatcher } from './backupWatcher.js'
import { getDefaultDb } from './db.js'

let active: BackupScheduler | null = null
let watcher: BackupWatcher | null = null
let logFn: (msg: string) => void = (m) => console.log(m)

/**
 * Whether a background service is actually maintaining the sync folder.
 *
 * True only once `reconfigureBackup` has started the scheduler or the watcher,
 * which happens on the desktop build — `server/index.ts` never calls
 * `initBackupRuntime`. A hosted instance therefore has the manual write and
 * restore routes and nothing else, and a client that assumed otherwise would
 * show a sync panel promising a service that is not running.
 */
export function isBackupRuntimeActive(): boolean {
  return active !== null || watcher !== null
}

/** Set the logger the scheduler should use (the launcher's file+console tee). */
export function initBackupRuntime(log: (msg: string) => void): void {
  logFn = log
}

/**
 * Restart the periodic backup writer AND the inbound file watcher for a new
 * folder/interval. Passing a null or empty dir tears both down (sync turned
 * off). Idempotent and safe to call repeatedly; reuses the singleton DB handle.
 *
 * The scheduler writes our edits OUT to the sync folder; the watcher pulls other
 * machines' edits IN whenever a sync service updates the file (so a
 * long-running background server doesn't only merge at launch). Both are gated
 * so they never chase each other's writes — see BackupWatcher's feedback guard.
 */
export function reconfigureBackup(dir: string | null, intervalMs: number): void {
  if (active) {
    active.stop()
    active = null
  }
  if (watcher) {
    watcher.stop()
    watcher = null
  }
  const target = dir?.trim()
  if (target) {
    const db = getDefaultDb()
    active = new BackupScheduler({ db, dir: target, intervalMs, log: logFn })
    active.start()
    watcher = new BackupWatcher({ db, dir: target, intervalMs, log: logFn })
    watcher.start()
  }
}

/** Force a final backup write (shutdown). No-op when sync is off. */
export function flushBackup(): void {
  active?.flush()
}

/** Stop the scheduler + watcher without flushing. */
export function stopBackup(): void {
  active?.stop()
  active = null
  watcher?.stop()
  watcher = null
}
