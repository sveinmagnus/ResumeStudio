/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppHeader } from '../../src/components/AppHeader'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore } from '../fixtures'
import { SECTIONS } from '../../src/lib/sections'
import { api } from '../../src/lib/api'
import * as backup from '../../src/lib/backup'

const projectsSection = SECTIONS.find((s) => s.key === 'projects')

function seed() {
  useStore.setState({
    data: emptyStore(), hasData: true, primaryLocale: 'en', secondaryLocale: 'no',
    activeSection: 'projects', expandedItemId: null, mutationCount: 0,
  })
}

function renderHeader() {
  return render(
    <AppHeader
      resumeId="r1"
      section={projectsSection}
      saveState="idle"
      cacheSavedAt={null}
      onRetry={() => {}}
      onUnauthorized={() => {}}
    />,
  )
}

describe('<AppHeader>', () => {
  beforeEach(() => {
    resetStore()
    // The ResumeSwitcher preloads the list on mount — provide a default.
    vi.spyOn(api, 'listResumes').mockResolvedValue([
      { id: 'r1', name: 'My CV', primary_locale: 'en', secondary_locale: 'no', saved_at: '', created_at: '', version: 1 },
    ])
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders the active section title', () => {
    seed()
    renderHeader()
    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('preloads the resume name into the switcher trigger without opening the menu', async () => {
    seed()
    renderHeader()
    // Name appears once the mount-time listResumes resolves — no click needed.
    expect(await screen.findByText('My CV')).toBeInTheDocument()
  })

  it('disables undo/redo when there is no history', () => {
    seed()
    renderHeader()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })

  it('binds Ctrl+Z to undo and Ctrl+Y to redo the last edit', () => {
    vi.useFakeTimers()
    try {
      seed()
      renderHeader()
      const before = useStore.getState().data.resume!.full_name

      // Make an observable edit, then let the 500ms history debounce commit.
      act(() => { useStore.getState().updateResume({ full_name: 'Edited Name' }) })
      act(() => { vi.advanceTimersByTime(600) })
      expect(useStore.getState().data.resume!.full_name).toBe('Edited Name')

      // Ctrl+Z reverts it…
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })) })
      expect(useStore.getState().data.resume!.full_name).toBe(before)

      // …Ctrl+Y reapplies it.
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true })) })
      expect(useStore.getState().data.resume!.full_name).toBe('Edited Name')
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the settings modal from the header cogwheel', async () => {
    seed()
    vi.spyOn(api, 'getSettings').mockRejectedValue(new Error('offline'))
    renderHeader()
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('opens the version-history modal', async () => {
    seed()
    vi.spyOn(api, 'listSnapshots').mockResolvedValue([])
    renderHeader()
    await userEvent.click(screen.getByRole('button', { name: /history/i }))
    expect(await screen.findByText('Version history')).toBeInTheDocument()
  })

  it('downloads a backup on "Save to file"', async () => {
    seed()
    const spy = vi.spyOn(backup, 'downloadBackup').mockImplementation(() => {})
    renderHeader()
    await userEvent.click(screen.getByRole('button', { name: /save to file/i }))
    expect(spy).toHaveBeenCalledOnce()
  })
})
