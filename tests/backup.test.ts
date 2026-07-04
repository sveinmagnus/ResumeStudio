import { describe, it, expect } from 'vitest'
import {
  isBackupFormat, exportToBackup, importFromBackup,
  migrateBackup, UnsupportedBackupVersionError, CURRENT_FORMAT_VERSION,
  type AnyBackup,
} from '../src/lib/backup'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ,
  makeReference, makeSpokenLanguage, makeSkill, makeRole, makeIndustry,
  makeView, makeSkillCategory,
} from './fixtures'

describe('isBackupFormat()', () => {
  it('accepts a well-formed backup envelope', () => {
    const store = emptyStore()
    expect(isBackupFormat(exportToBackup(store))).toBe(true)
  })

  it('rejects null and non-object inputs', () => {
    expect(isBackupFormat(null)).toBe(false)
    expect(isBackupFormat(undefined)).toBe(false)
    expect(isBackupFormat('string')).toBe(false)
    expect(isBackupFormat(42)).toBe(false)
  })

  it('rejects a CVpartner-shaped object (missing schema marker)', () => {
    const cvpartnerish = { name: 'Test', email: 'x@y', project_experiences: [], cv_roles: [] }
    expect(isBackupFormat(cvpartnerish)).toBe(false)
  })

  it('rejects backup with wrong $schema', () => {
    expect(isBackupFormat({
      $schema: 'something-else',
      format_version: 1,
      profile: null,
      registries: {},
      sections: {},
    })).toBe(false)
  })

  it('accepts an envelope from a future format version (detection layer is lenient — migrateBackup decides if we can read it)', () => {
    // We want users with future-version backups to see "unsupported version"
    // rather than the misleading "this looks like a CVpartner file" error.
    expect(isBackupFormat({
      $schema: 'resumestudio/v2',
      format_version: 2,
      profile: null,
      sections: {},
    })).toBe(true)
  })

  it('rejects backup missing the sections payload', () => {
    expect(isBackupFormat({
      $schema: 'resumestudio/v1',
      format_version: 1,
      profile: null,
    })).toBe(false)
  })

  it('rejects when format_version is not a number', () => {
    expect(isBackupFormat({
      $schema: 'resumestudio/v1',
      format_version: '1',
      profile: null,
      sections: {},
    })).toBe(false)
  })
})

describe('exportToBackup()', () => {
  it('produces a backup with the canonical schema/version markers', () => {
    const backup = exportToBackup(emptyStore())
    expect(backup.$schema).toBe('resumestudio/v1')
    expect(backup.format_version).toBe(1)
    expect(backup.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('moves resume → profile and groups registries/sections', () => {
    const store = emptyStore()
    store.skills.push(makeSkill())
    store.roles.push(makeRole())
    store.projects.push(makeProject())
    const backup = exportToBackup(store)
    expect(backup.profile).toEqual(store.resume)
    expect(backup.registries.skills).toEqual(store.skills)
    expect(backup.registries.roles).toEqual(store.roles)
    expect(backup.sections.projects).toEqual(store.projects)
  })
})

describe('round-trip (exportToBackup → importFromBackup)', () => {
  it('preserves an empty store', () => {
    const store = emptyStore()
    const restored = importFromBackup(exportToBackup(store))
    expect(restored).toEqual(store)
  })

  it('preserves a richly populated store', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ name: { en: 'Go', no: 'Go' } }))
    store.roles.push(makeRole({ name: { en: 'SRE' }, starred: true }))
    store.industries.push(makeIndustry({ id: 'fin', name: { en: 'Finance', no: 'Finans' } }))
    store.key_qualifications.push(makeKQ())
    store.projects.push(makeProject({ starred: true, customer: { en: 'X', no: 'Y' }, industry_id: 'fin' }))
    store.work_experiences.push(makeWork({ employer: { en: 'Old Co' }, end: { year: 2018, month: 12 } }))
    store.educations.push(makeEducation({ grade: 'A+', exchange: true }))
    store.spoken_languages.push(makeSpokenLanguage())
    store.references.push(makeReference({ include_in_exports: true }))
    store.views.push(makeView({ name: 'Compact', starred_only: true }))

    const restored = importFromBackup(exportToBackup(store))
    expect(restored).toEqual(store)
  })

  it('survives a JSON serialisation cycle (the actual file format)', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ customer: { en: 'JSON-safe', no: 'JSON-trygt' } }))
    const json = JSON.stringify(exportToBackup(store))
    const parsed = JSON.parse(json) as unknown
    expect(isBackupFormat(parsed)).toBe(true)
    if (isBackupFormat(parsed)) {
      const restored = importFromBackup(parsed)
      expect(restored).toEqual(store)
    }
  })

  it('preserves null resume (fresh-start state)', () => {
    const store = emptyStore()
    store.resume = null
    const restored = importFromBackup(exportToBackup(store))
    expect(restored.resume).toBeNull()
  })

  it('preserves skill_categories entities and Skill.category_id links', () => {
    const store = emptyStore()
    store.skill_categories.push(makeSkillCategory({ id: 'cat1', name: { en: 'Languages', no: 'Sprak' } }))
    store.skills.push(makeSkill({ id: 's1', name: { en: 'TypeScript' }, category_id: 'cat1', is_highlighted: true }))
    const restored = importFromBackup(exportToBackup(store))
    expect(restored).toEqual(store)
  })

  it('converts a legacy pre-v6 backup carrying sections.technology_categories on load', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 's1', name: { en: 'TypeScript' } }))
    const backup = exportToBackup(store)
    // Simulate an older backup: no registries.skill_categories, but the old
    // Showcase structure under sections.technology_categories.
    delete (backup.registries as Record<string, unknown>).skill_categories
    ;(backup.sections as unknown as Record<string, unknown>).technology_categories = [
      { id: 'tc1', name: { en: 'Languages' }, sort_order: 0, skills: [{ id: 'cs1', skill_id: 's1' }] },
    ]
    const restored = importFromBackup(backup)
    expect(restored.skill_categories).toEqual([])
    // The legacy structure is attached untyped for migrateStore to convert.
    expect((restored as unknown as Record<string, unknown>).technology_categories).toEqual([
      { id: 'tc1', name: { en: 'Languages' }, sort_order: 0, skills: [{ id: 'cs1', skill_id: 's1' }] },
    ])
  })
})

describe('migrateBackup() & UnsupportedBackupVersionError', () => {
  it('passes v1 through unchanged (current = v1)', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(1)
    const v1 = exportToBackup(emptyStore())
    expect(migrateBackup(v1)).toBe(v1)
  })

  it('throws a typed error for an unknown future version', () => {
    const fromTheFuture = {
      ...exportToBackup(emptyStore()),
      format_version: 99,
    } as unknown as AnyBackup
    expect(() => migrateBackup(fromTheFuture)).toThrow(UnsupportedBackupVersionError)
    try {
      migrateBackup(fromTheFuture)
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedBackupVersionError)
      expect((e as UnsupportedBackupVersionError).version).toBe(99)
      // The user-facing message must mention versions
      expect((e as Error).message).toMatch(/version/i)
    }
  })

  it('importFromBackup propagates the migration error for unknown versions', () => {
    const fromTheFuture = {
      ...exportToBackup(emptyStore()),
      format_version: 7,
    } as unknown as AnyBackup
    expect(() => importFromBackup(fromTheFuture)).toThrow(UnsupportedBackupVersionError)
  })
})
