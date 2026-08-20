// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetupNotice } from '../../src/components/account/SetupNotice'
import { api } from '../../src/lib/api'
import * as router from '../../src/lib/router'

/**
 * The defect this pins, found by driving the real app rather than by any test:
 *
 * `AuthGate` renders the first-run setup form, but the gate is only mounted
 * after a 401 — and an instance in `open` mode never returns one. So on a fresh
 * server the code was printed, the API reported `bootstrap_available: true`,
 * and the app showed the ordinary screen. The entire accounts feature had no
 * way in through the UI.
 */

const status = (over: Record<string, unknown> = {}) => ({
  mode: 'open' as const,
  auth_required: false,
  bootstrap_available: true,
  mail_configured: false,
  ...over,
})

beforeEach(() => { vi.restoreAllMocks() })

describe('<SetupNotice>', () => {
  it('offers setup when the server says a code is waiting', async () => {
    vi.spyOn(api, 'authStatus').mockResolvedValue(status())
    render(<SetupNotice />)
    expect(await screen.findByRole('button', { name: /set up accounts/i })).toBeInTheDocument()
  })

  it('says what having no accounts actually means', async () => {
    // The reason to act, not just the button. Someone who does not know the
    // instance is open to anyone has no way to judge whether this matters.
    vi.spyOn(api, 'authStatus').mockResolvedValue(status())
    render(<SetupNotice />)
    expect(await screen.findByText(/read and edit every CV/i)).toBeInTheDocument()
  })

  it('stays out of the way once accounts exist', async () => {
    vi.spyOn(api, 'authStatus').mockResolvedValue(
      status({ mode: 'accounts', auth_required: true, bootstrap_available: false }),
    )
    const { container } = render(<SetupNotice />)
    await waitFor(() => expect(api.authStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('stays out of the way on the desktop build, which issues no code', async () => {
    // Desktop is `open` too, but never mints a bootstrap code — so the flag,
    // not the mode, is what this keys on.
    vi.spyOn(api, 'authStatus').mockResolvedValue(status({ bootstrap_available: false }))
    const { container } = render(<SetupNotice />)
    await waitFor(() => expect(api.authStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('navigates to the setup screen, which is reachable without a 401', async () => {
    vi.spyOn(api, 'authStatus').mockResolvedValue(status())
    const go = vi.spyOn(router, 'navigate').mockImplementation(() => {})
    render(<SetupNotice />)
    await userEvent.click(await screen.findByRole('button', { name: /set up accounts/i }))
    expect(go).toHaveBeenCalledWith('/setup')
  })

  it('can be dismissed for the session', async () => {
    vi.spyOn(api, 'authStatus').mockResolvedValue(status())
    const { container } = render(<SetupNotice />)
    await userEvent.click(await screen.findByRole('button', { name: /not now/i }))
    expect(container).toBeEmptyDOMElement()
  })

  it('says nothing when the status call fails, rather than guessing', async () => {
    vi.spyOn(api, 'authStatus').mockRejectedValue(new Error('offline'))
    const { container } = render(<SetupNotice />)
    await waitFor(() => expect(api.authStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
