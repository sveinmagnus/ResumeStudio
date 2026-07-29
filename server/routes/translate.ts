import { Router, type Request, type Response } from 'express'
import {
  translate,
  isTranslationConfigured,
  TranslateError,
  MAX_TRANSLATE_CHARS,
} from '../translate.js'
import { parseGlossary } from '../glossary.js'

const router = Router()

/** GET /api/translate/status — does this server have translation configured? */
router.get('/status', (_req: Request, res: Response): void => {
  res.json({ configured: isTranslationConfigured() })
})

/**
 * POST /api/translate — draft-translate one field.
 * Body: { text, source, target, glossary? } (source/target in app locale codes).
 * Returns: { translation }.
 *
 * `glossary` is optional terminology the CLIENT derived from the resume and
 * scoped to this text (src/lib/glossary.ts) — the server has no access to the
 * CV, so it cannot build it itself. Untrusted, so it is capped and
 * charset-cleaned by `parseGlossary` before it can reach a prompt or an
 * upstream API. Absent or unusable simply means translating without it.
 */
router.post('/', (req: Request, res: Response): void => {
  void (async () => {
    const body = req.body as Record<string, unknown>
    const text = body?.text
    const source = body?.source
    const target = body?.target

    if (typeof text !== 'string' || typeof source !== 'string' || typeof target !== 'string') {
      res.status(400).json({ error: 'text, source and target are required strings' })
      return
    }
    const trimmed = text.trim()
    if (!trimmed) {
      res.status(400).json({ error: 'text is empty' })
      return
    }
    if (text.length > MAX_TRANSLATE_CHARS) {
      res.status(413).json({ error: `text exceeds ${MAX_TRANSLATE_CHARS} characters` })
      return
    }
    // Locale codes are short identifiers — reject anything that isn't.
    if (source.length > 10 || target.length > 10) {
      res.status(400).json({ error: 'invalid locale code' })
      return
    }
    if (source === target) {
      res.status(400).json({ error: 'source and target must differ' })
      return
    }

    try {
      const translation = await translate(text, source, target, undefined, parseGlossary(body?.glossary))
      res.json({ translation })
    } catch (err) {
      if (err instanceof TranslateError) {
        res.status(err.status).json({ error: err.message })
        return
      }
      // Never leak an unexpected error's details.
      res.status(500).json({ error: 'Translation failed' })
    }
  })()
})

export default router
