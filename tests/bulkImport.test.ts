import { describe, it, expect } from 'vitest'
import {
  BULK_IMPORT_SCHEMA, BULK_SPECS, bulkSpec, isBulkSection, isBulkImportFormat,
  validateBulkImport, mapBulkItems, appendBulkItems, findDuplicates,
  bulkInstructions, toLocalized, toYearMonth, InvalidBulkImportError,
  type BulkSectionSpec, type BulkFileV1,
} from '../src/lib/bulkImport'
import { emptyStore, makeResume, makeProject, makeCourse, makeSkill, makeRole, makeWork } from './fixtures'
import type { ResumeStore } from '../src/types'

/** A store with a resume attached — mappers read `resume.id`. */
function storeWithResume(over: Partial<ResumeStore> = {}): ResumeStore {
  return { ...emptyStore(), resume: makeResume({ id: 'r1' }), ...over }
}

/** A minimal valid file for a section. */
function file(section: string, items: Record<string, unknown>[]): unknown {
  return { $schema: BULK_IMPORT_SCHEMA, section, items }
}

describe('toLocalized()', () => {
  it('wraps a plain string in the default locale', () => {
    expect(toLocalized('Hei', 'no')).toEqual({ no: 'Hei' })
  })

  it('keeps a per-locale object as-is — the point of the format', () => {
    expect(toLocalized({ no: 'Ledet migrering', en: 'Led the migration' }, 'no'))
      .toEqual({ no: 'Ledet migrering', en: 'Led the migration' })
  })

  it('drops empty values and coerces numbers', () => {
    expect(toLocalized({ no: '  ', en: 'Kept' }, 'no')).toEqual({ en: 'Kept' })
    expect(toLocalized(2024, 'en')).toEqual({ en: '2024' })
    expect(toLocalized('', 'en')).toEqual({})
    expect(toLocalized(null, 'en')).toEqual({})
  })
})

describe('toYearMonth()', () => {
  it('accepts a bare year, an object, and null', () => {
    expect(toYearMonth(2019)).toEqual({ year: 2019, month: null })
    expect(toYearMonth('2019')).toEqual({ year: 2019, month: null })
    expect(toYearMonth({ year: 2019, month: 6 })).toEqual({ year: 2019, month: 6 })
    expect(toYearMonth(null)).toBeNull()
  })

  it('drops an out-of-range month rather than failing', () => {
    expect(toYearMonth({ year: 2019, month: 13 })).toEqual({ year: 2019, month: null })
    expect(toYearMonth({ year: 2019, month: 0 })).toEqual({ year: 2019, month: null })
  })
})

describe('the spec table', () => {
  it('covers the content sections and excludes languages + registries', () => {
    const keys = BULK_SPECS.map((s) => s.key).sort()
    expect(keys).toEqual([
      'certifications', 'courses', 'educations', 'honor_awards', 'key_competencies',
      'key_qualifications', 'positions', 'presentations', 'projects', 'publications',
      'recommendations', 'references', 'work_experiences',
    ])
    expect(isBulkSection('spoken_languages')).toBe(false)
    expect(isBulkSection('skills')).toBe(false)
    expect(isBulkSection('roles')).toBe(false)
    expect(isBulkSection('industries')).toBe(false)
    expect(isBulkSection('views')).toBe(false)
  })

  it('every spec maps an empty item without throwing (mappers are total)', () => {
    const ctx = {
      resumeId: 'r1', defaultLocale: 'en',
      internSkill: () => 's1', internRole: () => 'ro1',
    }
    for (const spec of BULK_SPECS) {
      expect(() => spec.make({}, ctx), spec.key).not.toThrow()
      const item = spec.make({}, ctx)
      expect(item['id'], spec.key).toBeTruthy()
      expect(item['resume_id'], spec.key).toBe('r1')
    }
  })

  it('every spec produces preview text without throwing', () => {
    const ctx = { resumeId: 'r1', defaultLocale: 'en', internSkill: () => 's', internRole: () => 'r' }
    for (const spec of BULK_SPECS) {
      const item = spec.make({}, ctx)
      expect(() => spec.title(item, 'en'), spec.key).not.toThrow()
      expect(() => spec.subtitle(item, 'en'), spec.key).not.toThrow()
      expect(() => spec.dupKeys(item), spec.key).not.toThrow()
    }
  })
})

describe('isBulkImportFormat()', () => {
  it('matches any resumestudio-bulk/ version, rejects everything else', () => {
    expect(isBulkImportFormat({ $schema: 'resumestudio-bulk/v1' })).toBe(true)
    expect(isBulkImportFormat({ $schema: 'resumestudio-bulk/v9' })).toBe(true)
    expect(isBulkImportFormat({ $schema: 'resumestudio-ai/v1' })).toBe(false)
    expect(isBulkImportFormat({})).toBe(false)
    expect(isBulkImportFormat(null)).toBe(false)
    expect(isBulkImportFormat([])).toBe(false)
  })
})

describe('validateBulkImport()', () => {
  it('accepts a well-formed file', () => {
    const out = validateBulkImport(file('courses', [{ name: 'Kubernetes 101' }]), 'courses')
    expect(out.items).toHaveLength(1)
  })

  it('rejects a file for a DIFFERENT section, naming both', () => {
    try {
      validateBulkImport(file('projects', [{ customer: 'X' }]), 'courses')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidBulkImportError)
      const issues = (e as InvalidBulkImportError).issues
      expect(issues[0].path).toBe('section')
      expect(issues[0].reason).toContain('Projects')
      expect(issues[0].reason).toContain('Courses')
    }
  })

  it('rejects a wrong/missing $schema', () => {
    expect(() => validateBulkImport({ $schema: 'nope', section: 'courses', items: [] }, 'courses'))
      .toThrow(InvalidBulkImportError)
  })

  it('rejects a non-array items and an empty batch', () => {
    expect(() => validateBulkImport({ $schema: BULK_IMPORT_SCHEMA, section: 'courses', items: {} }, 'courses'))
      .toThrow(/expected an array/)
    expect(() => validateBulkImport(file('courses', []), 'courses')).toThrow(/no items/)
  })

  it('reports every issue at once, with a dotted path', () => {
    try {
      validateBulkImport(file('courses', [
        { name: { 123: 'bad locale' } },
        { completed: { year: 99 } },
      ]), 'courses')
      expect.unreachable('should have thrown')
    } catch (e) {
      const issues = (e as InvalidBulkImportError).issues
      expect(issues).toHaveLength(2)
      expect(issues.map((i) => i.path)).toEqual(['items[0].name.123', 'items[1].completed.year'])
    }
  })

  it('accepts both a string and a per-locale object for a text field', () => {
    expect(() => validateBulkImport(file('courses', [
      { name: 'Plain' },
      { name: { en: 'English', no: 'Norsk' } },
    ]), 'courses')).not.toThrow()
  })

  it('rejects an object where a non-translated field belongs', () => {
    expect(() => validateBulkImport(file('references', [{ name: { en: 'Ada' } }]), 'references'))
      .toThrow(/not translated/)
  })

  it('rejects an unknown enum value but accepts a known one', () => {
    expect(() => validateBulkImport(file('work_experiences', [{ employment_type: 'gig' }]), 'work_experiences'))
      .toThrow(/expected one of/)
    expect(() => validateBulkImport(file('work_experiences', [{ employment_type: 'contract' }]), 'work_experiences'))
      .not.toThrow()
  })

  it('is lenient about unknown extra keys the mapper ignores', () => {
    expect(() => validateBulkImport(file('courses', [{ name: 'X', vibes: 'immaculate' }]), 'courses'))
      .not.toThrow()
  })
})

describe('mapBulkItems()', () => {
  const spec = bulkSpec('projects') as BulkSectionSpec

  it('maps localized fields, dates and links', () => {
    const f = validateBulkImport(file('projects', [{
      customer: { en: 'AcmeCo', no: 'AcmeCo AS' },
      description: { en: 'Led the migration', no: 'Ledet migrering' },
      start: { year: 2022, month: 3 },
      end: null,
    }]), 'projects') as BulkFileV1
    const { items } = mapBulkItems(f, spec, storeWithResume(), 'en')
    expect(items[0]['customer']).toEqual({ en: 'AcmeCo', no: 'AcmeCo AS' })
    expect(items[0]['description']).toEqual({ en: 'Led the migration', no: 'Ledet migrering' })
    expect(items[0]['start']).toEqual({ year: 2022, month: 3 })
    expect(items[0]['end']).toBeNull()
  })

  it('reuses an existing registry skill instead of duplicating it', () => {
    const store = storeWithResume({
      skills: [makeSkill({ id: 'existing', name: { en: 'TypeScript' } })],
    })
    const f = validateBulkImport(file('projects', [{ skills: ['typescript', 'Rust'] }]), 'projects') as BulkFileV1
    const { items, additions } = mapBulkItems(f, spec, store, 'en')
    const links = items[0]['skills'] as { skill_id: string }[]
    expect(links[0].skill_id).toBe('existing')      // case-insensitive hit
    expect(additions.skills).toHaveLength(1)        // only Rust is new
    expect(additions.skills[0].name).toEqual({ en: 'Rust' })
  })

  it('matches an existing registry entry by ANY of its locale names', () => {
    const store = storeWithResume({
      roles: [makeRole({ id: 'r-lead', name: { en: 'Tech lead', no: 'Teknisk leder' } })],
    })
    const f = validateBulkImport(file('projects', [{ roles: ['Teknisk leder'] }]), 'projects') as BulkFileV1
    const { items, additions } = mapBulkItems(f, spec, store, 'no')
    expect((items[0]['roles'] as { role_id: string }[])[0].role_id).toBe('r-lead')
    expect(additions.roles).toHaveLength(0)
  })

  it('interns a repeated new name once across items', () => {
    const f = validateBulkImport(file('projects', [
      { skills: ['Go'] }, { skills: ['go'] },
    ]), 'projects') as BulkFileV1
    const { items, additions } = mapBulkItems(f, spec, storeWithResume(), 'en')
    expect(additions.skills).toHaveLength(1)
    expect((items[0]['skills'] as { skill_id: string }[])[0].skill_id)
      .toBe((items[1]['skills'] as { skill_id: string }[])[0].skill_id)
  })

  it('links a project to an existing employer by name, and strips the carrier', () => {
    const store = storeWithResume({
      work_experiences: [makeWork({ id: 'w1', employer: { en: 'Cartavio' } })],
    })
    const f = validateBulkImport(file('projects', [
      { customer: 'A', employer: 'cartavio' },
      { customer: 'B', employer: 'Someone else' },
    ]), 'projects') as BulkFileV1
    const { items } = mapBulkItems(f, spec, store, 'en')
    expect(items[0]['work_experience_id']).toBe('w1')
    expect(items[1]['work_experience_id']).toBeNull()
    expect('_employer' in items[0]).toBe(false) // carrier never reaches the store
  })

  it('carries free-text industry as the legacy field for migrateStore to intern', () => {
    const f = validateBulkImport(file('projects', [{ industry: { en: 'Banking' } }]), 'projects') as BulkFileV1
    const { items } = mapBulkItems(f, spec, storeWithResume(), 'en')
    expect(items[0]['industry']).toEqual({ en: 'Banking' })
  })

  it('defaults a reference to private (never auto-exports contact details)', () => {
    const refSpec = bulkSpec('references') as BulkSectionSpec
    const f = validateBulkImport(file('references', [{ name: 'Ada', email: 'ada@x.com' }]), 'references') as BulkFileV1
    const { items } = mapBulkItems(f, refSpec, storeWithResume(), 'en')
    expect(items[0]['include_in_exports']).toBe(false)
  })
})

describe('findDuplicates()', () => {
  const spec = bulkSpec('courses') as BulkSectionSpec
  const ctx = { resumeId: 'r1', defaultLocale: 'en', internSkill: () => 's', internRole: () => 'r' }

  it('flags an incoming item matching one already in the section', () => {
    const existing = [makeCourse({ name: { en: 'Kubernetes 101' }, completed: { year: 2023, month: 4 } })]
    const incoming = [
      spec.make({ name: 'Kubernetes 101', completed: { year: 2023, month: 4 } }, ctx),
      spec.make({ name: 'Rust for Rustaceans', completed: { year: 2024 } }, ctx),
    ]
    const dups = findDuplicates(incoming, existing as unknown as Record<string, unknown>[], spec)
    expect([...dups]).toEqual([0])
  })

  it('does not flag the same name at a different date', () => {
    const existing = [makeCourse({ name: { en: 'Kubernetes 101' }, completed: { year: 2019 } })]
    const incoming = [spec.make({ name: 'Kubernetes 101', completed: { year: 2024 } }, ctx)]
    expect(findDuplicates(incoming, existing as unknown as Record<string, unknown>[], spec).size).toBe(0)
  })

  it('matches on ANY locale — a bilingual incoming item vs a NO-only existing one', () => {
    // The whole point of the format is an LLM filling both columns at once, so
    // the incoming item carries locales the existing one never had.
    const existing = [makeCourse({ name: { no: 'Kubernetes grunnkurs' }, completed: null })]
    const incoming = [
      spec.make({ name: { no: 'Kubernetes grunnkurs', en: 'Kubernetes basics' } }, ctx),
    ]
    expect([...findDuplicates(incoming, existing as unknown as Record<string, unknown>[], spec)]).toEqual([0])
  })

  it('matches when only the English name overlaps', () => {
    const existing = [makeCourse({ name: { en: 'Kubernetes basics' }, completed: null })]
    const incoming = [
      spec.make({ name: { no: 'Noe helt annet', en: 'Kubernetes basics' } }, ctx),
    ]
    expect([...findDuplicates(incoming, existing as unknown as Record<string, unknown>[], spec)]).toEqual([0])
  })

  it('flags a duplicate WITHIN the incoming batch, keeping the first', () => {
    const incoming = [
      spec.make({ name: 'Repeated', completed: { year: 2024 } }, ctx),
      spec.make({ name: 'repeated', completed: { year: 2024 } }, ctx),
    ]
    expect([...findDuplicates(incoming, [], spec)]).toEqual([1])
  })

  it('never flags an item with nothing distinctive to compare', () => {
    const incoming = [spec.make({}, ctx), spec.make({}, ctx)]
    expect(findDuplicates(incoming, [], spec).size).toBe(0)
  })
})

describe('appendBulkItems()', () => {
  const spec = bulkSpec('courses') as BulkSectionSpec
  const ctx = { resumeId: 'r1', defaultLocale: 'en', internSkill: () => 's', internRole: () => 'r' }

  it('appends after existing items and continues sort_order', () => {
    const store = storeWithResume({
      courses: [makeCourse({ id: 'c1', sort_order: 0 }), makeCourse({ id: 'c2', sort_order: 7 })],
    })
    const items = [spec.make({ name: 'New A' }, ctx), spec.make({ name: 'New B' }, ctx)]
    const out = appendBulkItems(store, spec, items)
    expect(out.courses).toHaveLength(4)
    expect(out.courses.map((c) => c.sort_order)).toEqual([0, 7, 8, 9])
    expect(out.courses[0].id).toBe('c1') // existing order untouched
  })

  it('starts at 0 on an empty section', () => {
    const items = [spec.make({ name: 'First' }, ctx)]
    expect(appendBulkItems(storeWithResume(), spec, items).courses[0].sort_order).toBe(0)
  })

  it('does not mutate the input store', () => {
    const store = storeWithResume({ courses: [makeCourse({ id: 'c1' })] })
    appendBulkItems(store, spec, [spec.make({ name: 'X' }, ctx)])
    expect(store.courses).toHaveLength(1)
  })

  it('merges registry additions', () => {
    const store = storeWithResume({ skills: [makeSkill({ id: 's0' })] })
    const out = appendBulkItems(store, spec, [], {
      skills: [makeSkill({ id: 's1', name: { en: 'Rust' } })],
      roles: [makeRole({ id: 'r1' })],
    })
    expect(out.skills.map((s) => s.id)).toEqual(['s0', 's1'])
    expect(out.roles).toHaveLength(1)
  })

  it('tolerates a section whose items carry no sort_order (References)', () => {
    const refSpec = bulkSpec('references') as BulkSectionSpec
    const items = [refSpec.make({ name: 'Ada' }, ctx)]
    const out = appendBulkItems(storeWithResume(), refSpec, items)
    expect(out.references).toHaveLength(1)
    expect('sort_order' in out.references[0]).toBe(false)
  })
})

describe('bulkInstructions()', () => {
  const spec = bulkSpec('projects') as BulkSectionSpec

  it('pins the schema and section so the file validates against this section', () => {
    const md = bulkInstructions(spec, ['en'])
    expect(md).toContain(BULK_IMPORT_SCHEMA)
    expect(md).toContain('"section": "projects"')
  })

  it('names every field of the spec', () => {
    const md = bulkInstructions(spec, ['en'])
    for (const f of spec.fields) expect(md, f.name).toContain(`\`${f.name}\``)
  })

  it('asks a multi-language resume for per-locale objects naming its locales', () => {
    const md = bulkInstructions(spec, ['no', 'en'])
    expect(md).toContain('written in 2 languages')
    // The endonym tells the model which language to actually write.
    expect(md).toContain('no (Norsk)')
    expect(md).toContain('en (English)')
    expect(md).toContain('"no": "…", "en": "…"')
  })

  it('keeps a single-language resume simple', () => {
    const md = bulkInstructions(spec, ['en'])
    expect(md).not.toContain('languages:')
    expect(md).toContain('en (English)')
  })

  it('never renders a locale label as [object Object]', () => {
    expect(bulkInstructions(spec, ['no', 'en', 'zz'])).not.toContain('[object')
  })

  it('lists the allowed values for an enum field', () => {
    const md = bulkInstructions(bulkSpec('work_experiences') as BulkSectionSpec, ['en'])
    expect(md).toContain('permanent | contract | freelance | part_time | internship')
  })

  it('tells the model not to invent content', () => {
    const md = bulkInstructions(spec, ['en'])
    expect(md).toMatch(/Do not invent/i)
  })
})

describe('end-to-end: paste → validate → map → append', () => {
  it('adds bilingual projects to a resume that already has some', () => {
    const store = storeWithResume({
      projects: [makeProject({ id: 'p0', sort_order: 0, customer: { en: 'Existing' } })],
      skills: [makeSkill({ id: 's-ts', name: { en: 'TypeScript' } })],
    })
    const spec = bulkSpec('projects') as BulkSectionSpec
    const raw = {
      $schema: BULK_IMPORT_SCHEMA,
      section: 'projects',
      items: [{
        customer: 'Sparebank 1',
        description: { no: 'Ledet migrering til skyen', en: 'Led the cloud migration' },
        skills: ['TypeScript', 'Terraform'],
        roles: ['Tech lead'],
        start: { year: 2023, month: 1 },
        end: null,
      }],
    }
    const validated = validateBulkImport(raw, 'projects')
    const { items, additions } = mapBulkItems(validated, spec, store, 'no')
    const out = appendBulkItems(store, spec, items, additions)

    expect(out.projects).toHaveLength(2)
    expect(out.projects[1].customer).toEqual({ no: 'Sparebank 1' })
    expect(out.projects[1].description).toEqual({
      no: 'Ledet migrering til skyen', en: 'Led the cloud migration',
    })
    expect(out.projects[1].sort_order).toBe(1)
    // TypeScript reused, Terraform added.
    expect(out.skills).toHaveLength(2)
    expect(out.projects[1].skills[0].skill_id).toBe('s-ts')
    expect(out.roles).toHaveLength(1)
  })
})
