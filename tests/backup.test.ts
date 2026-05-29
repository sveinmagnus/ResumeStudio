import { describe, it, expect } from 'vitest'
import { isBackupFormat, exportToBackup, importFromBackup } from '../src/lib/backup'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ,
  makeReference, makeSpokenLanguage, makeSkill, makeRole,
  makeView,
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

  it('rejects backup with wrong format_version', () => {
    expect(isBackupFormat({
      $schema: 'resumestudio/v1',
      format_version: 2,
      profile: null,
      registries: {},
      sections: {},
    })).toBe(false)
  })

  it('rejects backup missing the registries section', () => {
    expect(isBackupFormat({
      $schema: 'resumestudio/v1',
      format_version: 1,
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
    store.key_qualifications.push(makeKQ())
    store.projects.push(makeProject({ starred: true, customer: { en: 'X', no: 'Y' } }))
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
})
