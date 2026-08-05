import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  REGISTRY_FILENAME, TOMBSTONE_FILENAME,
  slugForResume, resumeFileName, resumeIdFromFileName,
  referencedCanonicalIds, collectReferencedRegistry,
  buildResumeFile, reconcileSources, scanBackupDir, folderFingerprint, folderLastWrite,
  writeResumeFiles, recordDeletion, readTombstones, TOMBSTONE_TTL_MS,
} from '../../server/backupFiles'
import { BACKUP_FILENAME } from '../../server/backup'
import type { ResumeBackupEntry } from '../../server/db'
import type { RegistryEntry } from '../../server/registryDb'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rs-files-'))

function entry(over: Partial<ResumeBackupEntry> = {}): ResumeBackupEntry {
  return {
    id: 'r1', name: 'Ada Lovelace — CV',
    primary_locale: 'en', secondary_locale: null,
    saved_at: '2026-08-01T10:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    data: { resume: { full_name: 'Ada Lovelace' } },
    ...over,
  }
}

function reg(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'c1', kind: 'skill', name: { en: 'Rust' }, key: 'rust',
    extra: {}, version: 1, updated_at: '2026-07-01T00:00:00.000Z',
    ...over,
  }
}

// ─── Naming ─────────────────────────────────────────────────────────────────
//
// The filename has to be identical on every machine for a given (name, id), or
// two computers write two files for one person and the folder grows a duplicate
// per sync round.

describe('slugForResume', () => {
  it('lowercases and hyphenates', () => {
    expect(slugForResume('Ada Lovelace — CV')).toBe('ada-lovelace-cv')
  })

  it('folds non-ASCII to readable ASCII, not to hyphens', () => {
    // Nordic names are the normal case here, and `bj-rn-dega-rd` would make the
    // name in the filename useless for finding a person's file.
    const oSlash = String.fromCharCode(0xF8)
    const aRing = String.fromCharCode(0xE5)
    const ae = String.fromCharCode(0xE6)
    expect(slugForResume(`Bj${oSlash}rn ${oSlash.toUpperCase()}deg${aRing}rd`)).toBe('bjorn-odegard')
    expect(slugForResume(`S${ae}ther`)).toBe('saether')
    // NFKD handles anything that decomposes into base + combining mark.
    expect(slugForResume(`Zo${String.fromCharCode(0xEB)} ${String.fromCharCode(0xDC)}nicode`))
      .toBe('zoe-unicode')
  })

  it('never yields an empty or edge-hyphenated slug', () => {
    expect(slugForResume('')).toBe('resume')
    expect(slugForResume('!!!')).toBe('resume')
    expect(slugForResume('  Trailing  ')).toBe('trailing')
  })

  it('caps the length so the path stays sane, with no trailing hyphen', () => {
    const slug = slugForResume('x'.repeat(200))
    expect(slug).toHaveLength(60)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('resumeFileName / resumeIdFromFileName', () => {
  it('is stable for a given name+id and round-trips the id', () => {
    const name = resumeFileName('abc-123', 'Ada Lovelace — CV')
    expect(name).toBe('ada-lovelace-cv__abc-123.json')
    // Deterministic
    expect(resumeFileName('abc-123', 'Ada Lovelace — CV')).toBe(name)
    expect(resumeIdFromFileName(name)).toBe('abc-123')
  })

  it('returns null for a filename that carries no id (a hint, never the identity)', () => {
    expect(resumeIdFromFileName('registry.json')).toBeNull()
    expect(resumeIdFromFileName('something.json')).toBeNull()
  })
})

// ─── Registry embedding ─────────────────────────────────────────────────────

describe('collectReferencedRegistry', () => {
  const data = {
    skills: [{ id: 's1', canonical_id: 'c1' }, { id: 's2' }],
    roles: [{ id: 'ro1', canonical_id: 'c2' }],
    industries: [{ id: 'i1', canonical_id: null }],
    skill_categories: [{ id: 'k1', canonical_id: 'c1' }],
  }

  it('finds every canonical_id across the linked collections, deduped', () => {
    expect([...referencedCanonicalIds(data)].sort()).toEqual(['c1', 'c2'])
  })

  it('embeds the FULL entries so one file can recreate them elsewhere', () => {
    // A resume file lifted out on its own has to be able to rebuild the registry
    // entries it links to — id, kind and the whole localized name.
    const embedded = collectReferencedRegistry(data, [
      reg({ id: 'c1', name: { en: 'Rust', no: 'Rust' } }),
      reg({ id: 'c2', kind: 'role', key: 'architect', name: { en: 'Architect', no: 'Arkitekt' } }),
      reg({ id: 'c3', key: 'unused', name: { en: 'Unused' } }),
    ])
    expect(embedded.map((e) => e.id).sort()).toEqual(['c1', 'c2'])
    expect(embedded.find((e) => e.id === 'c2')).toMatchObject({
      kind: 'role', key: 'architect', name: { en: 'Architect', no: 'Arkitekt' },
    })
  })

  it('is empty when the resume links to nothing shared', () => {
    expect(collectReferencedRegistry({ skills: [{ id: 's1' }] }, [reg()])).toEqual([])
    expect(collectReferencedRegistry({}, [reg()])).toEqual([])
  })
})

// ─── Reconciliation ─────────────────────────────────────────────────────────

describe('reconcileSources', () => {
  const asSource = (name: string, json: unknown) => ({ name, json })

  it('keys on the EMBEDDED id, not the filename, and keeps the newest save', () => {
    // Mid-rename, two machines can briefly hold two names for one resume. The id
    // inside the file is what makes that one resume rather than two.
    const scan = reconcileSources([
      asSource('old-name__r1.json', buildResumeFile(entry({ saved_at: '2026-08-01T00:00:00Z' }), [])),
      asSource('new-name__r1.json', buildResumeFile(entry({ name: 'Renamed', saved_at: '2026-08-02T00:00:00Z' }), [])),
    ])
    expect(scan.resumes).toHaveLength(1)
    expect(scan.resumes[0].name).toBe('Renamed')
    expect(scan.filesByResumeId.get('r1')).toEqual(['old-name__r1.json', 'new-name__r1.json'])
  })

  it('unions the registry from resume files and registry.json, newest wins', () => {
    const scan = reconcileSources([
      asSource('a__r1.json', {
        $schema: 'resumestudio-resume/v1', format_version: 1,
        resume: entry(), registry: [reg({ name: { en: 'Old' }, updated_at: '2026-01-01T00:00:00Z' })],
      }),
      asSource(REGISTRY_FILENAME, {
        $schema: 'resumestudio-registry/v1', format_version: 1,
        registry: [reg({ name: { en: 'New' }, updated_at: '2026-09-01T00:00:00Z' }), reg({ id: 'c9', key: 'go' })],
      }),
    ])
    expect(scan.registry).toHaveLength(2)
    expect(scan.registry.find((e) => e.id === 'c1')?.name).toEqual({ en: 'New' })
  })

  it('reads a legacy combined backup alongside the split files', () => {
    const scan = reconcileSources([
      asSource('ada__r1.json', buildResumeFile(entry(), [])),
      asSource(BACKUP_FILENAME, {
        $schema: 'resumestudio-store/v1', format_version: 1,
        resumes: [entry({ id: 'r2', name: 'From the old file' })],
      }),
    ])
    expect(scan.resumes.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(scan.legacyFile).toBe(BACKUP_FILENAME)
  })

  it('ignores files that are not ours', () => {
    const scan = reconcileSources([
      asSource('notes.json', { hello: 'world' }),
      asSource('cvpartner.json', { navn: 'Someone', project_experiences: [] }),
    ])
    expect(scan.resumes).toEqual([])
    expect(scan.registry).toEqual([])
    expect(scan.legacyFile).toBeNull()
  })

  it('keeps the newest tombstone per id', () => {
    const scan = reconcileSources([
      asSource('t1.json', {
        $schema: 'resumestudio-tombstones/v1', format_version: 1,
        tombstones: [{ id: 'r1', deleted_at: '2026-01-01T00:00:00Z' }],
      }),
      asSource(TOMBSTONE_FILENAME, {
        $schema: 'resumestudio-tombstones/v1', format_version: 1,
        tombstones: [
          { id: 'r1', deleted_at: '2026-06-01T00:00:00Z' },
          // Malformed — dropped, not fatal
          { id: 'nope' },
        ],
      }),
    ])
    expect(scan.tombstones).toEqual([{ id: 'r1', deleted_at: '2026-06-01T00:00:00Z' }])
  })
})

// ─── Folder I/O ─────────────────────────────────────────────────────────────

describe('writeResumeFiles / scanBackupDir', () => {
  it('writes one file per resume plus registry.json, and reads them back', () => {
    const dir = tmp()
    try {
      const result = writeResumeFiles(dir, [entry(), entry({ id: 'r2', name: 'Grace Hopper — CV' })], [reg()])
      expect(result.written).toBe(2)
      const names = fs.readdirSync(dir).sort()
      expect(names).toEqual([
        REGISTRY_FILENAME, 'ada-lovelace-cv__r1.json', 'grace-hopper-cv__r2.json',
      ].sort())

      const scan = scanBackupDir(dir)
      expect(scan.resumes.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
      expect(scan.registry).toHaveLength(1)
      expect(scan.unreadable).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops the stale-named file when a resume is renamed', () => {
    const dir = tmp()
    try {
      writeResumeFiles(dir, [entry()], [])
      const result = writeResumeFiles(dir, [entry({ name: 'Ada — Renamed' })], [])
      expect(result.removed).toContain('ada-lovelace-cv__r1.json')
      expect(fs.readdirSync(dir).filter((f) => f.includes('__r1'))).toEqual(['ada-renamed__r1.json'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never deletes a file for a resume it does not hold', () => {
    // Another machine may have just published a person this one hasn't merged.
    // Treating "not in my DB" as "delete" would make two machines erase each
    // other's new work every sync round.
    const dir = tmp()
    try {
      writeResumeFiles(dir, [entry(), entry({ id: 'r2', name: 'Other Machine' })], [])
      writeResumeFiles(dir, [entry()], [])
      expect(fs.existsSync(path.join(dir, 'other-machine__r2.json'))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('retires a superseded legacy file, but keeps one holding a resume we lack', () => {
    const dir = tmp()
    try {
      const legacy = {
        $schema: 'resumestudio-store/v1', format_version: 1,
        resumes: [entry(), entry({ id: 'r9', name: 'Only In The Old File' })],
      }
      fs.writeFileSync(path.join(dir, BACKUP_FILENAME), JSON.stringify(legacy))
      // r9 is not ours yet → the old file still carries data we'd lose.
      writeResumeFiles(dir, [entry()], [])
      expect(fs.existsSync(path.join(dir, BACKUP_FILENAME))).toBe(true)

      // Now we hold both → nothing left in it that isn't in a per-resume file.
      writeResumeFiles(dir, [entry(), entry({ id: 'r9', name: 'Only In The Old File' })], [])
      expect(fs.existsSync(path.join(dir, BACKUP_FILENAME))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('records an unreadable file instead of throwing', () => {
    const dir = tmp()
    try {
      writeResumeFiles(dir, [entry()], [])
      fs.writeFileSync(path.join(dir, 'half-written__r7.json'), '{ "resume": ')
      const scan = scanBackupDir(dir)
      expect(scan.unreadable).toEqual(['half-written__r7.json'])
      // The good file still came through
      expect(scan.resumes).toHaveLength(1)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('scanning a folder that does not exist is empty, not an error', () => {
    const scan = scanBackupDir(path.join(os.tmpdir(), 'rs-does-not-exist-' + Date.now()))
    expect(scan.resumes).toEqual([])
    expect(scan.unreadable).toEqual([])
  })
})

describe('folderFingerprint / folderLastWrite', () => {
  it('moves when a file is added, changed, or removed', () => {
    const dir = tmp()
    try {
      const empty = folderFingerprint(dir)
      writeResumeFiles(dir, [entry()], [])
      const one = folderFingerprint(dir)
      expect(one).not.toBe(empty)

      // A second machine publishing a NEW person touches no existing file — the
      // whole reason this is a folder fingerprint rather than one file's mtime.
      writeResumeFiles(dir, [entry(), entry({ id: 'r2', name: 'New Person' })], [])
      expect(folderFingerprint(dir)).not.toBe(one)

      expect(folderLastWrite(dir)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores our in-flight temp files', () => {
    const dir = tmp()
    try {
      writeResumeFiles(dir, [entry()], [])
      const before = folderFingerprint(dir)
      fs.writeFileSync(path.join(dir, '.something.tmp.json'), 'x')
      expect(folderFingerprint(dir)).toBe(before)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports no last write for an empty or missing folder', () => {
    const dir = tmp()
    try {
      expect(folderLastWrite(dir)).toBeNull()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('recordDeletion', () => {
  it('removes the resume file and leaves an id-only tombstone', () => {
    const dir = tmp()
    try {
      writeResumeFiles(dir, [entry(), entry({ id: 'r2', name: 'Keeper' })], [])
      recordDeletion(dir, 'r1')

      expect(fs.existsSync(path.join(dir, 'ada-lovelace-cv__r1.json'))).toBe(false)
      expect(fs.existsSync(path.join(dir, 'keeper__r2.json'))).toBe(true)

      const tombstones = readTombstones(dir)
      expect(tombstones).toHaveLength(1)
      expect(tombstones[0].id).toBe('r1')
      // The marker that propagates an erasure must not itself carry the data.
      expect(Object.keys(tombstones[0]).sort()).toEqual(['deleted_at', 'id'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accumulates tombstones and prunes ones past the TTL', () => {
    const dir = tmp()
    try {
      const now = new Date('2026-08-04T00:00:00.000Z')
      const stale = new Date(now.getTime() - TOMBSTONE_TTL_MS - 1000).toISOString()
      fs.writeFileSync(path.join(dir, TOMBSTONE_FILENAME), JSON.stringify({
        $schema: 'resumestudio-tombstones/v1', format_version: 1,
        tombstones: [
          { id: 'ancient', deleted_at: stale },
          { id: 'recent', deleted_at: '2026-08-01T00:00:00.000Z' },
        ],
      }))
      recordDeletion(dir, 'fresh', now)
      expect(readTombstones(dir).map((t) => t.id).sort()).toEqual(['fresh', 'recent'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never throws when the folder is unwritable — the DB row is already gone', () => {
    expect(() => recordDeletion(path.join(os.tmpdir(), 'rs-nope-' + Date.now(), 'deep'), 'r1')).not.toThrow()
  })

  it('readTombstones is empty for a folder with none', () => {
    const dir = tmp()
    try {
      expect(readTombstones(dir)).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
