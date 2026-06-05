import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { createResumeDb, MAX_SNAPSHOTS, type ResumeBackupEntry } from '../../server/db'

// Each test gets its own isolated in-memory database.
const freshDb = () => createResumeDb(':memory:')

describe('createResumeDb — file permissions', () => {
  // Best-effort: better-sqlite3 keeps the file handle open, so Windows can't
  // unlink it mid-test. The assertions are what matter; tmp hygiene is not.
  const rmQuiet = (dir: string) => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  it('does not throw and produces a usable DB for a real file path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-db-'))
    const file = path.join(dir, 'resume.db')
    const db = createResumeDb(file)
    expect(db.listResumes()).toEqual([])
    expect(fs.existsSync(file)).toBe(true)
    rmQuiet(dir)
  })

  // POSIX only: chmod can't enforce group/other bits on Windows (it only
  // toggles the read-only attribute), so asserting 0600 there would be
  // environment noise, not a real signal. CI runs on Linux, where it holds.
  it.skipIf(process.platform === 'win32')('locks a file-backed DB to owner-only (0600)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-db-'))
    const file = path.join(dir, 'resume.db')
    createResumeDb(file)
    const mode = fs.statSync(file).mode & 0o777
    expect(mode & 0o077).toBe(0) // no group/other permission bits
    rmQuiet(dir)
  })
})

describe('createResumeDb — resume CRUD', () => {
  it('lists no resumes on a fresh DB', () => {
    const db = freshDb()
    expect(db.listResumes()).toEqual([])
  })

  it('createResume returns metadata with a uuid id and timestamps', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Sales CV' })
    expect(meta.id).toMatch(/^[0-9a-f]{8}-/) // uuid prefix
    expect(meta.name).toBe('Sales CV')
    expect(meta.primary_locale).toBe('en')
    expect(meta.secondary_locale).toBeNull()
    expect(meta.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(meta.created_at).toBe(meta.saved_at)
  })

  it('createResume accepts initial data and locale preferences', () => {
    const db = freshDb()
    const meta = db.createResume({
      name: 'Board CV',
      data: { resume: { full_name: 'Astrid' } },
      primary_locale: 'no',
      secondary_locale: 'en',
    })
    expect(meta.primary_locale).toBe('no')
    expect(meta.secondary_locale).toBe('en')

    const full = db.getResume(meta.id)
    expect(full?.data).toEqual({ resume: { full_name: 'Astrid' } })
    expect(full?.meta.primary_locale).toBe('no')
  })

  it('getResume returns null for an unknown id', () => {
    const db = freshDb()
    expect(db.getResume('does-not-exist')).toBeNull()
  })

  it('listResumes returns one row per resume, newest saved_at first', async () => {
    const db = freshDb()
    const a = db.createResume({ name: 'A' })
    await new Promise((r) => setTimeout(r, 5))
    const b = db.createResume({ name: 'B' })
    await new Promise((r) => setTimeout(r, 5))
    db.saveResume(b.id, { v: 1 }) // bumps B's saved_at past A's
    const list = db.listResumes()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
  })

  it('saveResume reports not-found for an unknown id (no row created)', () => {
    const db = freshDb()
    expect(db.saveResume('bogus', { v: 1 })).toEqual({ status: 'not-found' })
    expect(db.listResumes()).toEqual([])
  })

  it('saveResume updates data and bumps saved_at', async () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Mine' })
    // Sleep a millisecond so ISO timestamps differ.
    await new Promise((r) => setTimeout(r, 5))
    const result = db.saveResume(meta.id, { v: 2 })
    expect(result.status).toBe('saved')
    const savedAt = result.status === 'saved' ? result.saved_at : null
    expect(savedAt).not.toBe(meta.saved_at)
    const full = db.getResume(meta.id)
    expect(full?.data).toEqual({ v: 2 })
    expect(full?.meta.saved_at).toBe(savedAt)
    // created_at is not touched.
    expect(full?.meta.created_at).toBe(meta.created_at)
  })

  it('saveResume can update locales alongside data', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Mine' })
    db.saveResume(meta.id, { v: 1 }, { primary_locale: 'no', secondary_locale: 'en' })
    const full = db.getResume(meta.id)
    expect(full?.meta.primary_locale).toBe('no')
    expect(full?.meta.secondary_locale).toBe('en')
  })

  it('saveResume without locales leaves them unchanged', () => {
    const db = freshDb()
    const meta = db.createResume({
      name: 'Mine', primary_locale: 'no', secondary_locale: 'en',
    })
    db.saveResume(meta.id, { v: 1 }) // no locales arg
    const full = db.getResume(meta.id)
    expect(full?.meta.primary_locale).toBe('no')
    expect(full?.meta.secondary_locale).toBe('en')
  })

  it('renameResume updates the name and reports whether it matched', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Old' })
    expect(db.renameResume(meta.id, 'New')).toBe(true)
    expect(db.getResume(meta.id)?.meta.name).toBe('New')
    expect(db.renameResume('bogus', 'whatever')).toBe(false)
  })

  it('deleteResume removes the row and reports whether it matched', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Doomed' })
    expect(db.deleteResume(meta.id)).toBe(true)
    expect(db.getResume(meta.id)).toBeNull()
    expect(db.deleteResume(meta.id)).toBe(false)
  })
})

describe('createResumeDb — versioning & optimistic concurrency', () => {
  it('starts at version 1 and exposes it on create/get/list', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'CV' })
    expect(meta.version).toBe(1)
    expect(db.getResume(meta.id)?.meta.version).toBe(1)
    expect(db.listResumes()[0].version).toBe(1)
  })

  it('bumps the version by 1 on every successful save', () => {
    const db = freshDb()
    const { id } = db.createResume({ name: 'CV' })
    const r1 = db.saveResume(id, { v: 1 })
    const r2 = db.saveResume(id, { v: 2 })
    expect(r1).toEqual(expect.objectContaining({ status: 'saved', version: 2 }))
    expect(r2).toEqual(expect.objectContaining({ status: 'saved', version: 3 }))
    expect(db.getResume(id)?.meta.version).toBe(3)
  })

  it('accepts a save whose expectedVersion matches the current version', () => {
    const db = freshDb()
    const { id } = db.createResume({ name: 'CV' }) // version 1
    const r = db.saveResume(id, { v: 1 }, undefined, 1)
    expect(r.status).toBe('saved')
    expect(db.getResume(id)?.meta.version).toBe(2)
  })

  it('rejects a save with a stale expectedVersion and writes nothing', () => {
    const db = freshDb()
    const { id } = db.createResume({ name: 'CV', data: { original: true } })
    db.saveResume(id, { v: 2 }) // version → 2
    // A second writer still thinks the base is 1.
    const r = db.saveResume(id, { iLose: true }, undefined, 1)
    expect(r.status).toBe('conflict')
    if (r.status === 'conflict') {
      // The conflict carries the live server state for diffing…
      expect(r.current.meta.version).toBe(2)
      expect(r.current.data).toEqual({ v: 2 })
    }
    // …and nothing was written: data + version unchanged.
    expect(db.getResume(id)?.data).toEqual({ v: 2 })
    expect(db.getResume(id)?.meta.version).toBe(2)
  })

  it('a conflict does NOT append a snapshot', () => {
    const db = freshDb()
    const { id } = db.createResume({ name: 'CV' })
    db.saveResume(id, { v: 2 })              // version 2, 1 snapshot
    const before = db.listSnapshots(id).length
    db.saveResume(id, { stale: true }, undefined, 1) // conflict
    expect(db.listSnapshots(id).length).toBe(before)
  })

  it('omitting expectedVersion force-writes regardless of the current version', () => {
    const db = freshDb()
    const { id } = db.createResume({ name: 'CV' })
    db.saveResume(id, { v: 2 })            // version → 2
    const r = db.saveResume(id, { forced: true }) // no expectedVersion
    expect(r).toEqual(expect.objectContaining({ status: 'saved', version: 3 }))
    expect(db.getResume(id)?.data).toEqual({ forced: true })
  })
})

describe('createResumeDb — additive version migration', () => {
  const rmQuiet = (dir: string) => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  it('adds the version column to a pre-existing versionless resumes table', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-mig-'))
    const file = path.join(dir, 'old.db')

    // Hand-build the pre-offline-editing schema (no `version` column) + a row.
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE resumes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL,
        primary_locale TEXT NOT NULL DEFAULT 'en', secondary_locale TEXT,
        saved_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `)
    raw.prepare(
      `INSERT INTO resumes (id, name, data, primary_locale, secondary_locale, saved_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('old-1', 'Legacy', '{"hello":"world"}', 'en', null, '2026-01-01', '2026-01-01')
    raw.close()

    // Opening through the factory runs the migration.
    const db = createResumeDb(file)
    const full = db.getResume('old-1')
    expect(full?.meta.version).toBe(1)          // back-filled default
    expect(full?.data).toEqual({ hello: 'world' }) // data preserved, not dropped

    // And concurrency works from there: base 1 saves, base 1 then conflicts.
    expect(db.saveResume('old-1', { hello: 'again' }, undefined, 1).status).toBe('saved')
    expect(db.saveResume('old-1', { stale: true }, undefined, 1).status).toBe('conflict')

    rmQuiet(dir)
  })
})

describe('createResumeDb — snapshot history', () => {
  it('appends one snapshot per distinct save, newest first', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Mine' })
    db.saveResume(meta.id, { v: 1 })
    db.saveResume(meta.id, { v: 2 })
    const snaps = db.listSnapshots(meta.id)
    expect(snaps).toHaveLength(2)
    expect(snaps[0].id).toBeGreaterThan(snaps[1].id)
    expect(db.getSnapshot(meta.id, snaps[0].id)).toEqual({ v: 2 })
    expect(db.getSnapshot(meta.id, snaps[1].id)).toEqual({ v: 1 })
  })

  it('skips a snapshot identical to the most recent one for that resume', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Mine' })
    db.saveResume(meta.id, { v: 1 })
    db.saveResume(meta.id, { v: 1 }) // identical → deduped
    expect(db.listSnapshots(meta.id)).toHaveLength(1)
  })

  it('dedupes only against the most recent snapshot, not whole history', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Mine' })
    db.saveResume(meta.id, { v: 1 })
    db.saveResume(meta.id, { v: 2 })
    db.saveResume(meta.id, { v: 1 }) // differs from {v:2} → recorded
    expect(db.listSnapshots(meta.id)).toHaveLength(3)
  })

  it('reports size and id metadata', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Mine' })
    db.saveResume(meta.id, { hello: 'world' })
    const [snap] = db.listSnapshots(meta.id)
    expect(snap.size).toBe(JSON.stringify({ hello: 'world' }).length)
    expect(Number.isInteger(snap.id)).toBe(true)
  })

  it(`prunes to the newest ${MAX_SNAPSHOTS} snapshots per resume`, () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Mine' })
    const total = MAX_SNAPSHOTS + 5
    for (let i = 0; i < total; i++) db.saveResume(meta.id, { n: i })
    const snaps = db.listSnapshots(meta.id)
    expect(snaps).toHaveLength(MAX_SNAPSHOTS)
    expect(db.getSnapshot(meta.id, snaps[0].id)).toEqual({ n: total - 1 })
  })

  it('snapshot pruning is scoped per resume — does not touch siblings', () => {
    const db = freshDb()
    const a = db.createResume({ name: 'A' })
    const b = db.createResume({ name: 'B' })
    // One snapshot for B.
    db.saveResume(b.id, { from: 'b' })
    // Overflow A past the cap.
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) db.saveResume(a.id, { n: i })

    expect(db.listSnapshots(a.id)).toHaveLength(MAX_SNAPSHOTS)
    // B's single snapshot is intact.
    const bSnaps = db.listSnapshots(b.id)
    expect(bSnaps).toHaveLength(1)
    expect(db.getSnapshot(b.id, bSnaps[0].id)).toEqual({ from: 'b' })
  })

  it('listSnapshots and getSnapshot scope by resume_id', () => {
    const db = freshDb()
    const a = db.createResume({ name: 'A' })
    const b = db.createResume({ name: 'B' })
    db.saveResume(a.id, { from: 'a' })
    db.saveResume(b.id, { from: 'b' })

    const aSnaps = db.listSnapshots(a.id)
    expect(aSnaps).toHaveLength(1)
    expect(db.getSnapshot(a.id, aSnaps[0].id)).toEqual({ from: 'a' })
    // Looking up A's snapshot id under B returns null (cross-resume isolation).
    expect(db.getSnapshot(b.id, aSnaps[0].id)).toBeNull()
  })

  it('deleting a resume cascades its snapshots', () => {
    const db = freshDb()
    const a = db.createResume({ name: 'A' })
    const b = db.createResume({ name: 'B' })
    db.saveResume(a.id, { v: 1 })
    db.saveResume(a.id, { v: 2 })
    db.saveResume(b.id, { v: 1 })

    db.deleteResume(a.id)
    expect(db.listSnapshots(a.id)).toEqual([])
    // B is untouched.
    expect(db.listSnapshots(b.id)).toHaveLength(1)
  })

  it('returns null for an unknown snapshot id', () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Mine' })
    db.saveResume(meta.id, { v: 1 })
    expect(db.getSnapshot(meta.id, 9999)).toBeNull()
  })
})

describe('createResumeDb — dumpResumes / restoreResumes (store sync)', () => {
  it('dumpResumes returns portable entries for every resume', () => {
    const db = freshDb()
    const a = db.createResume({ name: 'A', data: { x: 1 }, primary_locale: 'no', secondary_locale: 'en' })
    db.createResume({ name: 'B', data: { y: 2 } })
    const dump = db.dumpResumes()
    expect(dump).toHaveLength(2)
    const first = dump.find((e) => e.id === a.id)!
    expect(first).toMatchObject({
      name: 'A', primary_locale: 'no', secondary_locale: 'en', data: { x: 1 },
    })
    // No version leaks into the portable shape (it's per-machine).
    expect('version' in first).toBe(false)
  })

  it('round-trips a dump from one db into a fresh one (insert)', () => {
    const src = freshDb()
    const a = src.createResume({ name: 'A', data: { hello: 'world' } })
    const dst = freshDb()
    const summary = dst.restoreResumes(src.dumpResumes())
    expect(summary).toMatchObject({ inserted: 1, updated: 0, skipped: 0, deleted: 0 })
    const full = dst.getResume(a.id)
    expect(full?.meta.name).toBe('A')
    expect(full?.data).toEqual({ hello: 'world' })
    expect(full?.meta.version).toBe(1)
  })

  it('merge keeps the local copy when it is newer (incoming older → skip)', () => {
    const db = freshDb()
    const a = db.createResume({ name: 'A' })
    db.saveResume(a.id, { local: 'newer' }) // advances saved_at
    const local = db.getResume(a.id)!
    const incoming: ResumeBackupEntry = {
      ...local.meta,
      created_at: local.meta.created_at,
      saved_at: '2000-01-01T00:00:00.000Z', // older
      data: { remote: 'older' },
    }
    const summary = db.restoreResumes([incoming])
    expect(summary).toMatchObject({ inserted: 0, updated: 0, skipped: 1 })
    expect(db.getResume(a.id)?.data).toEqual({ local: 'newer' })
  })

  it('merge takes the incoming copy when it is newer (update + snapshot)', () => {
    const db = freshDb()
    const a = db.createResume({ name: 'A', data: { v: 'old' } })
    const snapsBefore = db.listSnapshots(a.id).length
    const incoming: ResumeBackupEntry = {
      id: a.id, name: 'A (edited elsewhere)',
      primary_locale: 'en', secondary_locale: null,
      created_at: a.created_at,
      saved_at: '2999-01-01T00:00:00.000Z', // far future → wins
      data: { v: 'new' },
    }
    const summary = db.restoreResumes([incoming])
    expect(summary).toMatchObject({ inserted: 0, updated: 1, skipped: 0 })
    const full = db.getResume(a.id)!
    expect(full.data).toEqual({ v: 'new' })
    expect(full.meta.name).toBe('A (edited elsewhere)')
    expect(full.meta.saved_at).toBe('2999-01-01T00:00:00.000Z') // preserves source timestamp
    expect(full.meta.version).toBe(2) // bumped
    expect(db.listSnapshots(a.id).length).toBe(snapsBefore + 1) // restore is reversible
  })

  it('merge is idempotent — re-restoring the same dump changes nothing', () => {
    const src = freshDb()
    src.createResume({ name: 'A', data: { a: 1 } })
    src.createResume({ name: 'B', data: { b: 2 } })
    const dump = src.dumpResumes()
    const dst = freshDb()
    dst.restoreResumes(dump)
    const second = dst.restoreResumes(dump)
    expect(second).toMatchObject({ inserted: 0, updated: 0, skipped: 2, deleted: 0 })
  })

  it('merge never deletes local-only resumes', () => {
    const db = freshDb()
    const keep = db.createResume({ name: 'LocalOnly' })
    db.restoreResumes([]) // empty incoming
    expect(db.getResume(keep.id)).not.toBeNull()
  })

  it('replace mode deletes local resumes absent from the incoming set', () => {
    const db = freshDb()
    const gone = db.createResume({ name: 'Gone' })
    const kept = db.createResume({ name: 'Kept', data: { k: 1 } })
    const incoming = db.dumpResumes().filter((e) => e.id === kept.id)
    const summary = db.restoreResumes(incoming, { mode: 'replace' })
    expect(summary.deleted).toBe(1)
    expect(db.getResume(gone.id)).toBeNull()
    expect(db.getResume(kept.id)).not.toBeNull()
  })
})

describe('createResumeDb — close()', () => {
  const rmQuiet = (dir: string) => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  it('checkpoints + closes a file-backed DB without throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-close-'))
    const file = path.join(dir, 'resume.db')
    const db = createResumeDb(file)
    db.createResume({ name: 'A' })
    expect(() => db.close()).not.toThrow()
    // Reopening sees the persisted row (data survived the checkpoint+close).
    const reopened = createResumeDb(file)
    expect(reopened.listResumes()).toHaveLength(1)
    reopened.close()
    rmQuiet(dir)
  })

  it('close() is safe on an in-memory DB', () => {
    const db = freshDb()
    expect(() => db.close()).not.toThrow()
  })
})
