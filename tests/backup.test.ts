import { describe, it, expect } from 'vitest'
import {
  isBackupFormat, exportToBackup, importFromBackup,
  migrateBackup, UnsupportedBackupVersionError, CURRENT_FORMAT_VERSION,
  validateBackup, InvalidBackupError,
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

describe('validateBackup()', () => {
  // A minimal well-formed backup, mutated per-case.
  const good = (): Record<string, unknown> => exportToBackup(emptyStore()) as unknown as Record<string, unknown>

  it('accepts a well-formed backup and returns it typed', () => {
    const b = good()
    expect(validateBackup(b)).toBe(b)
  })

  it('accepts a real round-trippable export with content', () => {
    const store = { ...emptyStore(), projects: [makeProject()], skills: [makeSkill()], views: [makeView()] }
    expect(() => validateBackup(exportToBackup(store))).not.toThrow()
  })

  it('rejects non-objects with a root issue', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(() => validateBackup(bad)).toThrow(InvalidBackupError)
    }
  })

  it('flags a wrong $schema and a non-number format_version', () => {
    const b = good()
    b['$schema'] = 'not-ours'
    b['format_version'] = '1'
    try {
      validateBackup(b)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidBackupError)
      const paths = (e as InvalidBackupError).issues.map((i) => i.path)
      expect(paths).toContain('$schema')
      expect(paths).toContain('format_version')
    }
  })

  it('rejects a profile that is neither object nor null', () => {
    const b = good()
    b['profile'] = 'Ada Lovelace'
    expect(() => validateBackup(b)).toThrow(/profile/)
  })

  it('tolerates a null profile and omitted optional collections', () => {
    // Older/partial backups: profile null, no industries/skill_categories, no views.
    const b = {
      $schema: 'resumestudio/v1', format_version: 1, exported_at: '2026-01-01T00:00:00Z',
      profile: null,
      registries: { skills: [], roles: [] },
      sections: { key_qualifications: [], projects: [], work_experiences: [], educations: [], courses: [], certifications: [], spoken_languages: [], positions: [], presentations: [], honor_awards: [], publications: [], references: [] },
    }
    expect(() => validateBackup(b)).not.toThrow()
  })

  it('rejects a collection that is not an array', () => {
    const b = good()
    ;(b['sections'] as Record<string, unknown>)['projects'] = { 0: 'nope' }
    expect(() => validateBackup(b)).toThrow(/sections\.projects/)
  })

  it('rejects an item missing its id, with the exact path', () => {
    const b = good()
    ;(b['sections'] as Record<string, unknown>)['projects'] = [{ customer: {} }, { id: 'ok' }]
    try {
      validateBackup(b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as InvalidBackupError).issues[0].path).toBe('sections.projects[0].id')
    }
  })

  it('rejects a non-object item in a registry array', () => {
    const b = good()
    ;(b['registries'] as Record<string, unknown>)['skills'] = ['just a string']
    expect(() => validateBackup(b)).toThrow(/registries\.skills\[0\]/)
  })

  it('rejects views that are not id-bearing objects', () => {
    const b = good()
    b['views'] = [{ name: 'no id here' }]
    expect(() => validateBackup(b)).toThrow(/views\[0\]\.id/)
  })

  it('allows the legacy technology_categories blob as any array', () => {
    const b = good()
    ;(b['sections'] as Record<string, unknown>)['technology_categories'] = [{ anything: true }, 'even this']
    expect(() => validateBackup(b)).not.toThrow()
  })

  it('collects every problem in one pass, not just the first', () => {
    const b = good()
    b['format_version'] = '1'
    ;(b['sections'] as Record<string, unknown>)['projects'] = 'nope'
    ;(b['registries'] as Record<string, unknown>)['roles'] = [{ noId: 1 }]
    try {
      validateBackup(b)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as InvalidBackupError).issues.length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('importFromBackup() gates on validation', () => {
  it('throws InvalidBackupError before building a store from a malformed backup', () => {
    const b = exportToBackup(emptyStore()) as unknown as Record<string, unknown>
    ;(b['sections'] as Record<string, unknown>)['projects'] = [{ customer: {} }] // no id
    expect(() => importFromBackup(b as unknown as AnyBackup)).toThrow(InvalidBackupError)
  })

  it('still imports a valid backup unchanged', () => {
    const store = { ...emptyStore(), projects: [makeProject()], views: [makeView()] }
    const back = importFromBackup(exportToBackup(store))
    expect(back.projects).toHaveLength(1)
    expect(back.views).toHaveLength(1)
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
