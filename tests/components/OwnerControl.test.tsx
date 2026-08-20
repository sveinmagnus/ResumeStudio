/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OwnerControl } from '../../src/components/account/OwnerControl'
import { api, ServerError, type ResumeMeta, type TeamUser } from '../../src/lib/api'
import { resolveConfirm, confirmDialogVisible } from '../helpers/confirm'

const META = (over: Partial<ResumeMeta> = {}): ResumeMeta => ({
  id: 'r1', name: 'Board CV', primary_locale: 'en', secondary_locale: null,
  saved_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
  version: 3, owner_id: 'u1', ...over,
})

const USER = (over: Partial<TeamUser> = {}): TeamUser => ({
  id: 'u1', username: 'jane', display_name: 'Jane Doe', email: null,
  email_verified_at: null, role: 'member', created_at: '2026-01-01T00:00:00Z',
  last_login_at: null, disabled_at: null, ...over,
})

const USERS = [USER(), USER({ id: 'u2', username: 'omar', display_name: 'Omar Ali' })]

/** Open the transfer dialog for the rendered control. */
async function openDialog(name = /change owner of board cv/i): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name }))
  await screen.findByRole('dialog')
}

describe('<OwnerControl>', () => {
  afterEach(() => vi.restoreAllMocks())

  it('names the current owner and offers unowned as an explicit choice', async () => {
    render(<OwnerControl resume={META()} users={USERS} onChanged={() => {}} />)
    await openDialog()

    expect(screen.getByText('Jane Doe', { selector: 'strong' })).toBeInTheDocument()
    const select = screen.getByLabelText('New owner')
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    // Unowned is a real state (only owner-role accounts can read it), so it is
    // named rather than left as a blank row.
    expect(labels).toEqual(['Nobody (unowned)', 'Jane Doe', 'Omar Ali'])
  })

  it('reads an owner_id with no account behind it as exactly that', async () => {
    render(<OwnerControl resume={META({ owner_id: 'ghost' })} users={USERS} onChanged={() => {}} />)
    await openDialog()
    expect(screen.getByText('An account that no longer exists')).toBeInTheDocument()
  })

  it('says "Unowned" for a resume nobody has claimed', async () => {
    render(<OwnerControl resume={META({ owner_id: null })} users={USERS} onChanged={() => {}} />)
    await openDialog()
    expect(screen.getByText('Unowned')).toBeInTheDocument()
  })

  it('hands the resume to another account once confirmed', async () => {
    const setOwner = vi.spyOn(api, 'setResumeOwner').mockResolvedValue(undefined)
    const onChanged = vi.fn()
    render(<OwnerControl resume={META()} users={USERS} onChanged={onChanged} />)
    await openDialog()

    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'u2')
    await userEvent.click(screen.getByRole('button', { name: /^change owner$/i }))
    await resolveConfirm('confirm')

    await waitFor(() => expect(setOwner).toHaveBeenCalledWith('r1', 'u2'))
    expect(onChanged).toHaveBeenCalledWith('u2')
    // The dialog closes on success; the outcome is announced in the live region.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Board CV is now owned by Omar Ali.')
  })

  it('returns a resume to unowned when that is chosen', async () => {
    const setOwner = vi.spyOn(api, 'setResumeOwner').mockResolvedValue(undefined)
    const onChanged = vi.fn()
    render(<OwnerControl resume={META()} users={USERS} onChanged={onChanged} />)
    await openDialog()

    await userEvent.selectOptions(screen.getByLabelText('New owner'), '')
    await userEvent.click(screen.getByRole('button', { name: /^change owner$/i }))
    await resolveConfirm('confirm')

    await waitFor(() => expect(setOwner).toHaveBeenCalledWith('r1', null))
    expect(onChanged).toHaveBeenCalledWith(null)
  })

  it('warns that the handover is one-way before applying it', async () => {
    vi.spyOn(api, 'setResumeOwner').mockResolvedValue(undefined)
    render(<OwnerControl resume={META()} users={USERS} onChanged={() => {}} />)
    await openDialog()

    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'u2')
    await userEvent.click(screen.getByRole('button', { name: /^change owner$/i }))

    await waitFor(() => expect(confirmDialogVisible()).toBe(true))
    expect(document.querySelector('.confirm-message')?.textContent)
      .toMatch(/will not be able to take it back/i)
    await resolveConfirm('confirm')
  })

  it('changes nothing when the confirmation is declined', async () => {
    const setOwner = vi.spyOn(api, 'setResumeOwner').mockResolvedValue(undefined)
    render(<OwnerControl resume={META()} users={USERS} onChanged={() => {}} />)
    await openDialog()

    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'u2')
    await userEvent.click(screen.getByRole('button', { name: /^change owner$/i }))
    await resolveConfirm('cancel')

    expect(setOwner).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not ask the server when the owner is unchanged', async () => {
    const setOwner = vi.spyOn(api, 'setResumeOwner').mockResolvedValue(undefined)
    render(<OwnerControl resume={META()} users={USERS} onChanged={() => {}} />)
    await openDialog()

    await userEvent.click(screen.getByRole('button', { name: /^change owner$/i }))

    expect(confirmDialogVisible()).toBe(false)
    expect(setOwner).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('surfaces a refusal in an alert and leaves the dialog open', async () => {
    vi.spyOn(api, 'setResumeOwner').mockRejectedValue(new ServerError(404, 'Resume not found'))
    const onChanged = vi.fn()
    render(<OwnerControl resume={META()} users={USERS} onChanged={onChanged} />)
    await openDialog()

    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'u2')
    await userEvent.click(screen.getByRole('button', { name: /^change owner$/i }))
    await resolveConfirm('confirm')

    expect(await screen.findByRole('alert')).toHaveTextContent('Resume not found')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('marks a disabled account, which nothing else on the row would reveal', async () => {
    render(
      <OwnerControl
        resume={META()}
        users={[USER(), USER({ id: 'u3', display_name: 'Sam Ford', disabled_at: '2026-07-01T00:00:00Z' })]}
        onChanged={() => {}}
      />,
    )
    await openDialog()
    expect(screen.getByRole('option', { name: 'Sam Ford (disabled account)' })).toBeInTheDocument()
  })

  it('closes on Escape without touching ownership', async () => {
    const setOwner = vi.spyOn(api, 'setResumeOwner').mockResolvedValue(undefined)
    render(<OwnerControl resume={META()} users={USERS} onChanged={() => {}} />)
    await openDialog()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(setOwner).not.toHaveBeenCalled()
  })
})
