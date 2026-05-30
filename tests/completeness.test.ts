import { describe, it, expect } from 'vitest'
import { computeCompleteness } from '../src/lib/completeness'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ, makeCourse,
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
