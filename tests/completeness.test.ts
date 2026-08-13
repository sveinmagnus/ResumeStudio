import { describe, it, expect } from 'vitest'
import type { ResumeStore } from '../src/types'
import { computeCompleteness, computeSectionCoverage, collectTrackedFields } from '../src/lib/completeness'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ, makeCourse, makeSkill, makeRole,
  makeSkillCategory, makeCertification, makeResume, makeIndustry, makeCoverLetter,
} from './fixtures'

describe('collectTrackedFields()', () => {
  /**
   * Every content section applies the same rule: a soft-deleted item ships in
   * no export, so its untranslated fields must not drag the score down. The
   * check is written out per section, so it can be lost from one of them
   * without any aggregate number moving much.
   */
  it('excludes a disabled item in every section that has one', () => {
    const cases: Array<[string, Partial<ResumeStore>]> = [
      ['key_qualifications', { key_qualifications: [makeKQ({ summary: { en: 'x' }, disabled: true })] }],
      ['projects', { projects: [makeProject({ long_description: { en: 'x' }, disabled: true })] }],
      ['work_experiences', { work_experiences: [makeWork({ long_description: { en: 'x' }, disabled: true })] }],
      ['educations', { educations: [makeEducation({ description: { en: 'x' }, disabled: true })] }],
      ['courses', { courses: [makeCourse({ description: { en: 'x' }, disabled: true })] }],
      ['certifications', { certifications: [makeCertification({ description: { en: 'x' }, disabled: true })] }],
    ]
    for (const [name, over] of cases) {
      const store = { ...emptyStore(), resume: undefined as never, ...over }
      expect(collectTrackedFields(store as ResumeStore), name).toEqual([])
    }
  })

  it('tracks certifications, which nothing else reaches', () => {
    const store = {
      ...emptyStore(),
      resume: undefined as never,
      certifications: [makeCertification({ name: { en: 'CKA' }, description: { en: 'Kubernetes admin.' } })],
    }
    const fields = collectTrackedFields(store as ResumeStore)
    // Only the name, exactly as for courses — the description is deliberately
    // out of scope for both reports.
    expect(fields.map((f) => f.meta.fieldLabel)).toEqual(['Name'])
    expect(fields[0].meta.section).toBe('certifications')
    expect(fields[0].prose).toBe(false)
  })

  /**
   * `prose` is what drift.ts uses to decide whether comparing two lengths says
   * anything. A name is not prose: "Acme" and "Acme" differing in length is
   * meaningless, and marking it prose would fill the drift report with noise.
   */
  it('marks long-form fields as prose and identity fields as not', () => {
    const store = {
      ...emptyStore(),
      resume: makeResume({ title: { en: 'Architect' } }),
      projects: [makeProject({ customer: { en: 'Acme' }, long_description: { en: 'Ran the work.' } })],
      work_experiences: [makeWork({ employer: { en: 'BigCo' }, long_description: { en: 'Led a team.' } })],
      key_qualifications: [makeKQ({ summary: { en: 'A summary.' }, tag_line: { en: 'Architect' } })],
    }
    const byLabel = Object.fromEntries(
      collectTrackedFields(store as ResumeStore).map((f) => [`${f.meta.section}.${f.meta.fieldLabel}`, f.prose]),
    )
    expect(byLabel['projects.Long description']).toBe(true)
    expect(byLabel['work_experiences.Long description']).toBe(true)
    expect(byLabel['key_qualifications.Summary']).toBe(true)
    expect(byLabel['key_qualifications.Tagline']).toBe(false)
    expect(byLabel['header.Title']).toBe(false)
  })

  it('reads nothing from the resume record when there isn\'t one', () => {
    const store = { ...emptyStore(), resume: undefined } as unknown as ResumeStore
    expect(collectTrackedFields(store)).toEqual([])
  })
})

describe('computeCompleteness()', () => {
  it('returns 100% for every locale when there are no tracked fields', () => {
    const store = emptyStore()
    if (store.resume) {
      // wipe the seeded title in the fixture
      store.resume.title = {}
      store.resume.nationality = {}
      store.resume.place_of_residence = {}
    }
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.en).toEqual({ percent: 100, missing: [] })
    expect(out.no).toEqual({ percent: 100, missing: [] })
  })

  it('returns 100% only for locales that fill every tracked field', () => {
    const store = emptyStore()
    if (store.resume) {
      store.resume.title = { en: 'A', no: 'B' }
      store.resume.nationality = { en: 'A' }      // no Norwegian
      store.resume.place_of_residence = { en: 'A' }
    }
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.en.percent).toBe(100)
    expect(out.en.missing).toEqual([])
    expect(out.no.percent).toBeLessThan(100)
    expect(out.no.missing.length).toBe(2)
  })

  it('counts only fields with non-empty trimmed values', () => {
    const store = emptyStore()
    if (store.resume) {
      store.resume.title = { en: 'A', no: '   ' }   // whitespace doesn't count
      store.resume.nationality = { en: 'A', no: 'B' }
      store.resume.place_of_residence = { en: 'A', no: 'B' }
    }
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.en.percent).toBe(100)
    expect(out.no.percent).toBe(67) // 2 of 3 tracked fields filled in Norwegian → round(66.67)
  })

  it('aggregates fields from key_qualifications, projects, work, education, courses', () => {
    const store = emptyStore()
    if (store.resume) {
      store.resume.title = {}
      store.resume.nationality = {}
      store.resume.place_of_residence = {}
    }
    store.key_qualifications.push(makeKQ({ summary: { en: 'A' }, tag_line: { en: 'B' } }))
    store.projects.push(makeProject({ customer: { en: 'A' }, description: { en: 'B' }, long_description: { en: 'C' } }))
    store.work_experiences.push(makeWork({ employer: { en: 'A' }, long_description: { en: 'B' } }))
    store.educations.push(makeEducation({ school: { en: 'A' }, degree: { en: 'B' } }))
    store.courses.push(makeCourse({ name: { en: 'A' } }))
    // total tracked = 2 + 3 + 2 + 2 + 1 = 10; all filled in en → 100
    expect(computeCompleteness(store, ['en']).en.percent).toBe(100)
    // None filled in no → 0
    const no = computeCompleteness(store, ['no']).no
    expect(no.percent).toBe(0)
    expect(no.missing.length).toBe(10)
  })

  it('ignores fields that are completely empty (not tracked)', () => {
    const store = emptyStore()
    if (store.resume) {
      store.resume.title = {} // empty — not tracked
      store.resume.nationality = { en: 'A' } // tracked
      store.resume.place_of_residence = {}
    }
    // 1 tracked field, filled in en → 100, not in no → 0
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.en.percent).toBe(100)
    expect(out.no.percent).toBe(0)
    expect(out.no.missing).toHaveLength(1)
    expect(out.no.missing[0]).toMatchObject({
      section: 'header', itemId: null, fieldLabel: 'Nationality',
    })
  })

  it('returns missing fields with section, itemId, item label, and field label', () => {
    const store = emptyStore()
    if (store.resume) {
      store.resume.title = {}
      store.resume.nationality = {}
      store.resume.place_of_residence = {}
    }
    const project = makeProject({
      // customer non-empty so the project still gets an identifying label,
      // even though we're checking a locale where it's missing
      customer: { en: 'Acme Corp' },
      description: {},
      long_description: { en: 'desc' },
    })
    store.projects.push(project)
    const out = computeCompleteness(store, ['no'])
    const missing = out.no.missing
    expect(missing.length).toBe(2) // customer + long_description (description is empty so not tracked)
    expect(missing.every((m) => m.section === 'projects')).toBe(true)
    expect(missing.every((m) => m.itemId === project.id)).toBe(true)
    expect(missing.every((m) => m.itemLabel === 'Acme Corp')).toBe(true)
    const fieldLabels = missing.map((m) => m.fieldLabel).sort()
    expect(fieldLabels).toEqual(['Customer', 'Long description'])
  })

  it('labels resume-level missing fields under the header section', () => {
    const store = emptyStore()
    if (store.resume) {
      store.resume.title = { en: 'Consultant' }
      store.resume.nationality = {}
      store.resume.place_of_residence = {}
    }
    const out = computeCompleteness(store, ['no'])
    const titleMissing = out.no.missing.find((m) => m.fieldLabel === 'Title')
    expect(titleMissing).toMatchObject({
      section: 'header', itemId: null, itemLabel: 'Personal details',
    })
  })
})

describe('computeSectionCoverage()', () => {
  it('reports per-section populated/total counts for the requested locale', () => {
    const store = {
      ...emptyStore(),
      projects: [
        makeProject({ id: 'p1', customer: { en: 'Acme' } }),                          // en only
        makeProject({ id: 'p2', customer: { en: 'Beta', no: 'Beta' } }),              // both
      ],
      educations: [
        // School AND degree both no-only — otherwise the fixture's default
        // degree.en would make this item "populated" in English.
        makeEducation({ id: 'e1', school: { no: 'Universitetet' }, degree: { no: 'BSc' } }),
      ],
    }
    const en = computeSectionCoverage(store, 'en')
    const projectsEn = en.find((r) => r.key === 'projects')!
    const eduEn = en.find((r) => r.key === 'educations')!
    expect(projectsEn).toEqual({ key: 'projects', label: 'Projects', total: 2, populated: 2 })
    expect(eduEn).toEqual({ key: 'educations', label: 'Education', total: 1, populated: 0 })
  })

  it('skips registry sections (skills/roles) and views', () => {
    const out = computeSectionCoverage(emptyStore(), 'en')
    expect(out.find((r) => r.key === 'skills')).toBeUndefined()
    expect(out.find((r) => r.key === 'roles')).toBeUndefined()
    expect(out.find((r) => r.key === 'views')).toBeUndefined()
  })

  it('excludes disabled items from the totals', () => {
    const store = {
      ...emptyStore(),
      projects: [
        makeProject({ id: 'p1', customer: { en: 'Acme' }, disabled: true }),
        makeProject({ id: 'p2', customer: { en: 'Beta' } }),
      ],
    }
    const out = computeSectionCoverage(store, 'en')
    const projects = out.find((r) => r.key === 'projects')!
    expect(projects.total).toBe(1)
    expect(projects.populated).toBe(1)
  })

  it('sorts most-missing-first, with empty sections last', () => {
    const store = {
      ...emptyStore(),
      // Fully missing
      educations: [makeEducation({ school: { no: 'U' } })],
      // Partially missing
      work_experiences: [
        makeWork({ employer: { en: 'A' } }),
        makeWork({ employer: { no: 'B' } }),
      ],
      // Empty (no items at all) — other sections
    }
    const out = computeSectionCoverage(store, 'en')
    const labels = out.filter((r) => r.total > 0).map((r) => r.label)
    // Education is fully missing (1 gap), Employment has 1 of 2 missing — same
    // gap count, tie-broken alphabetically: Education before Employment.
    expect(labels.slice(0, 2)).toEqual(['Education', 'Employment'])
    // Empty sections end up at the bottom.
    const last = out[out.length - 1]
    expect(last.total).toBe(0)
  })

  it('counts items as populated if any tracked field has content in the locale', () => {
    const store = {
      ...emptyStore(),
      key_qualifications: [makeKQ({
        label: {}, summary: { no: 'oppsummering' }, tag_line: {},
      })],
      courses: [makeCourse({ name: { no: 'A' }, program: {}, description: {} })],
    }
    const noOut = computeSectionCoverage(store, 'no')
    expect(noOut.find((r) => r.key === 'key_qualifications')?.populated).toBe(1)
    expect(noOut.find((r) => r.key === 'courses')?.populated).toBe(1)
  })
})

describe('computeCompleteness() — used registry items (skills / roles)', () => {
  function clearHeader(store: ReturnType<typeof emptyStore>) {
    if (store.resume) {
      store.resume.title = {}
      store.resume.nationality = {}
      store.resume.place_of_residence = {}
    }
  }

  it('counts a USED skill missing its secondary translation as incomplete', () => {
    const store = emptyStore()
    clearHeader(store)
    const skill = makeSkill({ id: 'sk1', name: { en: 'React' } }) // no Norwegian
    store.skills = [skill]
    store.projects = [makeProject({
      id: 'p1',
      customer: { en: 'Acme', no: 'Acme' },
      description: { en: 'd', no: 'd' },
      long_description: { en: 'l', no: 'l' },
      skills: [{ id: 'ps1', skill_id: 'sk1', name: skill.name, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
    })]

    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.en.percent).toBe(100)
    expect(out.no.percent).toBeLessThan(100)
    expect(out.no.missing.some((m) => m.section === 'skills' && m.itemId === 'sk1')).toBe(true)
  })

  it('ignores an UNUSED skill missing a translation', () => {
    const store = emptyStore()
    clearHeader(store)
    store.skills = [makeSkill({ id: 'sk1', name: { en: 'React' } })] // referenced by nothing
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.no).toEqual({ percent: 100, missing: [] })
  })

  it('counts a role linked from an employment', () => {
    const store = emptyStore()
    clearHeader(store)
    store.roles = [makeRole({ id: 'r1', name: { en: 'Architect' } })] // no Norwegian
    store.work_experiences = [makeWork({ id: 'w1', employer: { en: 'C', no: 'C' }, long_description: { en: 'x', no: 'x' }, role_ids: ['r1'] })]
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.no.missing.some((m) => m.section === 'roles' && m.itemId === 'r1')).toBe(true)
  })

  it('ignores a skill referenced only by a DISABLED project', () => {
    const store = emptyStore()
    clearHeader(store)
    const skill = makeSkill({ id: 'sk1', name: { en: 'React' } }) // no Norwegian
    store.skills = [skill]
    store.projects = [makeProject({
      id: 'p1',
      disabled: true, // soft-deleted → never exports, so its skill isn't "used"
      customer: { en: 'Acme', no: 'Acme' },
      skills: [{ id: 'ps1', skill_id: 'sk1', name: skill.name, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
    })]
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.no).toEqual({ percent: 100, missing: [] })
  })

  it('ignores a role linked only from a DISABLED employment', () => {
    const store = emptyStore()
    clearHeader(store)
    store.roles = [makeRole({ id: 'r1', name: { en: 'Architect' } })] // no Norwegian
    store.work_experiences = [makeWork({ id: 'w1', disabled: true, employer: { en: 'C', no: 'C' }, long_description: { en: 'x', no: 'x' }, role_ids: ['r1'] })]
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.no).toEqual({ percent: 100, missing: [] })
  })

  it('counts a USED skill category (≥1 linked skill) missing its translation', () => {
    const store = emptyStore()
    clearHeader(store)
    store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })] // no Norwegian
    store.skills = [makeSkill({ id: 'sk1', name: { en: 'React', no: 'React' }, category_id: 'cat1' })]
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.no.missing.some((m) => m.section === 'skills' && m.itemId === 'cat1')).toBe(true)
  })

  it('ignores an UNUSED skill category (no linked skills) missing a translation', () => {
    const store = emptyStore()
    clearHeader(store)
    store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })] // no Norwegian
    const out = computeCompleteness(store, ['en', 'no'])
    expect(out.no).toEqual({ percent: 100, missing: [] })
  })
})

/**
 * The per-section "is there anything in this language" probe.
 *
 * 81 mutants no test reached: the switch has a case per section and only a
 * couple were ever exercised, so a section could be reading the WRONG field —
 * reporting a fully-written section as empty, or an empty one as done — and
 * nothing would notice. The bar is deliberately permissive (any ONE key field),
 * which is what makes a wrong field name silent rather than loud.
 */
describe('computeSectionCoverage — the per-section content probe', () => {
  /** Coverage for one section, given one item. */
  const covers = (key: string, storeKey: string, item: Record<string, unknown>): { total: number; populated: number } => {
    const store = emptyStore() as unknown as Record<string, unknown>
    store[storeKey] = [{ id: 'x', ...item }]
    const row = computeSectionCoverage(store as never, 'en').find((r) => r.key === key)!
    return { total: row.total, populated: row.populated }
  }

  // One representative field per section — enough to prove the case reads the
  // section it claims to, which is what the mutants were free to change.
  const CASES: Array<[string, string, string]> = [
    ['key_qualifications', 'key_qualifications', 'summary'],
    ['key_competencies', 'key_competencies', 'title'],
    ['recommendations', 'recommendations', 'text'],
    ['projects', 'projects', 'customer'],
    ['work_experiences', 'work_experiences', 'employer'],
    ['educations', 'educations', 'school'],
    ['courses', 'courses', 'name'],
    ['certifications', 'certifications', 'name'],
    ['spoken_languages', 'spoken_languages', 'name'],
    ['positions', 'positions', 'name'],
    ['presentations', 'presentations', 'title'],
    ['publications', 'publications', 'title'],
    ['honor_awards', 'honor_awards', 'name'],
    ['references', 'references', 'relationship'],
  ]

  it.each(CASES)('counts a %s item populated via its %s field', (key, storeKey, field) => {
    expect(covers(key, storeKey, { [field]: { en: 'written' } })).toEqual({ total: 1, populated: 1 })
  })

  it.each(CASES)('counts a %s item UNpopulated when that field is empty', (key, storeKey, field) => {
    expect(covers(key, storeKey, { [field]: { en: '' } })).toEqual({ total: 1, populated: 0 })
  })

  it('counts content in the REQUESTED locale only', () => {
    const store = emptyStore()
    store.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' } })]
    const row = (loc: string) => computeSectionCoverage(store, loc).find((r) => r.key === 'projects')!
    expect(row('en').populated).toBe(1)
    expect(row('no').populated).toBe(0)
  })

  it('does not count whitespace as content', () => {
    // (Markup-only values resolve to nothing too, via richToPlain — that path
    // needs a DOM and is pinned in the richText suite; this file runs in node.)
    expect(covers('projects', 'projects', { long_description: { en: '   ' } }).populated).toBe(0)
    expect(covers('projects', 'projects', { long_description: { en: 'real' } }).populated).toBe(1)
  })

  it('does not count a disabled item at all — not even in the total', () => {
    const store = emptyStore()
    store.projects = [
      makeProject({ id: 'p1', customer: { en: 'Acme' } }),
      makeProject({ id: 'p2', customer: { en: 'Beta' }, disabled: true }),
    ]
    expect(computeSectionCoverage(store, 'en').find((r) => r.key === 'projects'))
      .toMatchObject({ total: 1, populated: 1 })
  })

  it('leaves the registries and views out of the reckoning', () => {
    // Skills and roles carry language content, but the consultant does not
    // think of them as translatable prose — measuring them would make the
    // report say a CV is half-written when its registry is.
    const keys = computeSectionCoverage(emptyStore(), 'en').map((r) => r.key)
    expect(keys).not.toContain('skills')
    expect(keys).not.toContain('roles')
    expect(keys).not.toContain('views')
  })

  it('does not double-count a synthetic section that borrows a storeKey', () => {
    const keys = computeSectionCoverage(emptyStore(), 'en').map((r) => r.key)
    expect(keys).not.toContain('promoted_projects')
    expect(keys).not.toContain('skill_matrix')
  })

  describe('the ordering, which is what makes the report actionable', () => {
    const store = () => {
      const s = emptyStore()
      // projects: 2 missing. educations: 1 missing. courses: none at all.
      // Every key field has to be blank — the bar is "any ONE of them", so a
      // fixture's default description alone counts the item as populated.
      const blank = { customer: {}, description: {}, long_description: {} }
      s.projects = [
        makeProject({ id: 'p1', ...blank }),
        makeProject({ id: 'p2', ...blank }),
        makeProject({ id: 'p3', ...blank, customer: { en: 'Acme' } }),
      ]
      s.educations = [makeEducation({ id: 'e1', school: {} })]
      return s
    }

    it('puts the biggest gap first', () => {
      const rows = computeSectionCoverage(store(), 'en')
      expect(rows[0].key).toBe('projects')
      expect(rows[1].key).toBe('educations')
    })

    it('sinks sections with no items to the bottom — they are not actionable', () => {
      const rows = computeSectionCoverage(store(), 'en')
      const empties = rows.filter((r) => r.total === 0)
      const nonEmpty = rows.filter((r) => r.total > 0)
      expect(empties.length).toBeGreaterThan(0)
      const lastNonEmpty = rows.lastIndexOf(nonEmpty[nonEmpty.length - 1])
      const firstEmpty = rows.indexOf(empties[0])
      expect(firstEmpty).toBeGreaterThan(lastNonEmpty)
    })

    it('breaks an equal-gap tie by label, so the order is stable run to run', () => {
      const s = emptyStore()
      s.courses = [{ ...makeCourse({ id: 'c1' }), name: {} } as never]
      s.educations = [makeEducation({ id: 'e1', school: {} })]
      const rows = computeSectionCoverage(s, 'en').filter((r) => r.total > 0)
      expect(rows.map((r) => r.label)).toEqual([...rows.map((r) => r.label)].sort((a, b) => a.localeCompare(b)))
    })
  })
})

describe('collectTrackedFields — the registries', () => {
  /**
   * A registry entry is only tracked when the CV actually REFERENCES it: the
   * shared registries outlive any one resume (they propagate across resumes and
   * ride the desktop sync), so an untranslated entry this CV never uses is not
   * this CV's incompleteness.
   */
  const linked = (): ResumeStore => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'used', name: { en: 'Go' } }), makeSkill({ id: 'idle', name: { en: 'Rust' } })]
    s.roles = [makeRole({ id: 'r-used', name: { en: 'Architect' } }), makeRole({ id: 'r-idle', name: { en: 'Scribe' } })]
    s.industries = [makeIndustry({ id: 'i-used', name: { en: 'Energy' } }), makeIndustry({ id: 'i-idle', name: { en: 'Retail' } })]
    s.projects = [makeProject({
      skills: [{ skill_id: 'used', name: { en: 'Go' }, proficiency: 0 }],
      roles: [{ role_id: 'r-used', name: { en: 'Architect' }, description: {} }],
      industries: [{ industry_id: 'i-used', name: { en: 'Energy' } }],
    })]
    return s
  }
  const labels = (s: ResumeStore) => collectTrackedFields(s).map((f) => f.meta.itemLabel)

  it('tracks a referenced registry entry and ignores an unreferenced one', () => {
    const out = labels(linked())
    expect(out).toContain('Go')
    expect(out).toContain('Architect')
    expect(out).toContain('Energy')
    expect(out).not.toContain('Rust')
    expect(out).not.toContain('Scribe')
    expect(out).not.toContain('Retail')
  })

  it('drops a referenced role or industry that is itself disabled', () => {
    // Disabled means "ships in no export", so it cannot be incomplete either —
    // even though a live project still links it.
    const s = linked()
    s.roles[0].disabled = true
    s.industries[0].disabled = true
    const out = labels(s)
    expect(out).not.toContain('Architect')
    expect(out).not.toContain('Energy')
    expect(out).toContain('Go')
  })

  it('picks up a role referenced only from a work experience', () => {
    const s = emptyStore()
    s.roles = [makeRole({ id: 'r1', name: { en: 'Team lead' } })]
    s.work_experiences = [makeWork({ role_ids: ['r1'] })]
    expect(labels(s)).toContain('Team lead')
  })

  it('ignores a role referenced only from a DISABLED work experience', () => {
    const s = emptyStore()
    s.roles = [makeRole({ id: 'r1', name: { en: 'Team lead' } })]
    s.work_experiences = [makeWork({ role_ids: ['r1'], disabled: true })]
    expect(labels(s)).not.toContain('Team lead')
  })

  it('tracks a skill CATEGORY once a skill links it, and not before', () => {
    const s = emptyStore()
    s.skill_categories = [makeSkillCategory({ id: 'c1', name: { en: 'Languages' } })]
    s.skills = [makeSkill({ id: 's1', name: { en: 'Go' }, category_id: null })]
    s.projects = [makeProject({ skills: [{ skill_id: 's1', name: { en: 'Go' }, proficiency: 0 }] })]
    expect(labels(s)).not.toContain('Languages')
    s.skills[0].category_id = 'c1'
    expect(labels(s)).toContain('Languages')
  })

  it('falls back to a generic label when a registry name has no text', () => {
    // The label is what the report row reads as; an empty one would be a blank row.
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { no: 'Go' } })]
    s.roles = [makeRole({ id: 'r1', name: { no: 'Arkitekt' } })]
    s.industries = [makeIndustry({ id: 'i1', name: { no: 'Energi' } })]
    s.skill_categories = [makeSkillCategory({ id: 'c1', name: { no: 'Språk' } })]
    s.skills[0].category_id = 'c1'
    s.projects = [makeProject({
      skills: [{ skill_id: 's1', name: { no: 'Go' }, proficiency: 0 }],
      roles: [{ role_id: 'r1', name: { no: 'Arkitekt' }, description: {} }],
      industries: [{ industry_id: 'i1', name: { no: 'Energi' } }],
    })]
    const out = labels(s)
    // Names exist, just not in the label locale, so each keeps its own text.
    expect(out).toContain('Go')
    expect(out).toContain('Arkitekt')
    expect(out).toContain('Energi')
    expect(out).toContain('Språk')
  })

  it('names every field it tracks — no unnamed rows', () => {
    for (const f of collectTrackedFields(linked())) {
      expect(f.meta.fieldLabel).toBeTruthy()
      expect(f.meta.itemLabel).toBeTruthy()
    }
  })
})

describe('computeSectionCoverage — what it declines to measure', () => {
  it('leaves out the three registries and the view configs', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ name: { en: 'Go' } })]
    s.roles = [makeRole({ name: { en: 'Architect' } })]
    s.industries = [makeIndustry({ name: { en: 'Energy' } })]
    const keys = computeSectionCoverage(s, 'en').map((c) => c.key)
    for (const k of ['skills', 'roles', 'industries', 'views']) expect(keys).not.toContain(k)
  })

  it('measures cover letters on their substance, not their internal name', () => {
    const s = emptyStore()
    s.cover_letters = [
      makeCoverLetter({ name: 'Acme', body: { en: 'Dear…' } }),
      makeCoverLetter({ name: 'Beta', body: {}, role_applied: {} }),
    ]
    const cl = computeSectionCoverage(s, 'en').find((c) => c.key === 'cover_letters')!
    expect(cl.total).toBe(2)
    expect(cl.populated).toBe(1)
  })
})

/**
 * The per-section "does this item say anything" probe, and the ordering of the
 * drill-down.
 *
 * The probe decides whether an item counts as populated at all, so a section
 * dropping out of it reports every one of its items as empty — the panel then
 * tells the user to fill in fields that are already filled.
 */
describe('completeness — each section counts its own fields', () => {
  const store = (over: Partial<ResumeStore>): ResumeStore => ({ ...emptyStore(), ...over })
  const sectionRow = (data: ResumeStore, key: string) =>
    computeSectionCoverage(data, 'en').find((s) => s.key === key)

  it('counts a course, certification, language and presentation as populated', () => {
    // One field each, and a different field per section: a probe that fell
    // through to "false" would report these as empty.
    const rows = [
      ['courses', store({ courses: [makeCourse({ id: 'c1', name: {}, program: { en: 'Cloud track' } })] })],
      ['certifications', store({ certifications: [makeCertification({ id: 'ce1', name: {}, organiser: { en: 'Amazon' } })] })],
      ['spoken_languages', store({ spoken_languages: [{ id: 'l1', resume_id: 'r', name: {}, level: { en: 'Native' }, sort_order: 0, disabled: false } as never] })],
      ['presentations', store({ presentations: [{ ...makeCourse({ id: 'p1' }), event: { en: 'JavaZone' }, title: {}, description: {} } as never] })],
    ] as const
    for (const [key, data] of rows) {
      expect(sectionRow(data, key)?.populated, key).toBeGreaterThan(0)
    }
  })
})

describe('completenessBySection — the order of the drill-down', () => {
  it('sinks a section with no items below one that has a gap', () => {
    // An empty section is not actionable; leaving it above the sections with
    // real gaps buries the work the user came to do.
    const s = { ...emptyStore(), projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: {} })] }
    const rows = computeSectionCoverage(s as never, 'en')
    const projects = rows.findIndex((r) => r.key === 'projects')
    const empty = rows.findIndex((r) => r.total === 0)
    expect(projects).toBeLessThan(empty)
  })

  it('orders two gapped sections by the SIZE of the gap', () => {
    const s = {
      ...emptyStore(),
      projects: [
        makeProject({ id: 'p1', customer: {}, description: {}, long_description: {} }),
        makeProject({ id: 'p2', customer: {}, description: {}, long_description: {} }),
      ],
      educations: [makeEducation({ id: 'e1', school: {}, degree: {}, description: {} })],
    }
    const rows = computeSectionCoverage(s as never, 'en').filter((r) => r.total > 0)
    const gaps = rows.map((r) => r.total - r.populated)
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a))
  })

  it('keeps the empty sections in a stable alphabetical order among themselves', () => {
    // They all sink below the actionable rows, but the panel still lists them —
    // and a comparator that reports an order for two equally-empty sections
    // makes that list reshuffle on every render.
    const rows = computeSectionCoverage(emptyStore(), 'en').filter((r) => r.total === 0)
    expect(rows.length).toBeGreaterThan(3)
    expect(rows.map((r) => r.label)).toEqual([...rows.map((r) => r.label)].sort((a, b) => a.localeCompare(b)))
  })
})
