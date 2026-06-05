import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  BACKUP_FILENAME, buildStoreBackup, isStoreBackup, parseStoreBackup,
  backupSignature, writeBackupAtomic, readBackupFile, UnreadableBackupError,
} from '../../server/backup'
import type { ResumeBackupEntry } from '../../server/db'

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

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rs-bk-'))
const rmQuiet = (d: string) => { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }

describe('buildStoreBackup', () => {
  it('wraps entries in the versioned envelope', () => {
    const b = buildStoreBackup([entry()])
    expect(b.$schema).toBe('resumestudio-store/v1')
    expect(b.format_version).toBe(1)
    expect(b.generator).toBe('resume-studio')
    expect(typeof b.exported_at).toBe('string')
    expect(b.resumes).toHaveLength(1)
  })
})

describe('isStoreBackup', () => {
  it('accepts a well-formed envelope', () => {
    expect(isStoreBackup(buildStoreBackup([entry()]))).toBe(true)
  })
  it('rejects non-objects and the per-resume client backup format', () => {
    expect(isStoreBackup(null)).toBe(false)
    expect(isStoreBackup({})).toBe(false)
    // The single-resume client backup uses the `resumestudio/` schema prefix.
    expect(isStoreBackup({ $schema: 'resumestudio/v1', format_version: 1, profile: null, sections: {} })).toBe(false)
    expect(isStoreBackup({ $schema: 'resumestudio-store/v1', format_version: 1 })).toBe(false) // no resumes[]
  })
})

describe('parseStoreBackup', () => {
  it('returns the entries for a valid backup', () => {
    const entries = parseStoreBackup(buildStoreBackup([entry(), entry({ id: 'r2' })]))
    expect(entries.map((e) => e.id)).toEqual(['r1', 'r2'])
  })
  it('throws UnreadableBackupError for a non-backup', () => {
    expect(() => parseStoreBackup({ hello: 'world' })).toThrow(UnreadableBackupError)
  })
  it('throws for an unsupported future format_version', () => {
    const future = { ...buildStoreBackup([entry()]), format_version: 2 }
    expect(() => parseStoreBackup(future)).toThrow(/format_version 2/)
  })
  it('throws for a malformed resume entry', () => {
    const bad = { ...buildStoreBackup([]), resumes: [{ id: 'x' }] } // missing saved_at/data
    expect(() => parseStoreBackup(bad)).toThrow(UnreadableBackupError)
  })
})

describe('backupSignature', () => {
  it('is order-independent and keys on id + saved_at', () => {
    const a = backupSignature([entry({ id: 'a' }), entry({ id: 'b', saved_at: '2026-02-02T00:00:00.000Z' })])
    const b = backupSignature([entry({ id: 'b', saved_at: '2026-02-02T00:00:00.000Z' }), entry({ id: 'a' })])
    expect(a).toBe(b)
  })
  it('changes when a saved_at advances', () => {
    const before = backupSignature([entry()])
    const after = backupSignature([entry({ saved_at: '2026-03-03T00:00:00.000Z' })])
    expect(before).not.toBe(after)
  })
})

describe('writeBackupAtomic / readBackupFile', () => {
  it('round-trips through a real file and creates the dir', () => {
    const root = tmp()
    const dir = path.join(root, 'nested', 'sync') // does not exist yet
    const res = writeBackupAtomic(dir, buildStoreBackup([entry(), entry({ id: 'r2' })]))
    expect(res.file).toBe(path.join(dir, BACKUP_FILENAME))
    expect(res.bytes).toBeGreaterThan(0)
    expect(fs.existsSync(res.file)).toBe(true)

    const back = readBackupFile(dir)
    expect(back?.map((e) => e.id)).toEqual(['r1', 'r2'])
    rmQuiet(root)
  })

  it('leaves no temp files behind', () => {
    const dir = tmp()
    writeBackupAtomic(dir, buildStoreBackup([entry()]))
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
    rmQuiet(dir)
  })

  it('overwrites in place on a second write (stable filename)', () => {
    const dir = tmp()
    writeBackupAtomic(dir, buildStoreBackup([entry()]))
    writeBackupAtomic(dir, buildStoreBackup([entry({ id: 'r1' }), entry({ id: 'r2' })]))
    expect(fs.readdirSync(dir).filter((f) => f === BACKUP_FILENAME)).toHaveLength(1)
    expect(readBackupFile(dir)).toHaveLength(2)
    rmQuiet(dir)
  })

  it('readBackupFile returns null when no file exists', () => {
    const dir = tmp()
    expect(readBackupFile(dir)).toBeNull()
    rmQuiet(dir)
  })

  it('readBackupFile throws UnreadableBackupError on invalid JSON', () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, BACKUP_FILENAME), '{ not json')
    expect(() => readBackupFile(dir)).toThrow(UnreadableBackupError)
    rmQuiet(dir)
  })
})
