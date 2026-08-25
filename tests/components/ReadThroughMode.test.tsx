/**
 * @vitest-environment jsdom
 *
 * Read-through mode: the view's content as one document, with flags that
 * survive leaving (localStorage) and land the user on the flagged item.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadThroughMode } from '../../src/components/editor/views/ReadThroughMode'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { loadFlags } from '../../src/lib/readThrough'
import { emptyStore, makeResume, makeProject, makeView } from '../fixtures'

function seed() {
  const view = makeView({ id: 'v1', name: 'Consultant CV', introduction: { en: 'A seasoned engineer.' } })
  useStore.setState({
    data: {
      ...emptyStore(),
      resume: makeResume({ id: 'r1', full_name: 'Kari Nordmann' }),
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        long_description: { en: '<p>Built the platform.</p>' },
      })],
      views: [view],
    },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'views', expandedItemId: null, mutationCount: 0,
  })
  return view
}

describe('<ReadThroughMode>', () => {
  beforeEach(() => { resetStore(); localStorage.clear() })

  it('renders the view as one flowing document', () => {
    const view = seed()
    render(<ReadThroughMode view={view} locale="en" onClose={() => {}} />)
    expect(screen.getByText('Kari Nordmann')).toBeInTheDocument()
    expect(screen.getByText('A seasoned engineer.')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Built the platform.')).toBeInTheDocument()
  })

  it('flags an item into the rail and persists across a remount', async () => {
    const view = seed()
    const { unmount } = render(<ReadThroughMode view={view} locale="en" onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /flag acme as reading wrong/i }))
    await userEvent.type(screen.getByLabelText(/note for the flag on acme/i), 'stale numbers')

    expect(loadFlags('r1', 'v1')).toHaveLength(1)
    expect(loadFlags('r1', 'v1')[0].note).toBe('stale numbers')

    // Leaving to fix one flag must not lose the rest — the list survives.
    unmount()
    render(<ReadThroughMode view={view} locale="en" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /remove the flag on acme/i })).toBeInTheDocument()
  })

  it('opens the flagged item in the editor and closes the overlay', async () => {
    const view = seed()
    const onClose = vi.fn()
    render(<ReadThroughMode view={view} locale="en" onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /flag acme as reading wrong/i }))
    await userEvent.click(screen.getByRole('button', { name: /open in editor/i }))

    expect(useStore.getState().activeSection).toBe('projects')
    expect(useStore.getState().expandedItemId).toBe('p1')
    expect(onClose).toHaveBeenCalled()
    // The flag stays — the user removes it once the item is actually fixed.
    expect(loadFlags('r1', 'v1')).toHaveLength(1)
  })

  it('toggling the flag off removes it, and empty storage cleans the key', async () => {
    const view = seed()
    render(<ReadThroughMode view={view} locale="en" onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /flag acme as reading wrong/i }))
    await userEvent.click(screen.getByRole('button', { name: /unflag acme/i }))
    expect(loadFlags('r1', 'v1')).toEqual([])
    expect(localStorage.getItem('resumestudio.readflags.r1.v1')).toBeNull()
  })
})
