/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthGate } from '../../src/components/AuthGate'
import { UnauthorizedError, api } from '../../src/lib/api'
import { savePending, loadPending } from '../../src/lib/localCache'
import { resolveConfirm, confirmDialogVisible } from '../helpers/confirm'
import { emptyStore } from '../fixtures'

const pending = (id: string, dirty = true) =>
  savePending(id, { data: emptyStore(), locales: { primary: 'en', secondary: null }, base_version: 1, dirty })

describe('<AuthGate>', () => {
  afterEach(() => { sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks() })
  it('disables Connect until a token is entered', () => {
    render(<AuthGate onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: /connect/i })).toBeDisabled()
  })

  it('submits the entered token', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AuthGate onSubmit={onSubmit} />)
    await userEvent.type(screen.getByPlaceholderText(/paste token/i), 'my-token')
    await userEvent.click(screen.getByRole('button', { name: /connect/i }))
    expect(onSubmit).toHaveBeenCalledWith('my-token')
  })

  it('shows an "incorrect token" message on UnauthorizedError', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new UnauthorizedError())
    render(<AuthGate onSubmit={onSubmit} />)
    await userEvent.type(screen.getByPlaceholderText(/paste token/i), 'bad')
    await userEvent.click(screen.getByRole('button', { name: /connect/i }))
    expect(await screen.findByText(/token is incorrect/i)).toBeInTheDocument()
  })

  it('shows a connection error for other failures', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('network'))
    render(<AuthGate onSubmit={onSubmit} />)
    await userEvent.type(screen.getByPlaceholderText(/paste token/i), 'x')
    await userEvent.click(screen.getByRole('button', { name: /connect/i }))
    expect(await screen.findByText(/could not connect/i)).toBeInTheDocument()
  })

  // Security skill: explicit logout must clear the server session cookie AND
  // wipe the local plaintext resume caches, so a shared machine doesn't retain
  // the CV. (The token itself now lives only in an HttpOnly cookie, so there's
  // nothing JS-readable to assert — we assert the logout call + cache wipe.)
  it('"Clear local data" logs out + wipes caches with no prompt when nothing is unsynced', async () => {
    const logoutSpy = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    pending('r1', false)
    pending('r2', false)

    render(<AuthGate onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /clear local data/i }))

    await waitFor(() => expect(logoutSpy).toHaveBeenCalledOnce())
    expect(confirmDialogVisible()).toBe(false)
    expect(loadPending('r1')).toBeNull()
    expect(loadPending('r2')).toBeNull()
  })

  it('prompts before wiping when there are unsynced changes, and clears on confirm', async () => {
    const logoutSpy = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    pending('r1', true)

    render(<AuthGate onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /clear local data/i }))
    await resolveConfirm('confirm')

    await waitFor(() => expect(logoutSpy).toHaveBeenCalledOnce())
    expect(loadPending('r1')).toBeNull()
  })

  it('keeps the caches when the user cancels the unsynced-changes prompt', async () => {
    const logoutSpy = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    pending('r1', true)

    render(<AuthGate onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /clear local data/i }))
    await resolveConfirm('cancel')

    // Nothing discarded — unsynced work is preserved, no logout fired.
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(loadPending('r1')).not.toBeNull()
  })
})
