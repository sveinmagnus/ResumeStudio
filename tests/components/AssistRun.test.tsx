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
import { resetLlmAvailability } from '../../src/lib/llmClient'
import { api } from '../../src/lib/api'

const LOCAL = { configured: true, provider: 'ollama', model: 'llama3.2:3b', local: true }
const REMOTE = { configured: true, provider: 'openai', model: 'gpt-4o-mini', local: false }
const OFF = { configured: false, provider: '', model: '', local: false }

function backend(status: typeof LOCAL | typeof OFF) {
  resetLlmAvailability()
  resetAssistConsent()
  vi.spyOn(api, 'llmStatus').mockResolvedValue(status)
}

/** A caller WITH a manual path, rendering its steps as children (tailor modal). */
function setup(over: Partial<Parameters<typeof AssistRun>[0]> = {}) {
  const onResult = vi.fn()
  render(
    <AssistRun buildPrompt={() => 'PROMPT'} onResult={onResult} hasManualPath {...over}>
      <button>Copy prompt for your LLM</button>
    </AssistRun>,
  )
  return { onResult }
}

/**
 * A caller with NO manual path — the in-editor panels (key points, writing
 * coach, skill suggest, anon check, page fit) offer no copy-prompt steps at all.
 */
function setupNoManual(over: Partial<Parameters<typeof AssistRun>[0]> = {}) {
  const onResult = vi.fn()
  render(<AssistRun buildPrompt={() => 'PROMPT'} onResult={onResult} hasManualPath={false} {...over} />)
  return { onResult }
}

describe('<AssistRun>', () => {
  beforeEach(() => { vi.restoreAllMocks(); resetAssistConsent() })

  describe('with a local model', () => {
    beforeEach(() => backend(LOCAL))

    /**
     * The model name is deliberately NOT on the button: it's in the provenance
     * line beside it, where it's only worth reading if you care. Repeating it on
     * every button made a project card read like a hardware inventory.
     */
    it('offers a clean Run label and promises locality', async () => {
      setup()
      const btn = await screen.findByRole('button', { name: /^run with my ai$/i })
      expect(btn).toBeInTheDocument()
      expect(btn.textContent).not.toMatch(/llama/i)
      expect(screen.getByText(/does not leave/i)).toBeInTheDocument()
      // …and the model IS named, once, in the line beside it.
      expect(screen.getByText(/llama3\.2:3b/)).toBeInTheDocument()
    })

    it('runs the prompt and hands the raw reply to the caller', async () => {
      const complete = vi.spyOn(api, 'llmComplete').mockResolvedValue('{"ok":1}')
      const { onResult } = setup()
      await userEvent.click(await screen.findByRole('button', { name: /run with my ai/i }))
      await waitFor(() => expect(onResult).toHaveBeenCalledWith('{"ok":1}'))
      // Third arg is the advanced flag — false unless the caller asks for it.
      expect(complete).toHaveBeenCalledWith('PROMPT', undefined, false)
    })

    /**
     * The advanced flag is what makes the server grant the high-end budget (and
     * what makes it 403 when the model isn't declared high-end), so a caller
     * setting it must actually reach the request.
     */
    it('forwards the advanced flag to the server', async () => {
      const complete = vi.spyOn(api, 'llmComplete').mockResolvedValue('{}')
      setup({ advanced: true })
      await userEvent.click(await screen.findByRole('button', { name: /run with my ai/i }))
      await waitFor(() => expect(complete).toHaveBeenCalledWith('PROMPT', undefined, true))
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

    it('offers the manual path in the copy when the caller has one', async () => {
      setup()
      expect(await screen.findByText(/use the manual path/i)).toBeInTheDocument()
    })

    it('does not name a manual path the caller never rendered', async () => {
      // An in-editor panel has no copy-prompt steps, so "use the manual path"
      // would send the user looking for something that is not on screen.
      setupNoManual()
      expect(await screen.findByText(/no ai model is configured/i)).toBeInTheDocument()
      expect(screen.queryByText(/manual/i)).not.toBeInTheDocument()
    })

    it('still names the manual path when the caller renders its own steps', async () => {
      // The AI-import and bulk-add modals lay their copy/paste steps out as
      // numbered stages instead of passing them as children. Inferring "has a
      // manual path" from `children` denied those two a path that was on
      // screen — hence the explicit prop. Pin it.
      const onResult = vi.fn()
      render(
        <>
          <AssistRun buildPrompt={() => 'PROMPT'} onResult={onResult} hasManualPath />
          <button>Copy instructions</button>
        </>,
      )
      expect(await screen.findByText(/use the manual path/i)).toBeInTheDocument()
    })
  })

  describe('with no manual path (in-editor panels)', () => {
    it('still promises locality for a local model', async () => {
      backend(LOCAL)
      setupNoManual()
      expect(await screen.findByText(/does not leave/i)).toBeInTheDocument()
      // No children → no disclosure to reveal.
      expect(screen.queryByRole('button', { name: /do it manually/i })).not.toBeInTheDocument()
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
