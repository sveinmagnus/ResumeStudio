/**
 * Server-side weight of a realistic large CV.
 *
 * The client half (tests/scale.test.ts) measures what the payload weighs in
 * the browser. This measures what it costs the SERVER to keep — specifically
 * the one design decision that stops snapshot history from multiplying a
 * profile photo by fifty: `stripSnapshotImages`, which is private to
 * `server/db.ts` and therefore only observable through a real save.
 *
 * That privacy is the point. Asserting it against a re-implementation in the
 * test would prove the copy agrees with the copy; asserting it through
 * `saveResume` + `storageStats` proves the shipped path does it.
 */
import { describe, it, expect } from 'vitest'
import { createResumeDb, SYSTEM_VIEWER } from '../../server/db'
// These suites exercise storage, not authorization: the unrestricted system
// viewer leaves every query unscoped, so they measure exactly what they
// measured before. Scoping has its own suite — tests/server/scoping.test.ts.
const V = SYSTEM_VIEWER

import { makeLargeStore, storeBytes } from '../helpers/largeStore'

const freshDb = () => createResumeDb(':memory:')

describe('a realistic large CV — server storage', () => {
  it('keeps snapshots image-free, so history does not multiply the photo', () => {
    const db = freshDb()
    const store = makeLargeStore()
    const meta = db.createResume(V, { name: 'Large CV', data: store })

    // Ten edits — each appends a snapshot. With images riding along this would
    // grow by the photo size every time; that is the failure mode the
    // image-free storage exists to prevent.
    let version = meta.version
    for (let i = 0; i < 10; i++) {
      const edited = {
        ...store,
        projects: store.projects.map((p, idx) =>
          idx === 0 ? { ...p, customer: { en: `Customer edited ${i}` } } : p,
        ),
      }
      const res = db.saveResume(V, meta.id, edited, undefined, version)
      expect(res.status, `save ${i} failed`).toBe('saved')
      if (res.status === 'saved') version = res.version
    }

    const stats = db.storageStats(V)
    const row = stats.resumes.find((r) => r.id === meta.id)
    expect(row).toBeDefined()

    // The live document really is image-heavy…
    expect(row!.image_bytes).toBeGreaterThan(200_000)
    expect(db.listSnapshots(V, meta.id).length).toBeGreaterThan(1)

    // …and each stored snapshot weighs about the IMAGE-FREE document, not the
    // document. Stated against `bytes - image_bytes` rather than a tuned
    // constant, so the assertion still means the same thing when the fixture
    // grows: a snapshot carries the prose and none of the photo.
    const snapshots = db.listSnapshots(V, meta.id).length
    const perSnapshot = row!.snapshot_bytes / snapshots
    const imageFree = row!.bytes - row!.image_bytes
    expect(
      perSnapshot,
      `per-snapshot ${Math.round(perSnapshot)} vs image-free document ${imageFree}`,
    ).toBeLessThan(imageFree * 1.1)
    // And strictly smaller than the live document — if this ever equals it,
    // stripping has silently stopped happening.
    expect(perSnapshot).toBeLessThan(row!.bytes * 0.95)

    db.close()
  })

  it('reports a payload weight that matches what the client measures', () => {
    const db = freshDb()
    const store = makeLargeStore()
    const meta = db.createResume(V, { name: 'Large CV', data: store })

    const row = db.storageStats(V).resumes.find((r) => r.id === meta.id)!
    // The picker's warning thresholds are applied to THIS number, so if it
    // drifted from the real JSON size the warnings would fire on the wrong
    // documents. Allow a little slack for row/besides-data overhead.
    const clientBytes = storeBytes(store)
    expect(Math.abs(row.bytes - clientBytes) / clientBytes).toBeLessThan(0.05)

    db.close()
  })
})
