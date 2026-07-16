import { Router, type Request, type Response } from 'express'
import { summarize, summarizeInfo, resolveConfig, SummarizeError, MAX_SUMMARIZE_CHARS } from '../summarize.js'
import { listOllamaModels } from '../summarizeDocker.js'

const router = Router()

/**
 * GET /api/summarize/status — is an LLM backend configured, and WHERE does it
 * run? The `local`/`provider`/`model` fields let the UI state honestly whether
 * content leaves the machine before the user clicks Run. No secrets here — the
 * key itself is never returned (see settings.ts `toView`).
 */
router.get('/status', (_req: Request, res: Response): void => {
  res.json(summarizeInfo())
})

/**
 * GET /api/summarize/models — the models the configured Ollama has pulled, so
 * the settings model field can offer real options next to the curated catalog.
 *
 * The URL comes from the SERVER's config, never the request: this makes an
 * outbound fetch, so accepting a client-supplied host would be SSRF. Only
 * meaningful for the ollama provider — everything else reports an empty list
 * (OpenAI/compat endpoints have no equivalent we can enumerate cheaply), and a
 * missing/stopped instance is an empty list too, never an error.
 */
router.get('/models', (_req: Request, res: Response): void => {
  void (async () => {
    const c = resolveConfig()
    if (c.provider !== 'ollama') { res.json({ models: [] }); return }
    res.json({ models: await listOllamaModels(c.ollama.url) })
  })()
})

/**
 * POST /api/summarize — condense a long description into one line.
 * Body: { text, locale } (locale = app locale code for the output language).
 * Returns: { summary }.
 */
router.post('/', (req: Request, res: Response): void => {
  void (async () => {
    const body = req.body as Record<string, unknown>
    const text = body?.text
    const locale = body?.locale
    if (typeof text !== 'string' || typeof locale !== 'string') {
      res.status(400).json({ error: 'text and locale are required strings' })
      return
    }
    const trimmed = text.trim()
    if (!trimmed) { res.status(400).json({ error: 'text is empty' }); return }
    if (text.length > MAX_SUMMARIZE_CHARS) {
      res.status(413).json({ error: `text exceeds ${MAX_SUMMARIZE_CHARS} characters` })
      return
    }
    if (locale.length > 10) { res.status(400).json({ error: 'invalid locale code' }); return }

    try {
      const summary = await summarize(trimmed, locale)
      res.json({ summary })
    } catch (err) {
      if (err instanceof SummarizeError) { res.status(err.status).json({ error: err.message }); return }
      res.status(500).json({ error: 'Summarize failed' })
    }
  })()
})

export default router
