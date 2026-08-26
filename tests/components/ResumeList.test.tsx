/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResumeList } from '../../src/components/ResumeList'
import { api, type MeInfo, type ResumeMeta, type TeamUser } from '../../src/lib/api'
import { savePending } from '../../src/lib/localCache'
import { resetStore } from '../helpers/store-reset'
import { resolveConfirm } from '../helpers/confirm'
import { emptyStore, makeResume } from '../fixtures'

const META = (over: Partial<ResumeMeta> = {}): ResumeMeta => ({
  id: 'r1', name: 'My CV', primary_locale: 'en', secondary_locale: null,
  saved_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z', version: 1, ...over,
})

/** Seeds one locally cached resume, the way the editor's fallback writes it. */
function cache(id: string, fullName: string | null, dirty = false): void {
  const data = emptyStore()
  data.resume = fullName === null ? null : makeResume({ full_name: fullName })
  savePending(id, {
    data, locales: { primary: 'en', secondary: 'no' },
    base_version: 1, dirty,
  })
}

describe('<ResumeList>', () => {
  beforeEach(() => { resetStore(); localStorage.clear() })
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('renders a card per resume from the server', async () => {
    vi.spyOn(api, 'listResumes').mockResolvedValue([
      META({ id: 'a', name: 'Board CV' }),
      META({ id: 'b', name: 'Technical CV' }),
    ])
    render(<ResumeList onUnauthorized={() => {}} />)
    expect(await screen.findByText('Board CV')).toBeInTheDocument()
    expect(screen.getByText('Technical CV')).toBeInTheDocument()
  })

  it('marks resumes with unsynced local edits and shows a backlog note', async () => {
    savePending('b', {
      data: emptyStore(), locales: { primary: 'en', secondary: null },
      base_version: 1, dirty: true,
    })
    vi.spyOn(api, 'listResumes').mockResolvedValue([
      META({ id: 'a', name: 'Clean CV' }),
      META({ id: 'b', name: 'Dirty CV' }),
    ])
    render(<ResumeList onUnauthorized={() => {}} />)
    await screen.findByText('Dirty CV')
    // Exactly one card carries the unsynced dot…
    expect(screen.getAllByLabelText('unsynced')).toHaveLength(1)
    // …and the backlog note appears.
    expect(screen.getByText(/resume has unsynced changes/i)).toBeInTheDocument()
  })

  it('renames a resume inline via PATCH and shows the new name', async () => {
    vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Old Name' })])
    const patch = vi.spyOn(api, 'patchResume').mockResolvedValue(undefined)

    render(<ResumeList onUnauthorized={() => {}} />)
    await screen.findByText('Old Name')

    await userEvent.click(screen.getByRole('button', { name: /rename old name/i }))
    const input = screen.getByRole('textbox', { name: /resume name/i })
    await userEvent.clear(input)
    await userEvent.type(input, 'New Name{Enter}')

    await waitFor(() => expect(patch).toHaveBeenCalledWith('a', { name: 'New Name' }))
    expect(screen.getByText('New Name')).toBeInTheDocument()
  })

  it('does not PATCH when the name is unchanged or blank', async () => {
    vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Same' })])
    const patch = vi.spyOn(api, 'patchResume').mockResolvedValue(undefined)

    render(<ResumeList onUnauthorized={() => {}} />)
    await screen.findByText('Same')
    await userEvent.click(screen.getByRole('button', { name: /rename same/i }))
    // Commit without changing → no-op.
    await userEvent.type(screen.getByRole('textbox', { name: /resume name/i }), '{Enter}')
    expect(patch).not.toHaveBeenCalled()
  })

  it('falls back to the import screen when there are no resumes', async () => {
    vi.spyOn(api, 'listResumes').mockResolvedValue([])
    render(<ResumeList onUnauthorized={() => {}} />)
    // ImportScreen full-bleed renders the drop zone + brand title.
    expect(await screen.findByText(/drop your resume file here/i)).toBeInTheDocument()
    expect(screen.getByText('Cartavio Resume Studio')).toBeInTheDocument()
  })

  it('deletes a resume after confirmation and removes its card', async () => {
    vi.spyOn(api, 'listResumes').mockResolvedValue([
      META({ id: 'a', name: 'Keep Me' }),
      META({ id: 'b', name: 'Delete Me' }),
    ])
    const delSpy = vi.spyOn(api, 'deleteResume').mockResolvedValue(undefined)

    render(<ResumeList onUnauthorized={() => {}} />)
    await screen.findByText('Delete Me')

    const delButton = screen.getByRole('button', { name: /delete delete me/i })
    await userEvent.click(delButton)
    await resolveConfirm('confirm')

    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('b'))
    await waitFor(() => expect(screen.queryByText('Delete Me')).not.toBeInTheDocument())
    expect(screen.getByText('Keep Me')).toBeInTheDocument()
  })

  it('does not delete when the confirm is declined', async () => {
    vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Safe CV' })])
    const delSpy = vi.spyOn(api, 'deleteResume').mockResolvedValue(undefined)

    render(<ResumeList onUnauthorized={() => {}} />)
    await screen.findByText('Safe CV')
    await userEvent.click(screen.getByRole('button', { name: /delete safe cv/i }))
    await resolveConfirm('cancel')

    expect(delSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Safe CV')).toBeInTheDocument()
  })

  it('flags heavy resumes with a payload-weight note, leaves light ones unmarked', async () => {
    vi.spyOn(api, 'listResumes').mockResolvedValue([
      META({ id: 'light', name: 'Light CV' }),
      META({ id: 'heavy', name: 'Heavy CV' }),
    ])
    vi.spyOn(api, 'storageStats').mockResolvedValue({
      db_bytes: 5_000_000,
      resumes: [
        { id: 'light', name: 'Light CV', bytes: 40_000, image_bytes: 0, snapshot_count: 2, snapshot_bytes: 70_000 },
        { id: 'heavy', name: 'Heavy CV', bytes: 2_600_000, image_bytes: 2_000_000, snapshot_count: 5, snapshot_bytes: 90_000 },
      ],
    })
    render(<ResumeList onUnauthorized={() => {}} />)
    await screen.findByText('Heavy CV')
    // The heavy card gets the readout (risk level: ≥ 2.5 MB)…
    expect(await screen.findByText(/≈2\.6 MB \(2\.0 MB images\)/)).toBeInTheDocument()
    // …the light card gets none (exactly one weight note in the document).
    expect(screen.getAllByText(/≈/)).toHaveLength(1)
    // The footer shows the DB total.
    expect(screen.getByText(/DB 5\.0 MB/)).toBeInTheDocument()
  })

  describe('offline fallback', () => {
    const unreachable = () =>
      vi.spyOn(api, 'listResumes').mockRejectedValue(new Error('Failed to fetch'))

    it('lists the locally cached copies when the server cannot be reached', async () => {
      cache('a', 'Ada Lovelace')
      cache('b', 'Grace Hopper')
      unreachable()

      render(<ResumeList onUnauthorized={() => {}} />)

      expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
      // Labelled, not silently substituted for the server's list.
      expect(screen.getAllByText('Offline copy')).toHaveLength(2)
      expect(screen.getByText(/2 copies are stored in this browser/i)).toBeInTheDocument()
      // The generic failure message would be the wrong thing to read next to
      // a list of resumes the user CAN open.
      expect(screen.queryByText(/could not load your resumes/i)).not.toBeInTheDocument()
    })

    it('keeps the error message when there is nothing cached to fall back to', async () => {
      unreachable()
      render(<ResumeList onUnauthorized={() => {}} />)

      expect(await screen.findByText(/could not load your resumes/i)).toBeInTheDocument()
      expect(screen.queryByText('Offline copy')).not.toBeInTheDocument()
      // Not the empty-list import screen either: an unreachable server is not
      // the same fact as "you have no resumes".
      expect(screen.queryByText(/drop your resume file here/i)).not.toBeInTheDocument()
    })

    it('links each cached row by its readable address, which the resolver reads from the same cache', async () => {
      // The fixture resume carries makeResume's email — the cached row links
      // by the derived address (EditorResolver falls back to the same cache
      // offline, so the address still resolves with the server unreachable).
      cache('cached-id', 'Ada Lovelace')
      unreachable()

      render(<ResumeList onUnauthorized={() => {}} />)

      const link = await screen.findByRole('link', { name: /Ada Lovelace/ })
      expect(link).toHaveAttribute('href', '/r/test-example')
    })

    it('links a cached row with no email by its id', async () => {
      cache('no-mail-id', null)
      unreachable()

      render(<ResumeList onUnauthorized={() => {}} />)

      const link = await screen.findByRole('link', { name: /Untitled resume/ })
      expect(link).toHaveAttribute('href', '/r/no-mail-id')
    })

    it('says which cached copies hold unsynced edits', async () => {
      cache('clean', 'Clean Copy', false)
      cache('dirty', 'Dirty Copy', true)
      unreachable()

      render(<ResumeList onUnauthorized={() => {}} />)
      await screen.findByText('Dirty Copy')

      expect(screen.getByText(/^Unsynced changes ·/)).toBeInTheDocument()
      expect(screen.getByText(/^Cached .* ·/)).toBeInTheDocument()
    })

    it('names a cached copy that carries no profile rather than rendering a blank row', async () => {
      cache('nameless', null)
      unreachable()

      render(<ResumeList onUnauthorized={() => {}} />)
      expect(await screen.findByText('Untitled resume')).toBeInTheDocument()
      // Counting is the easy half; agreeing with the count is the half that
      // ships as "These is the copy".
      expect(screen.getByText(/One copy is stored in this browser/i)).toBeInTheDocument()
    })

    it('hides "Add resume" offline — the create is a POST that cannot succeed', async () => {
      cache('a', 'Ada Lovelace')
      unreachable()

      render(<ResumeList onUnauthorized={() => {}} />)
      await screen.findByText('Ada Lovelace')
      expect(screen.queryByRole('button', { name: /add resume/i })).not.toBeInTheDocument()
    })

    it('shows nothing offline-flavoured when the server answered, cache or no cache', async () => {
      cache('a', 'Ada Lovelace')
      vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Server Name' })])

      render(<ResumeList onUnauthorized={() => {}} />)
      await screen.findByText('Server Name')

      expect(screen.queryByText('Offline copy')).not.toBeInTheDocument()
      expect(screen.queryByText(/server is unreachable/i)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /add resume/i })).toBeInTheDocument()
    })

    it('routes an expired session to the parent instead of into the cache', async () => {
      // A 401 is not an offline condition: showing cached CVs to whoever is at
      // the keyboard is exactly what the logout wipe exists to prevent.
      cache('a', 'Ada Lovelace')
      const { UnauthorizedError } = await import('../../src/lib/api')
      vi.spyOn(api, 'listResumes').mockRejectedValue(new UnauthorizedError())
      const onUnauthorized = vi.fn()

      render(<ResumeList onUnauthorized={onUnauthorized} />)

      await waitFor(() => expect(onUnauthorized).toHaveBeenCalled())
      expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    })
  })

  describe('ownership', () => {
    const ME = (over: Partial<MeInfo> = {}): MeInfo => ({
      user_id: 'u9', name: 'Root', role: 'owner', service: false, mode: 'accounts', ...over,
    })
    const JANE: TeamUser = {
      id: 'u1', username: 'jane', display_name: 'Jane Doe', email: null,
      email_verified_at: null, role: 'member', created_at: '2026-01-01T00:00:00Z',
      last_login_at: null, disabled_at: null,
    }

    it('names the owner and offers the transfer control to an instance owner', async () => {
      vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Board CV', owner_id: 'u1' })])
      vi.spyOn(api, 'me').mockResolvedValue(ME())
      vi.spyOn(api, 'listUsers').mockResolvedValue([JANE])

      render(<ResumeList onUnauthorized={() => {}} />)

      expect(await screen.findByText(/Owned by Jane Doe/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /change owner of board cv/i })).toBeInTheDocument()
    })

    it('flags an unowned resume rather than leaving the owner blank', async () => {
      vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Orphan CV', owner_id: null })])
      vi.spyOn(api, 'me').mockResolvedValue(ME())
      vi.spyOn(api, 'listUsers').mockResolvedValue([JANE])

      render(<ResumeList onUnauthorized={() => {}} />)
      expect(await screen.findByText(/Unowned/)).toBeInTheDocument()
    })

    it('shows no ownership surface to a member, and never asks for the user list', async () => {
      vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Board CV', owner_id: 'u1' })])
      vi.spyOn(api, 'me').mockResolvedValue(ME({ user_id: 'u1', role: 'member' }))
      const users = vi.spyOn(api, 'listUsers').mockResolvedValue([JANE])

      render(<ResumeList onUnauthorized={() => {}} />)
      await screen.findByText('Board CV')

      // /api/users 403s for a member; asking would be a guaranteed failure.
      expect(users).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /change owner/i })).not.toBeInTheDocument()
      expect(screen.queryByText(/Owned by/)).not.toBeInTheDocument()
    })

    it('shows no ownership surface where there are no accounts (desktop)', async () => {
      vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Board CV' })])
      vi.spyOn(api, 'me').mockResolvedValue(ME({ user_id: null, service: true, mode: 'open' }))
      const users = vi.spyOn(api, 'listUsers').mockResolvedValue([JANE])

      render(<ResumeList onUnauthorized={() => {}} />)
      await screen.findByText('Board CV')

      expect(users).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /change owner/i })).not.toBeInTheDocument()
    })

    it('re-labels the row after a handover, without a reload', async () => {
      vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Board CV', owner_id: 'u1' })])
      vi.spyOn(api, 'me').mockResolvedValue(ME())
      vi.spyOn(api, 'listUsers').mockResolvedValue([
        JANE, { ...JANE, id: 'u2', username: 'omar', display_name: 'Omar Ali' },
      ])
      vi.spyOn(api, 'setResumeOwner').mockResolvedValue(undefined)

      render(<ResumeList onUnauthorized={() => {}} />)
      await userEvent.click(await screen.findByRole('button', { name: /change owner of board cv/i }))
      await userEvent.selectOptions(await screen.findByLabelText('New owner'), 'u2')
      await userEvent.click(screen.getByRole('button', { name: /^change owner$/i }))
      await resolveConfirm('confirm')

      expect(await screen.findByText(/Owned by Omar Ali/)).toBeInTheDocument()
    })
  })

  it('surfaces an auth failure to the parent', async () => {
    const { UnauthorizedError } = await import('../../src/lib/api')
    vi.spyOn(api, 'listResumes').mockRejectedValue(new UnauthorizedError())
    const onUnauthorized = vi.fn()
    render(<ResumeList onUnauthorized={onUnauthorized} />)
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled())
  })
})
