import { describe, it, expect } from 'vitest'
import { buildCareerTimeline, monthsToLabel } from '../src/lib/careerTimeline'
import { emptyStore, makeWork, makeProject, makeEducation } from './fixtures'
import type { ResumeStore } from '../src/types'

const NOW = new Date('2026-06-15T00:00:00Z') // → nowMonths = 2026*12 + 6
const opts = { now: NOW }

describe('buildCareerTimeline — basics', () => {
  it('reports no data for an empty store', () => {
    const m = buildCareerTimeline(emptyStore(), 'en', opts)
    expect(m.hasData).toBe(false)
    expect(m.employment.bars).toEqual([])
  })

  it('skips employments without a start date and disabled items', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'w1', start: null }))
    store.work_experiences.push(makeWork({ id: 'w2', start: { year: 2020, month: 1 }, end: { year: 2021, month: 1 }, disabled: true }))
    expect(buildCareerTimeline(store, 'en', opts).employment.bars).toEqual([])
  })

  it('builds an employment bar with absolute months and an ongoing end at now', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'Cartavio' }, start: { year: 2020, month: 3 }, end: null,
    }))
    const m = buildCareerTimeline(store, 'en', opts)
    const bar = m.employment.bars[0]
    expect(bar.startMonths).toBe(2020 * 12 + 3)
    expect(bar.ongoing).toBe(true)
    expect(bar.endMonths).toBe(2026 * 12 + 6) // nowMonths
    expect(bar.label).toBe('Cartavio')
  })

  it('rounds the axis out to whole years and lists year ticks', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'w1', start: { year: 2019, month: 6 }, end: { year: 2021, month: 2 } }))
    const m = buildCareerTimeline(store, 'en', { ...opts, includeProjects: false })
    expect(m.minMonths).toBe(2019 * 12) // Jan 2019
    expect(m.maxMonths).toBe(2027 * 12) // Jan after 2026 (nowMonths year)
    expect(m.years[0]).toBe(2019)
    expect(m.years).toContain(2026)
  })
})

describe('lane packing (overlap handling)', () => {
  it('puts non-overlapping employments in one lane', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2018, month: 1 }, end: { year: 2019, month: 1 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2019, month: 6 }, end: { year: 2020, month: 1 } }))
    const m = buildCareerTimeline(store, 'en', { ...opts, includeProjects: false })
    expect(m.employment.lanes).toBe(1)
    expect(m.employment.bars.every((b) => b.lane === 0)).toBe(true)
  })

  it('reuses a lane for a job starting the month the last one ended', () => {
    // The boundary the lane packer turns on: with a strict comparison this
    // stacks two consecutive jobs into two lanes and doubles the chart height.
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2018, month: 1 }, end: { year: 2019, month: 6 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2019, month: 6 }, end: { year: 2020, month: 1 } }))
    const m = buildCareerTimeline(store, 'en', { ...opts, includeProjects: false })
    expect(m.employment.lanes).toBe(1)
  })

  it('stacks overlapping employments into separate lanes', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2018, month: 1 }, end: { year: 2020, month: 1 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2019, month: 1 }, end: { year: 2021, month: 1 } }))
    const m = buildCareerTimeline(store, 'en', { ...opts, includeProjects: false })
    expect(m.employment.lanes).toBe(2)
    expect(new Set(m.employment.bars.map((b) => b.lane))).toEqual(new Set([0, 1]))
  })
})

describe('employment gaps', () => {
  it('detects a multi-month gap between jobs', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2018, month: 1 }, end: { year: 2019, month: 6 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2020, month: 1 }, end: { year: 2021, month: 1 } }))
    const m = buildCareerTimeline(store, 'en', { ...opts, includeProjects: false, minGapMonths: 2 })
    expect(m.gaps).toHaveLength(1)
    // Jul–Dec 2019 = 6 uncovered months.
    expect(m.gaps[0].months).toBe(6)
    expect(m.gaps[0].startMonths).toBe(2019 * 12 + 7)
    expect(m.gaps[0].endMonths).toBe(2019 * 12 + 12)
  })

  it('ignores back-to-back jobs and gaps under the threshold', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2018, month: 1 }, end: { year: 2019, month: 6 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2019, month: 7 }, end: { year: 2020, month: 1 } })) // contiguous
    store.work_experiences.push(makeWork({ id: 'c', start: { year: 2020, month: 2 }, end: { year: 2021, month: 1 } })) // 0-month gap
    const m = buildCareerTimeline(store, 'en', { ...opts, includeProjects: false, minGapMonths: 2 })
    expect(m.gaps).toEqual([])
  })

  it('reports a gap of exactly the threshold', () => {
    // Only the far side was tested, so moving the comparison a month was
    // invisible — and a two-month gap is precisely what a user asks about.
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2018, month: 1 }, end: { year: 2019, month: 6 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2019, month: 9 }, end: { year: 2020, month: 1 } }))
    const m = buildCareerTimeline(store, 'en', { ...opts, includeProjects: false, minGapMonths: 2 })
    expect(m.gaps.map((g) => g.months)).toEqual([2])
  })

  it('never calls contiguous jobs a gap, even with no threshold at all', () => {
    // With minGapMonths 0 the threshold cannot mask an off-by-one in the
    // "is there anything uncovered here" test, which is the point.
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2018, month: 1 }, end: { year: 2019, month: 6 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2019, month: 7 }, end: { year: 2020, month: 1 } }))
    const m = buildCareerTimeline(store, 'en', { ...opts, includeProjects: false, minGapMonths: 0 })
    expect(m.gaps).toEqual([])
  })

  it('does not treat an overlap (concurrent jobs) as a gap', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2018, month: 1 }, end: { year: 2022, month: 1 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2019, month: 1 }, end: { year: 2020, month: 1 } }))
    const m = buildCareerTimeline(store, 'en', { ...opts, includeProjects: false })
    expect(m.gaps).toEqual([])
  })
})

describe('education track', () => {
  it('builds an education bar from school + degree', () => {
    const store = emptyStore()
    store.educations.push(makeEducation({
      id: 'e1', school: { en: 'NTNU' }, degree: { en: 'MSc CS' },
      start: { year: 2014, month: 8 }, end: { year: 2016, month: 6 },
    }))
    const m = buildCareerTimeline(store, 'en', opts)
    expect(m.education.bars).toHaveLength(1)
    expect(m.education.bars[0].label).toBe('NTNU')
    expect(m.education.bars[0].sublabel).toBe('MSc CS')
    expect(m.education.bars[0].kind).toBe('education')
  })

  it('skips education without a start date and disabled education', () => {
    const store = emptyStore()
    store.educations.push(makeEducation({ id: 'e1', start: null }))
    store.educations.push(makeEducation({ id: 'e2', start: { year: 2014, month: 1 }, disabled: true }))
    expect(buildCareerTimeline(store, 'en', opts).education.bars).toEqual([])
  })

  it('education FILLS what would otherwise be an employment gap', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2014, month: 1 }, end: { year: 2016, month: 6 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2018, month: 9 }, end: { year: 2020, month: 1 } }))
    // Studied Jul 2016 – Aug 2018 — exactly the otherwise-uncovered span.
    store.educations.push(makeEducation({ id: 'e1', start: { year: 2016, month: 7 }, end: { year: 2018, month: 8 } }))
    expect(buildCareerTimeline(store, 'en', opts).gaps).toEqual([])
  })

  it('the same span IS a gap when education is excluded', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2014, month: 1 }, end: { year: 2016, month: 6 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2018, month: 9 }, end: { year: 2020, month: 1 } }))
    store.educations.push(makeEducation({ id: 'e1', start: { year: 2016, month: 7 }, end: { year: 2018, month: 8 } }))
    const m = buildCareerTimeline(store, 'en', { ...opts, includeEducation: false })
    expect(m.education.bars).toEqual([])
    expect(m.gaps).toHaveLength(1)
  })
})

describe('projects track', () => {
  it('includes projects by default and excludes them when asked', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1', start: { year: 2021, month: 1 }, end: { year: 2021, month: 6 } }))
    expect(buildCareerTimeline(store, 'en', opts).projects.bars).toHaveLength(1)
    expect(buildCareerTimeline(store, 'en', { ...opts, includeProjects: false }).projects.bars).toHaveLength(0)
  })

  it('skips a disabled project and one with no start date', () => {
    // Same rule as employment, on its own code path — a soft-deleted project
    // must not reappear on the chart.
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1', start: { year: 2021, month: 1 }, end: { year: 2021, month: 6 }, disabled: true }))
    store.projects.push(makeProject({ id: 'p2', start: null, end: { year: 2021, month: 6 } }))
    expect(buildCareerTimeline(store, 'en', opts).projects.bars).toEqual([])
  })

  it('labels a project by customer, falling back to its name', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      id: 'p1', customer: { en: 'Acme' }, description: { en: 'Payments' },
      start: { year: 2021, month: 1 }, end: { year: 2021, month: 6 },
    }))
    store.projects.push(makeProject({
      id: 'p2', customer: {}, description: { en: 'Internal tooling' },
      start: { year: 2021, month: 1 }, end: { year: 2021, month: 6 },
    }))
    store.projects.push(makeProject({
      id: 'p3', customer: {}, description: {},
      start: { year: 2021, month: 1 }, end: { year: 2021, month: 6 },
    }))
    const labels = buildCareerTimeline(store, 'en', opts).projects.bars.map((b) => b.label)
    expect(labels).toEqual(['Acme', 'Internal tooling', 'Project'])
  })

  it('projects do not contribute to employment gaps', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'a', start: { year: 2018, month: 1 }, end: { year: 2019, month: 1 } }))
    store.work_experiences.push(makeWork({ id: 'b', start: { year: 2021, month: 1 }, end: { year: 2022, month: 1 } }))
    store.projects.push(makeProject({ id: 'p', start: { year: 2019, month: 6 }, end: { year: 2020, month: 6 } }))
    const m = buildCareerTimeline(store, 'en', opts)
    expect(m.gaps).toHaveLength(1) // the project does NOT fill the employment gap
  })
})

describe('monthsToLabel', () => {
  it('formats absolute months as "MMM YYYY"', () => {
    expect(monthsToLabel(2020 * 12 + 3)).toBe('Mar 2020')
    expect(monthsToLabel(2026 * 12 + 12)).toBe('Dec 2026')
  })
})

/**
 * The bar labels.
 *
 * A timeline bar is a rectangle with a name on it — if the name falls back
 * wrongly the chart shows "Project" three times over and the user cannot tell
 * which stretch is which.
 */
describe('buildCareerTimeline — bar labels', () => {
  const NOW2 = new Date('2026-06-15T00:00:00Z')
  /** One track's bars — the result is split per track, not a flat list. */
  const bars = (store: ResumeStore, track: 'employment' | 'education' | 'projects') =>
    buildCareerTimeline(store, 'en', { now: NOW2, includeProjects: true })[track].bars

  it('labels an employment by employer, with the role beneath', () => {
    const s = emptyStore()
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, role_title: { en: 'Architect' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
    })]
    expect(bars(s, 'employment')[0]).toMatchObject({ label: 'Acme', sublabel: 'Architect' })
  })

  it('falls back to a generic employment label rather than a blank bar', () => {
    const s = emptyStore()
    s.work_experiences = [makeWork({
      id: 'w1', employer: {}, role_title: {},
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
    })]
    expect(bars(s, 'employment')[0]).toMatchObject({ label: 'Employer', sublabel: '' })
  })

  it('labels a project by customer, falling through to its name', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p1', customer: { en: 'Acme' }, description: { en: 'Payments' }, start: { year: 2020, month: 1 }, end: { year: 2020, month: 6 } }),
      makeProject({ id: 'p2', customer: {}, description: { en: 'Payments' }, start: { year: 2021, month: 1 }, end: { year: 2021, month: 6 } }),
      makeProject({ id: 'p3', customer: {}, description: {}, start: { year: 2022, month: 1 }, end: { year: 2022, month: 6 } }),
    ]
    expect(bars(s, 'projects').map((b) => b.label)).toEqual(['Acme', 'Payments', 'Project'])
  })

  it('lists a project’s industries as its sublabel, comma-joined', () => {
    const s = emptyStore()
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Acme' }, start: { year: 2020, month: 1 }, end: { year: 2020, month: 6 },
      industries: [
        { id: 'i1', industry_id: 'x', name: { en: 'Banking' }, sort_order: 0 },
        { id: 'i2', industry_id: 'y', name: { en: 'Insurance' }, sort_order: 1 },
      ],
    })]
    expect(bars(s, 'projects')[0].sublabel).toBe('Banking, Insurance')
  })

  it('drops an unnamed industry rather than leaving a dangling comma', () => {
    const s = emptyStore()
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Acme' }, start: { year: 2020, month: 1 }, end: { year: 2020, month: 6 },
      industries: [
        { id: 'i1', industry_id: 'x', name: { en: 'Banking' }, sort_order: 0 },
        { id: 'i2', industry_id: 'y', name: {}, sort_order: 1 },
      ],
    })]
    expect(bars(s, 'projects')[0].sublabel).toBe('Banking')
  })

  it('labels an education by school, with the degree beneath', () => {
    const s = emptyStore()
    s.educations = [makeEducation({
      id: 'e1', school: { en: 'NTNU' }, degree: { en: 'MSc' },
      start: { year: 2014, month: 8 }, end: { year: 2019, month: 6 },
    })]
    expect(bars(s, 'education')[0]).toMatchObject({ label: 'NTNU', sublabel: 'MSc' })
  })

  it('falls back to a generic education label', () => {
    const s = emptyStore()
    s.educations = [makeEducation({
      id: 'e1', school: {}, degree: {},
      start: { year: 2014, month: 8 }, end: { year: 2019, month: 6 },
    })]
    expect(bars(s, 'education')[0].label).toBe('Education')
  })

  it('includes projects by DEFAULT, and drops them only when told to', () => {
    // The default is on — a timeline without the project track would be mostly
    // empty for a consultant whose work is all client engagements.
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, start: { year: 2020, month: 1 }, end: { year: 2020, month: 6 } })]
    expect(buildCareerTimeline(s, 'en', { now: NOW2 }).projects.bars).toHaveLength(1)
    expect(buildCareerTimeline(s, 'en', { now: NOW2, includeProjects: false }).projects.bars).toEqual([])
  })

  it('skips a disabled or undated project', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p1', customer: { en: 'Gone' }, disabled: true, start: { year: 2020, month: 1 }, end: { year: 2020, month: 6 } }),
      makeProject({ id: 'p2', customer: { en: 'Undated' }, start: null as never, end: null as never }),
    ]
    expect(bars(s, 'projects')).toEqual([])
  })
})

describe('bars are ordered before they are packed into lanes', () => {
  const ym = (year: number, month: number) => ({ year, month })
  const built = (store: ResumeStore) => buildCareerTimeline(store, 'en', opts)

  it('orders employment bars by start date whatever order the store holds', () => {
    // Lane packing assumes sorted input, so the order IS load-bearing rather
    // than cosmetic: an unsorted bar opens a lane it does not need.
    const s = emptyStore()
    s.work_experiences = [
      makeWork({ id: 'later', employer: { en: 'Later' }, start: ym(2022, 1), end: ym(2023, 1) }),
      makeWork({ id: 'first', employer: { en: 'First' }, start: ym(2015, 1), end: ym(2016, 1) }),
      makeWork({ id: 'middle', employer: { en: 'Middle' }, start: ym(2018, 1), end: ym(2019, 1) }),
    ]
    const m = built(s)
    expect(m.employment.bars.map((b) => b.id)).toEqual(['first', 'middle', 'later'])
    expect(m.employment.lanes).toBe(1)
  })

  it('breaks a same-start tie by end date, shortest first', () => {
    const s = emptyStore()
    s.work_experiences = [
      makeWork({ id: 'long', employer: { en: 'Long' }, start: ym(2020, 1), end: ym(2025, 1) }),
      makeWork({ id: 'short', employer: { en: 'Short' }, start: ym(2020, 1), end: ym(2021, 1) }),
    ]
    expect(built(s).employment.bars.map((b) => b.id)).toEqual(['short', 'long'])
  })

  it('orders education and project bars the same way', () => {
    const s = emptyStore()
    s.educations = [
      makeEducation({ id: 'e2', school: { en: 'Second' }, start: ym(2012, 1), end: ym(2014, 1) }),
      makeEducation({ id: 'e1', school: { en: 'First' }, start: ym(2008, 1), end: ym(2011, 1) }),
    ]
    s.projects = [
      makeProject({ id: 'p2', customer: { en: 'Second' }, start: ym(2022, 1), end: ym(2023, 1) }),
      makeProject({ id: 'p1', customer: { en: 'First' }, start: ym(2019, 1), end: ym(2020, 1) }),
    ]
    const m = built(s)
    expect(m.education.bars.map((b) => b.id)).toEqual(['e1', 'e2'])
    expect(m.projects.bars.map((b) => b.id)).toEqual(['p1', 'p2'])
  })

  it('keeps each kind in its own row — a project never lands among the jobs', () => {
    const s = emptyStore()
    s.work_experiences = [makeWork({ id: 'w', employer: { en: 'Job' }, start: ym(2020, 1), end: null })]
    s.educations = [makeEducation({ id: 'e', school: { en: 'Uni' }, start: ym(2010, 1), end: ym(2013, 1) })]
    s.projects = [makeProject({ id: 'p', customer: { en: 'Client' }, start: ym(2021, 1), end: null })]
    const m = built(s)
    expect(m.employment.bars.map((b) => b.id)).toEqual(['w'])
    expect(m.education.bars.map((b) => b.id)).toEqual(['e'])
    expect(m.projects.bars.map((b) => b.id)).toEqual(['p'])
  })

  it('packs each overlapping bar into its own lane, and reports the count', () => {
    const s = emptyStore()
    s.work_experiences = [
      makeWork({ id: 'a', employer: { en: 'A' }, start: ym(2020, 1), end: ym(2024, 1) }),
      makeWork({ id: 'b', employer: { en: 'B' }, start: ym(2021, 1), end: ym(2024, 1) }),
      makeWork({ id: 'c', employer: { en: 'C' }, start: ym(2022, 1), end: ym(2024, 1) }),
    ]
    const m = built(s)
    expect(m.employment.bars.map((b) => b.lane)).toEqual([0, 1, 2])
    expect(m.employment.lanes).toBe(3)
  })

  it('reuses the FIRST free lane rather than opening a new one', () => {
    const s = emptyStore()
    s.work_experiences = [
      makeWork({ id: 'a', employer: { en: 'A' }, start: ym(2010, 1), end: ym(2012, 1) }),
      makeWork({ id: 'b', employer: { en: 'B' }, start: ym(2011, 1), end: ym(2020, 1) }),
      makeWork({ id: 'c', employer: { en: 'C' }, start: ym(2013, 1), end: ym(2014, 1) }),
    ]
    const m = built(s)
    // c fits back in lane 0, which a is no longer using.
    expect(m.employment.bars.map((b) => `${b.id}:${b.lane}`)).toEqual(['a:0', 'b:1', 'c:0'])
    expect(m.employment.lanes).toBe(2)
  })
})

describe('project sublabels and gap coverage', () => {
  const ym = (year: number, month: number) => ({ year, month })

  it('joins a project\u2019s industries, skipping ones with no name', () => {
    const s = emptyStore()
    s.projects = [makeProject({
      id: 'p', customer: { en: 'Client' }, start: ym(2020, 1), end: ym(2021, 1),
      industries: [
        { industry_id: 'i1', name: { en: 'Energy' } },
        { industry_id: 'i2', name: {} },
        { industry_id: 'i3', name: { en: 'Retail' } },
      ],
    })]
    expect(buildCareerTimeline(s, 'en', opts).projects.bars[0].sublabel).toBe('Energy, Retail')
  })

  it('leaves the sublabel empty for a project with no industries', () => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p', customer: { en: 'Client' }, start: ym(2020, 1), end: ym(2021, 1), industries: [] })]
    expect(buildCareerTimeline(s, 'en', opts).projects.bars[0].sublabel).toBe('')
  })

  it('measures a gap from the FURTHEST end reached, not the previous bar\u2019s', () => {
    // A long job that swallows a later short one must keep covering the span
    // after the short one ends.
    const s = emptyStore()
    s.work_experiences = [
      makeWork({ id: 'long', employer: { en: 'Long' }, start: ym(2010, 1), end: ym(2020, 1) }),
      makeWork({ id: 'short', employer: { en: 'Short' }, start: ym(2012, 1), end: ym(2013, 1) }),
      makeWork({ id: 'after', employer: { en: 'After' }, start: ym(2020, 5), end: ym(2021, 1) }),
    ]
    const gaps = buildCareerTimeline(s, 'en', opts).gaps
    expect(gaps).toHaveLength(1)
    expect(gaps[0].months).toBe(3)
  })

  it('reports every gap in a history with more than one', () => {
    const s = emptyStore()
    s.work_experiences = [
      makeWork({ id: 'a', employer: { en: 'A' }, start: ym(2010, 1), end: ym(2011, 1) }),
      makeWork({ id: 'b', employer: { en: 'B' }, start: ym(2012, 1), end: ym(2013, 1) }),
      makeWork({ id: 'c', employer: { en: 'C' }, start: ym(2015, 1), end: ym(2016, 1) }),
    ]
    const gaps = buildCareerTimeline(s, 'en', opts).gaps
    expect(gaps.map((g) => g.months)).toEqual([11, 23])
  })

  it('keeps the axis at zero when there is nothing to show', () => {
    const m = buildCareerTimeline(emptyStore(), 'en', opts)
    expect([m.minMonths, m.maxMonths, m.years]).toEqual([0, 0, []])
  })
})

describe('the gap threshold and the axis bounds', () => {
  const ym = (year: number, month: number) => ({ year, month })

  it('reports NO gaps at all for a store with nothing in it', () => {
    expect(buildCareerTimeline(emptyStore(), 'en', opts).gaps).toEqual([])
  })

  it('ignores a gap one month under the threshold and reports it at the threshold', () => {
    const between = (startMonth: number) => {
      const s = emptyStore()
      s.work_experiences = [
        makeWork({ id: 'a', employer: { en: 'A' }, start: ym(2020, 1), end: ym(2020, 6) }),
        makeWork({ id: 'b', employer: { en: 'B' }, start: ym(2020, startMonth), end: ym(2021, 1) }),
      ]
      return buildCareerTimeline(s, 'en', opts).gaps
    }
    // Default threshold is two months: a single uncovered month is not a gap.
    expect(between(8)).toEqual([])
    expect(between(9).map((g) => g.months)).toEqual([2])
  })

  it('starts the axis at the EARLIEST bar, not the latest', () => {
    const s = emptyStore()
    s.work_experiences = [
      makeWork({ id: 'late', employer: { en: 'Late' }, start: ym(2022, 5), end: ym(2023, 1) }),
      makeWork({ id: 'early', employer: { en: 'Early' }, start: ym(2015, 3), end: ym(2016, 1) }),
    ]
    const m = buildCareerTimeline(s, 'en', opts)
    expect(m.minMonths).toBe(2015 * 12)
    expect(m.years[0]).toBe(2015)
    expect(m.years).toContain(2022)
  })
})
