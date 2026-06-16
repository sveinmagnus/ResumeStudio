/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SnapshotHistory } from '../../src/components/SnapshotHistory'
import { useStore } from '../../src/store/useStore'
import { api, type SnapshotMeta } from '../../src/lib/api'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeResume, makeProject } from '../fixtures'
import type { ResumeStore } from '../../src/types'

const SNAPSHOTS: SnapshotMeta[] = [
  { id: 2, saved_at: '2026-05-31T11:59:00Z', size: 1200 },
  { id: 1, saved_at: '2026-05-30T09:00:00Z', size: 1000 },
]

describe('<SnapshotHistory>', () => {
  beforeEach(() => resetStore())
  afterEach(() => vi.restoreAllMocks())

  it('lists snapshots newest-first with a "latest" badge', async () => {
    vi.spyOn(api, 'listSnapshots').mockResolvedValue(SNAPSHOTS)
    render(<SnapshotHistory resumeId="r1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /restore/i })).toHaveLength(2))
    expect(screen.getByText('latest')).toBeInTheDocument()
  })

  // ── Shared dialog behaviour (useDialog) ─────────────────────────────────

  it('moves focus into the dialog on open and closes on Escape', async () => {
    vi.spyOn(api, 'listSnapshots').mockResolvedValue(SNAPSHOTS)
    const onClose = vi.fn()
    render(<SnapshotHistory resumeId="r1" onClose={onClose} />)
    // Initial focus lands on the first focusable element (the close button).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('traps Tab inside the dialog', async () => {
    vi.spyOn(api, 'listSnapshots').mockResolvedValue(SNAPSHOTS)
    render(<SnapshotHistory resumeId="r1" onClose={() => {}} />)
    await screen.findAllByRole('button', { name: /restore/i })
    // Shift+Tab from the first focusable wraps to the last.
    screen.getByRole('button', { name: 'Close' }).focus()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    const restores = screen.getAllByRole('button', { name: /restore/i })
    expect(document.activeElement).toBe(restores[restores.length - 1])
  })

  it('restores a snapshot via replaceData and closes', async () => {
    const restored = { ...emptyStore(), resume: makeResume({ full_name: 'Restored Person' }) }
    vi.spyOn(api, 'listSnapshots').mockResolvedValue(SNAPSHOTS)
    vi.spyOn(api, 'getSnapshot').mockResolvedValue(restored)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onClose = vi.fn()

    render(<SnapshotHistory resumeId="r1" onClose={onClose} />)
    const [firstRestore] = await screen.findAllByRole('button', { name: /restore/i })
    await userEvent.click(firstRestore)

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.getSnapshot).toHaveBeenCalledWith('r1', 2)
    // replaceData stored the restored payload and treated it as a mutation.
    expect(useStore.getState().data.resume?.full_name).toBe('Restored Person')
    expect(useStore.getState().mutationCount).toBeGreaterThan(0)
  })

  it('does not restore when the confirm dialog is declined', async () => {
    vi.spyOn(api, 'listSnapshots').mockResolvedValue(SNAPSHOTS)
    const getSpy = vi.spyOn(api, 'getSnapshot')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onClose = vi.fn()

    render(<SnapshotHistory resumeId="r1" onClose={onClose} />)
    const [firstRestore] = await screen.findAllByRole('button', { name: /restore/i })
    await userEvent.click(firstRestore)

    expect(getSpy).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows an error message when the list cannot be loaded', async () => {
    vi.spyOn(api, 'listSnapshots').mockRejectedValue(new Error('boom'))
    render(<SnapshotHistory resumeId="r1" onClose={() => {}} />)
    expect(await screen.findByText(/could not load history/i)).toBeInTheDocument()
  })

  // ── What-changed detail (lazy diff vs the previous snapshot) ─────────────

  it('expands a row to show what changed vs the previous snapshot', async () => {
    const prev: ResumeStore = emptyStore()
    const next: ResumeStore = { ...emptyStore(), projects: [makeProject({ id: 'p1', customer: { en: 'Acme Bank' } })] }
    vi.spyOn(api, 'listSnapshots').mockResolvedValue(SNAPSHOTS)
    vi.spyOn(api, 'getSnapshot').mockImplementation(async (_rid, id) => (id === 2 ? next : prev))

    render(<SnapshotHistory resumeId="r1" onClose={() => {}} />)
    await screen.findAllByRole('button', { name: /restore/i })

    // Expand the latest (id 2) row → diffs against the older (id 1).
    const expanders = screen.getAllByRole('button', { name: /show what changed/i })
    await userEvent.click(expanders[0])

    expect(await screen.findByText('Acme Bank')).toBeInTheDocument()
    expect(screen.getByText('Added')).toBeInTheDocument()
    expect(api.getSnapshot).toHaveBeenCalledWith('r1', 2)
    expect(api.getSnapshot).toHaveBeenCalledWith('r1', 1)
  })

  it('labels the oldest snapshot as the first recorded version', async () => {
    vi.spyOn(api, 'listSnapshots').mockResolvedValue(SNAPSHOTS)
    vi.spyOn(api, 'getSnapshot').mockResolvedValue(emptyStore())
    render(<SnapshotHistory resumeId="r1" onClose={() => {}} />)
    await screen.findAllByRole('button', { name: /restore/i })

    const expanders = screen.getAllByRole('button', { name: /show what changed/i })
    await userEvent.click(expanders[1]) // the older row (id 1) has no predecessor
    expect(await screen.findByText(/first recorded version/i)).toBeInTheDocument()
  })
})
