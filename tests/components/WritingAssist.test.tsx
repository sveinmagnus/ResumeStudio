/**
 * @vitest-environment jsdom
 *
 * The writing assist's contract is "suggest, never save". These tests pin that
 * a rewrite is shown next to the original and only written on an explicit
 * click — the comparison is what lets the user catch an invented fact — plus
 * the two honesty rules added after real use: the prompt carries the entry's
 * structured fields (so the model can't ask for a date that has its own
 * field), and a verbatim rewrite is presented as "already reads well" rather
 * than as a change to review.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WritingAssist } from '../../src/components/ui/WritingAssist'
import { resetLlmAvailability } from '../../src/lib/llmClient'
import { resetAssistConsent } from '../../src/components/ui/AssistRun'
import { api } from '../../src/lib/api'
import { useStore } from '../../src/store/useStore'
import { useAdvisors } from '../../src/store/useAdvisors'
import { resetStore } from '../helpers/store-reset'
import { makeCourse } from '../fixtures'

const LOCAL = { configured: true, provider: 'ollama', model: 'llama3.2:3b', local: true, highEnd: false }
const OFF = { configured: false, provider: '', model: '', local: false, highEnd: false }

function backend(status: typeof LOCAL | typeof OFF) {
  resetLlmAvailability()
  resetAssistConsent()
  vi.spyOn(api, 'llmStatus').mockResolvedValue(status)
}

const REPLY = JSON.stringify({
  $schema: 'resumestudio-rewrite/v1',
  rewrite: 'Led the migration of 12 services to Kubernetes.',
  asks: ['How large was the team?'],
})

const SOURCE = { en: '<p>Was responsible for the migration of 12 services</p>' }

function setup(source: Record<string, string> = SOURCE) {
  const onApply = vi.fn()
  const course = makeCourse({
    name: { en: 'Project management' },
    program: { en: 'Metier Academy' },
    description: source,
  })
  const panel = () => (
    <WritingAssist section="courses" item={course} source={source} locale="en" onApply={onApply} />
  )
  const { unmount } = render(panel())
  // Unmount and mount again — what clicking to another item does, since
  // EditorCard renders its body only while the card is expanded.
  const revisit = () => { unmount(); render(panel()) }
  return { onApply, revisit }
}

describe('<WritingAssist>', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetAssistConsent()
    resetStore()
    localStorage.clear()
    useAdvisors.setState({ runs: {}, reveal: null })
    useStore.setState({ currentResumeId: 'resume-1' })
  })

  it('offers Strengthen when a model is configured and there is prose', async () => {
    backend(LOCAL)
    setup()
    expect(await screen.findByRole('button', { name: /strengthen this description/i })).toBeInTheDocument()
  })

  it('offers Draft instead when the field is empty but the entry has identity', async () => {
    backend(LOCAL)
    setup({ en: '' })
    expect(await screen.findByRole('button', { name: /draft this description/i })).toBeInTheDocument()
  })

  it("sends the entry's own fields with the prompt, so the model knows what is already shown", async () => {
    // The reported failure: shown only the description, the model asked "when
    // was the course completed?" — a question whose answer has its own field.
    backend(LOCAL)
    const complete = vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    await screen.findByText('Led the migration of 12 services to Kubernetes.')
    const prompt = complete.mock.calls[0][0]
    expect(prompt).toContain('Course: Project management')
    expect(prompt).toContain('Programme: Metier Academy')
    expect(prompt).toMatch(/NEVER ask for dates/i)
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

  /**
   * The reported bug: start an assist, click to another item, and the spinner
   * is gone with no way to tell whether a reply is still coming. The card's
   * body is unmounted on that click, so the run has to belong to the store.
   */
  it('is still working when you leave the item and come back', async () => {
    backend(LOCAL)
    let settle: (reply: string) => void = () => {}
    vi.spyOn(api, 'llmComplete').mockReturnValue(new Promise<string>((res) => { settle = res }))
    const { revisit } = setup()

    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    expect(await screen.findByRole('button', { name: /working/i })).toBeInTheDocument()

    revisit()
    expect(await screen.findByRole('button', { name: /working/i })).toBeInTheDocument()

    // And the reply still lands, in the panel that was never mounted for it.
    settle(REPLY)
    expect(await screen.findByText('Led the migration of 12 services to Kubernetes.')).toBeInTheDocument()
  })

  it('still shows a finished suggestion after you leave and come back', async () => {
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    const { onApply, revisit } = setup()

    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    await screen.findByText('Led the migration of 12 services to Kubernetes.')

    revisit()
    expect(await screen.findByText('Led the migration of 12 services to Kubernetes.')).toBeInTheDocument()
    expect(screen.getByText('How large was the team?')).toBeInTheDocument()
    // Still un-applied: only an explicit click writes.
    expect(onApply).not.toHaveBeenCalled()

    // …and it applies from the second mount just as it would from the first.
    await userEvent.click(screen.getByRole('button', { name: /use the suggestion/i }))
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
  })

  it('is gone for good once accepted or discarded', async () => {
    // The other half of the contract: it persists until the user acts, and
    // then it does NOT come back on the next visit.
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    const { revisit } = setup()

    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    await userEvent.click(await screen.findByRole('button', { name: /discard/i }))

    revisit()
    await screen.findByRole('button', { name: /strengthen this description/i })
    expect(screen.queryByText('Led the migration of 12 services to Kubernetes.')).not.toBeInTheDocument()
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

  it('presents a verbatim rewrite as "already reads well", with nothing to apply', async () => {
    // A model with nothing to improve used to reshuffle words to have something
    // to show; the prompt now names "return it unchanged" as the honest answer,
    // and the UI must treat that as a verdict rather than a change.
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(
      JSON.stringify({ rewrite: 'Was responsible for the migration of 12 services', asks: ['How large was the team?'] }),
    )
    const { onApply } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))

    expect(await screen.findByText(/already reads well/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use the suggestion/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/yours now/i)).not.toBeInTheDocument()
    // The asks still show — "nothing to tighten" and "facts are missing" are
    // independent answers.
    expect(screen.getByText('How large was the team?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onApply).not.toHaveBeenCalled()
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

  it('warns about lost formatting only when there is formatting to lose', async () => {
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    setup({ en: '<ul><li>Migrated 12 services</li></ul>' })
    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    expect(await screen.findByText(/replaces it with plain paragraphs/i)).toBeInTheDocument()
  })

  it('does not warn for plain paragraphs — they survive the round trip', async () => {
    // Every rich-editor value is <p>-wrapped, so warning on <p> made the
    // notice near-unconditional and therefore ignored.
    backend(LOCAL)
    vi.spyOn(api, 'llmComplete').mockResolvedValue(REPLY)
    setup({ en: '<p>One paragraph</p><p>Another paragraph</p>' })
    await userEvent.click(await screen.findByRole('button', { name: /strengthen this description/i }))
    await screen.findByText('Led the migration of 12 services to Kubernetes.')
    expect(screen.queryByText(/replaces it with plain paragraphs/i)).not.toBeInTheDocument()
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
    expect(await screen.findByText(/no ai model is configured/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /strengthen this description/i })).not.toBeInTheDocument()
  })
})
