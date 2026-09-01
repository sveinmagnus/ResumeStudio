/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorCard } from '../../src/components/ui/EditorCard'
import { SortableList } from '../../src/components/ui/SortableList'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeCourse } from '../fixtures'
import { resolveConfirm } from '../helpers/confirm'

function seedWithCourse(id = 'c1') {
  useStore.setState({
    data: { ...emptyStore(), courses: [makeCourse({ id, name: { en: 'X' } })] },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'courses', expandedItemId: null, mutationCount: 0,
  })
}

function card(extra: Record<string, unknown> = {}) {
  return (
    <EditorCard section="courses" id="c1" title="X" {...extra}>
      <div>card body</div>
    </EditorCard>
  )
}

describe('<EditorCard>', () => {
  beforeEach(() => resetStore())
  afterEach(() => vi.restoreAllMocks())

  it('is collapsed by default and expands on header click', async () => {
    seedWithCourse()
    render(card())
    expect(screen.queryByText('card body')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('X'))
    expect(useStore.getState().expandedItemId).toBe('c1')
    expect(screen.getByText('card body')).toBeInTheDocument()
  })

  it('expands from the keyboard via the title toggle (aria-expanded)', async () => {
    seedWithCourse()
    render(card())
    const toggle = screen.getByRole('button', { name: 'X', expanded: false })
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(useStore.getState().expandedItemId).toBe('c1')
    expect(screen.getByRole('button', { name: 'X', expanded: true })).toBeInTheDocument()
  })

  it('toggles starred via the star action', async () => {
    seedWithCourse()
    render(card({ starred: false }))
    await userEvent.click(screen.getByLabelText('Star this item'))
    expect(useStore.getState().data.courses[0].starred).toBe(true)
  })

  it('toggles disabled via the visibility action', async () => {
    seedWithCourse()
    render(card({ disabled: false }))
    await userEvent.click(screen.getByLabelText('Hide from all views'))
    expect(useStore.getState().data.courses[0].disabled).toBe(true)
  })

  it('deletes after confirmation', async () => {
    seedWithCourse()
    render(card())
    await userEvent.click(screen.getByLabelText('Delete this item'))
    await resolveConfirm('confirm')
    expect(useStore.getState().data.courses).toHaveLength(0)
  })

  it('does not delete when confirmation is declined', async () => {
    seedWithCourse()
    render(card())
    await userEvent.click(screen.getByLabelText('Delete this item'))
    await resolveConfirm('cancel')
    expect(useStore.getState().data.courses).toHaveLength(1)
  })

  it('hides the drag handle and arrows when sortable={false}', () => {
    seedWithCourse()
    render(card({ sortable: false }))
    expect(screen.queryByLabelText('Drag handle')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Move up in this section')).not.toBeInTheDocument()
  })
})

describe('<EditorCard> reorder arrows at the list boundaries', () => {
  beforeEach(() => resetStore())

  /** Two courses inside a real SortableList, so useSortable reports a position. */
  function renderList() {
    useStore.setState({
      data: {
        ...emptyStore(),
        courses: [
          makeCourse({ id: 'c1', name: { en: 'First' } }),
          makeCourse({ id: 'c2', name: { en: 'Second' } }),
        ],
      },
      hasData: true, primaryLocale: 'en', secondaryLocale: null,
      activeSection: 'courses', expandedItemId: null, mutationCount: 0,
    })
    return render(
      <SortableList section="courses" ids={['c1', 'c2']} addLabel="Add" onAdd={() => {}}>
        <EditorCard section="courses" id="c1" title="First"><div /></EditorCard>
        <EditorCard section="courses" id="c2" title="Second"><div /></EditorCard>
      </SortableList>,
    )
  }

  it('disables Move up on the first row and Move down on the last', () => {
    // Pressing either used to raise the "Switch to custom order?" prompt and
    // then reset the section's sort mode without moving anything.
    renderList()
    const ups = screen.getAllByRole('button', { name: 'Move up in this section' })
    const downs = screen.getAllByRole('button', { name: 'Move down in this section' })
    expect(ups[0]).toBeDisabled()
    expect(downs[0]).toBeEnabled()
    expect(ups[1]).toBeEnabled()
    expect(downs[1]).toBeDisabled()
  })

  it('a click on a disabled boundary arrow leaves the sort mode alone', async () => {
    renderList()
    useStore.getState().setSectionSort('courses', 'alpha')
    const ups = screen.getAllByRole('button', { name: 'Move up in this section' })
    await userEvent.click(ups[0])
    expect(useStore.getState().sectionSort.courses).toBe('alpha')
    expect(useStore.getState().mutationCount).toBe(0)
  })
})
