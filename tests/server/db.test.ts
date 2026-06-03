import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createResumeDb, MAX_SNAPSHOTS } from '../../server/db'

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

  it('saveResume returns null for an unknown id (no row created)', () => {
    const db = freshDb()
    expect(db.saveResume('bogus', { v: 1 })).toBeNull()
    expect(db.listResumes()).toEqual([])
  })

  it('saveResume updates data and bumps saved_at', async () => {
    const db = freshDb()
    const meta = db.createResume({ name: 'Mine' })
    // Sleep a millisecond so ISO timestamps differ.
    await new Promise((r) => setTimeout(r, 5))
    const newSavedAt = db.saveResume(meta.id, { v: 2 })
    expect(newSavedAt).not.toBe(meta.saved_at)
    const full = db.getResume(meta.id)
    expect(full?.data).toEqual({ v: 2 })
    expect(full?.meta.saved_at).toBe(newSavedAt)
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
