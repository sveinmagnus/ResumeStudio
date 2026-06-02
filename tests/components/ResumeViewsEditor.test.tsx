/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResumeViewsEditor } from '../../src/components/editor/ResumeViewsEditor'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore } from '../fixtures'

function seed() {
  useStore.setState({
    data: emptyStore(), hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'views', expandedItemId: null, mutationCount: 0,
  })
}

describe('<ResumeViewsEditor>', () => {
  beforeEach(() => resetStore())

  it('shows an empty state when there are no views', () => {
    seed()
    render(<ResumeViewsEditor />)
    expect(screen.getByText(/no views yet/i)).toBeInTheDocument()
  })

  it('creates a view and opens the editor', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    expect(useStore.getState().data.views).toHaveLength(1)
    // Editor is now showing — the "All views" back button appears.
    expect(screen.getByRole('button', { name: /all views/i })).toBeInTheDocument()
  })

  it('renames the active view', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    const nameInput = screen.getByDisplayValue('New View')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Board CV')
    expect(useStore.getState().data.views[0].name).toBe('Board CV')
  })

  it('toggles a section off for the view', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    const total = useStore.getState().data.views[0].sections.length
    const enabledBefore = useStore.getState().data.views[0].sections.filter((s) => s.enabled).length
    expect(enabledBefore).toBe(total) // all on by default

    await userEvent.click(screen.getAllByTitle('Hide section')[0])

    const enabledAfter = useStore.getState().data.views[0].sections.filter((s) => s.enabled).length
    expect(enabledAfter).toBe(total - 1)
  })

  it('edits the introduction text', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    await userEvent.type(
      screen.getByPlaceholderText('Write an introduction for this view…'),
      'Targeted for boards',
    )
    expect(useStore.getState().data.views[0].introduction.en).toBe('Targeted for boards')
  })
})
