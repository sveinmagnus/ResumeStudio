import { describe, it, expect } from 'vitest'
import { createResumeDb, MAX_SNAPSHOTS } from '../../server/db'

// Each test gets its own isolated in-memory database.
const freshDb = () => createResumeDb(':memory:')

describe('createResumeDb — resume CRUD', () => {
  it('reports empty state before anything is saved', () => {
    const db = freshDb()
    expect(db.getResume()).toBeNull()
    expect(db.getLastSavedAt()).toBeNull()
    expect(db.listSnapshots()).toEqual([])
  })

  it('round-trips saved resume data and a timestamp', () => {
    const db = freshDb()
    const data = { resume: { full_name: 'Astrid' }, projects: [] }
    const savedAt = db.saveResume(data)
    expect(db.getResume()).toEqual(data)
    expect(db.getLastSavedAt()).toBe(savedAt)
    expect(savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('overwrites the single live row on each save', () => {
    const db = freshDb()
    db.saveResume({ v: 1 })
    db.saveResume({ v: 2 })
    expect(db.getResume()).toEqual({ v: 2 })
  })
})

describe('createResumeDb — snapshot history', () => {
  it('appends one snapshot per distinct save, newest first', () => {
    const db = freshDb()
    db.saveResume({ v: 1 })
    db.saveResume({ v: 2 })
    const snaps = db.listSnapshots()
    expect(snaps).toHaveLength(2)
    // Newest first (descending id).
    expect(snaps[0].id).toBeGreaterThan(snaps[1].id)
    expect(db.getSnapshot(snaps[0].id)).toEqual({ v: 2 })
    expect(db.getSnapshot(snaps[1].id)).toEqual({ v: 1 })
  })

  it('skips a snapshot identical to the most recent one', () => {
    const db = freshDb()
    db.saveResume({ v: 1 })
    db.saveResume({ v: 1 }) // identical → deduped
    expect(db.listSnapshots()).toHaveLength(1)
  })

  it('dedupes only against the most recent snapshot, not the whole history', () => {
    const db = freshDb()
    db.saveResume({ v: 1 })
    db.saveResume({ v: 2 })
    db.saveResume({ v: 1 }) // differs from the last ({v:2}) → recorded again
    expect(db.listSnapshots()).toHaveLength(3)
  })

  it('reports size (byte length) and ids in the metadata', () => {
    const db = freshDb()
    db.saveResume({ hello: 'world' })
    const [snap] = db.listSnapshots()
    expect(snap.size).toBe(JSON.stringify({ hello: 'world' }).length)
    expect(Number.isInteger(snap.id)).toBe(true)
  })

  it(`prunes to the newest ${MAX_SNAPSHOTS} snapshots`, () => {
    const db = freshDb()
    const total = MAX_SNAPSHOTS + 5
    for (let i = 0; i < total; i++) db.saveResume({ n: i })

    const snaps = db.listSnapshots()
    expect(snaps).toHaveLength(MAX_SNAPSHOTS)
    // Newest snapshot holds the last save.
    expect(db.getSnapshot(snaps[0].id)).toEqual({ n: total - 1 })
    // The earliest ids (1..5) were pruned.
    expect(db.getSnapshot(1)).toBeNull()
    expect(db.getSnapshot(5)).toBeNull()
  })

  it('returns null for an unknown snapshot id', () => {
    const db = freshDb()
    db.saveResume({ v: 1 })
    expect(db.getSnapshot(9999)).toBeNull()
  })
})
