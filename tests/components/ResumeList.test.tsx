/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResumeList } from '../../src/components/ResumeList'
import { api, type ResumeMeta } from '../../src/lib/api'
import { savePending } from '../../src/lib/localCache'
import { resetStore } from '../helpers/store-reset'
import { emptyStore } from '../fixtures'

const META = (over: Partial<ResumeMeta> = {}): ResumeMeta => ({
  id: 'r1', name: 'My CV', primary_locale: 'en', secondary_locale: null,
  saved_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z', ...over,
})

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
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<ResumeList onUnauthorized={() => {}} />)
    await screen.findByText('Delete Me')

    const delButton = screen.getByRole('button', { name: /delete delete me/i })
    await userEvent.click(delButton)

    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('b'))
    await waitFor(() => expect(screen.queryByText('Delete Me')).not.toBeInTheDocument())
    expect(screen.getByText('Keep Me')).toBeInTheDocument()
  })

  it('does not delete when the confirm is declined', async () => {
    vi.spyOn(api, 'listResumes').mockResolvedValue([META({ id: 'a', name: 'Safe CV' })])
    const delSpy = vi.spyOn(api, 'deleteResume').mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<ResumeList onUnauthorized={() => {}} />)
    await screen.findByText('Safe CV')
    await userEvent.click(screen.getByRole('button', { name: /delete safe cv/i }))

    expect(delSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Safe CV')).toBeInTheDocument()
  })

  it('surfaces an auth failure to the parent', async () => {
    const { UnauthorizedError } = await import('../../src/lib/api')
    vi.spyOn(api, 'listResumes').mockRejectedValue(new UnauthorizedError())
    const onUnauthorized = vi.fn()
    render(<ResumeList onUnauthorized={onUnauthorized} />)
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled())
  })
})
