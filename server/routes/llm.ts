import { Router, type Request, type Response } from 'express'
import { chatComplete, isSummarizeConfigured, SummarizeError } from '../summarize.js'

/**
 * A single generic completion against the configured model.
 *
 * Why a general prompt proxy is acceptable HERE, where it usually wouldn't be:
 * the prompts for the assist features (tailoring, AI import, bulk add, skill
 * extraction…) are built in `src/lib/` on the client, and duplicating those
 * builders server-side just to keep the endpoint task-specific would fork the
 * one place each schema is defined — the exact drift this codebase avoids
 * elsewhere (see the section catalog). The endpoint is also not a capability
 * escalation: it sits behind the same auth as everything else, and a caller
 * holding the token can already read and rewrite every CV in the database.
 * Being able to additionally prompt the user's OWN model is strictly less.
 *
 * It is NOT an open relay: the model, endpoint and key are all server config —
 * a request can only choose the prompt text, never where it goes.
 */
const router = Router()

/** Cap on a single assist prompt. Larger than a summarize call — an AI import
 *  carries a whole CV — but still bounded so one request can't pin the model. */
export const MAX_PROMPT_CHARS = 60_000
/** Cap on the reply, so a runaway generation can't stream forever. */
const MAX_OUTPUT_TOKENS = 4096
const DEFAULT_OUTPUT_TOKENS = 2048

/** GET /api/llm/status — thin alias of the summarize status for assist callers. */
router.get('/status', (_req: Request, res: Response): void => {
  res.json({ configured: isSummarizeConfigured() })
})

/**
 * POST /api/llm/complete — run `prompt`, return the raw reply.
 * Body: { prompt, max_tokens? }. Returns: { text }.
 *
 * The reply is returned verbatim: every caller has its own validator
 * (`validateTailorResponse`, `validateBulkImport`, …) and parsing here would
 * just add a second, weaker copy of that.
 */
router.post('/complete', (req: Request, res: Response): void => {
  void (async () => {
    const body = req.body as Record<string, unknown> | undefined
    const prompt = body?.prompt
    if (typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'prompt is required' })
      return
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      res.status(413).json({ error: `prompt exceeds ${MAX_PROMPT_CHARS} characters` })
      return
    }
    const raw = body?.max_tokens
    const maxTokens = typeof raw === 'number' && raw > 0
      ? Math.min(Math.floor(raw), MAX_OUTPUT_TOKENS)
      : DEFAULT_OUTPUT_TOKENS

    try {
      // Temperature 0: every assist wants a structured, reproducible answer,
      // not a creative one.
      const text = await chatComplete(
        [{ role: 'user', content: prompt }],
        { maxTokens, temperature: 0 },
      )
      res.json({ text })
    } catch (err) {
      if (err instanceof SummarizeError) { res.status(err.status).json({ error: err.message }); return }
      res.status(500).json({ error: 'The AI model could not complete that request' })
    }
  })()
})

export default router
