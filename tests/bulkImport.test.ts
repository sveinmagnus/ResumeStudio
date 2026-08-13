import { describe, it, expect } from 'vitest'
import {
  BULK_IMPORT_SCHEMA, BULK_SPECS, bulkSpec, isBulkSection, isBulkImportFormat,
  validateBulkImport, mapBulkItems, appendBulkItems, findDuplicates,
  bulkInstructions, intakeInstructions, toLocalized, toYearMonth, InvalidBulkImportError,
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

  /**
   * The preview label falls back across locales. A batch written only in
   * Norwegian, previewed in English, would otherwise show a column of blank
   * rows and look like it had imported nothing.
   */
  it('labels a preview row from another locale when the asked-for one is empty', () => {
    const ctx = { resumeId: 'r1', defaultLocale: 'en', internSkill: () => 's', internRole: () => 'r' }
    const spec = BULK_SPECS.find((s) => s.key === 'projects')!

    const both = spec.make({ customer: { en: 'Acme', no: 'Acme AS' } }, ctx)
    expect(spec.title(both, 'en')).toBe('Acme')
    expect(spec.title(both, 'no')).toBe('Acme AS')

    const norwegianOnly = spec.make({ customer: { no: 'Statens vegvesen' } }, ctx)
    expect(spec.title(norwegianOnly, 'en')).toBe('Statens vegvesen')

    // Nothing to show is empty, not a crash — including when the value isn't a
    // localized object at all, which is what a legacy or hand-built item looks
    // like. The preview must never be the thing that throws.
    expect(spec.title(spec.make({}, ctx), 'en')).toBe('')
    expect(spec.title({ customer: 'a bare string' }, 'en')).toBe('')
    expect(spec.title({ customer: null }, 'en')).toBe('')
  })

  it('keys a duplicate on every locale name, and on the date when there is one', () => {
    const ctx = { resumeId: 'r1', defaultLocale: 'en', internSkill: () => 's', internRole: () => 'r' }
    const spec = BULK_SPECS.find((s) => s.key === 'courses')!

    // One key per distinct name — a name repeated across locales is not two.
    const two = spec.dupKeys(spec.make({ name: { en: 'Kubernetes', no: 'Kubernetes' } }, ctx))
    expect(two).toHaveLength(1)
    expect(spec.dupKeys(spec.make({ name: { en: 'Kubernetes', no: 'Containere' } }, ctx))).toHaveLength(2)

    // A year with no month must not key the same as a year with one, or an
    // undated entry would collide with every dated one.
    // The paste field is "completed"; the mapper puts it on the range's end.
    const undated = spec.dupKeys(spec.make({ name: 'Kubernetes' }, ctx))
    const dated = spec.dupKeys(spec.make({ name: 'Kubernetes', completed: { year: 2024, month: 3 } }, ctx))
    const yearOnly = spec.dupKeys(spec.make({ name: 'Kubernetes', completed: 2024 }, ctx))
    expect(new Set([...undated, ...dated, ...yearOnly]).size).toBe(3)
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

  it('takes a scalar or null for a text field, but not a list', () => {
    // A model answering 2019 for a name is sloppy, not unusable; an array is a
    // different shape and would be dropped silently by the mapper.
    expect(() => validateBulkImport(file('courses', [
      { name: 2019 }, { name: true }, { name: null }, { program: undefined },
    ]), 'courses')).not.toThrow()
    expect(() => validateBulkImport(file('courses', [{ name: ['a', 'b'] }]), 'courses'))
      .toThrow(/expected a string, or an object of locale/)
  })

  it('checks the keys of a per-locale object are locale codes', () => {
    // A model that keys by language NAME produces text nothing will ever read,
    // because no locale resolves to "english".
    expect(() => validateBulkImport(file('courses', [{ name: { english: 'Kubernetes' } }]), 'courses'))
      .toThrow(/expected a locale code/)
    expect(() => validateBulkImport(file('courses', [{ name: { 'en-GB': 'Kubernetes' } }]), 'courses'))
      .not.toThrow()
  })

  it('rejects a locale slot holding something other than text', () => {
    expect(() => validateBulkImport(file('courses', [{ name: { en: { nested: 'no' } } }]), 'courses'))
      .toThrow(/items\[0\].name.en/)
    // A number in a locale slot is still text as far as the mapper cares.
    expect(() => validateBulkImport(file('courses', [{ name: { en: 2019 } }]), 'courses')).not.toThrow()
  })

  it('names the single problem in its message rather than counting to one', () => {
    expect(() => validateBulkImport(file('courses', [{ name: ['a'] }]), 'courses'))
      .toThrow(/items\[0\]\.name:/)
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
    const existing = [makeCourse({ name: { en: 'Kubernetes 101' }, end: { year: 2023, month: 4 } })]
    const incoming = [
      spec.make({ name: 'Kubernetes 101', completed: { year: 2023, month: 4 } }, ctx),
      spec.make({ name: 'Rust for Rustaceans', completed: { year: 2024 } }, ctx),
    ]
    const dups = findDuplicates(incoming, existing as unknown as Record<string, unknown>[], spec)
    expect([...dups]).toEqual([0])
  })

  it('does not flag the same name at a different date', () => {
    const existing = [makeCourse({ name: { en: 'Kubernetes 101' }, end: { year: 2019 } })]
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

/**
 * The field kinds the existing cases never reach: date, list and bool.
 *
 * Validation is the ONLY thing standing between a model's improvised JSON and
 * the open resume, and each kind is a separate arm of one switch — so an arm
 * nobody exercises accepts whatever the model sent. `date` matters most: it is
 * used by 15 fields across the specs, and a bad one does not fail loudly, it
 * lands as a wrong or missing year on a CV entry.
 */
describe('validateBulkImport() — the unexercised field kinds', () => {
  const courses = (item: Record<string, unknown>) => () =>
    validateBulkImport(file('courses', [{ name: 'X', ...item }]), 'courses')

  describe('date', () => {
    it('takes a bare year as a number or a string', () => {
      expect(courses({ completed: 2019 })).not.toThrow()
      expect(courses({ completed: '2019' })).not.toThrow()
    })

    it('takes a { year, month } object, with month optional', () => {
      expect(courses({ completed: { year: 2019, month: 6 } })).not.toThrow()
      expect(courses({ completed: { year: 2019, month: null } })).not.toThrow()
      expect(courses({ completed: { year: 2019 } })).not.toThrow()
    })

    it('rejects a year outside 1000–3000, naming the value', () => {
      // A two-digit year is the mistake to catch: '19' would otherwise land as
      // year 19 and sort the entry before everything else in the CV.
      expect(courses({ completed: 19 })).toThrow(/4-digit year/)
      expect(courses({ completed: 99999 })).toThrow(/4-digit year/)
      expect(courses({ completed: 'last year' })).toThrow(/4-digit year/)
    })

    it('rejects a month outside 1–12, and a fractional one', () => {
      expect(courses({ completed: { year: 2019, month: 0 } })).toThrow(/month 1/)
      expect(courses({ completed: { year: 2019, month: 13 } })).toThrow(/month 1/)
      expect(courses({ completed: { year: 2019, month: 6.5 } })).toThrow(/month 1/)
    })

    it('points at the sub-field, not just the date', () => {
      expect(courses({ completed: { year: 2019, month: 13 } })).toThrow(/completed\.month/)
      expect(courses({ completed: { year: 19, month: 6 } })).toThrow(/completed\.year/)
    })

    it('rejects a shape that is neither a year nor an object', () => {
      expect(courses({ completed: [2019] })).toThrow(/year number or a \{ year, month \} object/)
    })

    it('treats null as "not given" rather than as an error', () => {
      expect(courses({ completed: null })).not.toThrow()
    })
  })

  describe('list', () => {
    const proj = (item: Record<string, unknown>) => () =>
      validateBulkImport(file('projects', [{ customer: 'Acme', ...item }]), 'projects')

    it('accepts an array of strings, and of numbers', () => {
      expect(proj({ skills: ['Go', 'Kubernetes'] })).not.toThrow()
      expect(proj({ skills: [1, 2] })).not.toThrow()
    })

    it('rejects a bare string where a list belongs', () => {
      // A model asked for a list often sends "Go, Kubernetes" instead; silently
      // accepting it would intern one skill named after the whole sentence.
      expect(proj({ skills: 'Go, Kubernetes' })).toThrow(/expected an array of strings/)
    })

    it('names the offending INDEX when one entry is the wrong shape', () => {
      expect(proj({ skills: ['Go', { name: 'Kubernetes' }] })).toThrow(/skills\[1\]/)
    })

    it('tolerates a null entry rather than failing the whole batch', () => {
      expect(proj({ skills: ['Go', null] })).not.toThrow()
    })
  })

  describe('bool', () => {
    const edu = (item: Record<string, unknown>) => () =>
      validateBulkImport(file('educations', [{ school: 'NTNU', ...item }]), 'educations')

    it('accepts a real boolean', () => {
      expect(edu({ exchange: true })).not.toThrow()
      expect(edu({ exchange: false })).not.toThrow()
    })

    it('rejects the STRING "true", which is what a model usually sends', () => {
      expect(edu({ exchange: 'true' })).toThrow(/expected true or false/)
      expect(edu({ exchange: 1 })).toThrow(/expected true or false/)
    })
  })
})

/**
 * Registry interning and the envelope guards.
 *
 * A bulk add interns against what the resume ALREADY has, so a paste that
 * mentions "Kubernetes" reuses the existing skill rather than minting a second
 * one. That match is by NAME across every locale, because the existing entry may
 * only ever have had a Norwegian name.
 */
describe('mapBulkItems — registry interning', () => {
  const store = (over: Partial<ResumeStore> = {}): ResumeStore => ({
    ...emptyStore(),
    resume: makeResume({ id: 'r1', full_name: 'X' }),
    ...over,
  })
  const mapProjects = (s: ResumeStore, items: Array<Record<string, unknown>>) =>
    mapBulkItems(
      validateBulkImport(file('projects', items), 'projects'),
      bulkSpec('projects')!, s, 'en',
    )

  it('reuses an existing skill by name, case- and space-insensitively', () => {
    const s = store({ skills: [makeSkill({ id: 'k8s', name: { en: 'Kubernetes' } })] })
    const out = mapProjects(s, [{ customer: 'Acme', skills: ['  kubernetes  '] }])
    expect(out.additions.skills).toEqual([])
    expect((out.items[0].skills as Array<{ skill_id: string }>)[0].skill_id).toBe('k8s')
  })

  it('matches an existing entry by ANY of its locales', () => {
    // The existing skill may only ever have had a Norwegian name — matching one
    // representative name would mint a duplicate.
    const s = store({ skills: [makeSkill({ id: 'sky', name: { no: 'Skytjenester' } })] })
    const out = mapProjects(s, [{ customer: 'Acme', skills: ['Skytjenester'] }])
    expect(out.additions.skills).toEqual([])
  })

  it('creates a skill for a genuinely new name, in the default locale', () => {
    const out = mapProjects(store(), [{ customer: 'Acme', skills: ['Kubernetes'] }])
    expect(out.additions.skills).toHaveLength(1)
    expect(out.additions.skills[0].name).toEqual({ en: 'Kubernetes' })
  })

  it('interns one name ONCE across several items', () => {
    const out = mapProjects(store(), [
      { customer: 'Acme', skills: ['Kubernetes'] },
      { customer: 'Beta', skills: ['kubernetes'] },
    ])
    expect(out.additions.skills).toHaveLength(1)
  })

  it('creates a new skill unhighlighted and unmeasured', () => {
    // Highlighting drives the Skills Showcase; a bulk add must not fill it.
    const out = mapProjects(store(), [{ customer: 'Acme', skills: ['Kubernetes'] }])
    expect(out.additions.skills[0]).toMatchObject({
      is_highlighted: false, total_duration_in_years: 0, proficiency: 0, category_id: null,
    })
  })

  it('numbers new roles AFTER the ones the resume already has', () => {
    // Colliding sort_order values make the registry order arbitrary.
    const s = store({ roles: [makeRole({ id: 'a', name: { en: 'PM' }, sort_order: 0 })] })
    const out = mapProjects(s, [{ customer: 'Acme', roles: ['Architect', 'Developer'] }])
    expect(out.additions.roles.map((r) => r.sort_order)).toEqual([1, 2])
  })

  it('creates a new role unstarred and enabled', () => {
    const out = mapProjects(store(), [{ customer: 'Acme', roles: ['Architect'] }])
    expect(out.additions.roles[0]).toMatchObject({ starred: false, disabled: false })
  })

  it('reuses an existing role by name too', () => {
    const s = store({ roles: [makeRole({ id: 'arch', name: { en: 'Architect' } })] })
    const out = mapProjects(s, [{ customer: 'Acme', roles: ['architect'] }])
    expect(out.additions.roles).toEqual([])
  })

  it('stamps every mapped item with the resume’s own id', () => {
    const out = mapProjects(store(), [{ customer: 'Acme' }])
    expect(out.items[0].resume_id).toBe('r1')
  })

  it('survives a store with no resume rather than throwing', () => {
    const s = { ...emptyStore(), resume: null }
    expect(() => mapProjects(s, [{ customer: 'Acme' }])).not.toThrow()
  })
})

describe('validateBulkImport — the envelope guards', () => {
  it('rejects a missing $schema as well as a wrong one', () => {
    expect(() => validateBulkImport({ section: 'courses', items: [{ name: 'X' }] }, 'courses'))
      .toThrow(/\$schema/)
    expect(() => validateBulkImport(
      { $schema: 'resumestudio-bulk/v1', section: 'courses', items: [{ name: 'X' }] }, 'courses',
    )).not.toThrow()
  })

  it('rejects an EMPTY section string, not only a wrong one', () => {
    expect(() => validateBulkImport(
      { $schema: BULK_IMPORT_SCHEMA, section: '', items: [{ name: 'X' }] }, 'courses',
    )).toThrow(/section/)
  })

  it('names both the file’s section and the target when they differ', () => {
    // The whole point of carrying `section` is a message the user can act on.
    let msg = ''
    try { validateBulkImport(file('projects', [{ customer: 'X' }]), 'courses') }
    catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/Projects/)
    expect(msg).toMatch(/Courses/)
  })

  it('says "unknown section" for a name no spec claims', () => {
    let msg = ''
    try {
      validateBulkImport(
        { $schema: BULK_IMPORT_SCHEMA, section: 'vegetables', items: [{ name: 'X' }] }, 'courses',
      )
    } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/unknown section/i)
  })

  it('lists the legal enum values in the message', () => {
    let msg = ''
    try { validateBulkImport(file('work_experiences', [{ employment_type: 'gig' }]), 'work_experiences') }
    catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/permanent/)
  })
})

/**
 * The validator in front of a bulk paste.
 *
 * Hard errors are reserved for what would silently lose data, so each field kind
 * has its own check — and a check that stops firing lets a malformed value into
 * the store, where it renders as a blank line or breaks an export.
 */
describe('validateBulkImport — one check per field kind', () => {
  const file = (items: unknown[], section = 'educations') =>
    ({ $schema: BULK_IMPORT_SCHEMA, section, items })
  const issues = (json: unknown, section = 'educations'): string[] => {
    try {
      validateBulkImport(json, section as never)
      return []
    } catch (e) {
      return (e as InvalidBulkImportError).issues.map((i) => `${i.path}: ${i.reason}`)
    }
  }

  it('refuses a root that is not an object at all', () => {
    for (const bad of [null, undefined, 'text', 42, true, ['a']]) {
      expect(issues(bad), String(bad)).toEqual(['(root): expected a JSON object'])
    }
  })

  it('refuses a missing, empty or non-string section by NAMING what it wanted', () => {
    // Distinct from the mismatch message below: there is no section to compare,
    // so the file is unusable rather than pasted into the wrong list.
    for (const bad of [undefined, 42, '', null]) {
      const json: Record<string, unknown> = { $schema: BULK_IMPORT_SCHEMA, items: [] }
      if (bad !== undefined) json.section = bad
      // `items` is present and valid, so the section complaint is the only one
      // about the section itself.
      expect(issues(json).filter((i) => i.startsWith('section:')), String(bad))
        .toEqual(['section: expected "educations"'])
    }
  })

  it('says which section the file IS for when it names a real but different one', () => {
    expect(issues({ $schema: BULK_IMPORT_SCHEMA, section: 'projects', items: [] }).join())
      .toMatch(/this file is for Projects/)
  })

  it('refuses an item that is not an object, naming its index', () => {
    expect(issues(file([{ school: 'NTNU' }, 'not an object'])))
      .toEqual(['items[1]: expected an object'])
  })

  it('refuses a BOOLEAN field that is not a boolean', () => {
    // Educations carry `exchange`; the string "true" would be stored as truthy
    // without ever having been a boolean.
    expect(issues(file([{ school: 'NTNU', exchange: 'true' }])))
      .toEqual(['items[0].exchange: expected true or false'])
    expect(issues(file([{ school: 'NTNU', exchange: true }]))).toEqual([])
    expect(issues(file([{ school: 'NTNU', exchange: false }]))).toEqual([])
  })

  it('refuses an entry inside a LIST that is neither string nor number', () => {
    expect(issues(file([{ customer: 'Acme', skills: ['Go', { name: 'Rust' }] }], 'projects'), 'projects'))
      .toEqual(['items[0].skills[1]: expected a string'])
    // A number is fine — a model writing 3 for a version is not data loss.
    expect(issues(file([{ customer: 'Acme', skills: ['Go', 42, null] }], 'projects'), 'projects')).toEqual([])
  })

  it('refuses a list that is not an array', () => {
    expect(issues(file([{ customer: 'Acme', skills: 'Go, Rust' }], 'projects'), 'projects').join())
      .toMatch(/expected an array of strings/)
  })

  it('refuses an object where a NON-translated plain string belongs', () => {
    // `employer` on a project is a plain string: it matches an Employment entry
    // by name, so a localized object could never match one.
    expect(issues(file([{ customer: 'Acme', employer: { en: 'Cartavio' } }], 'projects'), 'projects').join())
      .toMatch(/not translated/)
    expect(issues(file([{ customer: 'Acme', employer: 'Cartavio' }], 'projects'), 'projects')).toEqual([])
  })

  it('refuses an out-of-vocabulary ENUM, listing what it accepts', () => {
    const out = issues(
      file([{ employer: 'Acme', employment_type: 'freelanceish' }], 'work_experiences'),
      'work_experiences',
    )
    expect(out.join()).toMatch(/expected one of/)
    expect(issues(file([{ employer: 'Acme', employment_type: 'permanent' }], 'work_experiences'), 'work_experiences'))
      .toEqual([])
  })

  it('ignores a field the item simply does not set', () => {
    expect(issues(file([{ school: 'NTNU' }]))).toEqual([])
  })

  it('reports EVERY problem in one pass', () => {
    const out = issues(file([
      { school: 'NTNU', exchange: 'yes' },
      'not an object',
      { school: 'UiO', start: 'yesterday' },
    ]))
    expect(out).toHaveLength(3)
  })
})

describe('bulkInstructions — the sheet the user hands their model', () => {
  const specFor = (key: string) => bulkSpec(key as never)!

  it('shows a worked example value for every field kind the section has', () => {
    // The instructions are generated from the spec, so an example that stops
    // being emitted leaves the model guessing that field's shape.
    const educations = bulkInstructions(specFor('educations'), ['en'])
    expect(educations).toContain('"exchange": false')
    expect(educations).toContain('{ "year": 2024, "month": 6 }')

    const projects = bulkInstructions(specFor('projects'), ['en'])
    expect(projects).toMatch(/"skills": \["…", "…"\]/)
    expect(projects).toMatch(/"employer": "…"/)

    const employments = bulkInstructions(specFor('work_experiences'), ['en'])
    // An enum's example is one of its own values, not a placeholder.
    expect(employments).toMatch(/"employment_type": "[a-z_]+"/)
  })

  it('names each of the resume\u2019s locales in a translated field\u2019s example', () => {
    const one = bulkInstructions(specFor('educations'), ['en'])
    expect(one).toMatch(/"school": "…"/)
    const two = bulkInstructions(specFor('educations'), ['en', 'no'])
    expect(two).toMatch(/"school": \{ "en": "…", "no": "…" \}/)
  })
})

describe('the registry interning a bulk add does', () => {
  const bulkFile = (items: unknown[], section: string) =>
    ({ $schema: BULK_IMPORT_SCHEMA, section, items }) as unknown as BulkFileV1
  const spec = (key: string) => bulkSpec(key as never)!

  it('reuses an existing skill and role whatever locale named it', () => {
    const store = storeWithResume({
      skills: [makeSkill({ id: 's1', name: { no: 'Regneark' } })],
      roles: [makeRole({ id: 'r-1', name: { no: 'Arkitekt' } })],
    })
    const mapped = mapBulkItems(
      bulkFile([{ customer: 'Acme', skills: ['regneark'], roles: ['ARKITEKT'] }], 'projects'),
      spec('projects'), store, 'en',
    )
    const out = appendBulkItems(store, spec('projects'), mapped.items, mapped.additions)
    expect(out.skills).toHaveLength(1)
    expect(out.roles).toHaveLength(1)
    expect(out.projects[0].skills[0].skill_id).toBe('s1')
    expect(out.projects[0].roles[0].role_id).toBe('r-1')
  })

  it('interns a name once even when two items use it', () => {
    const store = storeWithResume()
    const mapped = mapBulkItems(
      bulkFile([
        { customer: 'One', skills: ['Kubernetes'] },
        { customer: 'Two', skills: ['kubernetes'] },
      ], 'projects'),
      spec('projects'), store, 'en',
    )
    const out = appendBulkItems(store, spec('projects'), mapped.items, mapped.additions)
    expect(out.skills).toHaveLength(1)
    expect(out.projects[0].skills[0].skill_id).toBe(out.projects[1].skills[0].skill_id)
  })

  it('ignores a blank skill or role name rather than interning an empty entry', () => {
    const store = storeWithResume()
    const mapped = mapBulkItems(
      bulkFile([{ customer: 'Acme', skills: ['', '   '], roles: ['  '] }], 'projects'),
      spec('projects'), store, 'en',
    )
    const out = appendBulkItems(store, spec('projects'), mapped.items, mapped.additions)
    expect(out.skills).toEqual([])
    expect(out.roles).toEqual([])
  })
})

describe('appendBulkItems — the sort_order of the new rows', () => {
  const spec = (key: string) => bulkSpec(key as never)!

  it('numbers new rows after the highest sort_order already there', () => {
    const store = storeWithResume({
      // Deliberately NOT ascending: the highest wins, not the last one seen.
      courses: [makeCourse({ id: 'c1', sort_order: 9 }), makeCourse({ id: 'c2', sort_order: 4 })],
    })
    const out = appendBulkItems(store, spec('courses'), [
      { id: 'new1', sort_order: 0 } as never,
      { id: 'new2', sort_order: 0 } as never,
    ])
    expect(out.courses.map((c) => c.sort_order)).toEqual([9, 4, 10, 11])
  })

  it('ignores a non-numeric sort_order when finding the highest', () => {
    // An imported row can carry a string there; treating it as the max would
    // push every new row to NaN and collapse the display order.
    const store = storeWithResume({
      courses: [{ ...makeCourse({ id: 'c1' }), sort_order: 'first' } as never],
    })
    const out = appendBulkItems(store, spec('courses'), [{ id: 'new1', sort_order: 0 } as never])
    expect(out.courses[1].sort_order).toBe(0)
  })

  it('starts at zero when the section is empty', () => {
    const out = appendBulkItems(storeWithResume(), spec('courses'), [
      { id: 'new1', sort_order: 0 } as never,
      { id: 'new2', sort_order: 0 } as never,
    ])
    expect(out.courses.map((c) => c.sort_order)).toEqual([0, 1])
  })
})

describe('the registry lookup ignores an unnamed entry', () => {
  it('does not match a blank bulk name against a blank registry name', () => {
    // A registry entry with an empty name is data damage; letting a blank source
    // name "match" it would link every unnamed row to it.
    const store = storeWithResume({ skills: [makeSkill({ id: 'blank', name: { en: '' } })] })
    const mapped = mapBulkItems(
      { $schema: BULK_IMPORT_SCHEMA, section: 'projects', items: [{ customer: 'Acme', skills: [''] }] } as never,
      bulkSpec('projects' as never)!, store, 'en',
    )
    const out = appendBulkItems(store, bulkSpec('projects' as never)!, mapped.items, mapped.additions)
    expect(out.projects[0].skills).toEqual([])
  })
})

/**
 * Interning a bulk add against the registries the resume already has.
 *
 * This is the whole reason a bulk add is safe to run twice: the names in the
 * file are matched against every locale of every existing entry, first writer
 * wins, and only genuinely new names become registry rows.
 */
describe('mapBulkItems — interning against the existing registry', () => {
  const bulkFile = (items: unknown[], section: string) =>
    ({ $schema: BULK_IMPORT_SCHEMA, section, items }) as unknown as BulkFileV1
  const spec = (key: string) => bulkSpec(key as never)!
  const run = (store: ResumeStore, items: unknown[], key = 'projects') => {
    const mapped = mapBulkItems(bulkFile(items, key), spec(key), store, 'en')
    return { out: appendBulkItems(store, spec(key), mapped.items, mapped.additions), mapped }
  }

  it('keeps the FIRST registry entry when two normalise to the same name', () => {
    // Registries accumulate near-duplicates over years of imports; the entry the
    // user curated first is the one the CV already renders.
    const store = storeWithResume({
      skills: [makeSkill({ id: 'first', name: { en: 'Go' } }), makeSkill({ id: 'second', name: { en: ' go ' } })],
    })
    const { out } = run(store, [{ customer: 'Acme', skills: ['Go'] }])
    expect(out.projects[0].skills[0].skill_id).toBe('first')
    expect(out.skills).toHaveLength(2)
  })

  it('keeps the first EMPLOYMENT when two share an employer name', () => {
    const store = storeWithResume({
      work_experiences: [
        makeWork({ id: 'w-first', employer: { en: 'Acme' } }),
        makeWork({ id: 'w-second', employer: { en: 'acme' } }),
      ],
    })
    const { out } = run(store, [{ customer: 'Client', employer: 'ACME' }])
    expect(out.projects[0].work_experience_id).toBe('w-first')
  })

  it('trims the name of a registry entry it creates', () => {
    const store = storeWithResume()
    const { out } = run(store, [{ customer: 'Acme', skills: ['  Rust  '], roles: ['  Architect  '] }])
    expect(out.skills[0].name).toEqual({ en: 'Rust' })
    expect(out.roles[0].name).toEqual({ en: 'Architect' })
  })

  it('names a created role in the resume\u2019s own locale', () => {
    const store = storeWithResume()
    const mapped = mapBulkItems(
      bulkFile([{ customer: 'Acme', roles: ['Arkitekt'] }], 'projects'), spec('projects'), store, 'no')
    const out = appendBulkItems(store, spec('projects'), mapped.items, mapped.additions)
    expect(out.roles[0].name).toEqual({ no: 'Arkitekt' })
  })

  it('leaves a NON-project section with no employment link at all', () => {
    // The employer carrier is a Projects-only field; running that resolution for
    // another section would stamp a work_experience_id onto rows that have no
    // such column.
    const store = storeWithResume({ work_experiences: [makeWork({ id: 'w1', employer: { en: 'Acme' } })] })
    const { out } = run(store, [{ school: 'NTNU' }], 'educations')
    expect('work_experience_id' in out.educations[0]).toBe(false)
    expect('_employer' in out.educations[0]).toBe(false)
  })

  it('drops the employer carrier field from the stored project', () => {
    const store = storeWithResume()
    const { out } = run(store, [{ customer: 'Acme', employer: 'Nowhere Ltd' }])
    expect('_employer' in out.projects[0]).toBe(false)
    expect(out.projects[0].work_experience_id).toBeNull()
  })
})

describe('appendBulkItems — where the new rows land', () => {
  const spec = (key: string) => bulkSpec(key as never)!

  it('continues the sort_order past the highest one already stored', () => {
    const store = storeWithResume({
      projects: [makeProject({ id: 'p1', sort_order: 4 }), makeProject({ id: 'p2', sort_order: 9 })],
    })
    const out = appendBulkItems(store, spec('projects'), [
      { customer: { en: 'A' }, sort_order: 0 } as never,
      { customer: { en: 'B' }, sort_order: 0 } as never,
    ], { skills: [], roles: [] })
    expect(out.projects.slice(2).map((p) => p.sort_order)).toEqual([10, 11])
  })

  it('starts at zero when the section is empty', () => {
    const out = appendBulkItems(storeWithResume(), spec('projects'),
      [{ customer: { en: 'A' }, sort_order: 0 } as never], { skills: [], roles: [] })
    expect(out.projects[0].sort_order).toBe(0)
  })

  it('adds no registry rows when called with no additions', () => {
    // The default is what a caller gets wrong; a non-empty one would append a
    // phantom skill to the shared registry on every bulk add.
    const store = storeWithResume({ skills: [makeSkill({ id: 's1', name: { en: 'Go' } })] })
    const out = appendBulkItems(store, spec('projects'), [{ customer: { en: 'A' }, sort_order: 0 } as never])
    expect(out.skills).toHaveLength(1)
    expect(out.roles).toEqual([])
  })
})

describe('the duplicate key a bulk row is matched on', () => {
  const spec = (key: string) => bulkSpec(key as never)!

  it('keys a project on EVERY locale of its name, plus the start date', () => {
    // CLAUDE.md §9: one key per locale, and a match on ANY of them flags a
    // duplicate — an incoming NO+EN row must match an existing NO-only one.
    const keys = spec('projects').dupKeys({
      customer: { en: 'Acme', no: 'Acme AS' }, start: { year: 2020, month: 6 },
    })
    expect(keys).toHaveLength(2)
    expect(keys.every((k) => k.includes('2020'))).toBe(true)
  })

  it('keys a plain-string name too, not only a localized map', () => {
    expect(spec('projects').dupKeys({ customer: 'Acme', start: null })).toEqual(['acme'])
  })

  it('ignores a blank locale slot rather than keying on it', () => {
    // A blank key would match every other row that also has a blank slot.
    expect(spec('projects').dupKeys({ customer: { en: 'Acme', no: '   ' }, start: null }))
      .toEqual(['acme'])
    expect(spec('projects').dupKeys({ customer: { en: '   ' }, start: null })).toEqual([])
    expect(spec('projects').dupKeys({ customer: '', start: null })).toEqual([])
  })

  it('distinguishes a year-only start from the same year with a month', () => {
    // Two engagements at the same customer, one dated 2020 and one 2020-06, are
    // different rows; collapsing them would silently drop the second.
    const yearOnly = spec('projects').dupKeys({ customer: 'Acme', start: { year: 2020, month: null } })
    const withMonth = spec('projects').dupKeys({ customer: 'Acme', start: { year: 2020, month: 6 } })
    expect(yearOnly).not.toEqual(withMonth)
    expect(yearOnly[0]).toBe('acme|2020-')
  })
})

describe('InvalidBulkImportError — the message the modal shows', () => {
  it('quotes the ONE problem when there is only one', () => {
    // A single mistake is fixable from the message alone; "found 1 problems"
    // sends the user hunting for a list that has one line in it.
    const one = new InvalidBulkImportError([{ path: 'items[0].start', reason: 'expected a date' }])
    expect(one.message).toBe('items[0].start: expected a date')
  })

  it('counts them when there are several', () => {
    const many = new InvalidBulkImportError([
      { path: 'items[0]', reason: 'a' }, { path: 'items[1]', reason: 'b' },
    ])
    expect(many.message).toMatch(/2 problems/)
  })
})

describe('bulkInstructions — the example row', () => {
  it('shows an enum example from the vocabulary, not a placeholder', () => {
    const out = bulkInstructions(bulkSpec('work_experiences' as never)!, ['en'])
    expect(out).toMatch(/"employment_type": "[a-z_]+"/)
    expect(out).not.toMatch(/"employment_type": "…"/)
  })

  it('shows a date example in the object shape the validator accepts', () => {
    const out = bulkInstructions(bulkSpec('projects' as never)!, ['en'])
    expect(out).toContain('{ "year": 2024, "month": 6 }')
  })

  it('documents an enum field by listing its values', () => {
    const out = bulkInstructions(bulkSpec('work_experiences' as never)!, ['en'])
    expect(out).toMatch(/one of: [a-z_]+ \| /)
  })
})

describe('bulkInstructions — the shared field groups', () => {
  it('offers short_description on the sections that carry one', () => {
    // The one-line summary field is shared across specs; losing it from the
    // sheet means every bulk add arrives with summary mode empty.
    for (const key of ['projects', 'work_experiences', 'educations']) {
      const out = bulkInstructions(bulkSpec(key as never)!, ['en'])
      expect(out, key).toContain('short_description')
      expect(out, key).toMatch(/concise line/i)
    }
  })

  it('documents a non-enum field by its KIND, not as a vocabulary', () => {
    const out = bulkInstructions(bulkSpec('projects' as never)!, ['en'])
    const customerRow = out.split(String.fromCharCode(10)).find((l) => l.includes('`customer`'))!
    expect(customerRow).not.toContain('one of:')
  })

  it('shows a DATE example in the object shape, distinct from a list', () => {
    const out = bulkInstructions(bulkSpec('projects' as never)!, ['en'])
    const startRow = out.split(String.fromCharCode(10)).find((l) => l.includes('"start"'))!
    expect(startRow).toContain('{ "year": 2024, "month": 6 }')
  })
})

describe('intakeInstructions — the messy source it wraps', () => {
  it('trims the pasted source rather than carrying its padding', () => {
    const out = intakeInstructions(bulkSpec('projects' as never)!, ['en'], '   Ran a platform rebuild.   ')
    expect(out).toContain('Ran a platform rebuild.')
    expect(out.endsWith('Ran a platform rebuild.')).toBe(true)
  })
})

describe('mapBulkItems — the role registry, like the skill one', () => {
  it('keeps the FIRST role entry when two normalise to the same name', () => {
    const store = storeWithResume({
      roles: [makeRole({ id: 'r-first', name: { en: 'Architect' } }), makeRole({ id: 'r-second', name: { en: ' architect ' } })],
    })
    const spec = bulkSpec('projects' as never)!
    const file = { $schema: BULK_IMPORT_SCHEMA, section: 'projects', items: [{ customer: 'Acme', roles: ['ARCHITECT'] }] }
    const mapped = mapBulkItems(file as never, spec, store, 'en')
    const out = appendBulkItems(store, spec, mapped.items, mapped.additions)
    expect(out.projects[0].roles[0].role_id).toBe('r-first')
    expect(out.roles).toHaveLength(2)
  })
})
