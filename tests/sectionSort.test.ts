import { describe, it, expect } from 'vitest'
import { availableSortModes, sortItems, SORT_LABELS, type SortMode } from '../src/lib/sectionSort'
import {
  makeProject, makeWork, makeEducation, makeCourse, makeCertification, makeSpokenLanguage, makeRole,
} from './fixtures'

describe('availableSortModes()', () => {
  it('offers custom + alpha for any section', () => {
    expect(availableSortModes('spoken_languages')).toEqual(['custom', 'alpha'])
    expect(availableSortModes('roles')).toEqual(['custom', 'alpha'])
  })

  it('adds start + end (newest and oldest) for date-range sections', () => {
    expect(availableSortModes('projects')).toEqual(['custom', 'alpha', 'start', 'start_asc', 'end', 'end_asc'])
    expect(availableSortModes('work_experiences')).toEqual(['custom', 'alpha', 'start', 'start_asc', 'end', 'end_asc'])
    // Courses gained a from/to range (shape v11), so they sort like the other ranged sections.
    expect(availableSortModes('courses')).toEqual(['custom', 'alpha', 'start', 'start_asc', 'end', 'end_asc'])
    // Presentations gained a from/to range (shape v13) — same as courses.
    expect(availableSortModes('presentations')).toEqual(['custom', 'alpha', 'start', 'start_asc', 'end', 'end_asc'])
    // The remaining two ranged sections. Every row of the capability table is
    // independent, so one can lose its dates without the others noticing.
    expect(availableSortModes('educations')).toEqual(['custom', 'alpha', 'start', 'start_asc', 'end', 'end_asc'])
    expect(availableSortModes('positions')).toEqual(['custom', 'alpha', 'start', 'start_asc', 'end', 'end_asc'])
  })

  it('offers nothing date-shaped to a section that has no dates', () => {
    // The fallback for a section absent from the table — including one that
    // does not exist at all, which is what a stale stored sort mode names.
    expect(availableSortModes('skills')).toEqual(['custom', 'alpha'])
    expect(availableSortModes('not_a_section')).toEqual(['custom', 'alpha'])
  })

  it('adds both single date directions for single-date sections', () => {
    expect(availableSortModes('certifications')).toEqual(['custom', 'alpha', 'date', 'date_asc'])
    expect(availableSortModes('honor_awards')).toEqual(['custom', 'alpha', 'date', 'date_asc'])
    expect(availableSortModes('publications')).toEqual(['custom', 'alpha', 'date', 'date_asc'])
    // recommendations carry a date too — they must offer date sorting.
    expect(availableSortModes('recommendations')).toEqual(['custom', 'alpha', 'date', 'date_asc'])
  })

  it('has a label for every mode', () => {
    const modes: SortMode[] = ['custom', 'alpha', 'start', 'start_asc', 'end', 'end_asc', 'date', 'date_asc']
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

  it('start mode floats a missing start date to the top (new items surface until dated)', () => {
    const dated = makeWork({ id: 'dated', start: { year: 2020, month: 1 } })
    const undated = makeWork({ id: 'undated', start: null })
    const out = sortItems('work_experiences', [dated, undated], 'start', 'en')
    expect(out.map((x) => x.id)).toEqual(['undated', 'dated'])
  })

  it('end mode treats a null (ongoing) end as the most recent', () => {
    const ended   = makeWork({ id: 'ended', end: { year: 2021, month: 12 } })
    const ongoing = makeWork({ id: 'ongoing', end: null })
    const out = sortItems('work_experiences', [ended, ongoing], 'end', 'en')
    expect(out.map((x) => x.id)).toEqual(['ongoing', 'ended'])
  })

  it('end mode tie-breaks multiple ongoing items by start date, newest first', () => {
    // Two roles that are both still active — without a secondary key the
    // input order wins, which buried a freshly-added current role below an
    // older one. We now break the tie on start date descending so the most
    // recently started ongoing item sorts first.
    const oldOngoing = makeWork({ id: 'old',  end: null, start: { year: 2018, month: 3 } })
    const newOngoing = makeWork({ id: 'new',  end: null, start: { year: 2023, month: 8 } })
    const midOngoing = makeWork({ id: 'mid',  end: null, start: { year: 2020, month: 1 } })
    const ended      = makeWork({ id: 'done', end: { year: 2021, month: 12 }, start: { year: 2019, month: 1 } })
    const out = sortItems('work_experiences', [oldOngoing, ended, newOngoing, midOngoing], 'end', 'en')
    expect(out.map((x) => x.id)).toEqual(['new', 'mid', 'old', 'done'])
  })

  it('end mode floats an unknown-start ongoing item to the top of the ongoing group', () => {
    // An ongoing item with no recorded start date is a freshly-added /
    // not-yet-dated entry, so it floats to the top among its ongoing siblings —
    // but a concrete end date still ranks below every ongoing item.
    const dated   = makeWork({ id: 'dated',   end: null, start: { year: 2022, month: 6 } })
    const undated = makeWork({ id: 'undated', end: null, start: null })
    const ended   = makeWork({ id: 'ended',   end: { year: 2024, month: 1 } })
    const out = sortItems('work_experiences', [dated, ended, undated], 'end', 'en')
    expect(out.map((x) => x.id)).toEqual(['undated', 'dated', 'ended'])
  })

  it('date mode uses the section single-date field (certifications → issued)', () => {
    const a = makeCertification({ id: 'a', issued: { year: 2019, month: 1 } })
    const b = makeCertification({ id: 'b', issued: { year: 2023, month: 1 } })
    const out = sortItems('certifications', [a, b], 'date', 'en')
    expect(out.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('date_asc mode orders single dates oldest first', () => {
    const a = makeCertification({ id: 'a', issued: { year: 2019, month: 1 } })
    const b = makeCertification({ id: 'b', issued: { year: 2023, month: 1 } })
    const out = sortItems('certifications', [a, b], 'date_asc', 'en')
    expect(out.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('courses sort by their end (to) date, newest first', () => {
    const a = makeCourse({ id: 'a', end: { year: 2019, month: 1 } })
    const b = makeCourse({ id: 'b', end: { year: 2023, month: 1 } })
    const out = sortItems('courses', [a, b], 'end', 'en')
    expect(out.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('start_asc mode orders oldest start first, undated still floats to the top', () => {
    const older   = makeWork({ id: 'old', start: { year: 2018, month: 1 } })
    const newer   = makeWork({ id: 'new', start: { year: 2022, month: 6 } })
    const undated = makeWork({ id: 'undated', start: null })
    const out = sortItems('work_experiences', [newer, older, undated], 'start_asc', 'en')
    expect(out.map((x) => x.id)).toEqual(['undated', 'old', 'new'])
  })

  it('end_asc mode orders oldest end first', () => {
    const early = makeWork({ id: 'early', end: { year: 2019, month: 1 } })
    const late  = makeWork({ id: 'late',  end: { year: 2023, month: 1 } })
    const out = sortItems('work_experiences', [late, early], 'end_asc', 'en')
    expect(out.map((x) => x.id)).toEqual(['early', 'late'])
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

describe('the date key and its edges', () => {
  const ids = (items: ReturnType<typeof makeProject>[], mode: SortMode) =>
    sortItems('projects', items, mode, 'en').map((p) => p.id)
  const p = (id: string, start: unknown) => makeProject({ id, start: start as never })

  it('orders by year AND month, not year alone', () => {
    const items = [p('mar', { year: 2024, month: 3 }), p('jan', { year: 2024, month: 1 })]
    expect(ids(items, 'start')).toEqual(['mar', 'jan'])
    expect(ids(items, 'start_asc')).toEqual(['jan', 'mar'])
  })

  it('treats a year-only date as the start of that year, ahead of its own February', () => {
    const items = [p('feb', { year: 2024, month: 2 }), p('yearonly', { year: 2024, month: null })]
    expect(ids(items, 'start_asc')).toEqual(['yearonly', 'feb'])
  })

  it('lifts an undated item above a dated one whichever order they arrive in', () => {
    const dated = p('dated', { year: 2020, month: 1 })
    const none = p('none', null)
    expect(ids([dated, none], 'start')).toEqual(['none', 'dated'])
    expect(ids([none, dated], 'start')).toEqual(['none', 'dated'])
    expect(ids([dated, none], 'start_asc')).toEqual(['none', 'dated'])
    expect(ids([none, dated], 'start_asc')).toEqual(['none', 'dated'])
  })

  it('floats an undated item to the top in BOTH directions', () => {
    const items = [p('old', { year: 2019, month: 1 }), p('none', null), p('new', { year: 2025, month: 1 })]
    expect(ids(items, 'start')[0]).toBe('none')
    expect(ids(items, 'start_asc')[0]).toBe('none')
  })

  it('treats a malformed date as undated rather than sorting on junk', () => {
    const items = [p('good', { year: 2020, month: 1 }), p('junk', { year: '2020', month: 1 })]
    expect(ids(items, 'start')[0]).toBe('junk')
  })

  it('keeps two items with the SAME date in their input order', () => {
    const items = [p('first', { year: 2020, month: 5 }), p('second', { year: 2020, month: 5 })]
    expect(ids(items, 'start')).toEqual(['first', 'second'])
    expect(ids(items, 'start_asc')).toEqual(['first', 'second'])
  })

  it('keeps two undated items in their input order', () => {
    const items = [p('first', null), p('second', null)]
    expect(ids(items, 'start')).toEqual(['first', 'second'])
  })
})

describe('end-date sort — ongoing items tie, then break on start', () => {
  const w = (id: string, start: unknown, end: unknown) =>
    makeWork({ id, start: start as never, end: end as never })
  const ids = (items: ReturnType<typeof makeWork>[], mode: SortMode) =>
    sortItems('work_experiences', items, mode, 'en').map((x) => x.id)

  it('ranks every ongoing item above every finished one', () => {
    const items = [w('done', { year: 2024, month: 1 }, { year: 2025, month: 1 }), w('open', { year: 2019, month: 1 }, null)]
    expect(ids(items, 'end')).toEqual(['open', 'done'])
    expect(ids(items, 'end_asc')).toEqual(['open', 'done'])
  })

  it('breaks a tie between two ongoing items by start date, in the same direction', () => {
    // Without the secondary key the input order wins and a newly added ongoing
    // role hides below an older one.
    const items = [w('older', { year: 2015, month: 1 }, null), w('newer', { year: 2023, month: 1 }, null)]
    expect(ids(items, 'end')).toEqual(['newer', 'older'])
    expect(ids(items, 'end_asc')).toEqual(['older', 'newer'])
  })

  it('does NOT re-order two items that share a real end date', () => {
    // Only the ongoing tie gets a secondary key; a shared end date keeps the
    // entry order, so the list does not shuffle under the user.
    const end = { year: 2025, month: 6 }
    const items = [w('a', { year: 2010, month: 1 }, end), w('b', { year: 2020, month: 1 }, end)]
    expect(ids(items, 'end')).toEqual(['a', 'b'])
  })
})

describe('single-date sort reads each section’s own date field', () => {
  it('sorts certifications on their ISSUED date, not a generic one', () => {
    const c = (id: string, issued: unknown) => makeCertification({ id, issued: issued as never })
    const items = [c('old', { year: 2019, month: 1 }), c('new', { year: 2024, month: 1 })]
    expect(sortItems('certifications', items, 'date', 'en').map((x) => x.id)).toEqual(['new', 'old'])
    expect(sortItems('certifications', items, 'date_asc', 'en').map((x) => x.id)).toEqual(['old', 'new'])
  })

  it('leaves a section with no single-date capability in input order', () => {
    // 'date' is not an offered mode there, so nothing is read and nothing moves.
    const items = [makeRole({ id: 'b' }), makeRole({ id: 'a' })]
    expect(sortItems('roles', items, 'date', 'en').map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('alphabetical sort', () => {
  it('orders titles A–Z', () => {
    const items = [
      makeProject({ id: 'z', customer: { en: 'zebra' } }),
      makeProject({ id: 'b', customer: { en: 'beta' } }),
      makeProject({ id: 'a', customer: { en: 'alfa' } }),
    ]
    expect(sortItems('projects', items, 'alpha', 'en').map((x) => x.id)).toEqual(['a', 'b', 'z'])
  })

  it('ignores CASE, so two titles differing only in case keep their order', () => {
    // Case-sensitive collation would shuffle "Beta" and "beta" past each other.
    const items = [
      makeProject({ id: 'upper', customer: { en: 'Beta' } }),
      makeProject({ id: 'lower', customer: { en: 'beta' } }),
    ]
    expect(sortItems('projects', items, 'alpha', 'en').map((x) => x.id)).toEqual(['upper', 'lower'])
  })

  it('compares the title in the requested locale', () => {
    const items = [
      makeProject({ id: 'one', customer: { en: 'Zebra', no: 'Alfa' } }),
      makeProject({ id: 'two', customer: { en: 'Alpha', no: 'Beta' } }),
    ]
    expect(sortItems('projects', items, 'alpha', 'en').map((x) => x.id)).toEqual(['two', 'one'])
    expect(sortItems('projects', items, 'alpha', 'no').map((x) => x.id)).toEqual(['one', 'two'])
  })
})

describe('a section the catalog does not describe', () => {
  it('falls back to the item id for the alphabetical sort', () => {
    // No descriptor means no title function; ordering by id at least keeps the
    // sort deterministic instead of collapsing every row onto one key.
    const items = [
      { id: 'beta', sort_order: 0 },
      { id: 'alfa', sort_order: 1 },
    ]
    expect(sortItems('made_up_section', items, 'alpha', 'en').map((x) => x.id)).toEqual(['alfa', 'beta'])
  })
})

/**
 * The date comparator's two edges.
 *
 * An UNDATED item floats to the top whichever direction is asked for, because a
 * freshly added row has to stay where the user can see it until they date it.
 * And equal dates must compare as EQUAL — returning a non-zero for a tie makes
 * the order depend on the sort algorithm's internals, so the same list can come
 * out differently after an unrelated edit.
 */
describe('sortItems — undated rows and exact ties', () => {
  const ym = (year: number, month: number | null = 1) => ({ year, month })
  const item = (id: string, start: unknown, end: unknown = null, sort_order = 0) =>
    ({ id, start, end, sort_order } as never)

  const ids = (mode: string, items: unknown[]) =>
    sortItems('projects', items as never, mode as never, 'en').map((i) => i.id)

  it('keeps an undated row first in BOTH directions', () => {
    const rows = [item('dated', ym(2020)), item('undated', null)]
    expect(ids('start', rows)).toEqual(['undated', 'dated'])
    expect(ids('start_asc', rows)).toEqual(['undated', 'dated'])
  })

  it('keeps an undated row above BOTH neighbours it is compared with', () => {
    // Three rows so the comparator is called in both argument orders: with two
    // the engine may only ever ask "does the new row come before the old one?",
    // and the mirror case goes unexercised.
    const rows = [item('older', ym(2015)), item('undated', null), item('newer', ym(2022))]
    expect(ids('start', rows)).toEqual(['undated', 'newer', 'older'])
    expect(ids('start_asc', rows)).toEqual(['undated', 'older', 'newer'])
  })

  it('keeps two undated rows in their given order', () => {
    expect(ids('start', [item('a', null), item('b', null)])).toEqual(['a', 'b'])
  })

  it('leaves two rows with the SAME date in their given order', () => {
    // A tie that reports an order turns a stable list into an unstable one.
    const rows = [item('a', ym(2020, 6)), item('b', ym(2020, 6))]
    expect(ids('start', rows)).toEqual(['a', 'b'])
    expect(ids('start_asc', rows)).toEqual(['a', 'b'])
  })

  it('tie-breaks two ONGOING rows by their start date, in the same direction', () => {
    // Both ends are open, so the end date cannot separate them; the later start
    // is the more recent engagement.
    const rows = [
      item('older', ym(2018, 1), null),
      item('newer', ym(2022, 1), null),
    ]
    expect(ids('end', rows)).toEqual(['newer', 'older'])
    expect(ids('end_asc', rows)).toEqual(['older', 'newer'])
  })

  it('does not tie-break by start when only ONE row is ongoing', () => {
    // A real end date beats an open one on its own; reaching for the start here
    // would let a long-finished row outrank a running one.
    const rows = [
      item('finished', ym(2010, 1), ym(2011, 1)),
      item('ongoing', ym(2000, 1), null),
    ]
    expect(ids('end', rows)).toEqual(['ongoing', 'finished'])
  })
})
