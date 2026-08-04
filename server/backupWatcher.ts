/**
 * Inbound sync-folder watcher for the desktop build — the read-side mirror of
 * `BackupScheduler`.
 *
 * The boot restore in the launcher pulls newer edits from the sync folder ONCE,
 * at startup. But the normal way this app runs is a server left open in the
 * background for days: launches are rare, so a launch-only restore means edits
 * a *sync service* drops into the folder (from another machine) never land here
 * until the next restart. This watcher closes that gap — it re-runs the same
 * non-destructive merge whenever anything in the folder changes.
 *
 * Detection is deliberately HYBRID:
 *  - `fs.watch` on the folder gives a near-immediate reaction when it fires, but
 *    it is unreliable exactly where this feature lives — Drive/Dropbox/OneDrive
 *    and network shares frequently deliver a synced file without emitting a
 *    usable event (or emit a burst mid-write).
 *  - a periodic fingerprint poll is the correctness guarantee: even if every
 *    watch event is missed, the next tick notices the changed folder and merges.
 * The watch is thus a latency optimisation layered over a poll that is always
 * right within one interval.
 *
 * Since the folder became one file PER RESUME (`backupFiles.ts`), the change
 * gate is a fingerprint of every JSON file's name/size/mtime rather than one
 * file's mtime — otherwise a second machine adding a new person's file, which
 * touches no existing file, would go unnoticed.
 *
 * Feedback-loop guard: our own `BackupScheduler` writes these same files, which
 * would otherwise trip the watcher. Before merging, the watcher compares the
 * folder's content signature to the LIVE DB signature; when they match (our own
 * write, or data we already merged) it does nothing. Only a folder that carries
 * state the DB doesn't reflect triggers a restore.
 *
 * Errors are logged, never thrown — a failing read (e.g. a half-written file
 * caught mid-sync) must not take down the editor; the next tick retries.
 */

import fs from 'fs'
import { backupSignature } from './backup.js'
import { folderFingerprint, scanBackupDir, type Tombstone } from './backupFiles.js'
import type { ResumeBackupEntry, ResumeDb } from './db.js'

export interface BackupWatcherOptions {
  db: ResumeDb
  /** Sync folder holding the resume files (e.g. a Google Drive path). */
  dir: string
  /** Poll-backstop interval in ms. Default 60s. */
  intervalMs?: number
  /** Diagnostic sink — defaults to console.log. */
  log?: (msg: string) => void
  /** Called after a merge that actually changed the DB. */
  onMerged?: (summary: {
    inserted: number
    updated: number
    deleted: number
    registry: { added: number; updated: number }
  }) => void
}

/** Debounce window for coalescing an fs.watch event burst before checking. */
const WATCH_DEBOUNCE_MS = 750

/**
 * Reconcile scanned files against erasure tombstones.
 *
 * A tombstone is only honoured for a copy whose `saved_at` is at or before the
 * deletion. An edit made AFTER the delete is a deliberate revival and is never
 * silently thrown away — the same "newest wins" rule the rest of the merge uses,
 * with a delete treated as just another timestamped change.
 *
 * Returns the entries still safe to merge, plus the tombstones that survived
 * (i.e. no newer file revived them). Those still have to be checked against the
 * LOCAL row before anything is deleted — a resume this machine edited but hasn't
 * published yet has no file here to speak for it. Pure, so the rule is directly
 * testable.
 */
export function applyTombstoneRules(
  entries: ResumeBackupEntry[],
  tombstones: Tombstone[],
): { keep: ResumeBackupEntry[]; pending: Tombstone[] } {
  if (!tombstones.length) return { keep: entries, pending: [] }
  const deletedAtById = new Map(tombstones.map((t) => [t.id, t.deleted_at]))
  const keep: ResumeBackupEntry[] = []
  for (const e of entries) {
    const deletedAt = deletedAtById.get(e.id)
    if (deletedAt === undefined || e.saved_at > deletedAt) keep.push(e)
  }
  const revived = new Set(keep.map((e) => e.id))
  return { keep, pending: tombstones.filter((t) => !revived.has(t.id)) }
}

export class BackupWatcher {
  private readonly db: ResumeDb
  private readonly dir: string
  private readonly intervalMs: number
  private readonly log: (msg: string) => void
  private readonly onMerged?: BackupWatcherOptions['onMerged']
  private timer: NodeJS.Timeout | null = null
  private watcher: fs.FSWatcher | null = null
  private debounce: NodeJS.Timeout | null = null
  /** Fingerprint of the folder as we last read it — the poll's change gate. */
  private lastFingerprint = ''

  constructor(opts: BackupWatcherOptions) {
    this.db = opts.db
    this.dir = opts.dir
    this.intervalMs = opts.intervalMs ?? 60_000
    this.log = opts.log ?? ((m) => console.log(m))
    this.onMerged = opts.onMerged
  }

  /**
   * Begin watching + polling. Seeds the fingerprint from what's already there so
   * the first tick doesn't redundantly re-merge what the launcher's boot restore
   * just applied — only a CHANGE from here on triggers work.
   */
  start(): void {
    if (this.timer || this.watcher) return
    this.lastFingerprint = folderFingerprint(this.dir)

    // Poll backstop.
    this.timer = setInterval(() => this.check(), this.intervalMs)
    this.timer.unref?.() // don't keep the process alive just for the watcher

    // Low-latency layer. Watch the FOLDER, not a file: a sync client (and our
    // own atomic write) replaces files via rename, which detaches a file-level
    // watch from the new inode; a folder watch survives it — and with one file
    // per resume, the folder is the unit that matters anyway.
    try {
      this.watcher = fs.watch(this.dir, (_event, filename) => {
        // filename can be null on some platforms — treat that as "something in
        // the folder changed" and check anyway. Our own temp files (dot-
        // prefixed) are the one thing worth ignoring.
        if (filename === null || !filename.startsWith('.')) this.scheduleCheck()
      })
      this.watcher.on('error', (err) => {
        // A watch error (folder removed, FS doesn't support it) must not be
        // fatal — the poll keeps correctness. Drop the watcher and log once.
        this.log(`[backup-watch] fs.watch error, falling back to polling: ${(err as Error).message}`)
        try { this.watcher?.close() } catch { /* ignore */ }
        this.watcher = null
      })
    } catch (err) {
      this.log(`[backup-watch] fs.watch unavailable, polling only: ${(err as Error).message}`)
      this.watcher = null
    }
  }

  /** Debounce a burst of watch events into a single check. */
  private scheduleCheck(): void {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      this.check()
    }, WATCH_DEBOUNCE_MS)
    this.debounce.unref?.()
  }

  /**
   * Merge the folder into the DB IFF it changed on disk AND carries state the DB
   * doesn't already reflect. Cheap-exits on an unchanged fingerprint so an idle
   * app does almost no work.
   */
  private check(): void {
    const fingerprint = folderFingerprint(this.dir)
    if (fingerprint === this.lastFingerprint) return

    const scan = scanBackupDir(this.dir)
    if (scan.unreadable.length) {
      // Half-written files caught mid-sync. Log, and DON'T advance the gate, so
      // the next tick retries once the sync client has finished writing.
      this.log(`[backup-watch] ${scan.unreadable.length} file(s) unreadable, will retry: ${scan.unreadable.join(', ')}`)
      return
    }
    this.lastFingerprint = fingerprint

    const { keep, pending } = applyTombstoneRules(scan.resumes, scan.tombstones)

    // A tombstone only erases a LOCAL row the deletion is newer than. Without
    // this, a resume edited here but not yet published (so no file argues for
    // it) would be destroyed by another machine's older delete.
    const local = this.db.dumpResumes()
    const localSavedAt = new Map(local.map((e) => [e.id, e.saved_at]))
    const erasedIds = pending
      .filter((t) => {
        const savedAt = localSavedAt.get(t.id)
        return savedAt !== undefined && savedAt <= t.deleted_at
      })
      .map((t) => t.id)

    // Feedback-loop guard: if the folder already matches the live store (our own
    // BackupScheduler write, or data we merged earlier), there's nothing to pull.
    if (!erasedIds.length && backupSignature(keep) === backupSignature(local)) return

    try {
      const summary = this.db.restoreResumes(keep) // merge mode: newest-wins, no deletes
      const registry = this.db.mergeRegistry(scan.registry)

      // Erasure last, so a stale file for a deleted resume can't re-insert it.
      let deleted = 0
      for (const id of erasedIds) {
        if (this.db.deleteResume(id)) deleted++
      }

      const changed = summary.inserted + summary.updated + deleted
      if (changed > 0 || registry.added + registry.updated > 0) {
        this.log(
          `[backup-watch] merged from sync folder: +${summary.inserted} new, ` +
          `${summary.updated} updated, ${deleted} erased, ${summary.skipped} already current; ` +
          `registry +${registry.added}/${registry.updated}`,
        )
        if (changed > 0) {
          this.onMerged?.({ inserted: summary.inserted, updated: summary.updated, deleted, registry })
        }
      }
    } catch (err) {
      this.log(`[backup-watch] merge failed: ${(err as Error).message}`)
    }
  }

  stop(): void {
    if (this.debounce) { clearTimeout(this.debounce); this.debounce = null }
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.watcher) {
      try { this.watcher.close() } catch { /* ignore */ }
      this.watcher = null
    }
  }
}
