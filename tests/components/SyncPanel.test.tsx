/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncPanel } from '../../src/components/SyncPanel'
import { api, type BackupStatus } from '../../src/lib/api'
import { resolveConfirm } from '../helpers/confirm'

const configured = (over: Partial<Extract<BackupStatus, { configured: true }>> = {}): BackupStatus => ({
  configured: true,
  dir: 'C:\\Drive\\ResumeStudio',
  file: 'C:\\Drive\\ResumeStudio\\resume-studio-backup.json',
  exists: true,
  lastBackupAt: '2026-05-31T11:59:00Z',
  upToDate: true,
  resumeCount: 2,
  backupResumeCount: 2,
  ...over,
})

describe('<SyncPanel>', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders nothing when sync is not configured (web/VPS build)', async () => {
    vi.spyOn(api, 'backupStatus').mockResolvedValue({ configured: false })
    const { container } = render(<SyncPanel onRestored={() => {}} onUnauthorized={() => {}} />)
    // Give the effect a tick; the panel should stay empty.
    await waitFor(() => expect(api.backupStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the folder + "Up to date" badge when the backup is current', async () => {
    vi.spyOn(api, 'backupStatus').mockResolvedValue(configured())
    render(<SyncPanel onRestored={() => {}} onUnauthorized={() => {}} />)
    expect(await screen.findByText('Sync & backup')).toBeInTheDocument()
    expect(screen.getByText('Up to date')).toBeInTheDocument()
    expect(screen.getByText('C:\\Drive\\ResumeStudio')).toBeInTheDocument()
  })

  it('flags when there are changes not yet backed up', async () => {
    vi.spyOn(api, 'backupStatus').mockResolvedValue(configured({ upToDate: false }))
    render(<SyncPanel onRestored={() => {}} onUnauthorized={() => {}} />)
    expect(await screen.findByText('Changes not yet backed up')).toBeInTheDocument()
  })

  it('"Back up now" calls the API and re-reads status', async () => {
    const statusSpy = vi.spyOn(api, 'backupStatus').mockResolvedValue(configured({ upToDate: false }))
    const nowSpy = vi.spyOn(api, 'backupNow').mockResolvedValue({ file: 'x', bytes: 100, resumeCount: 2 })
    render(<SyncPanel onRestored={() => {}} onUnauthorized={() => {}} />)

    const btn = await screen.findByRole('button', { name: /back up now/i })
    await userEvent.click(btn)

    await waitFor(() => expect(nowSpy).toHaveBeenCalled())
    expect(await screen.findByText(/Backed up 2 resumes/i)).toBeInTheDocument()
    // Initial load + post-backup refresh.
    expect(statusSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('"Restore from folder" merges and notifies the parent when confirmed', async () => {
    vi.spyOn(api, 'backupStatus').mockResolvedValue(configured())
    const restoreSpy = vi.spyOn(api, 'restoreBackup').mockResolvedValue({ inserted: 1, updated: 1, skipped: 0, deleted: 0 })
    const onRestored = vi.fn()
    render(<SyncPanel onRestored={onRestored} onUnauthorized={() => {}} />)

    const btn = await screen.findByRole('button', { name: /restore from folder/i })
    await userEvent.click(btn)
    await resolveConfirm('confirm')

    await waitFor(() => expect(restoreSpy).toHaveBeenCalledWith('merge'))
    expect(onRestored).toHaveBeenCalled()
    expect(await screen.findByText(/1 added, 1 updated/i)).toBeInTheDocument()
  })

  it('does not restore when the confirm dialog is declined', async () => {
    vi.spyOn(api, 'backupStatus').mockResolvedValue(configured())
    const restoreSpy = vi.spyOn(api, 'restoreBackup')
    render(<SyncPanel onRestored={() => {}} onUnauthorized={() => {}} />)

    const btn = await screen.findByRole('button', { name: /restore from folder/i })
    await userEvent.click(btn)
    await resolveConfirm('cancel')
    expect(restoreSpy).not.toHaveBeenCalled()
  })

  it('disables Restore when no backup file exists yet', async () => {
    vi.spyOn(api, 'backupStatus').mockResolvedValue(configured({ exists: false, upToDate: false, backupResumeCount: null, lastBackupAt: null }))
    render(<SyncPanel onRestored={() => {}} onUnauthorized={() => {}} />)
    const btn = await screen.findByRole('button', { name: /restore from folder/i })
    expect(btn).toBeDisabled()
  })
})
