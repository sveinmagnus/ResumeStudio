/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
      section={projectsSection}
      saveState="idle"
      cacheSavedAt={null}
      onRetry={() => {}}
      onLoadFile={() => {}}
    />,
  )
}

describe('<AppHeader>', () => {
  beforeEach(() => resetStore())
  afterEach(() => vi.restoreAllMocks())

  it('renders the active section title', () => {
    seed()
    renderHeader()
    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('disables undo/redo when there is no history', () => {
    seed()
    renderHeader()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
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
