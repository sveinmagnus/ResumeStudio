/**
 * @vitest-environment jsdom
 *
 * The writing coach's contract is "suggest, never save". These tests pin that
 * a rewrite is shown next to the original and only written on an explicit
 * click — the comparison is what lets the user catch an invented fact.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WritingCoachPanel } from '../../src/components/ui/WritingCoachPanel'
import { resetSummarizeAvailability } from '../../src/lib/summarizeClient'
import { resetAssistConsent } from '../../src/components/ui/AssistRun'
import { api } from '../../src/lib/api'

const LOCAL = { configured: true, provider: 'ollama', model: 'llama3.2:3b', local: true }
const OFF = { configured: false, provider: '', model: '', local: false }

function backend(status: typeof LOCAL | typeof OFF) {
  resetSummarizeAvailability()
  resetAssistConsent()
  vi.spyOn(api, 'summarizeStatus').mockResolvedValue(status)
}

const REPLY = JSON.stringify({
  $schema: 'resumestudio-rewrite/v1',
  rewrite: 'Led the migration of 12 services to Kubernetes.',
  asks: ['How large was the team?'],
})

function setup(source = { en: '<p>Was responsible for the migration of 12 services</p>' }) {
  const onApply = vi.fn()
  render(<WritingCoachPanel source={source} locale="en" onApply={onApply} />)
  return { onApply }
}

describe('<WritingCoachPanel>', () => {
  beforeEach(() => { vi.restoreAllMocks(); resetAssistConsent() })

  it('offers the coach when a model is configured', async () => {
    backend(LOCAL)
    setup()
    expect(await screen.findByRole('button', { name: /strengthen this description/i })).toBeInTheDocument()
  })

  it('disables the run when there is nothing written yet', async () => {
    backend(LOCAL)
    setup({ en: '' })
    expect(await screen.findByRole('button', { name: /strengthen this description/i })).toBeDisabled()
    expect(screen.getByText(/nothing to work on yet/i)).toBeInTheDocument()
  })

  it('shows the suggestion beside the original and does not write until asked', async () => {
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    const { onApply } = setup()

    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))

    // Both texts are on screen — the comparison is the review.
    expect(await screen.findByText('Led the migration of 12 services to Kubernetes.')).toBeInTheDocument()
    expect(screen.getByText(/Was responsible for the migration of 12 services/)).toBeInTheDocument()
    // Nothing written yet.
    expect(onApply).not.toHaveBeenCalled()
  })

  it('surfaces the asks as questions for the user, not as content', async () => {
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    expect(await screen.findByText('How large was the team?')).toBeInTheDocument()
    expect(screen.getByText(/only you can answer/i)).toBeInTheDocument()
  })

  it('applies the rewrite only on confirm', async () => {
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    const { onApply } = setup()

    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    await userEvent.click(await screen.findByRole('button', { name: /use the suggestion/i }))

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(onApply.mock.calls[0][0]).toContain('Led the migration of 12 services to Kubernetes.')
  })

  it('turns a multi-paragraph rewrite into paragraphs', async () => {
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(
      JSON.stringify({ rewrite: 'First para.\n\nSecond para.', asks: [] }),
    )
    const { onApply } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    await userEvent.click(await screen.findByRole('button', { name: /use the suggestion/i }))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect(onApply.mock.calls[0][0]).toBe('<p>First para.</p><p>Second para.</p>')
  })

  it('escapes markup in the reply rather than writing it into the field', async () => {
    // The reply is untrusted text landing in a rich-text field that the export
    // pipeline re-renders — it must arrive escaped, not as live markup.
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(
      JSON.stringify({ rewrite: 'Led <img src=x onerror=alert(1)> the work', asks: [] }),
    )
    const { onApply } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    await userEvent.click(await screen.findByRole('button', { name: /use the suggestion/i }))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect(onApply.mock.calls[0][0]).not.toContain('<img')
    expect(onApply.mock.calls[0][0]).toContain('&lt;img')
  })

  it('discards without writing', async () => {
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    const { onApply } = setup()

    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    await userEvent.click(await screen.findByRole('button', { name: /discard/i }))

    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByText('Led the migration of 12 services to Kubernetes.')).not.toBeInTheDocument()
  })

  it('warns that applying replaces existing formatting', async () => {
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    setup({ en: '<ul><li>Migrated 12 services</li></ul>' })
    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    expect(await screen.findByText(/replaces it with plain paragraphs/i)).toBeInTheDocument()
  })

  it('reports an unreadable reply instead of writing garbage', async () => {
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue('I cannot help with that.')
    const { onApply } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('offers no Run at all when no model is configured', async () => {
    backend(OFF)
    setup()
    await waitFor(() => expect(screen.getByText(/no ai model is configured/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /strengthen this description/i })).not.toBeInTheDocument()
  })
})
