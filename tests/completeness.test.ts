import { describe, it, expect } from 'vitest'
import { computeCompleteness, computeSectionCoverage } from '../src/lib/completeness'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ, makeCourse, makeSkill, makeRole,
  makeSkillCategory,
} from './fixtures'

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
