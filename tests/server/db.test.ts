import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { createResumeDb, MAX_SNAPSHOTS, SYSTEM_VIEWER, type ResumeBackupEntry } from '../../server/db'
// These suites exercise storage, not authorization: the unrestricted system
// viewer leaves every query unscoped, so they measure exactly what they
// measured before. Scoping has its own suite — tests/server/scoping.test.ts.
const V = SYSTEM_VIEWER


// Each test gets its own isolated in-memory database.
const freshDb = () => createResumeDb(':memory:')

describe('createResumeDb — file permissions', () => {
  // Best-effort: the connection keeps the file handle open, so Windows can't
  // unlink it mid-test. The assertions are what matter; tmp hygiene is not.
  const rmQuiet = (dir: string) => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  it('does not throw and produces a usable DB for a real file path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-db-'))
    const file = path.join(dir, 'resume.db')
    const db = createResumeDb(file)
    expect(db.listResumes(V)).toEqual([])
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
    // No group/other permission bits
    expect(mode & 0o077).toBe(0)
    rmQuiet(dir)
  })
})

describe('createResumeDb — storageStats', () => {
  const photo = `data:image/jpeg;base64,${'A'.repeat(2000)}`

  it('returns empty resumes and a positive db size on a fresh DB', () => {
    const db = freshDb()
    const stats = db.storageStats(V)
    expect(stats.resumes).toEqual([])
    expect(stats.db_bytes).toBeGreaterThan(0)
  })

  it('reports per-resume bytes and image share', () => {
    const db = freshDb()
    const plain = db.createResume(V, { name: 'Plain', data: { resume: { name: { en: 'CV' } } } })
    const heavy = db.createResume(V, { name: 'Heavy', data: { resume: { profile_photo: photo } } })
    const stats = db.storageStats(V)
    const plainStat = stats.resumes.find((r) => r.id === plain.id)!
    const heavyStat = stats.resumes.find((r) => r.id === heavy.id)!
    expect(plainStat.image_bytes).toBe(0)
    expect(plainStat.bytes).toBeGreaterThan(0)
    expect(heavyStat.image_bytes).toBe(photo.length)
    expect(heavyStat.bytes).toBeGreaterThan(heavyStat.image_bytes)
    expect(heavyStat.name).toBe('Heavy')
  })

  it('counts snapshots per resume, and snapshot bytes exclude stripped images', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'CV' })
    db.saveResume(V, meta.id, { resume: { profile_photo: photo, name: { en: 'v1' } } })
    const stat = db.storageStats(V).resumes.find((r) => r.id === meta.id)!
    expect(stat.snapshot_count).toBe(db.listSnapshots(V, meta.id).length)
    expect(stat.snapshot_count).toBeGreaterThan(0)
    // Snapshots are stored image-free, so their total stays far below the live row.
    expect(stat.snapshot_bytes).toBeLessThan(stat.bytes)
    expect(stat.snapshot_bytes).toBeGreaterThan(0)
  })
})

describe('createResumeDb — saved_by attribution (F10)', () => {
  it('stamps saved_by on the row and the snapshot', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Team CV' })
    expect(meta.saved_by).toBeNull()
    db.saveResume(V, meta.id, { v: 1 }, undefined, undefined, 'kari')
    expect(db.getResume(V, meta.id)!.meta.saved_by).toBe('kari')
    expect(db.listResumes(V)[0].saved_by).toBe('kari')
    expect(db.listSnapshots(V, meta.id)[0].saved_by).toBe('kari')
  })

  it('an anonymous save (no name) clears the previous attribution', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Team CV' })
    db.saveResume(V, meta.id, { v: 1 }, undefined, undefined, 'kari')
    db.saveResume(V, meta.id, { v: 2 })
    expect(db.getResume(V, meta.id)!.meta.saved_by).toBeNull()
    // History keeps each save's own author.
    const snaps = db.listSnapshots(V, meta.id)
    expect(snaps.map((s) => s.saved_by)).toEqual([null, 'kari'])
  })

  it('a restore-update clears saved_by (content now comes from the backup)', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Synced CV' })
    db.saveResume(V, meta.id, { v: 1 }, undefined, undefined, 'kari')
    db.restoreResumes(V, [{
      id: meta.id, name: 'Synced CV',
      primary_locale: 'en', secondary_locale: null,
      saved_at: '2099-01-01T00:00:00.000Z', created_at: meta.created_at,
      data: { v: 2 },
    }])
    expect(db.getResume(V, meta.id)!.meta.saved_by).toBeNull()
  })
})

describe('createResumeDb — resume CRUD', () => {
  it('lists no resumes on a fresh DB', () => {
    const db = freshDb()
    expect(db.listResumes(V)).toEqual([])
  })

  it('createResume returns metadata with a uuid id and timestamps', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Sales CV' })
    // UUID prefix
    expect(meta.id).toMatch(/^[0-9a-f]{8}-/)
    expect(meta.name).toBe('Sales CV')
    expect(meta.primary_locale).toBe('en')
    expect(meta.secondary_locale).toBeNull()
    expect(meta.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(meta.created_at).toBe(meta.saved_at)
  })

  it('createResume accepts initial data and locale preferences', () => {
    const db = freshDb()
    const meta = db.createResume(V, {
      name: 'Board CV',
      data: { resume: { full_name: 'Astrid' } },
      primary_locale: 'no',
      secondary_locale: 'en',
    })
    expect(meta.primary_locale).toBe('no')
    expect(meta.secondary_locale).toBe('en')

    const full = db.getResume(V, meta.id)
    expect(full?.data).toEqual({ resume: { full_name: 'Astrid' } })
    expect(full?.meta.primary_locale).toBe('no')
  })

  it('getResume returns null for an unknown id', () => {
    const db = freshDb()
    expect(db.getResume(V, 'does-not-exist')).toBeNull()
  })

  it('listResumes returns one row per resume, newest saved_at first', async () => {
    const db = freshDb()
    const a = db.createResume(V, { name: 'A' })
    await new Promise((r) => setTimeout(r, 5))
    const b = db.createResume(V, { name: 'B' })
    await new Promise((r) => setTimeout(r, 5))
    // Bumps B's saved_at past A's
    db.saveResume(V, b.id, { v: 1 })
    const list = db.listResumes(V)
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
  })

  it('saveResume reports not-found for an unknown id (no row created)', () => {
    const db = freshDb()
    expect(db.saveResume(V, 'bogus', { v: 1 })).toEqual({ status: 'not-found' })
    expect(db.listResumes(V)).toEqual([])
  })

  it('saveResume updates data and bumps saved_at', async () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    // Sleep a millisecond so ISO timestamps differ.
    await new Promise((r) => setTimeout(r, 5))
    const result = db.saveResume(V, meta.id, { v: 2 })
    expect(result.status).toBe('saved')
    const savedAt = result.status === 'saved' ? result.saved_at : null
    expect(savedAt).not.toBe(meta.saved_at)
    const full = db.getResume(V, meta.id)
    expect(full?.data).toEqual({ v: 2 })
    expect(full?.meta.saved_at).toBe(savedAt)
    // created_at is not touched.
    expect(full?.meta.created_at).toBe(meta.created_at)
  })

  it('saveResume can update locales alongside data', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    db.saveResume(V, meta.id, { v: 1 }, { primary_locale: 'no', secondary_locale: 'en' })
    const full = db.getResume(V, meta.id)
    expect(full?.meta.primary_locale).toBe('no')
    expect(full?.meta.secondary_locale).toBe('en')
  })

  it('saveResume without locales leaves them unchanged', () => {
    const db = freshDb()
    const meta = db.createResume(V, {
      name: 'Mine', primary_locale: 'no', secondary_locale: 'en',
    })
    // No locales arg
    db.saveResume(V, meta.id, { v: 1 })
    const full = db.getResume(V, meta.id)
    expect(full?.meta.primary_locale).toBe('no')
    expect(full?.meta.secondary_locale).toBe('en')
  })

  it('renameResume updates the name and reports whether it matched', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Old' })
    expect(db.renameResume(V, meta.id, 'New')).toBe(true)
    expect(db.getResume(V, meta.id)?.meta.name).toBe('New')
    expect(db.renameResume(V, 'bogus', 'whatever')).toBe(false)
  })

  it('deleteResume removes the row and reports whether it matched', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Doomed' })
    expect(db.deleteResume(V, meta.id)).toBe(true)
    expect(db.getResume(V, meta.id)).toBeNull()
    expect(db.deleteResume(V, meta.id)).toBe(false)
  })
})

describe('createResumeDb — versioning & optimistic concurrency', () => {
  it('starts at version 1 and exposes it on create/get/list', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'CV' })
    expect(meta.version).toBe(1)
    expect(db.getResume(V, meta.id)?.meta.version).toBe(1)
    expect(db.listResumes(V)[0].version).toBe(1)
  })

  it('bumps the version by 1 on every successful save', () => {
    const db = freshDb()
    const { id } = db.createResume(V, { name: 'CV' })
    const r1 = db.saveResume(V, id, { v: 1 })
    const r2 = db.saveResume(V, id, { v: 2 })
    expect(r1).toEqual(expect.objectContaining({ status: 'saved', version: 2 }))
    expect(r2).toEqual(expect.objectContaining({ status: 'saved', version: 3 }))
    expect(db.getResume(V, id)?.meta.version).toBe(3)
  })

  it('accepts a save whose expectedVersion matches the current version', () => {
    const db = freshDb()
    // Version 1
    const { id } = db.createResume(V, { name: 'CV' })
    const r = db.saveResume(V, id, { v: 1 }, undefined, 1)
    expect(r.status).toBe('saved')
    expect(db.getResume(V, id)?.meta.version).toBe(2)
  })

  it('rejects a save with a stale expectedVersion and writes nothing', () => {
    const db = freshDb()
    const { id } = db.createResume(V, { name: 'CV', data: { original: true } })
    // Version → 2
    db.saveResume(V, id, { v: 2 })
    // A second writer still thinks the base is 1.
    const r = db.saveResume(V, id, { iLose: true }, undefined, 1)
    expect(r.status).toBe('conflict')
    if (r.status === 'conflict') {
      // The conflict carries the live server state for diffing…
      expect(r.current.meta.version).toBe(2)
      expect(r.current.data).toEqual({ v: 2 })
    }
    // …and nothing was written: data + version unchanged.
    expect(db.getResume(V, id)?.data).toEqual({ v: 2 })
    expect(db.getResume(V, id)?.meta.version).toBe(2)
  })

  it('a conflict does NOT append a snapshot', () => {
    const db = freshDb()
    const { id } = db.createResume(V, { name: 'CV' })
    // Version 2, 1 snapshot
    db.saveResume(V, id, { v: 2 })
    const before = db.listSnapshots(V, id).length
    // Conflict
    db.saveResume(V, id, { stale: true }, undefined, 1)
    expect(db.listSnapshots(V, id).length).toBe(before)
  })

  it('omitting expectedVersion force-writes regardless of the current version', () => {
    const db = freshDb()
    const { id } = db.createResume(V, { name: 'CV' })
    // Version → 2
    db.saveResume(V, id, { v: 2 })
    // No expectedVersion
    const r = db.saveResume(V, id, { forced: true })
    expect(r).toEqual(expect.objectContaining({ status: 'saved', version: 3 }))
    expect(db.getResume(V, id)?.data).toEqual({ forced: true })
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
    const raw = new DatabaseSync(file)
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
    const full = db.getResume(V, 'old-1')
    // Back-filled default
    expect(full?.meta.version).toBe(1)
    // Data preserved, not dropped
    expect(full?.data).toEqual({ hello: 'world' })

    // And concurrency works from there: base 1 saves, base 1 then conflicts.
    expect(db.saveResume(V, 'old-1', { hello: 'again' }, undefined, 1).status).toBe('saved')
    expect(db.saveResume(V, 'old-1', { stale: true }, undefined, 1).status).toBe('conflict')

    rmQuiet(dir)
  })
})

describe('createResumeDb — snapshot history', () => {
  it('appends one snapshot per distinct save, newest first', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    db.saveResume(V, meta.id, { v: 1 })
    db.saveResume(V, meta.id, { v: 2 })
    const snaps = db.listSnapshots(V, meta.id)
    expect(snaps).toHaveLength(2)
    expect(snaps[0].id).toBeGreaterThan(snaps[1].id)
    expect(db.getSnapshot(V, meta.id, snaps[0].id)).toEqual({ v: 2 })
    expect(db.getSnapshot(V, meta.id, snaps[1].id)).toEqual({ v: 1 })
  })

  it('skips a snapshot identical to the most recent one for that resume', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    db.saveResume(V, meta.id, { v: 1 })
    // Identical → deduped
    db.saveResume(V, meta.id, { v: 1 })
    expect(db.listSnapshots(V, meta.id)).toHaveLength(1)
  })

  it('dedupes only against the most recent snapshot, not whole history', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    db.saveResume(V, meta.id, { v: 1 })
    db.saveResume(V, meta.id, { v: 2 })
    // Differs from {v:2} → recorded
    db.saveResume(V, meta.id, { v: 1 })
    expect(db.listSnapshots(V, meta.id)).toHaveLength(3)
  })

  it('reports size and id metadata', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    db.saveResume(V, meta.id, { hello: 'world' })
    const [snap] = db.listSnapshots(V, meta.id)
    expect(snap.size).toBe(JSON.stringify({ hello: 'world' }).length)
    expect(Number.isInteger(snap.id)).toBe(true)
  })

  it(`prunes to the newest ${MAX_SNAPSHOTS} snapshots per resume`, () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    const total = MAX_SNAPSHOTS + 5
    for (let i = 0; i < total; i++) db.saveResume(V, meta.id, { n: i })
    const snaps = db.listSnapshots(V, meta.id)
    expect(snaps).toHaveLength(MAX_SNAPSHOTS)
    expect(db.getSnapshot(V, meta.id, snaps[0].id)).toEqual({ n: total - 1 })
  })

  it('snapshot pruning is scoped per resume — does not touch siblings', () => {
    const db = freshDb()
    const a = db.createResume(V, { name: 'A' })
    const b = db.createResume(V, { name: 'B' })
    // One snapshot for B.
    db.saveResume(V, b.id, { from: 'b' })
    // Overflow A past the cap.
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) db.saveResume(V, a.id, { n: i })

    expect(db.listSnapshots(V, a.id)).toHaveLength(MAX_SNAPSHOTS)
    // B's single snapshot is intact.
    const bSnaps = db.listSnapshots(V, b.id)
    expect(bSnaps).toHaveLength(1)
    expect(db.getSnapshot(V, b.id, bSnaps[0].id)).toEqual({ from: 'b' })
  })

  it('listSnapshots and getSnapshot scope by resume_id', () => {
    const db = freshDb()
    const a = db.createResume(V, { name: 'A' })
    const b = db.createResume(V, { name: 'B' })
    db.saveResume(V, a.id, { from: 'a' })
    db.saveResume(V, b.id, { from: 'b' })

    const aSnaps = db.listSnapshots(V, a.id)
    expect(aSnaps).toHaveLength(1)
    expect(db.getSnapshot(V, a.id, aSnaps[0].id)).toEqual({ from: 'a' })
    // Looking up A's snapshot id under B returns null (cross-resume isolation).
    expect(db.getSnapshot(V, b.id, aSnaps[0].id)).toBeNull()
  })

  it('deleting a resume cascades its snapshots', () => {
    const db = freshDb()
    const a = db.createResume(V, { name: 'A' })
    const b = db.createResume(V, { name: 'B' })
    db.saveResume(V, a.id, { v: 1 })
    db.saveResume(V, a.id, { v: 2 })
    db.saveResume(V, b.id, { v: 1 })

    db.deleteResume(V, a.id)
    expect(db.listSnapshots(V, a.id)).toEqual([])
    // B is untouched.
    expect(db.listSnapshots(V, b.id)).toHaveLength(1)
  })

  it('returns null for an unknown snapshot id', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    db.saveResume(V, meta.id, { v: 1 })
    expect(db.getSnapshot(V, meta.id, 9999)).toBeNull()
  })
})

describe('createResumeDb — snapshots strip embedded images', () => {
  // A store shaped like the client's, with every image field populated.
  const imageStore = (photo: string) => ({
    resume: { full_name: 'Kari', profile_photo: photo, company_logo: 'data:image/png;base64,LOGO' },
    projects: [{ id: 'p1', customer: { en: 'Acme' } }],
    views: [
      {
        id: 'v1',
        name: 'Board CV',
        header: { photo_override: 'data:image/jpeg;base64,OVR', logo_override: 'data:image/png;base64,LOVR', separator: ' | ' },
      },
    ],
  })

  it('the live row keeps images; the snapshot copy drops them, other fields intact', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    db.saveResume(V, meta.id, imageStore('data:image/jpeg;base64,AAA'))

    // Live row: untouched, images included.
    const live = db.getResume(V, meta.id)!.data as ReturnType<typeof imageStore>
    expect(live.resume.profile_photo).toBe('data:image/jpeg;base64,AAA')
    expect(live.views[0].header.photo_override).toBe('data:image/jpeg;base64,OVR')

    // Snapshot: image fields absent, everything else preserved.
    const [snap] = db.listSnapshots(V, meta.id)
    const data = db.getSnapshot(V, meta.id, snap.id) as ReturnType<typeof imageStore>
    expect(data.resume.full_name).toBe('Kari')
    expect(data.projects).toEqual([{ id: 'p1', customer: { en: 'Acme' } }])
    expect(data.views[0].header.separator).toBe(' | ')
    expect('profile_photo' in data.resume).toBe(false)
    expect('company_logo' in data.resume).toBe(false)
    expect('photo_override' in data.views[0].header).toBe(false)
    expect('logo_override' in data.views[0].header).toBe(false)
  })

  it('an image-only change saves the live row without minting a snapshot', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    db.saveResume(V, meta.id, imageStore('data:image/jpeg;base64,AAA'))
    // Only the photo differs
    db.saveResume(V, meta.id, imageStore('data:image/jpeg;base64,BBB'))

    expect(db.listSnapshots(V, meta.id)).toHaveLength(1)
    const live = db.getResume(V, meta.id)!.data as ReturnType<typeof imageStore>
    // Live row did update
    expect(live.resume.profile_photo).toBe('data:image/jpeg;base64,BBB')
  })

  it('does not mutate the caller’s data object', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Mine' })
    const store = imageStore('data:image/jpeg;base64,AAA')
    db.saveResume(V, meta.id, store)
    expect(store.resume.profile_photo).toBe('data:image/jpeg;base64,AAA')
    expect(store.views[0].header.logo_override).toBe('data:image/png;base64,LOVR')
  })

  it('restoreResumes also stores image-free snapshots (live rows keep images)', () => {
    const source = freshDb()
    const meta = source.createResume(V, { name: 'Synced' })
    source.saveResume(V, meta.id, imageStore('data:image/jpeg;base64,AAA'))

    const target = freshDb()
    target.restoreResumes(V, source.dumpResumes(V))

    const live = target.getResume(V, meta.id)!.data as ReturnType<typeof imageStore>
    expect(live.resume.profile_photo).toBe('data:image/jpeg;base64,AAA')
    const [snap] = target.listSnapshots(V, meta.id)
    const data = target.getSnapshot(V, meta.id, snap.id) as ReturnType<typeof imageStore>
    expect('profile_photo' in data.resume).toBe(false)
    expect('photo_override' in data.views[0].header).toBe(false)
  })

  it('handles malformed shapes gracefully (no resume / odd views)', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'Odd' })
    db.saveResume(V, meta.id, { resume: null, views: [null, 42, { id: 'x' }] })
    const [snap] = db.listSnapshots(V, meta.id)
    expect(db.getSnapshot(V, meta.id, snap.id)).toEqual({ resume: null, views: [null, 42, { id: 'x' }] })
  })
})

describe('createResumeDb — dumpResumes / restoreResumes (store sync)', () => {
  it('dumpResumes returns portable entries for every resume', () => {
    const db = freshDb()
    const a = db.createResume(V, { name: 'A', data: { x: 1 }, primary_locale: 'no', secondary_locale: 'en' })
    db.createResume(V, { name: 'B', data: { y: 2 } })
    const dump = db.dumpResumes(V)
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
    const a = src.createResume(V, { name: 'A', data: { hello: 'world' } })
    const dst = freshDb()
    const summary = dst.restoreResumes(V, src.dumpResumes(V))
    expect(summary).toMatchObject({ inserted: 1, updated: 0, skipped: 0, deleted: 0 })
    const full = dst.getResume(V, a.id)
    expect(full?.meta.name).toBe('A')
    expect(full?.data).toEqual({ hello: 'world' })
    expect(full?.meta.version).toBe(1)
  })

  it('merge keeps the local copy when it is newer (incoming older → skip)', () => {
    const db = freshDb()
    const a = db.createResume(V, { name: 'A' })
    // Advances saved_at
    db.saveResume(V, a.id, { local: 'newer' })
    const local = db.getResume(V, a.id)!
    const incoming: ResumeBackupEntry = {
      ...local.meta,
      created_at: local.meta.created_at,
      // Older
      saved_at: '2000-01-01T00:00:00.000Z',
      data: { remote: 'older' },
    }
    const summary = db.restoreResumes(V, [incoming])
    expect(summary).toMatchObject({ inserted: 0, updated: 0, skipped: 1 })
    expect(db.getResume(V, a.id)?.data).toEqual({ local: 'newer' })
  })

  it('merge takes the incoming copy when it is newer (update + snapshot)', () => {
    const db = freshDb()
    const a = db.createResume(V, { name: 'A', data: { v: 'old' } })
    const snapsBefore = db.listSnapshots(V, a.id).length
    const incoming: ResumeBackupEntry = {
      id: a.id, name: 'A (edited elsewhere)',
      primary_locale: 'en', secondary_locale: null,
      created_at: a.created_at,
      // Far future → wins
      saved_at: '2999-01-01T00:00:00.000Z',
      data: { v: 'new' },
    }
    const summary = db.restoreResumes(V, [incoming])
    expect(summary).toMatchObject({ inserted: 0, updated: 1, skipped: 0 })
    const full = db.getResume(V, a.id)!
    expect(full.data).toEqual({ v: 'new' })
    expect(full.meta.name).toBe('A (edited elsewhere)')
    // Preserves source timestamp
    expect(full.meta.saved_at).toBe('2999-01-01T00:00:00.000Z')
    // Bumped
    expect(full.meta.version).toBe(2)
    // Restore is reversible
    expect(db.listSnapshots(V, a.id).length).toBe(snapsBefore + 1)
  })

  it('merge is idempotent — re-restoring the same dump changes nothing', () => {
    const src = freshDb()
    src.createResume(V, { name: 'A', data: { a: 1 } })
    src.createResume(V, { name: 'B', data: { b: 2 } })
    const dump = src.dumpResumes(V)
    const dst = freshDb()
    dst.restoreResumes(V, dump)
    const second = dst.restoreResumes(V, dump)
    expect(second).toMatchObject({ inserted: 0, updated: 0, skipped: 2, deleted: 0 })
  })

  it('merge never deletes local-only resumes', () => {
    const db = freshDb()
    const keep = db.createResume(V, { name: 'LocalOnly' })
    // Empty incoming
    db.restoreResumes(V, [])
    expect(db.getResume(V, keep.id)).not.toBeNull()
  })

  it('replace mode deletes local resumes absent from the incoming set', () => {
    const db = freshDb()
    const gone = db.createResume(V, { name: 'Gone' })
    const kept = db.createResume(V, { name: 'Kept', data: { k: 1 } })
    const incoming = db.dumpResumes(V).filter((e) => e.id === kept.id)
    const summary = db.restoreResumes(V, incoming, { mode: 'replace' })
    expect(summary.deleted).toBe(1)
    expect(db.getResume(V, gone.id)).toBeNull()
    expect(db.getResume(V, kept.id)).not.toBeNull()
  })
})

/**
 * `ResumeMeta.email` — the CV header's email surfaced into the LIST via
 * json_extract, so the client can derive each resume's readable URL
 * (`lib/resumeSlug.ts`) without fetching every document. One source of truth:
 * it reads the JSON blob, so an edit to the header is visible on the very
 * next list with no second field to keep in step.
 */
describe('createResumeDb — meta email (readable-URL source)', () => {
  it('extracts data.resume.email into list rows and getResume meta', () => {
    const db = freshDb()
    const { id } = db.createResume(V, { name: 'CV', data: { resume: { email: 'kari@corp.no' } } })
    expect(db.listResumes(V)[0].email).toBe('kari@corp.no')
    expect(db.getResume(V, id)?.meta.email).toBe('kari@corp.no')
    db.close()
  })

  it('tracks a header edit — the email is read from the document, never copied', () => {
    const db = freshDb()
    const { id } = db.createResume(V, { name: 'CV', data: { resume: { email: 'old@corp.no' } } })
    db.saveResume(V, id, { resume: { email: 'new@corp.no' } })
    expect(db.listResumes(V)[0].email).toBe('new@corp.no')
    db.close()
  })

  it('answers null for a missing, empty, or non-string value', () => {
    const db = freshDb()
    db.createResume(V, { name: 'none', data: {} })
    db.createResume(V, { name: 'empty', data: { resume: { email: '  ' } } })
    // Imported JSON can hold anything at that path.
    db.createResume(V, { name: 'weird', data: { resume: { email: 42 } } })
    expect(db.listResumes(V).map((r) => r.email)).toEqual([null, null, null])
    db.close()
  })

  it('createResume itself reports the carried email in its returned meta', () => {
    const db = freshDb()
    const meta = db.createResume(V, { name: 'CV', data: { resume: { email: 'ny@corp.no' } } })
    expect(meta.email).toBe('ny@corp.no')
    expect(db.createResume(V, { name: 'blank' }).email).toBeNull()
    db.close()
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
    db.createResume(V, { name: 'A' })
    expect(() => db.close()).not.toThrow()
    // Reopening sees the persisted row (data survived the checkpoint+close).
    const reopened = createResumeDb(file)
    expect(reopened.listResumes(V)).toHaveLength(1)
    reopened.close()
    rmQuiet(dir)
  })

  it('close() is safe on an in-memory DB', () => {
    const db = freshDb()
    expect(() => db.close()).not.toThrow()
  })
})

/**
 * Upgrading a database written by an OLDER install.
 *
 * These exercise a real file on disk rather than ':memory:', because that is
 * where the risk actually lives: storage moved from better-sqlite3 to
 * `node:sqlite` (server/sqlite.ts), and the connection-level settings that
 * carry real consequences — foreign keys, journal mode, the checkpoint on
 * close — are applied via PRAGMA, which is exactly the kind of thing a driver
 * swap can silently stop honouring. None of them fail loudly when dropped: FKs
 * off means orphaned snapshot rows, and journal mode is the documented guard
 * against corrupting a DB kept in a cloud-synced folder.
 */
describe('createResumeDb — upgrading an existing database file', () => {
  const rmQuiet = (dir: string) => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  /** A DB as an install predating `version`, `saved_by` and multi-resume left it. */
  const writeLegacyDb = (file: string) => {
    const legacy = new DatabaseSync(file)
    legacy.exec('PRAGMA journal_mode = WAL')
    // The pre-multi-resume table createResumeDb drops on sight.
    legacy.exec('CREATE TABLE resume_store (id INTEGER PRIMARY KEY, data TEXT)')
    legacy.exec("INSERT INTO resume_store VALUES (1, '{\"legacy\":true}')")
    legacy.exec(`CREATE TABLE resumes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL,
      primary_locale TEXT NOT NULL DEFAULT 'en', secondary_locale TEXT,
      saved_at TEXT NOT NULL, created_at TEXT NOT NULL)`)
    legacy.exec(`CREATE TABLE resume_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      data TEXT NOT NULL, saved_at TEXT NOT NULL)`)
    legacy.prepare('INSERT INTO resumes VALUES (?,?,?,?,?,?,?)')
      .run('r1', 'My CV', '{"shape_version":9}', 'no', 'en', '2026-01-01', '2026-01-01')
    legacy.prepare('INSERT INTO resume_snapshots (resume_id, data, saved_at) VALUES (?,?,?)')
      .run('r1', '{"old":"snap"}', '2026-01-01')
    legacy.close()
  }

  it('migrates a legacy file in place, keeping every resume and snapshot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-upg-'))
    const file = path.join(dir, 'resume.db')
    writeLegacyDb(file)

    const db = createResumeDb(file)
    // The added columns take their defaults rather than nulling the row out:
    // an in-flight client must see a clean first save, not version undefined.
    // A row that predates accounts is unowned and private — which means the
    // bootstrap must claim it, not that it is everybody's (see server/access.ts).
    expect(db.listResumes(V)).toEqual([{
      id: 'r1', name: 'My CV', primary_locale: 'no', secondary_locale: 'en',
      saved_at: '2026-01-01', created_at: '2026-01-01', version: 1, saved_by: null,
      owner_id: null, visibility: 'private', email: null,
    }])
    expect(db.getResume(V, 'r1')?.data).toEqual({ shape_version: 9 })
    expect(db.listSnapshots(V, 'r1')).toHaveLength(1)

    // The migrated file is writable, and versioning starts from the default.
    expect(db.saveResume(V, 'r1', { shape_version: 9, x: 1 })).toMatchObject({ status: 'saved', version: 2 })
    db.close()
    rmQuiet(dir)
  })

  it('drops the pre-multi-resume resume_store table', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-upg-drop-'))
    const file = path.join(dir, 'resume.db')
    writeLegacyDb(file)

    const db = createResumeDb(file)
    db.close()

    const check = new DatabaseSync(file)
    const stale = check.prepare("SELECT name FROM sqlite_master WHERE name = 'resume_store'").get()
    check.close()
    expect(stale).toBeUndefined()
    rmQuiet(dir)
  })

  it('enforces foreign keys on a migrated file, so deletes leave no orphan snapshots', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-upg-fk-'))
    const file = path.join(dir, 'resume.db')
    writeLegacyDb(file)

    const db = createResumeDb(file)
    expect(db.listSnapshots(V, 'r1')).toHaveLength(1)
    expect(db.deleteResume(V, 'r1')).toBe(true)
    db.close()

    // Read with a fresh connection: an orphan row is invisible through the API
    // that just deleted its parent, so assert against the table itself.
    const check = new DatabaseSync(file)
    const { c } = check.prepare('SELECT count(*) c FROM resume_snapshots').get() as { c: number }
    check.close()
    expect(c).toBe(0)
    rmQuiet(dir)
  })

  it('leaves no -wal/-shm sidecars behind after close()', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-upg-wal-'))
    const file = path.join(dir, 'resume.db')
    writeLegacyDb(file)

    const db = createResumeDb(file)
    db.saveResume(V, 'r1', { shape_version: 9, y: 2 })
    db.close()

    // The point of the checkpoint on close: the .db is self-contained at rest,
    // which is what makes it safe for a backup (or a cloud sync client) to copy.
    expect(fs.readdirSync(dir).sort()).toEqual(['resume.db'])
    rmQuiet(dir)
  })

  /**
   * Asserted through the sidecars rather than `PRAGMA journal_mode`, because
   * only WAL records the mode IN THE FILE — the rollback modes are a property
   * of the connection, so a fresh connection always reports the default and an
   * assertion on it would pass or fail for the wrong reason. The sidecars are
   * also the thing the setting actually exists to control.
   */
  it('defaults to WAL, which keeps a -wal sidecar while the DB is open', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-upg-wal2-'))
    const file = path.join(dir, 'resume.db')

    const db = createResumeDb(file)
    db.createResume(V, { name: 'A' })
    expect(fs.existsSync(`${file}-wal`)).toBe(true)
    db.close()
    rmQuiet(dir)
  })

  it('honours RESUME_DB_JOURNAL=TRUNCATE for a DB kept in a cloud-synced folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-upg-journal-'))
    const file = path.join(dir, 'resume.db')
    vi.stubEnv('RESUME_DB_JOURNAL', 'TRUNCATE')

    const db = createResumeDb(file)
    db.createResume(V, { name: 'A' })
    // The whole point: no long-lived sidecar for a sync client to upload at an
    // inconsistent moment, which is how a cloud-synced DB gets corrupted.
    expect(fs.existsSync(`${file}-wal`)).toBe(false)
    db.close()
    vi.unstubAllEnvs()
    rmQuiet(dir)
  })
})
