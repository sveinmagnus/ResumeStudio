import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { BackupWatcher, applyTombstoneRules } from '../../server/backupWatcher'
import { BackupScheduler } from '../../server/backupScheduler'
import {
  TOMBSTONE_FILENAME, buildResumeFile, buildTombstoneFile, resumeFileName,
  writeJsonAtomic, type Tombstone,
} from '../../server/backupFiles'
import { BACKUP_FILENAME, buildStoreBackup, writeBackupAtomic } from '../../server/backup'
import { createResumeDb, type ResumeBackupEntry, type ResumeDb } from '../../server/db'

const entry = (over: Partial<ResumeBackupEntry> = {}): ResumeBackupEntry => ({
  id: 'r1',
  name: 'CV',
  primary_locale: 'en',
  secondary_locale: null,
  saved_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  data: { resume: { full_name: 'Ada' } },
  ...over,
})

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rs-bw-'))
const rmQuiet = (d: string) => { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }

/**
 * Publish resume files the way another machine's sync client would, forcing a
 * distinct mtime so the poll's change gate is deterministic regardless of
 * filesystem timestamp resolution.
 */
function putFiles(dir: string, entries: ResumeBackupEntry[], mtime: Date): void {
  for (const e of entries) {
    const name = resumeFileName(e.id, e.name)
    writeJsonAtomic(dir, name, buildResumeFile(e, []))
    fs.utimesSync(path.join(dir, name), mtime, mtime)
  }
}

function putTombstones(dir: string, tombstones: Tombstone[], mtime: Date): void {
  writeJsonAtomic(dir, TOMBSTONE_FILENAME, buildTombstoneFile(tombstones))
  fs.utimesSync(path.join(dir, TOMBSTONE_FILENAME), mtime, mtime)
}

const INTERVAL = 10_000
/** Advance past one poll interval to fire the backstop `check()`. */
const pollOnce = () => vi.advanceTimersByTime(INTERVAL + 1)

// ─── The erasure rule, in isolation ─────────────────────────────────────────

describe('applyTombstoneRules', () => {
  it('drops a copy the deletion is newer than', () => {
    const { keep, pending } = applyTombstoneRules(
      [entry({ saved_at: '2026-01-01T00:00:00.000Z' })],
      [{ id: 'r1', deleted_at: '2026-02-01T00:00:00.000Z' }],
    )
    expect(keep).toEqual([])
    expect(pending.map((t) => t.id)).toEqual(['r1'])
  })

  it('an edit made AFTER the delete revives the resume', () => {
    // A delete is just another timestamped change, so newest still wins. Losing
    // an edit somebody made after the deletion would be silent data loss.
    const { keep, pending } = applyTombstoneRules(
      [entry({ saved_at: '2026-03-01T00:00:00.000Z' })],
      [{ id: 'r1', deleted_at: '2026-02-01T00:00:00.000Z' }],
    )
    expect(keep).toHaveLength(1)
    expect(pending).toEqual([])
  })

  it('a tombstone with no surviving file stays pending (the local row may exist)', () => {
    const { keep, pending } = applyTombstoneRules([], [{ id: 'gone', deleted_at: '2026-02-01T00:00:00.000Z' }])
    expect(keep).toEqual([])
    expect(pending.map((t) => t.id)).toEqual(['gone'])
  })

  it('is a pass-through when there is nothing to erase', () => {
    const entries = [entry()]
    expect(applyTombstoneRules(entries, [])).toEqual({ keep: entries, pending: [] })
  })
})

describe('BackupWatcher', () => {
  let dir: string
  let db: ResumeDb
  let logs: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    dir = tmp()
    db = createResumeDb(':memory:')
    logs = []
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
    rmQuiet(dir)
  })

  const make = () => new BackupWatcher({
    db, dir, intervalMs: INTERVAL, log: (m) => logs.push(m),
  })

  it('merges newer external edits picked up on the poll backstop', () => {
    db.restoreResumes([entry({ saved_at: '2026-01-01T00:00:00.000Z' })]) // seed r1 (old)
    const w = make()
    w.start() // empty folder → gate seeded empty

    // A sync service drops a newer r1 + a brand-new r2 into the folder.
    putFiles(dir, [
      entry({ saved_at: '2026-02-01T00:00:00.000Z', data: { resume: { full_name: 'Ada Lovelace' } } }),
      entry({ id: 'r2', name: 'Other', saved_at: '2026-01-15T00:00:00.000Z' }),
    ], new Date('2027-01-01T00:00:00Z'))

    pollOnce()

    const byId = Object.fromEntries(db.dumpResumes().map((e) => [e.id, e]))
    expect(Object.keys(byId).sort()).toEqual(['r1', 'r2'])
    expect(byId.r1.saved_at).toBe('2026-02-01T00:00:00.000Z') // updated to newer
    expect(byId.r2).toBeTruthy()                              // inserted
    w.stop()
  })

  it('notices a NEW person even though no existing file changed', () => {
    // The reason the change gate is a folder fingerprint rather than one file's
    // mtime: another machine publishing a new resume adds a file and touches
    // nothing else, which a single-file mtime watch would never see.
    db.restoreResumes([entry()])
    putFiles(dir, [entry()], new Date('2027-01-01T00:00:00Z'))
    const w = make()
    w.start()

    putFiles(dir, [entry({ id: 'r2', name: 'Newcomer' })], new Date('2027-01-02T00:00:00Z'))
    pollOnce()

    expect(db.dumpResumes().map((e) => e.id).sort()).toEqual(['r1', 'r2'])
    w.stop()
  })

  it('erases a resume another machine deleted, and says so', () => {
    db.restoreResumes([entry(), entry({ id: 'r2', name: 'Keeper' })])
    const w = make()
    w.start()

    // The other machine removed r1's file and left a tombstone behind.
    putFiles(dir, [entry({ id: 'r2', name: 'Keeper' })], new Date('2027-01-01T00:00:00Z'))
    putTombstones(dir, [{ id: 'r1', deleted_at: '2026-06-01T00:00:00.000Z' }], new Date('2027-01-01T00:00:00Z'))
    pollOnce()

    expect(db.dumpResumes().map((e) => e.id)).toEqual(['r2'])
    expect(logs.some((l) => l.includes('1 erased'))).toBe(true)
    w.stop()
  })

  it('does NOT erase a local resume edited after the deletion', () => {
    // No file here argues for the local copy (this machine hasn't published
    // yet), so the tombstone must be checked against the local row's own
    // saved_at or a stale delete would destroy newer work.
    db.restoreResumes([entry({ saved_at: '2026-09-01T00:00:00.000Z' })])
    const w = make()
    w.start()

    putFiles(dir, [entry({ id: 'r2', name: 'Anything' })], new Date('2027-01-01T00:00:00Z'))
    putTombstones(dir, [{ id: 'r1', deleted_at: '2026-06-01T00:00:00.000Z' }], new Date('2027-01-01T00:00:00Z'))
    pollOnce()

    expect(db.dumpResumes().map((e) => e.id).sort()).toEqual(['r1', 'r2'])
    w.stop()
  })

  it('a stale file for a deleted resume cannot resurrect it', () => {
    // Erasure runs after the merge for exactly this case: another machine that
    // hasn't synced yet still has the resume's file sitting in the folder.
    db.restoreResumes([entry()])
    const w = make()
    w.start()

    putFiles(dir, [entry({ saved_at: '2026-05-01T00:00:00.000Z' })], new Date('2027-01-01T00:00:00Z'))
    putTombstones(dir, [{ id: 'r1', deleted_at: '2026-06-01T00:00:00.000Z' }], new Date('2027-01-01T00:00:00Z'))
    pollOnce()

    expect(db.dumpResumes()).toEqual([])
    w.stop()
  })

  it('does nothing when the folder already matches the live store (own-write guard)', () => {
    db.restoreResumes([entry()])
    const restoreSpy = vi.spyOn(db, 'restoreResumes')
    const w = make()
    w.start()

    // Files carry the SAME signature the DB already has (as our own scheduler
    // would have written). Must not trigger a restore.
    putFiles(dir, [entry()], new Date('2027-01-01T00:00:00Z'))
    pollOnce()

    expect(restoreSpy).not.toHaveBeenCalled()
    w.stop()
  })

  it('skips an unreadable (half-written) file without throwing, then merges once valid', () => {
    db.restoreResumes([entry()])
    const w = make()
    w.start()

    // A partial/garbage file — must be tolerated and retried, not fatal.
    const file = path.join(dir, 'half__r1.json')
    fs.writeFileSync(file, '{ not json')
    fs.utimesSync(file, new Date('2027-01-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'))
    expect(() => pollOnce()).not.toThrow()
    expect(db.dumpResumes()[0].saved_at).toBe('2026-01-01T00:00:00.000Z') // unchanged
    expect(logs.some((l) => l.includes('unreadable'))).toBe(true)

    // Once the sync client finishes, a valid newer file merges on the next tick.
    // Distinct data so the newest-wins merge actually rewrites the row (an
    // identical-content restore is a deliberate no-op).
    fs.rmSync(file)
    putFiles(dir, [entry({ saved_at: '2026-03-01T00:00:00.000Z', data: { resume: { full_name: 'Grace' } } })], new Date('2027-02-01T00:00:00Z'))
    pollOnce()
    expect(db.dumpResumes()[0].saved_at).toBe('2026-03-01T00:00:00.000Z')
    w.stop()
  })

  it('still merges a legacy combined backup, so an un-upgraded machine is not stranded', () => {
    db.restoreResumes([entry()])
    const w = make()
    w.start()

    writeBackupAtomic(dir, buildStoreBackup([entry({ id: 'r2', name: 'From an old build' })]))
    const legacy = path.join(dir, BACKUP_FILENAME)
    fs.utimesSync(legacy, new Date('2027-01-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'))
    pollOnce()

    expect(db.dumpResumes().map((e) => e.id).sort()).toEqual(['r1', 'r2'])
    w.stop()
  })

  it('does not re-merge what was present at start (boot restore already ran)', () => {
    db.restoreResumes([entry()])
    // Files already on disk BEFORE start, carrying newer data than the DB.
    putFiles(dir, [entry({ saved_at: '2099-01-01T00:00:00.000Z' })], new Date('2027-01-01T00:00:00Z'))
    const restoreSpy = vi.spyOn(db, 'restoreResumes')
    const w = make()
    w.start() // seeds the fingerprint from the existing folder

    pollOnce() // unchanged folder → cheap-exit, no read/merge
    expect(restoreSpy).not.toHaveBeenCalled()
    w.stop()
  })

  it('the outbound scheduler and inbound watcher do not collide (own write is a no-op)', () => {
    db.restoreResumes([entry()])
    const w = make()
    w.start() // gate seeded empty (no files yet) so the next poll actually reads

    // A real scheduler writes our OWN current DB state to the same folder,
    // atomically (temp file + rename). The watcher must recognise it as ours
    // and NOT re-import it — the feedback-loop guard is the folder-vs-DB signature.
    const scheduler = new BackupScheduler({ db, dir, intervalMs: INTERVAL, log: (m) => logs.push(m) })
    const restoreSpy = vi.spyOn(db, 'restoreResumes')
    scheduler.flush() // publishes one file per resume

    pollOnce() // watcher reads the folder, folderSig === dbSig → returns before restoring
    expect(restoreSpy).not.toHaveBeenCalled()

    scheduler.stop()
    w.stop()
  })

  it('stop() clears the poll timer', () => {
    db.restoreResumes([entry()])
    const w = make()
    w.start()
    w.stop()
    const restoreSpy = vi.spyOn(db, 'restoreResumes')
    putFiles(dir, [entry({ saved_at: '2099-01-01T00:00:00.000Z' })], new Date('2027-01-01T00:00:00Z'))
    pollOnce()
    expect(restoreSpy).not.toHaveBeenCalled()
  })
})

describe('BackupScheduler', () => {
  let dir: string
  let db: ResumeDb

  beforeEach(() => {
    dir = tmp()
    db = createResumeDb(':memory:')
  })
  afterEach(() => { db.close(); rmQuiet(dir) })

  it('publishes one file per resume, then gates until something actually changes', () => {
    vi.useFakeTimers()
    try {
      db.restoreResumes([entry(), entry({ id: 'r2', name: 'Second' })])
      const logs: string[] = []
      const s = new BackupScheduler({ db, dir, intervalMs: INTERVAL, log: (m) => logs.push(m) })
      s.start() // runs one tick immediately
      expect(fs.readdirSync(dir).sort()).toEqual(['cv__r1.json', 'registry.json', 'second__r2.json'])
      expect(logs).toHaveLength(1)

      // Idle ticks must not touch the folder — an app left open for days should
      // not churn the user's cloud-sync client.
      vi.advanceTimersByTime(INTERVAL * 3)
      expect(logs).toHaveLength(1)

      // A registry-only change still triggers a write: registry.json is its own
      // file now, so gating on resume saved_at alone would leave it stale.
      db.upsertRegistryEntry({ kind: 'skill', name: { en: 'Rust' } })
      vi.advanceTimersByTime(INTERVAL + 1)
      expect(logs).toHaveLength(2)
      const registry = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8'))
      expect(registry.registry).toHaveLength(1)

      s.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
