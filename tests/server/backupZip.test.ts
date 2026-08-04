import { describe, it, expect } from 'vitest'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { buildBackupZip, readBackupZip, zipFileName } from '../../server/backupZip'
import { REGISTRY_FILENAME, buildResumeFile } from '../../server/backupFiles'
import type { ResumeBackupEntry } from '../../server/db'
import type { RegistryEntry } from '../../server/registryDb'

function entry(over: Partial<ResumeBackupEntry> = {}): ResumeBackupEntry {
  return {
    id: 'r1', name: 'Ada Lovelace',
    primary_locale: 'en', secondary_locale: null,
    saved_at: '2026-08-01T10:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    data: { resume: { full_name: 'Ada Lovelace' }, skills: [{ id: 's1', canonical_id: 'c1' }] },
    ...over,
  }
}

const reg: RegistryEntry = {
  id: 'c1', kind: 'skill', name: { en: 'Rust', no: 'Rust' }, key: 'rust',
  extra: { classification: 'language' }, version: 3, updated_at: '2026-07-01T00:00:00.000Z',
}

describe('zipFileName', () => {
  it('is dated so successive backups do not overwrite each other in Downloads', () => {
    expect(zipFileName(new Date('2026-08-04T12:00:00Z'))).toBe('resume-studio-backup-2026-08-04.zip')
  })
})

describe('buildBackupZip', () => {
  it('holds one file per resume plus the registry, flat', () => {
    // Flat (no wrapper directory) so extracting it straight into a sync folder
    // produces exactly the layout the folder expects.
    const zip = buildBackupZip([entry(), entry({ id: 'r2', name: 'Grace Hopper' })], [reg])
    const names = Object.keys(unzipSync(zip)).sort()
    expect(names).toEqual([REGISTRY_FILENAME, 'ada-lovelace__r1.json', 'grace-hopper__r2.json'].sort())
    expect(names.every((n) => !n.includes('/'))).toBe(true)
  })

  it('embeds the registry entries each resume references, in full', () => {
    // A single file lifted out of the archive has to be able to recreate the
    // shared entries it links to, without registry.json beside it.
    const files = unzipSync(buildBackupZip([entry()], [reg]))
    const parsed = JSON.parse(strFromU8(files['ada-lovelace__r1.json']))
    expect(parsed.registry).toEqual([reg])
  })

  it('never silently drops a person when two names collide', () => {
    const files = unzipSync(buildBackupZip([entry(), { ...entry(), name: 'Ada Lovelace' }], []))
    // Ids are unique so this only happens on corrupt input — but a backup that
    // quietly loses someone is the one failure worth ruling out.
    expect(Object.keys(files).filter((n) => n !== REGISTRY_FILENAME)).toHaveLength(2)
  })
})

describe('readBackupZip', () => {
  it('round-trips a zip back into the same view the folder scan produces', () => {
    const scan = readBackupZip(buildBackupZip([entry(), entry({ id: 'r2', name: 'Grace Hopper' })], [reg]))
    expect(scan.resumes.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(scan.registry).toEqual([reg])
    expect(scan.unreadable).toEqual([])
  })

  it('reads entries nested under a directory (some zip tools add one)', () => {
    const zip = zipSync({
      'backup/ada__r1.json': strToU8(JSON.stringify(buildResumeFile(entry(), []))),
    })
    expect(readBackupZip(zip).resumes.map((r) => r.id)).toEqual(['r1'])
  })

  it('recovers what it can and records the rest, rather than failing the archive', () => {
    const zip = zipSync({
      'ada__r1.json': strToU8(JSON.stringify(buildResumeFile(entry(), []))),
      'broken__r2.json': strToU8('{ not json'),
      'readme.txt': strToU8('ignored — not JSON'),
    })
    const scan = readBackupZip(zip)
    expect(scan.resumes.map((r) => r.id)).toEqual(['r1'])
    expect(scan.unreadable).toEqual(['broken__r2.json'])
  })

  it('never writes by entry name, so a traversal path is inert', () => {
    // Nothing in the import path touches the filesystem — entries are parsed in
    // memory and only the basename is kept. This pins that assumption.
    const zip = zipSync({
      '../../../etc/ada__r1.json': strToU8(JSON.stringify(buildResumeFile(entry(), []))),
    })
    const scan = readBackupZip(zip)
    expect(scan.resumes.map((r) => r.id)).toEqual(['r1'])
    expect([...scan.filesByResumeId.values()].flat()).toEqual(['ada__r1.json'])
  })

  it('skips an entry that declares an implausible size, without inflating it', () => {
    const zip = zipSync({ 'ada__r1.json': strToU8(JSON.stringify(buildResumeFile(entry(), []))) })
    // fflate's filter sees the header's originalSize; force it to look huge.
    const scan = readBackupZip(zip, 8)  // 8-byte cap → every real entry is over it
    expect(scan.resumes).toEqual([])
    expect(scan.unreadable).toEqual(['ada__r1.json'])
  })

  it('throws for something that is not a zip at all', () => {
    expect(() => readBackupZip(strToU8('definitely not a zip'))).toThrow()
  })
})
