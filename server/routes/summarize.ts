import { Router, type Request, type Response } from 'express'
import { LlmError } from '../llm.js'
import { summarize, MAX_SUMMARIZE_CHARS } from '../summarize.js'

/**
 * The Summarize FEATURE endpoint. Backend status and the model list moved to
 * /api/llm when the config stopped being named after this one feature — what's
 * left here is the feature itself.
 */
const router = Router()

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
      if (err instanceof LlmError) { res.status(err.status).json({ error: err.message }); return }
      res.status(500).json({ error: 'Summarize failed' })
    }
  })()
})

export default router
