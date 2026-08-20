/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ResetScreen, RecoverScreen, ForgotScreen, AcceptInviteScreen, VerifyEmailScreen,
} from '../../src/components/account/AccountScreens'
import { ServerError, api } from '../../src/lib/api'

/** These screens read `?token=` once on mount, so the URL is set before render. */
function at(path: string): void {
  window.history.replaceState({}, '', path)
}

beforeEach(() => { at('/') })
afterEach(() => { vi.restoreAllMocks() })

describe('<ResetScreen>', () => {
  it('refuses to guess when the link arrived without its token', () => {
    at('/reset')
    render(<ResetScreen />)
    expect(screen.getByRole('alert')).toHaveTextContent(/missing its token/i)
  })

  it('redeems the token and says the account is signed out everywhere', async () => {
    at('/reset?token=abc123')
    const reset = vi.spyOn(api, 'resetPassword').mockResolvedValue(undefined)
    render(<ResetScreen />)

    await userEvent.type(screen.getByLabelText(/^new password$/i), 'correct-horse-battery')
    await userEvent.type(screen.getByLabelText(/repeat the new password/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() => expect(reset).toHaveBeenCalledWith('abc123', 'correct-horse-battery'))
    expect(await screen.findByText(/signed out/i)).toBeInTheDocument()
  })

  it('catches a mistyped repeat before spending the one-shot token', async () => {
    at('/reset?token=abc123')
    const reset = vi.spyOn(api, 'resetPassword').mockResolvedValue(undefined)
    render(<ResetScreen />)

    await userEvent.type(screen.getByLabelText(/^new password$/i), 'correct-horse-battery')
    await userEvent.type(screen.getByLabelText(/repeat the new password/i), 'correct-horse-batter')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)
    expect(reset).not.toHaveBeenCalled()
  })

  it("shows the server's wording for a spent or expired link", async () => {
    at('/reset?token=stale')
    vi.spyOn(api, 'resetPassword')
      .mockRejectedValue(new ServerError(400, 'That link has expired or has already been used.'))
    render(<ResetScreen />)

    await userEvent.type(screen.getByLabelText(/^new password$/i), 'correct-horse-battery')
    await userEvent.type(screen.getByLabelText(/repeat the new password/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or has already been used/i)
  })
})

describe('<ForgotScreen>', () => {
  it('never claims a message was sent — the server answers identically either way', async () => {
    const forgot = vi.spyOn(api, 'forgotPassword').mockResolvedValue(undefined)
    render(<ForgotScreen />)

    await userEvent.type(screen.getByLabelText(/username or email address/i), 'ghost')
    await userEvent.click(screen.getByRole('button', { name: /send a reset link/i }))

    await waitFor(() => expect(forgot).toHaveBeenCalledWith('ghost'))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/if that account exists/i)
    // "Check your inbox" would answer "does this person have an account here",
    // which is the question this endpoint exists not to answer.
    expect(status).not.toHaveTextContent(/check your inbox/i)
  })

  it('offers the recovery-code route, which needs no mail at all', () => {
    render(<ForgotScreen />)
    expect(screen.getByRole('link', { name: /recovery code/i })).toHaveAttribute('href', '/recover')
  })
})

describe('<RecoverScreen>', () => {
  it('spends a code and reports how many are left', async () => {
    vi.spyOn(api, 'recoverWithCode').mockResolvedValue(7)
    render(<RecoverScreen />)

    await userEvent.type(screen.getByLabelText(/username or email address/i), 'kari')
    await userEvent.type(screen.getByLabelText(/recovery code/i), 'aaaaa bbbbb')
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }))

    expect(await screen.findByText(/7 recovery codes left/i)).toBeInTheDocument()
  })

  it('says plainly when that was the last code', async () => {
    vi.spyOn(api, 'recoverWithCode').mockResolvedValue(0)
    render(<RecoverScreen />)

    await userEvent.type(screen.getByLabelText(/username or email address/i), 'kari')
    await userEvent.type(screen.getByLabelText(/recovery code/i), 'zzzzz')
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }))

    expect(await screen.findByText(/that was your last recovery code/i)).toBeInTheDocument()
  })
})

describe('<AcceptInviteScreen>', () => {
  const CODES = ['AAAAA-BBBBB-CCCCC-DDDDD']

  it('says an expired invitation is expired instead of showing a form that cannot work', async () => {
    at('/accept?token=stale')
    vi.spyOn(api, 'inviteInfo').mockResolvedValue(null)
    render(<AcceptInviteScreen onSignedIn={vi.fn()} />)
    expect(await screen.findByText(/expired or has already been used/i)).toBeInTheDocument()
  })

  it('names the role the invitation carries, since an owner sees every resume', async () => {
    at('/accept?token=t')
    vi.spyOn(api, 'inviteInfo').mockResolvedValue({ role: 'owner', email: null })
    render(<AcceptInviteScreen onSignedIn={vi.fn()} />)
    expect(await screen.findByText(/invited as an owner/i)).toBeInTheDocument()
  })

  it('creates the account, then gates on the recovery codes before continuing', async () => {
    at('/accept?token=t')
    vi.spyOn(api, 'inviteInfo').mockResolvedValue({ role: 'member', email: null })
    vi.spyOn(api, 'acceptInvite').mockResolvedValue({
      user: { id: 'u2', username: 'ola', display_name: 'Ola', role: 'member' },
      recovery_codes: CODES,
    })
    const onSignedIn = vi.fn()
    render(<AcceptInviteScreen onSignedIn={onSignedIn} />)

    await userEvent.type(await screen.findByLabelText(/^username$/i), 'ola')
    await userEvent.type(screen.getByLabelText(/display name/i), 'Ola Nordmann')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /create my account/i }))

    expect(await screen.findByText(CODES[0])).toBeInTheDocument()
    expect(onSignedIn).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('checkbox', { name: /saved these codes/i }))
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onSignedIn).toHaveBeenCalled()
  })
})

describe('<VerifyEmailScreen>', () => {
  it('confirms the address the link was minted for', async () => {
    at('/verify-email?token=v1')
    const verify = vi.spyOn(api, 'verifyEmail').mockResolvedValue(undefined)
    render(<VerifyEmailScreen />)

    await waitFor(() => expect(verify).toHaveBeenCalledWith('v1'))
    expect(await screen.findByText(/can now receive a password reset/i)).toBeInTheDocument()
  })

  it('reports a stale link as an error rather than a silent no-op', async () => {
    at('/verify-email?token=old')
    vi.spyOn(api, 'verifyEmail')
      .mockRejectedValue(new ServerError(400, 'That address is no longer the one on the account.'))
    render(<VerifyEmailScreen />)

    expect(await screen.findByRole('alert'))
      .toHaveTextContent(/no longer the one on the account/i)
  })
})
