import { describe, it, expect } from 'vitest'
import { buildCareerTimeline, monthsToLabel } from '../src/lib/careerTimeline'
import { emptyStore, makeWork, makeProject, makeEducation } from './fixtures'

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
