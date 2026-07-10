import { describe, it, expect } from 'vitest'
import {
  AI_IMPORT_SCHEMA,
  isAIImportFormat,
  validateAIImport,
  InvalidAIImportError,
  importFromAIDraft,
  normalizeImportLocale,
  summarizeImportedStore,
  type AIImportV1,
} from '../src/lib/aiImport'
import { resolve } from '../src/lib/locales'

/** Minimal valid envelope with overrides merged in. */
function draft(over: Partial<AIImportV1> = {}): AIImportV1 {
  return { $schema: AI_IMPORT_SCHEMA, ...over }
}

describe('isAIImportFormat()', () => {
  it('accepts an envelope with the resumestudio-ai schema', () => {
    expect(isAIImportFormat({ $schema: AI_IMPORT_SCHEMA })).toBe(true)
  })

  it('accepts a future ai schema version (detector is lenient)', () => {
    expect(isAIImportFormat({ $schema: 'resumestudio-ai/v9' })).toBe(true)
  })

  it('rejects a backup file (different schema prefix)', () => {
    expect(isAIImportFormat({ $schema: 'resumestudio/v1', format_version: 1 })).toBe(false)
  })

  it('rejects null, arrays and non-objects', () => {
    expect(isAIImportFormat(null)).toBe(false)
    expect(isAIImportFormat([{ $schema: AI_IMPORT_SCHEMA }])).toBe(false)
    expect(isAIImportFormat('resumestudio-ai/v1')).toBe(false)
  })
})

describe('validateAIImport()', () => {
  it('passes a minimal valid object', () => {
    expect(() => validateAIImport(draft())).not.toThrow()
  })

  it('throws on a non-object root', () => {
    expect(() => validateAIImport(42)).toThrow(InvalidAIImportError)
    expect(() => validateAIImport(null)).toThrow(InvalidAIImportError)
  })

  it('flags a wrong $schema with a field path', () => {
    try {
      validateAIImport({ $schema: 'nope' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidAIImportError)
      expect((e as InvalidAIImportError).issues[0].path).toBe('$schema')
    }
  })

  it('flags a section that should be an array but is an object', () => {
    try {
      validateAIImport(draft({ projects: { customer: 'X' } as unknown as never }))
      throw new Error('should have thrown')
    } catch (e) {
      const issues = (e as InvalidAIImportError).issues
      expect(issues.some((i) => i.path === 'projects' && /array/.test(i.reason))).toBe(true)
    }
  })

  it('flags a non-object array item with an indexed path', () => {
    try {
      validateAIImport(draft({ projects: ['just a string' as unknown as never] }))
      throw new Error('should have thrown')
    } catch (e) {
      const issues = (e as InvalidAIImportError).issues
      expect(issues.some((i) => i.path === 'projects[0]')).toBe(true)
    }
  })

  it('flags a malformed date with a deep path', () => {
    try {
      validateAIImport(draft({
        work_experiences: [{ employer: 'Acme', start: { year: 'twenty-twenty' } as unknown as never }],
      }))
      throw new Error('should have thrown')
    } catch (e) {
      const issues = (e as InvalidAIImportError).issues
      expect(issues.some((i) => i.path === 'work_experiences[0].start.year')).toBe(true)
    }
  })

  it('flags an out-of-range month', () => {
    try {
      validateAIImport(draft({ projects: [{ start: { year: 2020, month: 13 } }] }))
      throw new Error('should have thrown')
    } catch (e) {
      const issues = (e as InvalidAIImportError).issues
      expect(issues.some((i) => i.path === 'projects[0].start.month')).toBe(true)
    }
  })

  it('accepts a bare year number or numeric string as a date', () => {
    expect(() => validateAIImport(draft({
      educations: [{ school: 'NTNU', start: 2015 as unknown as never, end: '2018' as unknown as never }],
    }))).not.toThrow()
  })

  it('flags a roles/skills list that is not an array', () => {
    try {
      validateAIImport(draft({ projects: [{ skills: 'TypeScript' as unknown as never }] }))
      throw new Error('should have thrown')
    } catch (e) {
      const issues = (e as InvalidAIImportError).issues
      expect(issues.some((i) => i.path === 'projects[0].skills')).toBe(true)
    }
  })

  it('collects multiple issues in one pass', () => {
    try {
      validateAIImport({ $schema: 'wrong', projects: 'x', educations: 5 })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as InvalidAIImportError).issues.length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('normalizeImportLocale()', () => {
  it('maps service codes onto app short codes', () => {
    expect(normalizeImportLocale('nb')).toBe('no')
    expect(normalizeImportLocale('sv')).toBe('se')
    expect(normalizeImportLocale('da')).toBe('dk')
    expect(normalizeImportLocale('int')).toBe('en')
    expect(normalizeImportLocale('en-GB')).toBe('en')
  })

  it('passes through known short codes', () => {
    expect(normalizeImportLocale('no')).toBe('no')
    expect(normalizeImportLocale('en')).toBe('en')
  })

  it('defaults unknown / missing to en', () => {
    expect(normalizeImportLocale(undefined)).toBe('en')
    expect(normalizeImportLocale('')).toBe('en')
    expect(normalizeImportLocale('zz')).toBe('en')
    expect(normalizeImportLocale(42)).toBe('en')
  })
})

describe('importFromAIDraft()', () => {
  it('produces an empty-but-valid store from a bare envelope', () => {
    const store = importFromAIDraft(draft())
    expect(store.resume).not.toBeNull()
    expect(store.resume?.default_locale).toBe('en')
    expect(store.resume?.supported_locales).toEqual(['en'])
    expect(store.projects).toEqual([])
    expect(store.views).toEqual([])
  })

  it('wraps plain strings into the primary locale', () => {
    const store = importFromAIDraft(draft({
      primary_locale: 'no',
      profile: { full_name: 'Kari Nordmann', title: 'Systemarkitekt', email: 'kari@x.no', phone: '+47 123' },
    }))
    expect(store.resume?.full_name).toBe('Kari Nordmann')
    expect(store.resume?.email).toBe('kari@x.no')
    expect(store.resume?.phone).toBe('+47 123')
    expect(store.resume?.title).toEqual({ no: 'Systemarkitekt' })
    expect(store.resume?.default_locale).toBe('no')
    expect(store.resume?.supported_locales).toEqual(['no'])
  })

  it('leaves blank scalar fields as empty (no empty-string locale keys)', () => {
    const store = importFromAIDraft(draft({ profile: { full_name: 'X', title: '' } }))
    expect(store.resume?.title).toEqual({})
    expect(store.resume?.phone).toBeNull()
  })

  it('routes profile.summary into a leading key qualification', () => {
    const store = importFromAIDraft(draft({ profile: { summary: 'Seasoned engineer.' } }))
    expect(store.key_qualifications).toHaveLength(1)
    expect(resolve(store.key_qualifications[0].summary, 'en')).toBe('Seasoned engineer.')
    expect(store.key_qualifications[0].label).toEqual({})
  })

  it('maps key_qualification bullets into standalone key_competencies', () => {
    // The per-KQ key_points sub-list is gone from the UI; bullets now feed the
    // top-level Key Competencies section (same shape as the CVpartner import).
    const store = importFromAIDraft(draft({
      key_qualifications: [{ label: 'Cloud', bullets: ['AWS', 'Terraform', ''] }],
    }))
    const kq = store.key_qualifications[0]
    expect(resolve(kq.label, 'en')).toBe('Cloud')
    expect(kq.key_points).toEqual([])
    expect(store.key_competencies).toHaveLength(2) // empty bullet dropped
    expect(resolve(store.key_competencies[0].title, 'en')).toBe('AWS')
    expect(resolve(store.key_competencies[1].title, 'en')).toBe('Terraform')
  })

  it('skips entirely-empty key qualifications', () => {
    const store = importFromAIDraft(draft({ key_qualifications: [{ label: '', summary: '', bullets: [] }] }))
    expect(store.key_qualifications).toHaveLength(0)
  })

  it('dedupes skills into the registry and links project skills by id', () => {
    const store = importFromAIDraft(draft({
      projects: [
        { customer: 'A', skills: ['TypeScript', 'AWS'] },
        { customer: 'B', skills: ['typescript', 'PostgreSQL'] }, // case-insensitive dup
      ],
    }))
    // 3 unique skills: TypeScript, AWS, PostgreSQL
    expect(store.skills).toHaveLength(3)
    const tsId = store.skills.find((s) => resolve(s.name, 'en') === 'TypeScript')!.id
    // Both projects' TypeScript ProjectSkill must point at the same registry id.
    const p0ts = store.projects[0].skills.find((ps) => resolve(ps.name, 'en') === 'TypeScript')!
    const p1ts = store.projects[1].skills.find((ps) => /typescript/i.test(resolve(ps.name, 'en')))!
    expect(p0ts.skill_id).toBe(tsId)
    expect(p1ts.skill_id).toBe(tsId)
  })

  it('dedupes roles into the registry', () => {
    const store = importFromAIDraft(draft({
      projects: [
        { customer: 'A', roles: ['Tech Lead', 'Developer'] },
        { customer: 'B', roles: ['Tech Lead'] },
      ],
    }))
    expect(store.roles).toHaveLength(2)
    const leadId = store.roles.find((r) => resolve(r.name, 'en') === 'Tech Lead')!.id
    expect(store.projects[0].roles[0].role_id).toBe(leadId)
    expect(store.projects[1].roles[0].role_id).toBe(leadId)
  })

  it('every ProjectSkill.skill_id resolves to a registry entry (no orphans)', () => {
    const store = importFromAIDraft(draft({
      projects: [{ customer: 'A', skills: ['Go', 'Rust'] }],
      technology_categories: [{ name: 'Languages', skills: ['Go', 'Python'] }],
    }))
    const ids = new Set(store.skills.map((s) => s.id))
    for (const p of store.projects) for (const ps of p.skills) expect(ids.has(ps.skill_id)).toBe(true)
    // Every skill's category_id (when set) resolves to a real skill category.
    const catIds = new Set((store.skill_categories ?? []).map((c) => c.id))
    for (const s of store.skills) if (s.category_id) expect(catIds.has(s.category_id)).toBe(true)
    // Go appears in both a project and a category but interns once.
    expect(store.skills.filter((s) => resolve(s.name, 'en') === 'Go')).toHaveLength(1)
  })

  it('technology_categories become skill categories; their skills are categorized + highlighted', () => {
    const store = importFromAIDraft(draft({
      technology_categories: [{ name: 'Languages', skills: ['Go', 'Python'] }],
    }))
    expect(store.skill_categories).toHaveLength(1)
    const cat = store.skill_categories![0]
    expect(resolve(cat.name, 'en')).toBe('Languages')
    const catSkills = store.skills.filter((s) => s.category_id === cat.id)
    expect(catSkills.map((s) => resolve(s.name, 'en')).sort()).toEqual(['Go', 'Python'])
    for (const s of catSkills) expect(s.is_highlighted).toBe(true)
  })

  it('links a project to a work experience by matching employer name', () => {
    const store = importFromAIDraft(draft({
      work_experiences: [{ employer: 'Cartavio AS', role_title: 'Consultant' }],
      projects: [
        { customer: 'Client X', employer: 'cartavio as' }, // case-insensitive match
        { customer: 'Client Y', employer: 'Unknown Inc' },  // no match
      ],
    }))
    const workId = store.work_experiences[0].id
    expect(store.projects[0].work_experience_id).toBe(workId)
    expect(store.projects[1].work_experience_id).toBeNull()
  })

  it('coerces dates: bare year, numeric string, and {year,month}', () => {
    const store = importFromAIDraft(draft({
      educations: [{ school: 'NTNU', start: 2015 as unknown as never, end: '2018' as unknown as never }],
      projects: [{ customer: 'A', start: { year: 2020, month: 3 }, end: { year: 2021, month: null } }],
    }))
    expect(store.educations[0].start).toEqual({ year: 2015, month: null })
    expect(store.educations[0].end).toEqual({ year: 2018, month: null })
    expect(store.projects[0].start).toEqual({ year: 2020, month: 3 })
    expect(store.projects[0].end).toEqual({ year: 2021, month: null })
  })

  it('maps recommendations with plain-string recommender identity', () => {
    const store = importFromAIDraft(draft({
      recommendations: [{
        recommender_name: 'Jane', recommender_title: 'CTO', recommender_company: 'BigCo',
        relationship: 'Worked together', text: 'Great engineer.',
      }],
    }))
    const r = store.recommendations[0]
    expect(r.recommender_name).toBe('Jane')
    expect(resolve(r.recommender_title, 'en')).toBe('CTO')
    expect(resolve(r.text, 'en')).toBe('Great engineer.')
  })

  it('survives a JSON serialisation cycle (the actual file path)', () => {
    const input = draft({
      primary_locale: 'no',
      profile: { full_name: 'Ola', summary: 'Hei' },
      projects: [{ customer: 'A', skills: ['Go'], start: { year: 2020, month: 1 } }],
    })
    const parsed = JSON.parse(JSON.stringify(input)) as unknown
    expect(isAIImportFormat(parsed)).toBe(true)
    const validated = validateAIImport(parsed)
    const store = importFromAIDraft(validated)
    expect(store.resume?.full_name).toBe('Ola')
    expect(store.skills).toHaveLength(1)
  })
})

describe('summarizeImportedStore()', () => {
  it('lists only non-empty sections with counts', () => {
    const store = importFromAIDraft(draft({
      profile: { full_name: 'Sam' },
      projects: [{ customer: 'A', skills: ['Go'] }, { customer: 'B' }],
      educations: [{ school: 'NTNU' }],
    }))
    const sum = summarizeImportedStore(store)
    expect(sum.full_name).toBe('Sam')
    expect(sum.lines.find((l) => l.label === 'projects')?.count).toBe(2)
    expect(sum.lines.find((l) => l.label === 'educations')?.count).toBe(1)
    expect(sum.lines.find((l) => l.label === 'courses')).toBeUndefined() // empty section omitted
    expect(sum.total).toBeGreaterThan(0)
  })

  it('reports total 0 for an essentially empty import', () => {
    const sum = summarizeImportedStore(importFromAIDraft(draft({ profile: { full_name: 'Empty' } })))
    expect(sum.total).toBe(0)
  })
})
