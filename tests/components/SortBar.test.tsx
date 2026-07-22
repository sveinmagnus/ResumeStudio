/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkEditor, CoursesEditor } from '../../src/components/editor/SimpleEditors'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { resolveConfirm, confirmDialogVisible } from '../helpers/confirm'
import { emptyStore, makeWork, makeCourse } from '../fixtures'
import { typeFilterKey } from '../../src/lib/viewItemSelect'

function seedTwoWork() {
  useStore.setState({
    data: {
      ...emptyStore(),
      work_experiences: [
        makeWork({ id: 'old', employer: { en: 'OldCo' }, sort_order: 0, start: { year: 2016, month: 1 }, end: { year: 2019, month: 1 } }),
        makeWork({ id: 'new', employer: { en: 'NewCo' }, sort_order: 1, start: { year: 2022, month: 1 }, end: null }),
      ],
    },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'work_experiences', expandedItemId: null,
    sectionSort: {}, mutationCount: 0,
  })
}

/** Read the visible card titles in DOM order. */
function cardOrder(): string[] {
  return Array.from(document.querySelectorAll('.ec-title')).map((el) => el.textContent?.trim() ?? '')
}

describe('<SortBar> + reorder guard (via WorkEditor)', () => {
  beforeEach(() => resetStore())
  afterEach(() => vi.restoreAllMocks())

  it('shows the sort selector with the section-appropriate modes', () => {
    seedTwoWork()
    render(<WorkEditor />)
    const select = screen.getByLabelText('Sort') as HTMLSelectElement
    const opts = Array.from(select.options).map((o) => o.value)
    expect(opts).toEqual(['custom', 'alpha', 'start', 'start_asc', 'end', 'end_asc'])
  })

  it('reorders the displayed list when a computed mode is selected', async () => {
    seedTwoWork()
    render(<WorkEditor />)
    // Custom order = sort_order: OldCo, NewCo.
    expect(cardOrder()).toEqual(['OldCo', 'NewCo'])
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'start')
    // Newest start first: NewCo (2022), OldCo (2016).
    expect(cardOrder()).toEqual(['NewCo', 'OldCo'])
  })

  it('warns before a manual reorder in a computed mode and bakes the order on accept', async () => {
    seedTwoWork()
    render(<WorkEditor />)
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'start')
    expect(cardOrder()).toEqual(['NewCo', 'OldCo'])

    // Move the first card (NewCo) down → confirm fires, order becomes OldCo,NewCo,
    // baked into sort_order, and the mode flips back to custom.
    await userEvent.click(screen.getAllByTitle('Move down in this section')[0])
    await resolveConfirm('confirm')

    expect(useStore.getState().sectionSort.work_experiences).toBe('custom')
    const ordered = [...useStore.getState().data.work_experiences].sort((a, b) => a.sort_order - b.sort_order)
    expect(ordered.map((w) => w.id)).toEqual(['old', 'new'])
  })

  it('does not reorder when the warning is declined', async () => {
    seedTwoWork()
    render(<WorkEditor />)
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'start')

    await userEvent.click(screen.getAllByTitle('Move down in this section')[0])
    await resolveConfirm('cancel')

    // Still in start mode; sort_order untouched (OldCo=0, NewCo=1).
    expect(useStore.getState().sectionSort.work_experiences).toBe('start')
    const byOrder = [...useStore.getState().data.work_experiences].sort((a, b) => a.sort_order - b.sort_order)
    expect(byOrder.map((w) => w.id)).toEqual(['old', 'new'])
  })

  it('does not warn for reordering while in custom mode', async () => {
    seedTwoWork()
    render(<WorkEditor />)
    // Default custom mode — move down without any prompt.
    await userEvent.click(screen.getAllByTitle('Move down in this section')[0])
    expect(confirmDialogVisible()).toBe(false)
    const ordered = [...useStore.getState().data.work_experiences].sort((a, b) => a.sort_order - b.sort_order)
    expect(ordered.map((w) => w.id)).toEqual(['new', 'old'])
  })
})

describe('<SortBar> type filter never traps the user (via CoursesEditor)', () => {
  beforeEach(() => resetStore())

  function seedTwoCourses() {
    useStore.setState({
      data: {
        ...emptyStore(),
        courses: [
          makeCourse({ id: 'c1', name: { en: 'Kubernetes' }, category: 'technical_expertise' }),
          makeCourse({ id: 'c2', name: { en: 'Leadership' }, category: 'management' }),
        ],
      },
      hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'courses', expandedItemId: null,
      sectionSort: {}, sectionTypeFilter: {}, mutationCount: 0,
    })
  }

  it('keeps the Filter control after a filter narrows the list to one item, and can be cleared', async () => {
    seedTwoCourses()
    render(<CoursesEditor />)
    expect(document.querySelectorAll('.ec-title').length).toBe(2)

    // Filter to a category matching exactly one course.
    await userEvent.selectOptions(
      screen.getByLabelText('Filter'),
      typeFilterKey('Category', 'technical_expertise'),
    )
    // The list is now a single item — the regression was the Filter control
    // disappearing here (it keyed off the FILTERED count), stranding the user.
    expect(document.querySelectorAll('.ec-title').length).toBe(1)
    const filter = screen.getByLabelText('Filter') as HTMLSelectElement
    expect(filter).toBeInTheDocument()
    expect(filter.value).toBe(typeFilterKey('Category', 'technical_expertise'))
    // The Sort selector must ALSO stay — it hides only when the section has one
    // item TOTAL, not merely one item showing through a filter (2 courses here).
    expect(screen.getByLabelText('Sort')).toBeInTheDocument()

    // Resetting to "All types" is always reachable and restores every item.
    await userEvent.selectOptions(filter, '')
    expect(useStore.getState().sectionTypeFilter.courses).toBe('')
    expect(document.querySelectorAll('.ec-title').length).toBe(2)
  })
})
