/**
 * @vitest-environment jsdom
 *
 * AssistRun is where the app's two AI promises are made — where your content
 * goes, and that the manual path is always yours. These tests pin both.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AssistRun, resetAssistConsent } from '../../src/components/ui/AssistRun'
import { resetSummarizeAvailability } from '../../src/lib/summarizeClient'
import { api } from '../../src/lib/api'

const LOCAL = { configured: true, provider: 'ollama', model: 'llama3.2:3b', local: true }
const REMOTE = { configured: true, provider: 'openai', model: 'gpt-4o-mini', local: false }
const OFF = { configured: false, provider: '', model: '', local: false }

function backend(status: typeof LOCAL | typeof OFF) {
  resetSummarizeAvailability()
  resetAssistConsent()
  vi.spyOn(api, 'summarizeStatus').mockResolvedValue(status)
}

function setup(over: Partial<Parameters<typeof AssistRun>[0]> = {}) {
  const onResult = vi.fn()
  render(
    <AssistRun buildPrompt={() => 'PROMPT'} onResult={onResult} {...over}>
      <button>Copy prompt for your LLM</button>
    </AssistRun>,
  )
  return { onResult }
}

describe('<AssistRun>', () => {
  beforeEach(() => { vi.restoreAllMocks(); resetAssistConsent() })

  describe('with a local model', () => {
    beforeEach(() => backend(LOCAL))

    it('offers Run labelled with the model and promises locality', async () => {
      setup()
      expect(await screen.findByRole('button', { name: /run with my ai \(llama3\.2:3b\)/i })).toBeInTheDocument()
      expect(screen.getByText(/does not leave/i)).toBeInTheDocument()
    })

    it('runs the prompt and hands the raw reply to the caller', async () => {
      const complete = vi.spyOn(api, 'llmComplete').mockResolvedValue('{"ok":1}')
      const { onResult } = setup()
      await userEvent.click(await screen.findByRole('button', { name: /run with my ai/i }))
      await waitFor(() => expect(onResult).toHaveBeenCalledWith('{"ok":1}'))
      expect(complete).toHaveBeenCalledWith('PROMPT', undefined)
    })

    it('never confirms for a local model, even for a whole-CV task', async () => {
      vi.spyOn(api, 'llmComplete').mockResolvedValue('{}')
      const { onResult } = setup({ wholeCv: true })
      await userEvent.click(await screen.findByRole('button', { name: /run with my ai/i }))
      // Straight through — nothing left the machine, so nothing to ask about.
      await waitFor(() => expect(onResult).toHaveBeenCalled())
    })

    it('surfaces a backend failure instead of failing silently', async () => {
      vi.spyOn(api, 'llmComplete').mockRejectedValue(new Error('model is unreachable'))
      const { onResult } = setup()
      await userEvent.click(await screen.findByRole('button', { name: /run with my ai/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/unreachable/i)
      expect(onResult).not.toHaveBeenCalled()
    })

    it('keeps the manual path available behind a disclosure', async () => {
      setup()
      await screen.findByRole('button', { name: /run with my ai/i })
      // Hidden until asked for — but always reachable.
      expect(screen.queryByRole('button', { name: /copy prompt/i })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /do it manually/i }))
      expect(screen.getByRole('button', { name: /copy prompt/i })).toBeInTheDocument()
    })
  })

  describe('with a remote model', () => {
    beforeEach(() => backend(REMOTE))

    it('names the destination and never claims locality', async () => {
      setup()
      await screen.findByRole('button', { name: /run with my ai/i })
      expect(screen.getByText(/over the internet/i)).toBeInTheDocument()
      expect(screen.queryByText(/does not leave/i)).not.toBeInTheDocument()
    })

    it('confirms before the first whole-CV send, and aborts if declined', async () => {
      const complete = vi.spyOn(api, 'llmComplete').mockResolvedValue('{}')
      setup({ wholeCv: true })
      await userEvent.click(await screen.findByRole('button', { name: /run with my ai/i }))

      expect(await screen.findByText(/sends your cv content to openai/i)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
      expect(complete).not.toHaveBeenCalled()
    })

    it('asks only once per session', async () => {
      const complete = vi.spyOn(api, 'llmComplete').mockResolvedValue('{}')
      setup({ wholeCv: true })
      const run = await screen.findByRole('button', { name: /run with my ai/i })

      await userEvent.click(run)
      await userEvent.click(await screen.findByRole('button', { name: /^send$/i }))
      await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))

      // Second run: no dialog, straight through.
      await userEvent.click(run)
      await waitFor(() => expect(complete).toHaveBeenCalledTimes(2))
      expect(screen.queryByText(/sends your cv content/i)).not.toBeInTheDocument()
    })

    it('does not confirm for a per-item (non whole-CV) task', async () => {
      const complete = vi.spyOn(api, 'llmComplete').mockResolvedValue('{}')
      setup({ wholeCv: false })
      await userEvent.click(await screen.findByRole('button', { name: /run with my ai/i }))
      await waitFor(() => expect(complete).toHaveBeenCalled())
    })
  })

  describe('with no model configured', () => {
    beforeEach(() => backend(OFF))

    it('offers no Run at all and shows the manual path outright', async () => {
      setup()
      expect(await screen.findByRole('button', { name: /copy prompt/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /run with my ai/i })).not.toBeInTheDocument()
      // No disclosure to open — manual IS the path.
      expect(screen.queryByRole('button', { name: /do it manually/i })).not.toBeInTheDocument()
    })

    it('points at Settings rather than leaving a dead end', async () => {
      setup()
      expect(await screen.findByText(/no ai model is configured/i)).toBeInTheDocument()
    })
  })

  describe('size steering', () => {
    it('warns on a long prompt but leaves Run enabled', async () => {
      backend(LOCAL)
      render(
        <AssistRun buildPrompt={() => 'x'.repeat(200_000)} onResult={vi.fn()}>
          <button>Copy prompt for your LLM</button>
        </AssistRun>,
      )
      expect(await screen.findByText(/truncate or garble/i)).toBeInTheDocument()
      // Informs, never decides — the user asked to keep the choice.
      expect(screen.getByRole('button', { name: /run with my ai/i })).toBeEnabled()
    })
  })
})
