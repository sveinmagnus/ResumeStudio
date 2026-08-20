/**
 * The destructive-condition drill.
 *
 * Every other server test asks whether the happy path works. These ask what
 * happens when the disk lies: a database damaged by a bad shutdown or a cloud
 * sync, a JSON file caught half-written, a directory that cannot be written.
 *
 * The distinction that matters throughout is between failing LOUDLY and
 * failing DESTRUCTIVELY. A damaged database must refuse to open — the one
 * unacceptable outcome is quietly starting fresh, because to a user that is
 * indistinguishable from "the app deleted my CVs", and it would overwrite the
 * file a specialist could still have recovered.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createResumeDb, isCorruptDbError, SYSTEM_VIEWER, describeCorruptDb } from '../../server/db'
// These suites exercise storage, not authorization: the unrestricted system
// viewer leaves every query unscoped, so they measure exactly what they
// measured before. Scoping has its own suite — tests/server/scoping.test.ts.
const V = SYSTEM_VIEWER

import { scanBackupDir, writeResumeFiles } from '../../server/backupFiles'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rs-drill-'))

/** A real, populated database file to damage in different ways. */
function realDbBytes(dir: string): Buffer {
  const file = path.join(dir, 'source.db')
  const db = createResumeDb(file)
  db.createResume(V, { name: 'Drill', data: { projects: [{ id: 'p1' }], shape_version: 14 } })
  db.close()
  return fs.readFileSync(file)
}

describe('a damaged database refuses to open rather than starting fresh', () => {
  it('rejects a file that is not a database at all', () => {
    const dir = tmp()
    const file = path.join(dir, 'resume.db')
    fs.writeFileSync(file, 'this is definitely not sqlite')

    let thrown: unknown
    try { createResumeDb(file) } catch (err) { thrown = err }

    expect(thrown, 'a non-database file opened without complaint').toBeDefined()
    expect(isCorruptDbError(thrown)).toBe(true)
    // The evidence is untouched: nothing renamed it, truncated it, or replaced
    // it with an empty database to get a clean boot.
    expect(fs.readFileSync(file, 'utf8')).toBe('this is definitely not sqlite')
  })

  it('rejects a truncated database (an interrupted copy or sync)', () => {
    const dir = tmp()
    const bytes = realDbBytes(dir)
    const file = path.join(dir, 'truncated.db')
    fs.writeFileSync(file, bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 3))))

    let thrown: unknown
    try { const db = createResumeDb(file); db.listResumes(V) } catch (err) { thrown = err }

    expect(thrown, 'a truncated database was read as if intact').toBeDefined()
    expect(isCorruptDbError(thrown)).toBe(true)
  })

  it('rejects a database with corrupted pages (bit rot / a bad sector)', () => {
    const dir = tmp()
    const copy = Buffer.from(realDbBytes(dir))
    // Past the header, so the failure is damaged CONTENT rather than an
    // unrecognisable file — the case a naive "is the header right?" check
    // would wave through.
    for (let i = 200; i < Math.min(copy.length, 4000); i += 7) copy[i] ^= 0xff
    const file = path.join(dir, 'flipped.db')
    fs.writeFileSync(file, copy)

    let thrown: unknown
    try { const db = createResumeDb(file); db.listResumes(V) } catch (err) { thrown = err }

    expect(thrown, 'corrupted pages were read as if intact').toBeDefined()
    expect(isCorruptDbError(thrown)).toBe(true)
  })

  it('treats a zero-byte file as a fresh database, which is correct', () => {
    // Not corruption: an empty file is what an interrupted first-run create
    // leaves behind, and SQLite legitimately initialises into it. Refusing
    // here would strand a user whose very first launch was interrupted.
    const dir = tmp()
    const file = path.join(dir, 'empty.db')
    fs.writeFileSync(file, '')

    const db = createResumeDb(file)
    expect(db.listResumes(V)).toEqual([])
    db.close()
  })
})

describe('isCorruptDbError only claims the failures it can actually identify', () => {
  it('recognises the SQLite damage messages', () => {
    for (const message of [
      'file is not a database',
      'database disk image is malformed',
      'malformed database schema (?)',
      'SQLITE_CORRUPT: database corruption detected',
    ]) {
      expect(isCorruptDbError(new Error(message)), message).toBe(true)
    }
  })

  it('does NOT claim failures that are fixable in place', () => {
    // Misclassifying any of these would tell a user their data is damaged when
    // the real problem is a path, a permission, or another process — and would
    // send them looking for backups they do not need.
    for (const message of [
      'ENOENT: no such file or directory',
      'EACCES: permission denied',
      'EPERM: operation not permitted',
      'database is locked',
      'unable to open database file',
      'attempt to write a readonly database',
    ]) {
      expect(isCorruptDbError(new Error(message)), message).toBe(false)
    }
    expect(isCorruptDbError(undefined)).toBe(false)
    expect(isCorruptDbError('a string, not an Error')).toBe(false)
  })
})

describe('a half-written sync file does not poison the folder', () => {
  it('quarantines unreadable files and still reads the intact ones', () => {
    const dir = tmp()
    const entry = {
      id: 'r1',
      name: 'Intact CV',
      data: { shape_version: 14, projects: [] },
      saved_at: '2026-08-01T10:00:00.000Z',
      created_at: '2026-08-01T09:00:00.000Z',
      primary_locale: 'en',
      secondary_locale: null,
      version: 1,
    }
    writeResumeFiles(dir, [entry], [])

    // A second machine's file caught mid-write by a cloud sync: valid name,
    // truncated JSON.
    const good = fs.readdirSync(dir).find((f) => f.includes('r1'))!
    const partial = fs.readFileSync(path.join(dir, good), 'utf8').slice(0, 80)
    fs.writeFileSync(path.join(dir, 'other-cv__r2.json'), partial)

    const scan = scanBackupDir(dir)

    // The intact resume is still readable — one bad file must not cost the
    // user the rest of the folder.
    expect(scan.resumes.map((r) => r.id)).toContain('r1')
    // And the broken one is reported rather than silently skipped, which is
    // what holds the change gate back so the next tick retries it.
    expect(scan.unreadable.length).toBeGreaterThan(0)
  })

  it('ignores files that are not ours at all', () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not json')
    fs.writeFileSync(path.join(dir, 'unrelated.json'), JSON.stringify({ hello: 'world' }))

    const scan = scanBackupDir(dir)
    expect(scan.resumes).toEqual([])
  })
})

describe('a write that cannot complete leaves the previous file intact', () => {
  it('does not destroy the existing file when the directory is gone', () => {
    const dir = tmp()
    const entry = {
      id: 'r1',
      name: 'CV',
      data: { shape_version: 14, projects: [] },
      saved_at: '2026-08-01T10:00:00.000Z',
      created_at: '2026-08-01T09:00:00.000Z',
      primary_locale: 'en',
      secondary_locale: null,
      version: 1,
    }
    writeResumeFiles(dir, [entry], [])
    const written = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(written.length).toBeGreaterThan(0)

    // The sync folder disappears mid-session — an unmounted drive, a signed-out
    // cloud client. The write must fail without taking anything with it.
    fs.rmSync(dir, { recursive: true, force: true })
    let thrown: unknown
    try { writeResumeFiles(dir, [entry], []) } catch (err) { thrown = err }

    // Either it recreated the folder or it refused; what it must NOT do is
    // report success while writing nothing, which would let the scheduler
    // believe the folder is current.
    if (!thrown) {
      expect(fs.existsSync(dir), 'reported success but wrote nothing').toBe(true)
      expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length).toBeGreaterThan(0)
    } else {
      expect(thrown).toBeInstanceOf(Error)
    }
  })
})

describe('describeCorruptDb — one explanation, two entry points', () => {
  const err = new Error('file is not a database')

  it('names the file and the reason', () => {
    const text = describeCorruptDb('/data/resume.db', err).join('\n')
    expect(text).toContain('/data/resume.db')
    expect(text).toContain('file is not a database')
  })

  it('says the file was left alone, which is the decision being explained', () => {
    // Starting fresh would be indistinguishable from "the app deleted my CVs",
    // so the refusal is the feature and the message has to say so.
    expect(describeCorruptDb('/data/resume.db', err).join('\n'))
      .toMatch(/NOT been changed or deleted/)
  })

  it('points at the sync folder when there is one', () => {
    const text = describeCorruptDb('/data/resume.db', err, '/cloud/sync').join('\n')
    expect(text).toContain('/cloud/sync')
  })

  it('falls back to importing a backup when there is not', () => {
    const text = describeCorruptDb('/data/resume.db', err, null).join('\n')
    expect(text).toMatch(/import your most recent backup/)
    expect(text).not.toContain('sync folder')
  })
})
