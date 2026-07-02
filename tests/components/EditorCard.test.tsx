/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorCard } from '../../src/components/ui/EditorCard'
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

  it('toggles starred via the Feature action', async () => {
    seedWithCourse()
    render(card({ starred: false }))
    await userEvent.click(screen.getByTitle('Feature'))
    expect(useStore.getState().data.courses[0].starred).toBe(true)
  })

  it('toggles disabled via the visibility action', async () => {
    seedWithCourse()
    render(card({ disabled: false }))
    await userEvent.click(screen.getByTitle('Visible'))
    expect(useStore.getState().data.courses[0].disabled).toBe(true)
  })

  it('deletes after confirmation', async () => {
    seedWithCourse()
    render(card())
    await userEvent.click(screen.getByTitle('Delete'))
    await resolveConfirm('confirm')
    expect(useStore.getState().data.courses).toHaveLength(0)
  })

  it('does not delete when confirmation is declined', async () => {
    seedWithCourse()
    render(card())
    await userEvent.click(screen.getByTitle('Delete'))
    await resolveConfirm('cancel')
    expect(useStore.getState().data.courses).toHaveLength(1)
  })

  it('hides the drag handle and arrows when sortable={false}', () => {
    seedWithCourse()
    render(card({ sortable: false }))
    expect(screen.queryByLabelText('Drag handle')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Move up')).not.toBeInTheDocument()
  })
})
