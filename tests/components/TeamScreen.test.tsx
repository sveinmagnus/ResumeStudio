/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeamScreen } from '../../src/components/account/TeamScreen'
import { ServerError, api, type TeamUser } from '../../src/lib/api'
import { resolveConfirm } from '../helpers/confirm'

const USER = (over: Partial<TeamUser> = {}): TeamUser => ({
  id: 'u1', username: 'kari', display_name: 'Kari Nordmann',
  email: null, email_verified_at: null, role: 'member',
  created_at: '2026-01-01T00:00:00Z', last_login_at: null, disabled_at: null, ...over,
})

const mount = (users: TeamUser[], meId: string | null = 'me') => {
  vi.spyOn(api, 'listUsers').mockResolvedValue(users)
  render(<TeamScreen meId={meId} />)
}

afterEach(() => { vi.restoreAllMocks() })

describe('<TeamScreen>', () => {
  it('lists every account with its role and sign-in history', async () => {
    mount([
      USER({ id: 'a', display_name: 'Kari', role: 'owner', last_login_at: '2026-08-19T09:00:00Z' }),
      USER({ id: 'b', display_name: 'Ola' }),
    ])
    expect(await screen.findByText('Kari')).toBeInTheDocument()
    expect(screen.getByText('Ola')).toBeInTheDocument()
    expect(screen.getByText(/never signed in/i)).toBeInTheDocument()
  })

  it('marks which row is you', async () => {
    mount([USER({ id: 'me', display_name: 'Kari' }), USER({ id: 'b', display_name: 'Ola' })])
    await screen.findByText('Kari')
    expect(screen.getAllByText('You')).toHaveLength(1)
  })

  it('hands the invitation back as a link for the owner to pass on', async () => {
    vi.spyOn(api, 'inviteUser').mockResolvedValue({
      url: 'https://cv.example.com/accept?token=abc', token: 'abc',
    })
    mount([])

    await userEvent.click(await screen.findByRole('button', { name: /create an invitation/i }))
    const field = await screen.findByLabelText(/invitation link/i)
    expect(field).toHaveValue('https://cv.example.com/accept?token=abc')
    expect(field).toHaveAttribute('readonly')
  })

  it('mints a reset link and warns what holding it means', async () => {
    vi.spyOn(api, 'userResetLink').mockResolvedValue('/reset?token=xyz')
    mount([USER({ id: 'b', display_name: 'Ola' })])

    await userEvent.click(await screen.findByRole('button', { name: /reset link/i }))
    expect(await screen.findByLabelText(/reset link for ola/i)).toHaveValue('/reset?token=xyz')
    expect(screen.getByText(/anyone holding it can set this account's password/i))
      .toBeInTheDocument()
  })

  it('confirms a disable, explaining that the resumes stay put', async () => {
    const setDisabled = vi.spyOn(api, 'setUserDisabled').mockResolvedValue(undefined)
    mount([USER({ id: 'b', display_name: 'Ola' })])

    await userEvent.click(await screen.findByRole('button', { name: /^disable$/i }))
    expect(await screen.findByText(/deleting a departing colleague/i)).toBeInTheDocument()
    await resolveConfirm('confirm')

    await waitFor(() => expect(setDisabled).toHaveBeenCalledWith('b', true))
  })

  it("shows the server's refusal to strand an instance without an owner", async () => {
    vi.spyOn(api, 'setUserRole').mockRejectedValue(
      new ServerError(409, 'This is the only owner. Promote somebody else first.'),
    )
    mount([USER({ id: 'me', display_name: 'Kari', role: 'owner' })])

    await userEvent.click(await screen.findByRole('button', { name: /make a member/i }))
    await resolveConfirm('confirm')

    expect(await screen.findByRole('alert'))
      .toHaveTextContent(/only owner. promote somebody else first/i)
  })

  it('surfaces a 403 rather than rendering an empty team', async () => {
    vi.spyOn(api, 'listUsers').mockRejectedValue(new ServerError(403, 'Forbidden'))
    render(<TeamScreen meId="me" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')
  })

  it('edits a colleague without asking for their password, and says the address stays unconfirmed', async () => {
    const update = vi.spyOn(api, 'updateUser').mockResolvedValue(undefined)
    mount([USER({ id: 'b', display_name: 'Ola' })])

    await userEvent.click(await screen.findByRole('button', { name: /edit details/i }))
    expect(screen.getByText(/leaves it unconfirmed/i)).toBeInTheDocument()

    const email = screen.getByLabelText(/^email address$/i)
    await userEvent.type(email, 'ola@example.com')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('b', {
      display_name: 'Ola', username: 'kari', email: 'ola@example.com',
    }))
  })
})
