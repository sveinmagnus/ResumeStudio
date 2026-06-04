import { describe, it, expect } from 'vitest'
import { availableSortModes, sortItems, SORT_LABELS, type SortMode } from '../src/lib/sectionSort'
import {
  makeProject, makeWork, makeEducation, makeCourse, makeSpokenLanguage, makeRole,
} from './fixtures'

describe('availableSortModes()', () => {
  it('offers custom + alpha for any section', () => {
    expect(availableSortModes('spoken_languages')).toEqual(['custom', 'alpha'])
    expect(availableSortModes('roles')).toEqual(['custom', 'alpha'])
  })

  it('adds start + end for date-range sections', () => {
    expect(availableSortModes('projects')).toEqual(['custom', 'alpha', 'start', 'end'])
    expect(availableSortModes('work_experiences')).toEqual(['custom', 'alpha', 'start', 'end'])
  })

  it('adds a single date mode for single-date sections', () => {
    expect(availableSortModes('courses')).toEqual(['custom', 'alpha', 'date'])
    expect(availableSortModes('certifications')).toEqual(['custom', 'alpha', 'date'])
    expect(availableSortModes('honor_awards')).toEqual(['custom', 'alpha', 'date'])
  })

  it('has a label for every mode', () => {
    const modes: SortMode[] = ['custom', 'alpha', 'start', 'end', 'date']
    for (const m of modes) expect(SORT_LABELS[m]).toBeTruthy()
  })
})

describe('sortItems()', () => {
  it('custom mode orders by sort_order', () => {
    const a = makeProject({ id: 'a', sort_order: 2, customer: { en: 'Zeta' } })
    const b = makeProject({ id: 'b', sort_order: 0, customer: { en: 'Alpha' } })
    const c = makeProject({ id: 'c', sort_order: 1, customer: { en: 'Mid' } })
    const out = sortItems('projects', [a, b, c], 'custom', 'en')
    expect(out.map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('alpha mode orders by resolved title, case-insensitive', () => {
    const a = makeProject({ id: 'a', customer: { en: 'banana' } })
    const b = makeProject({ id: 'b', customer: { en: 'Apple' } })
    const c = makeProject({ id: 'c', customer: { en: 'cherry' } })
    const out = sortItems('projects', [a, b, c], 'alpha', 'en')
    expect(out.map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('alpha mode uses the requested locale for the title', () => {
    const a = makeProject({ id: 'a', customer: { en: 'Zeta', no: 'Alfa' } })
    const b = makeProject({ id: 'b', customer: { en: 'Alpha', no: 'Zulu' } })
    const en = sortItems('projects', [a, b], 'alpha', 'en')
    expect(en.map((x) => x.id)).toEqual(['b', 'a'])
    const no = sortItems('projects', [a, b], 'alpha', 'no')
    expect(no.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('start mode orders newest start first', () => {
    const older = makeWork({ id: 'old', start: { year: 2018, month: 1 } })
    const newer = makeWork({ id: 'new', start: { year: 2022, month: 6 } })
    const mid   = makeWork({ id: 'mid', start: { year: 2020, month: 3 } })
    const out = sortItems('work_experiences', [older, newer, mid], 'start', 'en')
    expect(out.map((x) => x.id)).toEqual(['new', 'mid', 'old'])
  })

  it('start mode sorts a missing start date last', () => {
    const dated = makeWork({ id: 'dated', start: { year: 2020, month: 1 } })
    const undated = makeWork({ id: 'undated', start: null })
    const out = sortItems('work_experiences', [undated, dated], 'start', 'en')
    expect(out.map((x) => x.id)).toEqual(['dated', 'undated'])
  })

  it('end mode treats a null (ongoing) end as the most recent', () => {
    const ended   = makeWork({ id: 'ended', end: { year: 2021, month: 12 } })
    const ongoing = makeWork({ id: 'ongoing', end: null })
    const out = sortItems('work_experiences', [ended, ongoing], 'end', 'en')
    expect(out.map((x) => x.id)).toEqual(['ongoing', 'ended'])
  })

  it('date mode uses the section single-date field (courses → completed)', () => {
    const a = makeCourse({ id: 'a', completed: { year: 2019, month: 1 } })
    const b = makeCourse({ id: 'b', completed: { year: 2023, month: 1 } })
    const out = sortItems('courses', [a, b], 'date', 'en')
    expect(out.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('does not mutate the input array', () => {
    const a = makeRole({ id: 'a', name: { en: 'Zeta' }, sort_order: 0 })
    const b = makeRole({ id: 'b', name: { en: 'Alpha' }, sort_order: 1 })
    const input = [a, b]
    const snapshot = input.map((x) => x.id)
    sortItems('roles', input, 'alpha', 'en')
    expect(input.map((x) => x.id)).toEqual(snapshot)
  })

  it('orders spoken languages alphabetically by name', () => {
    const a = makeSpokenLanguage({ id: 'a', name: { en: 'Norwegian' } })
    const b = makeSpokenLanguage({ id: 'b', name: { en: 'English' } })
    const out = sortItems('spoken_languages', [a, b], 'alpha', 'en')
    expect(out.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('ignores fixture default dates by sorting purely on the chosen field', () => {
    // makeEducation defaults to 2015–2018; override to verify ordering.
    const a = makeEducation({ id: 'a', start: { year: 2010, month: 1 } })
    const b = makeEducation({ id: 'b', start: { year: 2016, month: 1 } })
    const out = sortItems('educations', [a, b], 'start', 'en')
    expect(out.map((x) => x.id)).toEqual(['b', 'a'])
  })
})
