import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  REGISTRY_FILENAME, LEGACY_REGISTRY_FILENAME,
  TOMBSTONE_FILENAME, LEGACY_TOMBSTONE_FILENAME,
  slugForResume, resumeFileName, resumeIdFromFileName,
  referencedCanonicalIds, collectReferencedRegistry,
  buildResumeFile, reconcileSources, scanBackupDir, folderFingerprint, folderLastWrite,
  writeResumeFiles, recordDeletion, readTombstones, TOMBSTONE_TTL_MS, type Tombstone,
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

  it('keeps the newest save when the NEWER source is read first', () => {
    /*
     * The same rule as above, in the order that can actually test it.
     *
     * Every existing case fed the older copy first, so "keep the newest" and
     * "keep whichever arrived last" agree and the mutation report showed the
     * comparison deletable. Reversed, they disagree — and taking the last would
     * be an older copy overwriting a newer one, which is the two-machines
     * failure this whole design exists to avoid.
     */
    const scan = reconcileSources([
      asSource('new-name__r1.json', buildResumeFile(entry({ name: 'Renamed', saved_at: '2026-08-02T00:00:00Z' }), [])),
      asSource('old-name__r1.json', buildResumeFile(entry({ saved_at: '2026-08-01T00:00:00Z' }), [])),
    ])
    expect(scan.resumes).toHaveLength(1)
    expect(scan.resumes[0].name).toBe('Renamed')
    expect(scan.resumes[0].saved_at).toBe('2026-08-02T00:00:00Z')
  })

  it('keeps the first of two copies saved at the same instant', () => {
    // A tie is not a reason to churn: `>` rather than `>=` means an identical
    // timestamp leaves the held copy alone.
    const scan = reconcileSources([
      asSource('a__r1.json', buildResumeFile(entry({ name: 'First', saved_at: '2026-08-01T00:00:00Z' }), [])),
      asSource('b__r1.json', buildResumeFile(entry({ name: 'Second', saved_at: '2026-08-01T00:00:00Z' }), [])),
    ])
    expect(scan.resumes[0].name).toBe('First')
  })

  it('keeps the newest registry entry when the NEWER source is read first', () => {
    const scan = reconcileSources([
      asSource(REGISTRY_FILENAME, {
        $schema: 'resumestudio-registry/v1', format_version: 1,
        registry: [reg({ name: { en: 'New' }, updated_at: '2026-09-01T00:00:00Z' })],
      }),
      asSource('a__r1.json', {
        $schema: 'resumestudio-resume/v1', format_version: 1,
        resume: entry(), registry: [reg({ name: { en: 'Old' }, updated_at: '2026-01-01T00:00:00Z' })],
      }),
    ])
    expect(scan.registry.find((e) => e.id === 'c1')?.name).toEqual({ en: 'New' })
  })

  it('prefers a dated registry entry over an undated one', () => {
    // `updated_at ?? ''` makes a missing timestamp the oldest possible, so an
    // entry from a build that did not stamp them cannot displace a real one.
    const scan = reconcileSources([
      asSource(REGISTRY_FILENAME, {
        $schema: 'resumestudio-registry/v1', format_version: 1,
        registry: [reg({ name: { en: 'Dated' }, updated_at: '2026-09-01T00:00:00Z' })],
      }),
      asSource('a__r1.json', {
        $schema: 'resumestudio-resume/v1', format_version: 1,
        resume: entry(), registry: [{ ...reg({ name: { en: 'Undated' } }), updated_at: undefined }],
      }),
    ])
    expect(scan.registry.find((e) => e.id === 'c1')?.name).toEqual({ en: 'Dated' })
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
  /**
   * The registry file was renamed from `registry.json` to
   * `resume-studio-registry.json`. Two things must hold for that to be safe in
   * a folder that already exists, and neither follows from the rename itself:
   * the old file must still be READ (matching is by `$schema`, not by name),
   * and it must not survive alongside its replacement — two registry files in
   * one folder is the confusion the rename set out to remove.
   */
  it('retires the legacy registry.json, keeping its entries readable first', () => {
    const dir = tmp()
    try {
      // A folder written by an older build: legacy name, one entry inside.
      fs.writeFileSync(
        path.join(dir, LEGACY_REGISTRY_FILENAME),
        JSON.stringify({
          $schema: 'resumestudio-registry/v1',
          format_version: 1,
          exported_at: '2026-08-01T00:00:00.000Z',
          generator: 'resume-studio',
          registry: [reg({ id: 'legacy-1' })],
        }),
      )
      // Readable BEFORE anything is rewritten — an un-upgraded folder keeps
      // working, which is what makes the rename safe to ship.
      expect(scanBackupDir(dir).registry.map((e) => e.id)).toEqual(['legacy-1'])

      const result = writeResumeFiles(dir, [entry()], [reg()])

      const names = fs.readdirSync(dir)
      expect(names).toContain(REGISTRY_FILENAME)
      expect(names).not.toContain(LEGACY_REGISTRY_FILENAME)
      expect(result.removed).toContain(LEGACY_REGISTRY_FILENAME)
      // The folder still resolves to a registry afterwards.
      expect(scanBackupDir(dir).registry.length).toBeGreaterThan(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes one file per resume plus the registry file, and reads them back', () => {
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

  /**
   * The tombstone file was renamed from `deleted-resumes.json` to
   * `resume-studio-deleted-resumes.json`. This is the rename with teeth: the
   * registry can be rewritten from the DB, but tombstones exist ONLY in the
   * folder, and losing one lets the next machine to sync restore a resume
   * somebody erased. So the property under test is not "the file moved" — it
   * is "no deletion was forgotten while it moved".
   */
  const legacyTombstoneFile = (dir: string, tombstones: Tombstone[]) => {
    fs.writeFileSync(
      path.join(dir, LEGACY_TOMBSTONE_FILENAME),
      JSON.stringify({
        $schema: 'resumestudio-tombstones/v1',
        format_version: 1,
        exported_at: '2026-08-01T00:00:00.000Z',
        generator: 'resume-studio',
        tombstones,
      }),
    )
  }

  it('reads tombstones written under the old name', () => {
    const dir = tmp()
    try {
      legacyTombstoneFile(dir, [{ id: 'erased', deleted_at: '2026-07-01T00:00:00.000Z' }])
      // Both the by-name read and the schema-driven scan must see it, or an
      // erasure made before the upgrade silently stops propagating.
      expect(readTombstones(dir).map((t) => t.id)).toEqual(['erased'])
      expect(scanBackupDir(dir).tombstones.map((t) => t.id)).toEqual(['erased'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('carries old tombstones into the new file before removing the old one', () => {
    const dir = tmp()
    try {
      legacyTombstoneFile(dir, [{ id: 'erased-before-upgrade', deleted_at: '2026-07-01T00:00:00.000Z' }])

      const result = writeResumeFiles(dir, [entry()], [reg()])

      const names = fs.readdirSync(dir)
      expect(names).toContain(TOMBSTONE_FILENAME)
      expect(names).not.toContain(LEGACY_TOMBSTONE_FILENAME)
      expect(result.removed).toContain(LEGACY_TOMBSTONE_FILENAME)
      // The deletion survived the move — the whole point.
      expect(readTombstones(dir).map((t) => t.id)).toEqual(['erased-before-upgrade'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves an unparseable legacy tombstone file alone', () => {
    // We cannot prove what it held, and an unexplained leftover file is a much
    // better outcome than a person who quietly stops being erased.
    const dir = tmp()
    try {
      fs.writeFileSync(path.join(dir, LEGACY_TOMBSTONE_FILENAME), '{ not json')
      writeResumeFiles(dir, [entry()], [reg()])
      expect(fs.readdirSync(dir)).toContain(LEGACY_TOMBSTONE_FILENAME)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('recordDeletion retires the old file, keeping every deletion', () => {
    const dir = tmp()
    try {
      legacyTombstoneFile(dir, [{ id: 'old', deleted_at: '2026-07-01T00:00:00.000Z' }])
      recordDeletion(dir, 'new', new Date('2026-08-02T00:00:00.000Z'))

      expect(fs.readdirSync(dir)).not.toContain(LEGACY_TOMBSTONE_FILENAME)
      expect(readTombstones(dir).map((t) => t.id).sort()).toEqual(['new', 'old'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── Resume id / path traversal ─────────────────────────────────────────────
//
// The resume id is the ONE field on the inbound path that becomes a filesystem
// path: it arrives inside an imported or synced file, `restoreResumes` stores
// it verbatim, and the next write pass builds `<slug>__<id>.json` and joins it
// onto the sync folder. An id carrying `..` and a separator therefore escapes
// that folder — on every machine sharing it, since the watcher merges inbound
// files and the scheduler republishes with no user action.
//
// Three locks, one per layer, each tested here: the id charset, the filename
// builder, and the write pass itself.

/** Backslash by char code, matching how this file writes every awkward literal. */
const BS = String.fromCharCode(92)

const TRAVERSAL_IDS = [
  'x/../../../../tmp/pwn',
  '../../evil',
  `..${BS}..${BS}evil`,
  'a/b',
  `a${BS}b`,
  'has space',
  'x'.repeat(65),
  '',
]

describe('resume id validation (path traversal)', () => {
  it('accepts the ids the app actually mints', () => {
    // uuidv4 output, plus the short ids the fixtures and older data use.
    for (const id of ['3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'r1', 'abc-123', 'A_b-9']) {
      expect(resumeFileName(id, 'Ada')).toBe(`ada__${id}.json`)
    }
  })

  it('refuses to build a filename from a traversing id', () => {
    for (const id of TRAVERSAL_IDS) {
      expect(() => resumeFileName(id, 'Ada')).toThrow(/not filename-safe/)
    }
  })

  it('drops a resume file whose embedded id is not filename-safe', () => {
    // The file parses as JSON and carries our $schema — the id is the only
    // thing wrong with it, and it must be enough to reject the whole entry.
    const scan = reconcileSources([{
      name: 'evil__x.json',
      json: {
        $schema: 'resumestudio-resume/v1',
        format_version: 1,
        resume: { ...entry(), id: 'x/../../../../tmp/pwn' },
        registry: [],
      },
    }])
    expect(scan.resumes).toEqual([])
    expect(scan.filesByResumeId.size).toBe(0)
  })

  it('keeps the good resumes in an upload that also carries a poisoned one', () => {
    const scan = reconcileSources([
      { name: 'a__r1.json', json: buildResumeFile(entry(), []) },
      {
        name: 'evil__x.json',
        json: {
          $schema: 'resumestudio-resume/v1', format_version: 1,
          resume: { ...entry(), id: '../../../../evil' }, registry: [],
        },
      },
    ])
    expect(scan.resumes.map((r) => r.id)).toEqual(['r1'])
  })

  it('writeResumeFiles never writes outside the backup dir', () => {
    // The end-to-end proof: even handed an entry the parsers would have
    // rejected, the write pass must not touch anything above `dir`.
    const root = tmp()
    const dir = path.join(root, 'sync')
    fs.mkdirSync(dir)
    const outside = path.join(root, 'outside')
    fs.mkdirSync(outside)

    // The id has to make `..` a segment of its OWN to traverse: `../x` only
    // yields a literal directory named `<slug>__..`, which fails as ENOENT and
    // would let this test pass against vulnerable code. `x/../../outside/pwn`
    // resolves to `<root>/outside/pwn.json` — a directory that EXISTS, so
    // nothing but the guard stands between it and the write.
    // The FILESYSTEM is the assertion that matters here, so run the write
    // without letting the throw short-circuit it: a future change that swaps
    // the exception for a skip-and-continue must still be caught by this test.
    let threw: unknown = null
    try {
      writeResumeFiles(dir, [entry({ id: 'x/../../outside/pwn', name: 'Ada' })], [])
    } catch (err) { threw = err }

    // Nothing landed above the sync folder, under either the final name or the
    // `.tmp` staging name the atomic write uses.
    expect(fs.readdirSync(outside)).toEqual([])
    expect(fs.readdirSync(root).sort()).toEqual(['outside', 'sync'])
    expect((threw as Error | null)?.message).toMatch(/not filename-safe/)
  })

  it('a poisoned entry cannot silently divert a whole write pass', () => {
    const dir = tmp()
    // A good entry first, so we can prove the failure is loud rather than a
    // partially-written folder that looks fine.
    expect(() => writeResumeFiles(dir, [
      entry({ id: 'r1' }),
      entry({ id: 'x/../../../../tmp/pwn', name: 'Evil' }),
    ], [])).toThrow(/not filename-safe/)
    for (const name of fs.readdirSync(dir)) {
      expect(path.resolve(dir, name).startsWith(path.resolve(dir))).toBe(true)
    }
  })
})
