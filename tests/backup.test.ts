import { describe, it, expect } from 'vitest'
import {
  isBackupFormat, exportToBackup, importFromBackup,
  migrateBackup, UnsupportedBackupVersionError, CURRENT_FORMAT_VERSION,
  validateBackup, InvalidBackupError,
  isStoreBackupFormat, resumesFromStoreBackup, normalizeStoreShape, looksLikeResumeStore,
  type AnyBackup,
} from '../src/lib/backup'
import { CURRENT_SHAPE_VERSION } from '../src/lib/migrate'
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

  it('omits canonical_registry when no registry is passed', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ canonical_id: 'c1' })] }
    expect(exportToBackup(store).canonical_registry).toBeUndefined()
  })

  it('embeds snapshots of the canonical entries the store links to', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', canonical_id: 'c1' })] }
    const canonical = [
      { id: 'c1', kind: 'skill' as const, name: { en: 'React' }, key: 'react', extra: {}, version: 3, updated_at: 'x' },
      { id: 'c2', kind: 'skill' as const, name: { en: 'Go' }, key: 'go', extra: {}, version: 1, updated_at: 'x' },
    ]
    const backup = exportToBackup(store, canonical)
    // Only the referenced entry, identity-only (no version/extra).
    expect(backup.canonical_registry).toEqual([{ id: 'c1', kind: 'skill', name: { en: 'React' }, key: 'react' }])
  })

  it('leaves canonical_registry off when the store has links but the registry is empty', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ canonical_id: 'c1' })] }
    expect(exportToBackup(store, []).canonical_registry).toBeUndefined()
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

// ─── Whole-store (desktop-sync) backup ────────────────────────────────────────
//
// Regression: the `resumestudio-store/v1` file (every resume in one JSON, written
// by the desktop build into a sync folder) used to slip past `isBackupFormat`
// (which matches only "resumestudio/") and fall through to the CVpartner
// importer, restoring an EMPTY resume. These pin the format's own reader.

function storeBackup(resumes: unknown[], extra: Record<string, unknown> = {}) {
  return {
    $schema: 'resumestudio-store/v1',
    format_version: 1,
    exported_at: '2026-07-22T15:33:04.502Z',
    generator: 'resume-studio',
    resumes,
    ...extra,
  }
}

function storeEntry(data: unknown, name = 'Someone — CV') {
  return {
    id: 'entry-1', name, primary_locale: 'no', secondary_locale: 'en',
    saved_at: '2026-07-22T15:32:37.594Z', created_at: '2026-06-05T17:59:49.311Z',
    data,
  }
}

describe('isStoreBackupFormat()', () => {
  it('accepts a whole-store backup envelope', () => {
    expect(isStoreBackupFormat(storeBackup([]))).toBe(true)
  })

  it('rejects a per-resume backup (resumestudio/ — not resumestudio-store/)', () => {
    expect(isStoreBackupFormat(exportToBackup(emptyStore()))).toBe(false)
  })

  it('rejects null, non-objects, and a missing resumes array', () => {
    expect(isStoreBackupFormat(null)).toBe(false)
    expect(isStoreBackupFormat('x')).toBe(false)
    expect(isStoreBackupFormat({ $schema: 'resumestudio-store/v1', format_version: 1 })).toBe(false)
  })
})

describe('resumesFromStoreBackup()', () => {
  it('restores each resume with its content INTACT (the empty-resume regression)', () => {
    const store = { ...emptyStore(), projects: [makeProject('p1'), makeProject('p2')] }
    const restored = resumesFromStoreBackup(storeBackup([storeEntry(store, 'Jane — CV')]))
    expect(restored).toHaveLength(1)
    expect(restored[0].name).toBe('Jane — CV')
    expect(restored[0].store.projects).toHaveLength(2)
  })

  it('recovers as many resumes as possible, skipping a malformed entry', () => {
    const good = storeEntry({ ...emptyStore(), work_experiences: [makeWork('w1')] })
    const restored = resumesFromStoreBackup(storeBackup([good, { id: 'x' /* no data */ }, null]))
    expect(restored).toHaveLength(1)
    expect(restored[0].store.work_experiences).toHaveLength(1)
  })

  it('throws InvalidBackupError when nothing readable is inside', () => {
    expect(() => resumesFromStoreBackup(storeBackup([{ id: 'x' }, null])))
      .toThrow(InvalidBackupError)
  })

  it('throws InvalidBackupError for a non-store-backup', () => {
    expect(() => resumesFromStoreBackup(exportToBackup(emptyStore())))
      .toThrow(InvalidBackupError)
  })

  it('throws UnsupportedBackupVersionError for a newer envelope', () => {
    expect(() => resumesFromStoreBackup(storeBackup([storeEntry(emptyStore())], { format_version: 2 })))
      .toThrow(UnsupportedBackupVersionError)
  })
})

describe('normalizeStoreShape()', () => {
  it('fills every missing top-level collection so migrations never hit an absent array', () => {
    const store = normalizeStoreShape({ resume: null, projects: [makeProject('p1')] })
    // A field the raw data omitted entirely is present and empty.
    expect(store.industries).toEqual([])
    expect(store.cover_letters).toEqual([])
    expect(store.skill_categories).toEqual([])
    // Provided content survives.
    expect(store.projects).toHaveLength(1)
  })

  it('coerces a wrong-typed collection to an empty array', () => {
    const store = normalizeStoreShape({ projects: 'not-an-array' as unknown })
    expect(store.projects).toEqual([])
  })

  it('preserves the backup OWN shape stamp — including undefined for pre-versioning data', () => {
    expect(normalizeStoreShape({ shape_version: 5 }).shape_version).toBe(5)
    // No stamp → undefined (NOT CURRENT), so migrateStore still runs on old data.
    expect(normalizeStoreShape({}).shape_version).toBeUndefined()
  })

  it('keeps a current-version store at CURRENT (round-trips cleanly)', () => {
    const store = normalizeStoreShape({ ...emptyStore() })
    expect(store.shape_version).toBe(CURRENT_SHAPE_VERSION)
  })
})

describe('looksLikeResumeStore()', () => {
  it('accepts a bare/legacy ResumeStore (resume slot + its own collections)', () => {
    expect(looksLikeResumeStore(emptyStore())).toBe(true)
    expect(looksLikeResumeStore({ resume: null, projects: [], skills: [] })).toBe(true)
  })

  it('rejects a per-resume backup envelope (profile/sections, not a raw store)', () => {
    expect(looksLikeResumeStore(exportToBackup(emptyStore()))).toBe(false)
  })

  it('rejects a CVpartner-shaped object (no resume wrapper)', () => {
    expect(looksLikeResumeStore({ project_experiences: [], work_experiences: [], educations: [] })).toBe(false)
  })

  it('rejects a random object and non-objects', () => {
    expect(looksLikeResumeStore({ resume: null })).toBe(false) // resume but no collections
    expect(looksLikeResumeStore({ foo: 1 })).toBe(false)
    expect(looksLikeResumeStore(null)).toBe(false)
    expect(looksLikeResumeStore([1, 2, 3])).toBe(false)
  })
})
