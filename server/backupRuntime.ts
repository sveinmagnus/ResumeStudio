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
import { getDefaultDb } from './db.js'

let active: BackupScheduler | null = null
let logFn: (msg: string) => void = (m) => console.log(m)

/** Set the logger the scheduler should use (the launcher's file+console tee). */
export function initBackupRuntime(log: (msg: string) => void): void {
  logFn = log
}

/**
 * Restart the periodic backup writer for a new folder/interval. Passing a null
 * or empty dir tears the scheduler down (sync turned off). Idempotent and safe
 * to call repeatedly; reuses the singleton DB handle.
 */
export function reconfigureBackup(dir: string | null, intervalMs: number): void {
  if (active) {
    active.stop()
    active = null
  }
  const target = dir?.trim()
  if (target) {
    active = new BackupScheduler({ db: getDefaultDb(), dir: target, intervalMs, log: logFn })
    active.start()
  }
}

/** Force a final backup write (shutdown). No-op when sync is off. */
export function flushBackup(): void {
  active?.flush()
}

/** Stop the scheduler without flushing. */
export function stopBackup(): void {
  active?.stop()
  active = null
}
