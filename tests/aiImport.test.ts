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
import {
  emptyStore, makeProject, makeWork, makeEducation, makeCourse, makeCertification,
  makeSkill, makeRole, makeKQ, makeKeyCompetency, makeSpokenLanguage,
  makeSkillCategory, makeRecommendation, makeResume,
} from './fixtures'

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

  it('rejects a non-string schema rather than trying to read it', () => {
    expect(isAIImportFormat({ $schema: 7 })).toBe(false)
    expect(isAIImportFormat({})).toBe(false)
  })
})

/** The issues a bad draft produces, by path — fails loudly if it was accepted. */
function issuePaths(json: unknown): string[] {
  try {
    validateAIImport(json)
  } catch (e) {
    return (e as InvalidAIImportError).issues.map((i) => i.path)
  }
  throw new Error('expected validateAIImport to throw')
}

describe('validateAIImport()', () => {
  it('passes a minimal valid object', () => {
    expect(() => validateAIImport(draft())).not.toThrow()
  })

  /**
   * The message is what the modal shows when it can't list the issues, so the
   * single-problem case has to name the problem rather than count it.
   */
  it('names a lone problem, and counts several', () => {
    expect(() => validateAIImport(42)).toThrow('(root): expected a JSON object')
    expect(new InvalidAIImportError([
      { path: 'a', reason: 'x' }, { path: 'b', reason: 'y' },
    ]).message).toBe('Found 2 problems in the AI import file.')
  })

  it('flags a profile that is not an object, and accepts an absent or null one', () => {
    expect(issuePaths(draft({ profile: ['not an object'] as unknown as never }))).toEqual(['profile'])
    // Absent and explicitly-null both mean "no profile", not "broken profile".
    expect(() => validateAIImport(draft({ profile: null as unknown as never }))).not.toThrow()
    expect(() => validateAIImport(draft())).not.toThrow()
  })

  it('treats a section that is present but null as absent', () => {
    expect(() => validateAIImport(draft({ projects: null as unknown as never }))).not.toThrow()
  })

  it('checks the date fields each section actually has', () => {
    expect(issuePaths(draft({ courses: [{ completed: { year: 'nope' } as unknown as never }] })))
      .toEqual(['courses[0].completed.year'])
    expect(issuePaths(draft({ certifications: [{
      issued: { year: 'x' } as unknown as never, expires: { year: 'y' } as unknown as never,
    }] }))).toEqual(['certifications[0].issued.year', 'certifications[0].expires.year'])
    expect(issuePaths(draft({ educations: [{
      start: { year: 'x' } as unknown as never, end: { year: 'y' } as unknown as never,
    }] }))).toEqual(['educations[0].start.year', 'educations[0].end.year'])
  })

  it('takes any scalar as a list entry, and flags a structured one by index', () => {
    // A model that answers with numbers or booleans is sloppy, not unusable.
    expect(() => validateAIImport(draft({
      projects: [{ bullets: ['shipped it', 2, true, null] as unknown as never }],
    }))).not.toThrow()
    expect(issuePaths(draft({
      projects: [{ bullets: ['ok', { text: 'nested' }] as unknown as never }],
    }))).toEqual(['projects[0].bullets[1]'])
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

  it('ignores the whitespace and case a model leaves around a code', () => {
    expect(normalizeImportLocale('  NB  ')).toBe('no')
    expect(normalizeImportLocale('\tEN-gb\n')).toBe('en')
    expect(normalizeImportLocale('   ')).toBe('en')
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

/**
 * The import preview's tally. 14 survivors: it is the LAST thing a user sees
 * before a file becomes a new resume, so a section missing from the list is a
 * section they were never told about.
 */
describe('summarizeImportedStore', () => {
  it('lists only the sections that have something in them', () => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1' })]
    s.skills = [makeSkill({ id: 's1' })]
    const out = summarizeImportedStore(s)
    expect(out.lines.map((l) => l.label)).toEqual(['projects', 'skills'])
    expect(out.lines.every((l) => l.count > 0)).toBe(true)
  })

  it('totals the counts it actually listed', () => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })]
    s.skills = [makeSkill({ id: 's1' })]
    expect(summarizeImportedStore(s).total).toBe(3)
  })

  it('counts every section it claims to', () => {
    // Each label maps to a real array; a mistyped one silently reports zero and
    // the section vanishes from the preview.
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1' })]
    s.work_experiences = [makeWork({ id: 'w1' })]
    s.educations = [makeEducation({ id: 'e1' })]
    s.courses = [makeCourse({ id: 'c1' })]
    s.certifications = [makeCertification({ id: 'cert1' })]
    s.skills = [makeSkill({ id: 's1' })]
    s.roles = [makeRole({ id: 'r1' })]
    s.key_qualifications = [makeKQ({ id: 'kq1' })]
    s.key_competencies = [makeKeyCompetency({ id: 'kc1' })]
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1' })]
    s.skill_categories = [makeSkillCategory({ id: 'sc1' })]
    s.recommendations = [makeRecommendation({ id: 'rec1' })]
    const out = summarizeImportedStore(s)
    expect(out.total).toBe(12)
    expect(out.lines).toHaveLength(12)
    expect(out.lines.every((l) => l.count === 1)).toBe(true)
  })

  it('survives a store with no skill_categories array at all', () => {
    const s = emptyStore()
    delete (s as unknown as Record<string, unknown>).skill_categories
    expect(() => summarizeImportedStore(s)).not.toThrow()
  })

  it('reports the name and locale from the resume, with safe defaults', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari', default_locale: 'no' })
    expect(summarizeImportedStore(s)).toMatchObject({ full_name: 'Kari', primary_locale: 'no' })
    const bare = emptyStore()
    bare.resume = null
    expect(summarizeImportedStore(bare)).toMatchObject({ full_name: '', primary_locale: 'en' })
  })
})


/**
 * Date validation per section, and the defaults an AI import lands with.
 *
 * The date fields differ by section — a course has `completed`, a certification
 * has `issued`/`expires`, the ranged sections have `start`/`end`. A section whose
 * dates go unchecked accepts whatever the model wrote, and a two-digit year sorts
 * an entry to the beginning of the CV.
 */
describe('validateAIImport — per-section date fields', () => {
  const withSection = (key: string, item: Record<string, unknown>) => () =>
    validateAIImport({ $schema: AI_IMPORT_SCHEMA, [key]: [item] } as never)
  const pathsOf = (fn: () => unknown): string[] => {
    try { fn(); return [] } catch (e) {
      return (e as InvalidAIImportError).issues.map((i) => i.path)
    }
  }

  it('checks start AND end on each of the three ranged sections', () => {
    for (const key of ['work_experiences', 'projects', 'educations']) {
      const paths = pathsOf(withSection(key, { start: 19, end: 19 }))
      expect(paths.some((p) => p.endsWith('.start')), key).toBe(true)
      expect(paths.some((p) => p.endsWith('.end')), key).toBe(true)
    }
  })

  it('checks a course’s completed date', () => {
    expect(pathsOf(withSection('courses', { name: 'X', completed: 19 })))
      .toContain('courses[0].completed')
  })

  it('checks BOTH a certification’s issued and expires dates', () => {
    const paths = pathsOf(withSection('certifications', { name: 'X', issued: 19, expires: 19 }))
    expect(paths).toContain('certifications[0].issued')
    expect(paths).toContain('certifications[0].expires')
  })

  it('accepts a well-formed date on every one of those fields', () => {
    expect(withSection('work_experiences', { employer: 'A', start: 2020, end: 2021 })).not.toThrow()
    expect(withSection('courses', { name: 'X', completed: { year: 2020, month: 6 } })).not.toThrow()
    expect(withSection('certifications', { name: 'X', issued: 2020, expires: 2025 })).not.toThrow()
  })
})

describe('importFromAIDraft — the imported defaults', () => {
  const draft = (over: Record<string, unknown>) =>
    importFromAIDraft({ $schema: AI_IMPORT_SCHEMA, ...over } as never)

  it('skips a profile with no label, no summary and no bullets', () => {
    // An empty profile would become the view's default title.
    expect(draft({ key_qualifications: [{}] }).key_qualifications).toEqual([])
    expect(draft({ key_qualifications: [{ label: 'Architect' }] }).key_qualifications).toHaveLength(1)
    expect(draft({ key_qualifications: [{ bullets: ['One'] }] }).key_qualifications).toHaveLength(1)
  })

  it('drops blank bullets rather than creating empty competencies', () => {
    const store = draft({ key_qualifications: [{ label: 'A', bullets: ['One', '', '   '] }] })
    expect(store.key_competencies).toHaveLength(1)
  })

  it('imports a project with anonymization off and a work experience unstarred', () => {
    const store = draft({
      projects: [{ customer: 'Acme' }],
      work_experiences: [{ employer: 'Acme' }],
    })
    expect(store.projects[0].use_anonymized).toBe(false)
    expect(store.work_experiences[0].starred).toBe(false)
  })

  it('imports an education claiming neither a grade nor an exchange term', () => {
    const store = draft({ educations: [{ school: 'NTNU' }] })
    expect(store.educations[0]).toMatchObject({ exchange: false })
  })

  it('links a project to a work experience by EMPLOYER name', () => {
    // The link is what puts a project under the right job; matching is
    // normalised so casing and spacing do not break it.
    const store = draft({
      work_experiences: [{ employer: 'Acme AS' }],
      projects: [{ customer: 'Bank', employer: '  acme as  ' }],
    })
    expect(store.projects[0].work_experience_id).toBe(store.work_experiences[0].id)
  })

  it('keeps the FIRST employer when two jobs share a name', () => {
    const store = draft({
      work_experiences: [{ employer: 'Acme' }, { employer: 'Acme' }],
      projects: [{ customer: 'Bank', employer: 'Acme' }],
    })
    expect(store.projects[0].work_experience_id).toBe(store.work_experiences[0].id)
  })

  it('leaves a project unlinked when no employer matches', () => {
    const store = draft({
      work_experiences: [{ employer: 'Acme' }],
      projects: [{ customer: 'Bank', employer: 'Nonesuch' }],
    })
    expect(store.projects[0].work_experience_id).toBeNull()
  })

  it('marks a showcase category’s skills highlighted, without overwriting a category', () => {
    // The showcase drives the Skills Showcase section, so its members are
    // highlighted — but a skill already filed elsewhere keeps its category.
    const store = draft({
      technology_categories: [{ name: 'Languages', skills: ['Go'] }],
    })
    const go = store.skills.find((s) => s.name.en === 'Go')!
    expect(go.is_highlighted).toBe(true)
    expect(go.category_id).toBe(store.skill_categories![0].id)
  })

  it('imports a skill that is not in a showcase category unhighlighted', () => {
    const store = draft({ projects: [{ customer: 'Acme', skills: ['Go'] }] })
    expect(store.skills.find((s) => s.name.en === 'Go')!.is_highlighted).toBe(false)
  })
})

/**
 * The sections an AI draft can carry beyond the big three.
 *
 * Each one is its own mapping — a section that maps to nothing is silently
 * missing from the import, and a flag defaulted the wrong way ships a
 * soft-deleted or starred row the user never asked for.
 */
describe('importFromAIDraft — courses, certifications and languages', () => {
  const draft = (over: Record<string, unknown>) =>
    importFromAIDraft({ $schema: AI_IMPORT_SCHEMA, ...over } as never)

  it('imports a course with its programme and completion date', () => {
    const store = draft({ courses: [{ name: 'Kubernetes', program: 'CNCF', completed: { year: 2024, month: 3 } }] })
    expect(store.courses).toHaveLength(1)
    expect(store.courses[0]).toMatchObject({
      name: { en: 'Kubernetes' }, program: { en: 'CNCF' },
      start: null, end: { year: 2024, month: 3 },
    })
    // A fresh row is live and unstarred, and carries no skill links yet.
    expect(store.courses[0]).toMatchObject({ starred: false, disabled: false })
    expect(store.courses[0].skill_ids).toEqual([])
  })

  it('imports a certification with both of its dates', () => {
    const store = draft({ certifications: [{
      name: 'AWS SA', organiser: 'AWS',
      issued: { year: 2024, month: 1 }, expires: { year: 2027, month: 1 },
    }] })
    expect(store.certifications[0]).toMatchObject({
      name: { en: 'AWS SA' }, organiser: { en: 'AWS' },
      issued: { year: 2024, month: 1 }, expires: { year: 2027, month: 1 },
      starred: false, disabled: false,
    })
    expect(store.certifications[0].skill_ids).toEqual([])
    expect(store.certifications[0].credential_url).toBeNull()
  })

  it('imports a spoken language with its level, live', () => {
    const store = draft({ spoken_languages: [{ name: 'Norwegian', level: 'Native' }] })
    expect(store.spoken_languages[0]).toMatchObject({
      name: { en: 'Norwegian' }, level: { en: 'Native' }, disabled: false,
    })
  })

  it('numbers each section in the order the draft listed it', () => {
    const store = draft({
      courses: [{ name: 'First' }, { name: 'Second' }],
      certifications: [{ name: 'C1' }, { name: 'C2' }],
      spoken_languages: [{ name: 'Norwegian' }, { name: 'English' }],
    })
    expect(store.courses.map((c) => c.sort_order)).toEqual([0, 1])
    expect(store.certifications.map((c) => c.sort_order)).toEqual([0, 1])
    expect(store.spoken_languages.map((l) => l.sort_order)).toEqual([0, 1])
  })

  it('leaves each of those sections empty when the draft omits it', () => {
    const store = draft({ projects: [{ customer: 'Acme' }] })
    expect(store.courses).toEqual([])
    expect(store.certifications).toEqual([])
    expect(store.spoken_languages).toEqual([])
  })

  it('imports a skills-showcase group, highlighting its skills once', () => {
    const store = draft({
      technology_categories: [{ name: 'Languages', skills: ['Go', 'Go', '   '] }],
    })
    expect(store.skill_categories).toHaveLength(1)
    const go = store.skills.filter((sk) => Object.values(sk.name)[0] === 'Go')
    expect(go).toHaveLength(1)
    expect(go[0].is_highlighted).toBe(true)
    expect(go[0].category_id).toBe(store.skill_categories![0].id)
    // The group itself carries a name and its position, nothing else.
    expect(store.skill_categories![0]).toEqual({
      id: store.skill_categories![0].id,
      resume_id: store.skill_categories![0].resume_id,
      name: { en: 'Languages' },
      sort_order: 0,
    })
  })

  it('numbers several showcase groups in the order given, without a stray member', () => {
    const store = draft({
      technology_categories: [
        { name: 'Languages', skills: ['Go'] },
        // No skills key at all — a group can be named before it is filled.
        { name: 'Platforms' },
      ],
    })
    expect(store.skill_categories!.map((c) => [Object.values(c.name)[0], c.sort_order]))
      .toEqual([['Languages', 0], ['Platforms', 1]])
    // The empty group interns nothing, so the registry holds only the one skill.
    expect(store.skills.map((sk) => Object.values(sk.name)[0])).toEqual(['Go'])
  })
})

describe('validateAIImport — the guards in front of the mapping', () => {
  const draft = (over: Record<string, unknown>) => ({ $schema: AI_IMPORT_SCHEMA, ...over })

  it('refuses a root that is not an object, and a schema that is not a string', () => {
    for (const bad of [null, 'text', 42, true, ['a']]) {
      expect(() => validateAIImport(bad)).toThrow()
    }
    expect(() => validateAIImport({ $schema: 42 })).toThrow()
  })

  it('checks the date fields the section actually has, and no others', () => {
    // A course has `completed`, a certification has `issued`/`expires`, and the
    // three big sections have `start`/`end`. Checking the wrong field lets a
    // malformed date through into the store.
    const paths = (d: Record<string, unknown>) => {
      try { validateAIImport(draft(d)); return [] } catch (e) {
        return (e as { issues: { path: string }[] }).issues.map((i) => i.path)
      }
    }
    expect(paths({ courses: [{ name: 'C', completed: 'yesterday' }] })).toEqual(['courses[0].completed'])
    expect(paths({ certifications: [{ name: 'C', issued: 'soon' }] })).toEqual(['certifications[0].issued'])
    expect(paths({ projects: [{ customer: 'A', start: 'then' }] })).toEqual(['projects[0].start'])
    expect(paths({ work_experiences: [{ employer: 'A', end: 'then' }] })).toEqual(['work_experiences[0].end'])
    expect(paths({ educations: [{ school: 'A', start: 'then' }] })).toEqual(['educations[0].start'])
    // A course's `start`/`end` are not part of the draft format, so a stray one
    // is not validated as a date.
    expect(paths({ courses: [{ name: 'C', start: 'nonsense' }] })).toEqual([])
    // And each section's check belongs to THAT section: a certification has no
    // `completed`, a course has no `issued`.
    expect(paths({ certifications: [{ name: 'C', completed: 'yesterday' }] })).toEqual([])
    expect(paths({ courses: [{ name: 'C', issued: 'soon', expires: 'later' }] })).toEqual([])
  })
})

describe('normalizeImportLocale — the three-step resolution', () => {
  it('resolves a three-letter alias by the WHOLE code, not its first two letters', () => {
    // "swe" truncated to "sw" is Swahili, not Swedish: the full-code lookup has
    // to happen before the two-letter one.
    expect(normalizeImportLocale('swe')).toBe('se')
    expect(normalizeImportLocale('nob')).toBe('no')
  })

  it('falls back to the two-letter prefix of a regional tag', () => {
    // "de-AT" is not in the alias table; the language is.
    expect(normalizeImportLocale('de-AT')).toBe('de')
    expect(normalizeImportLocale('fr-CA')).toBe('fr')
  })

  it('resolves a regional tag whose LANGUAGE is an alias', () => {
    // "nb-NO" is not listed, but "nb" is — and it means Norwegian, not English.
    expect(normalizeImportLocale('nb-NO')).toBe('no')
    expect(normalizeImportLocale('sv-SE')).toBe('se')
    expect(normalizeImportLocale('da-DK')).toBe('dk')
  })
})

/**
 * The store an AI draft becomes.
 *
 * The mapper writes every row by hand, so the parts nobody looks at are exactly
 * the parts that rot: the enabled/starred flags that decide whether an import is
 * visible at all, and the empty link lists that a seeded value would fill with
 * ids pointing nowhere.
 */
describe('importFromAIDraft — the shape it hands over', () => {
  const draft = (over: Record<string, unknown> = {}) =>
    importFromAIDraft({ $schema: AI_IMPORT_SCHEMA, ...over } as never)

  const full = () => draft({
    profile: { full_name: 'Kari Nordmann', summary: 'I build systems.' },
    key_qualifications: [{ label: 'Architect', summary: 'Cloud.', bullets: ['Owns delivery'] }],
    projects: [{ customer: 'Acme', roles: ['Architect'], skills: ['Go'] }],
    work_experiences: [{ employer: 'Cartavio' }],
    educations: [{ school: 'NTNU' }],
    courses: [{ name: 'Kubernetes' }],
    certifications: [{ name: 'AWS SA' }],
    spoken_languages: [{ name: 'Norwegian', level: 'Native' }],
    technology_categories: [{ name: 'Cloud', skills: ['Go'] }],
    recommendations: [{ recommender_name: 'Jane Boss', text: 'Excellent.' }],
  })

  it('imports every entity enabled and unstarred', () => {
    // Disabled is a soft delete: an import that lands disabled is invisible in
    // every export, so the consultant never sees what arrived.
    const s = full()
    const rows: Array<[string, { starred?: boolean; disabled?: boolean }]> = [
      ['summary profile', s.key_qualifications[0]],
      ['profile', s.key_qualifications[1]],
      ['competency', s.key_competencies[0]],
      ['project', s.projects[0]],
      ['employment', s.work_experiences[0]],
      ['education', s.educations[0]],
      ['course', s.courses[0]],
      ['certification', s.certifications[0]],
      ['recommendation', s.recommendations[0]],
    ]
    for (const [what, row] of rows) expect(row, what).toMatchObject({ starred: false, disabled: false })
    expect(s.spoken_languages[0].disabled).toBe(false)
    expect(s.projects[0].roles[0].disabled).toBe(false)
  })

  it('leaves every section the format does not carry EMPTY', () => {
    // A seeded row here is a phantom the user never wrote and cannot explain.
    const s = full()
    expect({
      industries: s.industries, positions: s.positions, presentations: s.presentations,
      honor_awards: s.honor_awards, publications: s.publications, references: s.references,
      views: s.views, cover_letters: s.cover_letters,
    }).toEqual({
      industries: [], positions: [], presentations: [],
      honor_awards: [], publications: [], references: [],
      views: [], cover_letters: [],
    })
  })

  it('leaves the per-item link lists empty', () => {
    const s = full()
    expect(s.key_qualifications[0].key_points).toEqual([])
    expect(s.key_qualifications[0].competency_ids).toEqual([])
    expect(s.work_experiences[0].role_ids).toEqual([])
    expect(s.certifications[0].skill_ids).toEqual([])
    expect(s.projects[0].industries).toEqual([])
    expect(s.projects[0].highlights).toEqual([])
  })

  it('creates no registry entry for a project that lists none', () => {
    // The roles/skills arrays are optional in the format; a fallback that is not
    // empty would mint a registry entry out of nothing on every import.
    const s = draft({ projects: [{ customer: 'Acme' }] })
    expect(s.skills).toEqual([])
    expect(s.roles).toEqual([])
    expect(s.projects[0].roles).toEqual([])
    expect(s.projects[0].skills).toEqual([])
  })

  it('drops a blank role or skill name instead of interning it', () => {
    const s = draft({ projects: [{ customer: 'Acme', roles: ['', '  '], skills: ['   '] }] })
    expect(s.skills).toEqual([])
    expect(s.roles).toEqual([])
  })

  it('trims the name it interns, and reuses the entry for a padded repeat', () => {
    const s = draft({
      projects: [
        { customer: 'One', roles: ['  Architect  '], skills: ['  Go  '] },
        { customer: 'Two', roles: ['Architect'], skills: ['Go'] },
      ],
    })
    expect(s.skills).toHaveLength(1)
    expect(s.roles).toHaveLength(1)
    expect(resolve(s.skills[0].name, 'en')).toBe('Go')
    expect(resolve(s.roles[0].name, 'en')).toBe('Architect')
  })

  it('carries the role name onto the project link, not just the registry id', () => {
    // The link keeps a snapshot of the name at link time (CLAUDE.md §4); an
    // empty one renders as a blank chip on the project card.
    const s = draft({ projects: [{ customer: 'Acme', roles: ['Architect'] }] })
    expect(resolve(s.projects[0].roles[0].name, 'en')).toBe('Architect')
    expect(s.projects[0].roles[0].role_id).toBe(s.roles[0].id)
  })

  it('numbers the imported competencies upward across profiles', () => {
    const s = draft({
      key_qualifications: [
        { label: 'A', bullets: ['One', 'Two'] },
        { label: 'B', bullets: ['Three'] },
      ],
    })
    expect(s.key_competencies.map((c) => c.sort_order)).toEqual([0, 1, 2])
  })

  it('ignores a blank skill name inside a skill category', () => {
    const s = draft({ technology_categories: [{ name: 'Cloud', skills: ['Go', '', '  '] }] })
    expect(s.skills).toHaveLength(1)
    expect(s.skills[0].is_highlighted).toBe(true)
  })
})

describe('importFromAIDraft — the registry rows and the bundles', () => {
  const draft = (over: Record<string, unknown> = {}) =>
    importFromAIDraft({ $schema: AI_IMPORT_SCHEMA, ...over } as never)

  it('creates a role registry entry enabled and unstarred', () => {
    // The registries are shared across resumes; a starred or disabled entry
    // arriving from one import shows up everywhere the registry is read.
    const s = draft({ projects: [{ customer: 'Acme', roles: ['Architect'] }] })
    expect(s.roles[0]).toMatchObject({ starred: false, disabled: false })
  })

  it('creates no competency for a profile with no bullets', () => {
    const s = draft({ key_qualifications: [{ label: 'Architect', summary: 'Cloud.' }] })
    expect(s.key_competencies).toEqual([])
    expect(s.key_qualifications[0].competency_ids).toEqual([])
  })

  it('bundles exactly the competencies it created for that profile', () => {
    // The bundle IS the view's competency list (CLAUDE.md §4): an extra id in it
    // resolves to nothing and silently shortens the rendered bundle.
    const s = draft({
      key_qualifications: [
        { label: 'A', bullets: ['One', 'Two'] },
        { label: 'B', bullets: ['Three'] },
      ],
    })
    const ids = s.key_competencies.map((c) => c.id)
    expect(s.key_qualifications[0].competency_ids).toEqual([ids[0], ids[1]])
    expect(s.key_qualifications[1].competency_ids).toEqual([ids[2]])
  })

  it('leaves a skill in the FIRST category that claimed it', () => {
    // A skill belongs to at most one category; letting a later group overwrite
    // the link would make the Showcase order depend on the reply's order.
    const s = draft({
      technology_categories: [
        { name: 'Languages', skills: ['Go'] },
        { name: 'Cloud', skills: ['Go'] },
      ],
    })
    expect(s.skills).toHaveLength(1)
    expect(s.skills[0].category_id).toBe(s.skill_categories![0].id)
  })
})

describe('summarizeImportedStore — a store with no skill categories', () => {
  it('counts none rather than inventing a line for them', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', name: { en: 'Go' } })] }
    delete (store as { skill_categories?: unknown }).skill_categories
    const summary = summarizeImportedStore(store as never)
    expect(summary.lines.some((l) => l.label === 'skill categories')).toBe(false)
  })
})
