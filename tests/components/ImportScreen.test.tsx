/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportScreen } from '../../src/components/ImportScreen'
import { AI_IMPORT_SCHEMA } from '../../src/lib/aiImport'
import { resetStore } from '../helpers/store-reset'

describe('<ImportScreen>', () => {
  beforeEach(() => resetStore())

  it('renders the brand title and the drop zone in full-bleed mode', () => {
    render(<ImportScreen onStartFresh={() => {}} onImported={() => {}} />)
    expect(screen.getByText('Cartavio Resume Studio')).toBeInTheDocument()
    expect(screen.getByText(/drop your resume file here/i)).toBeInTheDocument()
  })

  it('hides the brand block in compact mode', () => {
    render(<ImportScreen compact onStartFresh={() => {}} onImported={() => {}} />)
    expect(screen.queryByText('Cartavio Resume Studio')).not.toBeInTheDocument()
    expect(screen.getByText(/drop your resume file here/i)).toBeInTheDocument()
  })

  it('the drop zone is keyboard-operable and opens the file browser', async () => {
    render(<ImportScreen onStartFresh={() => {}} onImported={() => {}} />)
    const zone = screen.getByRole('button', { name: /choose a resume file/i })
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    zone.focus()
    await userEvent.keyboard('{Enter}')
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('"Start with an empty resume" calls onStartFresh', async () => {
    const onStartFresh = vi.fn()
    render(<ImportScreen onStartFresh={onStartFresh} onImported={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /start with an empty resume/i }))
    expect(onStartFresh).toHaveBeenCalledTimes(1)
  })

  it('"Start from a PDF/Word file with AI" opens the AI import modal', async () => {
    render(<ImportScreen onStartFresh={() => {}} onImported={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /start from a pdf\/word file with ai/i }))
    // The modal's dialog + title appear.
    expect(screen.getByRole('dialog', { name: /ai-assisted import/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download template/i })).toBeInTheDocument()
  })

  it('routes an AI-import JSON file dropped on the main zone to importFromAIDraft', async () => {
    const onImported = vi.fn()
    const { container } = render(<ImportScreen onStartFresh={() => {}} onImported={onImported} />)
    const file = new File(
      [JSON.stringify({
        $schema: AI_IMPORT_SCHEMA,
        profile: { full_name: 'Drag Drop' },
        projects: [{ customer: 'Acme', skills: ['Go'] }],
      })],
      'cv.json',
      { type: 'application/json' },
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, file)
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
    const [store, name] = onImported.mock.calls[0]
    expect(name).toBe('Drag Drop — CV')
    expect(store.projects).toHaveLength(1)
    expect(store.skills).toHaveLength(1)
  })

  it('surfaces a field-pathed error for a malformed backup instead of importing it', async () => {
    const onImported = vi.fn()
    const { container } = render(<ImportScreen onStartFresh={() => {}} onImported={onImported} />)
    // A backup envelope whose projects array holds an id-less item.
    const file = new File(
      [JSON.stringify({
        $schema: 'resumestudio/v1', format_version: 1, exported_at: '2026-01-01T00:00:00Z',
        profile: null, registries: { skills: [], roles: [] },
        sections: { projects: [{ customer: {} }] },
      })],
      'backup.json',
      { type: 'application/json' },
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, file)
    // The error names the offending field; nothing was imported.
    expect(await screen.findByText(/sections\.projects\[0\]\.id/)).toBeInTheDocument()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('restores a whole-store (resumestudio-store) backup with content intact, not an empty resume', async () => {
    const onImported = vi.fn()
    const { container } = render(<ImportScreen onStartFresh={() => {}} onImported={onImported} />)
    // The desktop cloud-sync file: every resume in one envelope, each entry's
    // `data` a FLAT ResumeStore. Regression — this used to fall through to the
    // CVpartner importer and yield an empty resume.
    const file = new File(
      [JSON.stringify({
        $schema: 'resumestudio-store/v1', format_version: 1,
        exported_at: '2026-07-22T15:33:04.502Z', generator: 'resume-studio',
        resumes: [{
          id: 'r1', name: 'Ada — CV', saved_at: '2026-07-22T00:00:00Z',
          data: {
            shape_version: 13,
            resume: { id: 'p1', full_name: 'Ada Lovelace' },
            projects: [{ id: 'proj1', customer: { en: 'Acme' } }],
            skills: [{ id: 's1', name: 'Analytical Engines' }],
          },
        }],
      })],
      'resume-studio-backup.json',
      { type: 'application/json' },
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, file)
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
    const [store, name] = onImported.mock.calls[0]
    expect(name).toBe('Ada — CV')
    expect(store.projects).toHaveLength(1)
    expect(store.skills).toHaveLength(1)
    // Missing collections were backfilled so nothing downstream iterates undefined.
    expect(store.cover_letters).toEqual([])
    expect(store.industries).toEqual([])
  })

  it('rejects a non-object JSON file with a clear message', async () => {
    const onImported = vi.fn()
    const { container } = render(<ImportScreen onStartFresh={() => {}} onImported={onImported} />)
    const file = new File(['[1,2,3]'], 'weird.json', { type: 'application/json' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, file)
    expect(await screen.findByText(/not a recognised resume format/i)).toBeInTheDocument()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('routes a CVpartner export via its own detector (not as a fallback)', async () => {
    const onImported = vi.fn()
    const { container } = render(<ImportScreen onStartFresh={() => {}} onImported={onImported} />)
    const file = new File(
      [JSON.stringify({
        navn: 'Sigrid Test',
        project_experiences: [{ _id: 'p1', customer: { no: 'Acme' } }],
      })],
      'cvpartner.json',
      { type: 'application/json' },
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, file)
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
    const [store] = onImported.mock.calls[0]
    expect(store.projects).toHaveLength(1)
  })

  it('DEFAULTS an unrecognised-but-ours raw ResumeStore to the Resume Studio path', async () => {
    // No backup envelope, no third-party signature — an older self-export dumped
    // as the raw internal store. Must import with content intact, not error and
    // not fall into a foreign importer.
    const onImported = vi.fn()
    const { container } = render(<ImportScreen onStartFresh={() => {}} onImported={onImported} />)
    const file = new File(
      [JSON.stringify({
        resume: { id: 'p1', full_name: 'Grace Hopper' },
        projects: [{ id: 'proj1', customer: { en: 'Navy' } }],
        skills: [{ id: 's1', name: 'COBOL' }],
        work_experiences: [], views: [],
      })],
      'store.json',
      { type: 'application/json' },
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, file)
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
    const [store, name] = onImported.mock.calls[0]
    expect(name).toBe('Grace Hopper — CV')
    expect(store.projects).toHaveLength(1)
    expect(store.cover_letters).toEqual([]) // backfilled by normalizeStoreShape
  })
})
