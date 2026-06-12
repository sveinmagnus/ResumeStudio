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
})
