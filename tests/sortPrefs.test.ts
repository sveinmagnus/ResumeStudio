/**
 * @vitest-environment jsdom
 *
 * The section sort mode has to SURVIVE, and it has to be STABLE — the two ways
 * "I picked End date and it went back to Custom" actually happened.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { loadSortPrefs, saveSortPrefs } from '../src/lib/sortPrefs'
import { useStore } from '../src/store/useStore'
import { sortItems } from '../src/lib/sectionSort'
import { resetStore } from './helpers/store-reset'
import { emptyStore, makeResume, makeCourse } from './fixtures'
import type { ResumeStore } from '../src/types'

describe('sortPrefs (localStorage)', () => {
  beforeEach(() => { localStorage.clear() })

  it('round-trips a resume\'s modes', () => {
    saveSortPrefs('r1', { courses: 'end', projects: 'alpha' })
    expect(loadSortPrefs('r1')).toEqual({ courses: 'end', projects: 'alpha' })
  })

  it('scopes by resume, so one CV cannot answer for another', () => {
    saveSortPrefs('r1', { courses: 'end' })
    expect(loadSortPrefs('r2')).toEqual({})
  })

  it('does not store Custom, which is the default anyway', () => {
    saveSortPrefs('r1', { courses: 'custom' })
    expect(loadSortPrefs('r1')).toEqual({})
  })

  it('drops a retired mode name rather than carrying it', () => {
    // sortItems falls back to sort_order for a mode it cannot honour, so a
    // stale value would present as "my sort silently stopped working".
    localStorage.setItem('rs.sectionSort.r1', JSON.stringify({ courses: 'end_desc', projects: 'alpha' }))
    expect(loadSortPrefs('r1')).toEqual({ projects: 'alpha' })
  })

  it('returns a plain value for an inherited key, and never adopts __proto__', () => {
    localStorage.setItem('rs.sectionSort.r1', JSON.stringify({ courses: 'toString', __proto__: 'alpha' }))
    const prefs = loadSortPrefs('r1')
    expect(prefs.courses).toBeUndefined()
    expect(Object.keys(prefs)).not.toContain('__proto__')
  })

  it('survives unusable storage instead of throwing', () => {
    localStorage.setItem('rs.sectionSort.r1', 'not json{')
    expect(loadSortPrefs('r1')).toEqual({})
    expect(loadSortPrefs(null)).toEqual({})
  })
})

describe('the chosen sort mode survives a reload', () => {
  beforeEach(() => { resetStore(); localStorage.clear() })

  const seeded = (): ResumeStore => ({
    ...emptyStore(),
    resume: makeResume({ id: 'r1' }),
    courses: [
      makeCourse({ id: 'a', end: { year: 2020, month: 1 }, sort_order: 0 }),
      makeCourse({ id: 'b', end: { year: 2024, month: 1 }, sort_order: 1 }),
    ],
  })

  it('restores it on loadStore, rather than dropping back to Custom', () => {
    // The real load effect sets the row id before loading; sort prefs key on it.
    useStore.getState().setCurrentResumeId('row-1')
    useStore.getState().loadStore(seeded())
    useStore.getState().setSectionSort('courses', 'end')

    // A reload, a remote-update reload and a snapshot restore all land here.
    useStore.getState().unloadStore()
    // The real load effect sets the row id before loading; sort prefs key on it.
    useStore.getState().setCurrentResumeId('row-1')
    useStore.getState().loadStore(seeded())

    expect(useStore.getState().sectionSort.courses).toBe('end')
  })

  it('persists the switch to Custom that a manual reorder causes', () => {
    // Otherwise the next reload restores the old computed mode and re-sorts the
    // order the user just baked by hand.
    // The real load effect sets the row id before loading; sort prefs key on it.
    useStore.getState().setCurrentResumeId('row-1')
    useStore.getState().loadStore(seeded())
    useStore.getState().setSectionSort('courses', 'end')
    useStore.getState().reorderItem('courses', 'b', 'down')
    expect(useStore.getState().sectionSort.courses).toBe('custom')

    useStore.getState().unloadStore()
    // The real load effect sets the row id before loading; sort prefs key on it.
    useStore.getState().setCurrentResumeId('row-1')
    useStore.getState().loadStore(seeded())
    expect(useStore.getState().sectionSort.courses ?? 'custom').toBe('custom')
  })

  it('does not persist the type filter, which hides rows', () => {
    // The real load effect sets the row id before loading; sort prefs key on it.
    useStore.getState().setCurrentResumeId('row-1')
    useStore.getState().loadStore(seeded())
    useStore.getState().setSectionTypeFilter('courses', 'Category\u001Fmedical')
    useStore.getState().unloadStore()
    // The real load effect sets the row id before loading; sort prefs key on it.
    useStore.getState().setCurrentResumeId('row-1')
    useStore.getState().loadStore(seeded())
    expect(useStore.getState().sectionTypeFilter.courses ?? '').toBe('')
  })
})

describe('a reorder that cannot move anything changes nothing', () => {
  beforeEach(() => { resetStore(); localStorage.clear() })

  const seed = () => {
    useStore.setState({
      data: {
        ...emptyStore(),
        resume: makeResume({ id: 'r1' }),
        courses: [
          makeCourse({ id: 'a', end: { year: 2020, month: 1 }, sort_order: 0 }),
          makeCourse({ id: 'b', end: { year: 2024, month: 1 }, sort_order: 1 }),
          makeCourse({ id: 'c', end: { year: 2022, month: 1 }, sort_order: 2 }),
        ],
      },
      hasData: true, primaryLocale: 'en', mutationCount: 0,
    })
    useStore.getState().setSectionSort('courses', 'end')
  }
  /** Ids in the order the editor displays them under the CURRENT mode — read
   *  from the store, since a real move switches the section to Custom. */
  const shown = (): string[] => {
    const st = useStore.getState()
    return sortItems('courses', st.data.courses as never, st.sectionSort.courses ?? 'custom', 'en')
      .map((c) => (c as { id: string }).id)
  }

  it('keeps the mode when Move up is pressed on the top row', () => {
    seed()
    const before = shown()
    useStore.getState().reorderItem('courses', before[0], 'up')
    const st = useStore.getState()
    expect(st.sectionSort.courses, 'the sort mode reset itself').toBe('end')
    expect(st.data.courses.map((c) => c.sort_order)).toEqual([0, 1, 2])
    // Nothing changed, so nothing may be queued for save.
    expect(st.mutationCount).toBe(0)
  })

  it('keeps the mode when Move down is pressed on the bottom row', () => {
    seed()
    const before = shown()
    useStore.getState().reorderItem('courses', before[before.length - 1], 'down')
    expect(useStore.getState().sectionSort.courses).toBe('end')
    expect(useStore.getState().mutationCount).toBe(0)
  })

  it('treats a drop onto an item\'s own position as a no-op in a computed mode', () => {
    seed()
    const target = shown()[1]
    useStore.getState().moveItem('courses', target, 1)
    expect(useStore.getState().sectionSort.courses).toBe('end')
    expect(useStore.getState().mutationCount).toBe(0)
  })

  it('still switches to Custom for a move that DOES rearrange the list', () => {
    seed()
    const before = shown()
    useStore.getState().reorderItem('courses', before[1], 'up')
    const after = shown()
    expect(useStore.getState().sectionSort.courses).toBe('custom')
    expect(after).not.toEqual(before)
    expect(useStore.getState().mutationCount).toBe(1)
  })
})
