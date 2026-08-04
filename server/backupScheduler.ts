/**
 * Periodic sync-folder writer for the desktop build.
 *
 * Polls the DB on an interval; when the store's signature has moved since the
 * last write, it publishes one file per resume plus `registry.json` (see
 * `backupFiles.ts` for the layout and why it is split per person). Signature-
 * gating means an idle app never rewrites anything (no pointless Drive churn),
 * while an actively-edited app keeps the synced copy current within one tick.
 *
 * Kept deliberately small and dependency-light so the launcher can own one
 * instance and call `flush()` on shutdown. Errors are logged, never thrown —
 * a failing backup must not take down the editor.
 */

import { backupSignature } from './backup.js'
import { writeResumeFiles } from './backupFiles.js'
import type { ResumeDb } from './db.js'
import type { RegistryEntry } from './registryDb.js'

export interface BackupSchedulerOptions {
  db: ResumeDb
  /** Sync folder to write into (e.g. a Google Drive path). */
  dir: string
  /** Poll interval in ms. Default 60s. */
  intervalMs?: number
  /** Diagnostic sink — defaults to console.log. */
  log?: (msg: string) => void
}

/**
 * The write gate: resumes AND the registry, since `registry.json` is now its own
 * file and a canonical rename can land without any resume's `saved_at` moving
 * (it used to ride along with the one file the resume signature already gated).
 */
export function storeSignature(
  entries: Parameters<typeof backupSignature>[0],
  registry: RegistryEntry[],
): string {
  const reg = registry
    .map((e) => `${e.id}:${e.updated_at}`)
    .sort()
    .join('|')
  return `${backupSignature(entries)}#${reg}`
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

  /** Begin polling. The first tick runs immediately so a freshly-launched app
   * publishes its current state, then it settles into the interval. */
  start(): void {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    // Don't keep the process alive solely for the backup timer.
    this.timer.unref?.()
  }

  /** Write now if (and only if) the store changed since the last write. */
  private tick(): void {
    try {
      const entries = this.db.dumpResumes()
      const registry = this.db.listRegistry()
      const sig = storeSignature(entries, registry)
      if (sig === this.lastSignature) return
      const { written, bytes, removed } = writeResumeFiles(this.dir, entries, registry)
      this.lastSignature = sig
      this.log(
        `[backup] wrote ${written} resume file(s), ${bytes} bytes → ${this.dir}` +
        (removed.length ? ` (removed ${removed.length} superseded file(s))` : ''),
      )
    } catch (err) {
      this.log(`[backup] write failed: ${(err as Error).message}`)
    }
  }

  /** Force a final write regardless of signature (used on graceful shutdown). */
  flush(): void {
    try {
      const entries = this.db.dumpResumes()
      const registry = this.db.listRegistry()
      const { written } = writeResumeFiles(this.dir, entries, registry)
      this.lastSignature = storeSignature(entries, registry)
      this.log(`[backup] final flush → ${written} resume file(s) in ${this.dir}`)
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
