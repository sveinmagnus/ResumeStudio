/**
 * Periodic store-backup writer for the desktop build.
 *
 * Polls the DB on an interval; when the store's signature has moved since the
 * last write, it writes a fresh atomic backup to the sync folder. Signature-
 * gating means an idle app never rewrites the file (no pointless Drive churn),
 * while an actively-edited app keeps the synced copy current within one tick.
 *
 * Kept deliberately small and dependency-light so the launcher can own one
 * instance and call `flush()` on shutdown. Errors are logged, never thrown —
 * a failing backup must not take down the editor.
 */

import { backupSignature, buildStoreBackup, writeBackupAtomic } from './backup.js'
import type { ResumeDb } from './db.js'

export interface BackupSchedulerOptions {
  db: ResumeDb
  /** Sync folder to write the backup into (e.g. a Google Drive path). */
  dir: string
  /** Poll interval in ms. Default 60s. */
  intervalMs?: number
  /** Diagnostic sink — defaults to console.log. */
  log?: (msg: string) => void
}

export class BackupScheduler {
  private readonly db: ResumeDb
  private readonly dir: string
  private readonly intervalMs: number
  private readonly log: (msg: string) => void
  private timer: NodeJS.Timeout | null = null
  private lastSignature: string | null = null

  constructor(opts: BackupSchedulerOptions) {
    this.db = opts.db
    this.dir = opts.dir
    this.intervalMs = opts.intervalMs ?? 60_000
    this.log = opts.log ?? ((m) => console.log(m))
  }

  /** Begin polling. Seeds `lastSignature` from the existing file's content if
   * the very first tick should be skipped — but simplest correct behaviour is
   * to let the first tick write a fresh backup, guaranteeing the synced file
   * matches the live DB at startup. */
  start(): void {
    if (this.timer) return
    // Run once promptly so a freshly-launched app publishes its current state,
    // then settle into the interval.
    this.tick()
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    // Don't keep the process alive solely for the backup timer.
    this.timer.unref?.()
  }

  /** Write now if (and only if) the store changed since the last write. */
  private tick(): void {
    try {
      const entries = this.db.dumpResumes()
      const sig = backupSignature(entries)
      if (sig === this.lastSignature) return
      const { file, bytes } = writeBackupAtomic(this.dir, buildStoreBackup(entries))
      this.lastSignature = sig
      this.log(`[backup] wrote ${entries.length} resume(s), ${bytes} bytes → ${file}`)
    } catch (err) {
      this.log(`[backup] write failed: ${(err as Error).message}`)
    }
  }

  /** Force a final write regardless of signature (used on graceful shutdown). */
  flush(): void {
    try {
      const entries = this.db.dumpResumes()
      const { file } = writeBackupAtomic(this.dir, buildStoreBackup(entries))
      this.lastSignature = backupSignature(entries)
      this.log(`[backup] final flush → ${file}`)
    } catch (err) {
      this.log(`[backup] final flush failed: ${(err as Error).message}`)
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
