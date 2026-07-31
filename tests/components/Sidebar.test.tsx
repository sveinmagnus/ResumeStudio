/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../../src/components/layout/Sidebar'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeProject, makeView } from '../fixtures'

function seed() {
  useStore.setState({
    data: { ...emptyStore(), projects: [makeProject(), makeProject()] },
    hasData: true, activeSection: 'overview', expandedItemId: null, mutationCount: 0,
    currentResumeId: 'r1',
  })
}

describe('<Sidebar>', () => {
  beforeEach(() => {
    resetStore()
    // The nav writes to the URL now, and jsdom's location persists across tests
    // in a file — reset it so each case starts from a known path.
    window.history.replaceState({}, '', '/')
  })

  it('renders section groups and a per-section count', () => {
    seed()
    render(<Sidebar />)
    // Projects link shows the count badge (2 seeded).
    expect(screen.getByRole('link', { name: /Projects\s*2/ })).toBeInTheDocument()
  })

  it('does not crash when a section array is missing (old backup / bypassed migrate)', () => {
    // The Sidebar renders OUTSIDE the per-section ErrorBoundary, so a throw here
    // white-screens the whole editor. A store that predates a section's array
    // (added in a later version, loaded before defaults backfill it) must render
    // the section with a 0 count, not crash.
    const store = emptyStore() as Record<string, unknown>
    delete store.cover_letters
    delete store.views
    useStore.setState({
      data: store as never,
      hasData: true, activeSection: 'overview', expandedItemId: null, mutationCount: 0,
      currentResumeId: 'r1',
    })
    expect(() => render(<Sidebar />)).not.toThrow()
    // The nav still renders (Projects is always present).
    expect(screen.getByRole('link', { name: /Projects/ })).toBeInTheDocument()
  })

  it('renders the Export group first (Resume Views at the top of the nav)', () => {
    seed()
    render(<Sidebar />)
    const labels = Array.from(document.querySelectorAll('.sb-group-label')).map((el) => el.textContent)
    expect(labels[0]).toBe('Export')
    // The first nav item inside the first group is Resume Views.
    const firstGroup = document.querySelector('.sb-group')
    expect(firstGroup?.textContent).toContain('Resume Views')
  })

  it('navigates on click', async () => {
    seed()
    render(<Sidebar />)
    await userEvent.click(screen.getByRole('link', { name: /^Projects/ }))
    // The URL is what a nav item changes; EditorRoute's URL→store effect moves
    // the store from there (not asserted here — this component is mounted bare).
    expect(window.location.pathname).toBe('/r/r1/projects')
  })

  /**
   * Nav items must be real links, not buttons with onClick. Two sections of one
   * CV side by side (or the same section in two windows) is a genuine editing
   * need, and a faked link makes Ctrl-click and "Open in new tab" do nothing.
   */
  describe('as real links', () => {
    it('gives every section item a resolvable href', () => {
      seed()
      render(<Sidebar />)
      expect(screen.getByRole('link', { name: /^Projects/ }))
        .toHaveAttribute('href', '/r/r1/projects')
      // Overview is the editor's canonical root — no section suffix.
      expect(screen.getByRole('link', { name: /^Overview/ }))
        .toHaveAttribute('href', '/r/r1')
    })

    it('links each Resume View directly', () => {
      useStore.setState({
        data: { ...emptyStore(), views: [makeView({ id: 'v1', name: 'Board CV' })] },
        hasData: true, activeSection: 'overview', expandedItemId: null, mutationCount: 0,
        currentResumeId: 'r1',
      })
      render(<Sidebar />)
      expect(screen.getByRole('link', { name: /Board CV/ }))
        .toHaveAttribute('href', '/r/r1/views/v1')
    })

    it('leaves a Ctrl-click to the browser and does not close the drawer', async () => {
      seed()
      const onClose = vi.fn()
      // One instance, so the held modifier is still down when the click lands.
      const user = userEvent.setup()
      render(<Sidebar isOpen onClose={onClose} />)

      await user.keyboard('{Control>}')
      await user.click(screen.getByRole('link', { name: /^Projects/ }))
      await user.keyboard('{/Control}')

      // We neither navigated this window nor dismissed the drawer behind it.
      expect(window.location.pathname).toBe('/')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('marks the active item with aria-current="page"', () => {
      useStore.setState({
        data: { ...emptyStore(), projects: [makeProject()] },
        hasData: true, activeSection: 'projects', expandedItemId: null, mutationCount: 0,
        currentResumeId: 'r1',
      })
      render(<Sidebar />)
      expect(screen.getByRole('link', { name: /^Projects/ })).toHaveAttribute('aria-current', 'page')
    })
  })

  it('shows the resume owner name in the brand block', () => {
    useStore.setState({
      data: { ...emptyStore() },
      hasData: true, activeSection: 'overview', expandedItemId: null, mutationCount: 0,
      currentResumeId: 'r1',
    })
    render(<Sidebar />)
    expect(screen.getByText('Test Person')).toBeInTheDocument()
  })
})
