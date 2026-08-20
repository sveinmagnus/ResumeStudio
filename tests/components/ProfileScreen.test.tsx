/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileScreen } from '../../src/components/account/ProfileScreen'
import { ServerError, api, type AccountProfile } from '../../src/lib/api'
import { resolveConfirm } from '../helpers/confirm'

const PROFILE = (over: Partial<AccountProfile> = {}): AccountProfile => ({
  id: 'u1', username: 'kari', display_name: 'Kari Nordmann',
  email: null, email_verified: false, role: 'member',
  recovery_codes_left: 8, mail_configured: true, ...over,
})

const mount = (p = PROFILE()) => {
  vi.spyOn(api, 'profile').mockResolvedValue(p)
  render(<ProfileScreen onSignedOut={vi.fn()} />)
}

afterEach(() => { vi.restoreAllMocks() })

describe('<ProfileScreen>', () => {
  it('changes the display name on its own — it is not a login identifier', async () => {
    const update = vi.spyOn(api, 'updateProfile').mockResolvedValue(undefined)
    mount()

    const field = await screen.findByLabelText(/^display name$/i)
    await userEvent.clear(field)
    await userEvent.type(field, 'Kari N')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ display_name: 'Kari N' }))
  })

  it('asks for the current password before either login identifier can change', async () => {
    mount()
    await screen.findByLabelText(/^username$/i)

    const save = screen.getByRole('button', { name: /save sign-in details/i })
    // Nothing changed yet — and even once it has, the password is required.
    expect(save).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/^email address$/i), 'kari@example.com')
    expect(save).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/your current password/i), 'correct-horse-battery')
    expect(save).toBeEnabled()
  })

  it('sends the current password along with the identifier change', async () => {
    const update = vi.spyOn(api, 'updateProfile').mockResolvedValue(undefined)
    mount()

    await userEvent.type(await screen.findByLabelText(/^email address$/i), 'kari@example.com')
    await userEvent.type(screen.getByLabelText(/your current password/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /save sign-in details/i }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({
      username: 'kari', email: 'kari@example.com', current_password: 'correct-horse-battery',
    }))
  })

  it('surfaces the server refusing a wrong current password', async () => {
    vi.spyOn(api, 'updateProfile').mockRejectedValue(
      new ServerError(403, 'Enter your current password to change your username or email address.'),
    )
    mount()

    await userEvent.type(await screen.findByLabelText(/^email address$/i), 'kari@example.com')
    await userEvent.type(screen.getByLabelText(/your current password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /save sign-in details/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your current password/i)
  })

  it('says an unverified address cannot receive a reset, and offers to send the link', async () => {
    const send = vi.spyOn(api, 'sendVerificationEmail').mockResolvedValue(undefined)
    mount(PROFILE({ email: 'kari@example.com', email_verified: false }))

    expect(await screen.findByText('Not confirmed')).toBeInTheDocument()
    expect(screen.getByText(/cannot receive a password reset/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /send the confirmation link/i }))
    await waitFor(() => expect(send).toHaveBeenCalled())
  })

  it('marks a verified address as usable and drops the send button', async () => {
    mount(PROFILE({ email: 'kari@example.com', email_verified: true }))
    expect(await screen.findByText('Confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send the confirmation link/i })).not.toBeInTheDocument()
  })

  it('states how many recovery codes are left, and confirms before invalidating them', async () => {
    const regen = vi.spyOn(api, 'regenerateRecoveryCodes')
      .mockResolvedValue(['NEW01-NEW02-NEW03-NEW04'])
    mount(PROFILE({ recovery_codes_left: 3 }))

    expect(await screen.findByText(/3 unused codes left/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /generate a new set/i }))
    await resolveConfirm('confirm')

    await waitFor(() => expect(regen).toHaveBeenCalled())
    expect(await screen.findByText('NEW01-NEW02-NEW03-NEW04')).toBeInTheDocument()
  })

  it('keeps the old codes working when the user backs out', async () => {
    const regen = vi.spyOn(api, 'regenerateRecoveryCodes').mockResolvedValue([])
    mount()

    await userEvent.click(await screen.findByRole('button', { name: /generate a new set/i }))
    await resolveConfirm('cancel')

    expect(regen).not.toHaveBeenCalled()
  })

  it('warns that a password change signs every session out, and acts on it', async () => {
    const change = vi.spyOn(api, 'changePassword').mockResolvedValue(undefined)
    vi.spyOn(api, 'profile').mockResolvedValue(PROFILE())
    const onSignedOut = vi.fn()
    render(<ProfileScreen onSignedOut={onSignedOut} />)

    expect(await screen.findByText(/signs out every session on every device/i)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/^current password$/i), 'old-password-here')
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'correct-horse-battery')
    await userEvent.type(screen.getByLabelText(/repeat the new password/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => expect(change).toHaveBeenCalledWith('old-password-here', 'correct-horse-battery'))
    expect(onSignedOut).toHaveBeenCalled()
  })
})
