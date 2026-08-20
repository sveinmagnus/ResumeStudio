/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountMenu } from '../../src/components/account/AccountMenu'
import { api, type MeInfo } from '../../src/lib/api'
import { savePending, loadPending } from '../../src/lib/localCache'
import { resolveConfirm } from '../helpers/confirm'
import { emptyStore } from '../fixtures'

const ME = (over: Partial<MeInfo> = {}): MeInfo => ({
  user_id: 'u1', name: 'Kari Nordmann', role: 'member', service: false, mode: 'accounts', ...over,
})

const mount = (me: MeInfo | null) => {
  vi.spyOn(api, 'me').mockResolvedValue(me)
  render(<AccountMenu />)
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('<AccountMenu>', () => {
  it('answers "who am I" — the question the client could not previously ask', async () => {
    mount(ME())
    await userEvent.click(await screen.findByRole('button', { name: /kari nordmann/i }))
    expect(screen.getByText(/signed in as kari nordmann/i)).toBeInTheDocument()
  })

  it('renders nothing at all where there are no accounts', async () => {
    // The desktop build and local dev: one person on loopback, where an
    // identity control answers a question nobody asked.
    const { container } = render(<AccountMenu />)
    vi.spyOn(api, 'me').mockResolvedValue(ME({ mode: 'open' }))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('offers a service credential the way out but not a profile', async () => {
    mount(ME({ user_id: null, name: 'ci', role: 'owner', service: true }))
    await userEvent.click(await screen.findByRole('button', { name: /service access/i }))
    expect(screen.getByText(/not a person/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /your account/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('shows the team page only to an owner', async () => {
    mount(ME())
    await userEvent.click(await screen.findByRole('button', { name: /kari/i }))
    expect(screen.queryByRole('link', { name: /team/i })).not.toBeInTheDocument()
  })

  it('links an owner to both the profile and the team page', async () => {
    mount(ME({ role: 'owner' }))
    await userEvent.click(await screen.findByRole('button', { name: /kari/i }))
    expect(screen.getByRole('link', { name: /your account/i })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('link', { name: /team/i })).toHaveAttribute('href', '/admin')
  })

  it('signing out wipes the plaintext caches, not just the session', async () => {
    // On a shared machine the localStorage fallback IS the CV in plain text,
    // and multi-user makes shared machines more likely, not less.
    const logout = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    savePending('r1', {
      data: emptyStore(), locales: { primary: 'en', secondary: null },
      base_version: 1, dirty: false,
    })
    mount(ME())

    await userEvent.click(await screen.findByRole('button', { name: /kari/i }))
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(logout).toHaveBeenCalled())
    expect(loadPending('r1')).toBeNull()
  })

  it('names the unsynced backlog before discarding it, and backs out cleanly', async () => {
    const logout = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    savePending('r1', {
      data: emptyStore(), locales: { primary: 'en', secondary: null },
      base_version: 1, dirty: true,
    })
    mount(ME())

    await userEvent.click(await screen.findByRole('button', { name: /kari/i }))
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await resolveConfirm('cancel')

    expect(logout).not.toHaveBeenCalled()
    expect(loadPending('r1')).not.toBeNull()
  })
})
