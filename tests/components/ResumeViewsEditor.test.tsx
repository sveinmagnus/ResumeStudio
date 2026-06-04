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

  it('switches a section to off via the detail toggle', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    // promoted_projects defaults to 'off', so a fresh view already has one
    // 'off' section. The first section row (Profile & Summary) is 'full'.
    const offBefore = useStore.getState().data.views[0].sections.filter((s) => s.detail === 'off').length

    // Click the first section's "off" radio button.
    const offBtns = screen.getAllByRole('radio', { name: /^off$/i })
    await userEvent.click(offBtns[0])

    const offAfter = useStore.getState().data.views[0].sections.filter((s) => s.detail === 'off').length
    expect(offAfter).toBe(offBefore + 1)
  })

  it('switches a section to summary via the detail toggle', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    const summaryBtns = screen.getAllByRole('radio', { name: /^summary$/i })
    await userEvent.click(summaryBtns[0])

    const summaryCount = useStore.getState().data.views[0].sections.filter((s) => s.detail === 'summary').length
    expect(summaryCount).toBe(1)
  })

  it('changes view-level density via the styling controls', async () => {
    seed()
    render(<ResumeViewsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /new view/i }))

    const densitySelect = screen.getByLabelText(/density/i)
    await userEvent.selectOptions(densitySelect, 'compact')

    expect(useStore.getState().data.views[0].style.density).toBe('compact')
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
