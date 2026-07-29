import { Router, type Request, type Response } from 'express'
import {
  ADVANCED_TIMEOUT_MS, chatComplete, isHighEndConfigured, llmInfo, LlmError, resolveConfig,
} from '../llm.js'
import { listProviderModels } from '../llmModels.js'

/**
 * The LLM backend: what's configured, what models it offers, and a single
 * generic completion.
 *
 * Why a general prompt proxy is acceptable HERE, where it usually wouldn't be:
 * the prompts for the assist features (tailoring, AI import, bulk add, skill
 * extraction, the whole-CV advisors…) are built in `src/lib/` on the client, and
 * duplicating those builders server-side just to keep the endpoint task-specific
 * would fork the one place each schema is defined — the exact drift this
 * codebase avoids elsewhere (see the section catalog). The endpoint is also not
 * a capability escalation: it sits behind the same auth as everything else, and
 * a caller holding the token can already read and rewrite every CV in the
 * database. Being able to additionally prompt the user's OWN model is strictly
 * less.
 *
 * It is NOT an open relay: the model, endpoint and key are all server config —
 * a request can only choose the prompt text, never where it goes.
 */
const router = Router()

/** Cap on a single assist prompt. Larger than a summarize call — an AI import
 *  carries a whole CV — but still bounded so one request can't pin the model. */
export const MAX_PROMPT_CHARS = 60_000
/**
 * Cap for an ADVANCED prompt. The whole-CV advisors bundle every section of the
 * master CV in one pass — that is the point of them — so the ordinary cap would
 * reject exactly the requests the high-end model exists to serve.
 */
export const ADVANCED_MAX_PROMPT_CHARS = 240_000
/** Cap on the reply, so a runaway generation can't stream forever. */
const MAX_OUTPUT_TOKENS = 4096
/** Advanced replies are lists of findings/proposals, not one line. */
const ADVANCED_MAX_OUTPUT_TOKENS = 16_384
const DEFAULT_OUTPUT_TOKENS = 2048

/**
 * GET /api/llm/status — is a backend configured, WHERE does it run, and is it
 * declared high-end? The `local`/`provider`/`model` fields let the UI state
 * honestly whether content leaves the machine before the user clicks Run;
 * `high_end` gates the advanced assists. No secrets here — the key itself is
 * never returned (see settings.ts `toView`).
 */
router.get('/status', (_req: Request, res: Response): void => {
  res.json(llmInfo())
})

/**
 * GET /api/llm/models — what the configured provider currently offers, so the
 * settings model field lists real, current model ids instead of a shortlist
 * that goes stale the moment a provider revs its line-up.
 *
 * Every provider is asked directly (see llmModels.ts): Ollama reports what it
 * has pulled, the rest have a `/models` endpoint. The URL and key come from the
 * SERVER's config, never the request — this makes an outbound fetch, so
 * accepting a client-supplied host would be SSRF. Unreachable, unconfigured or
 * unrecognised all mean an empty list, never an error; the client falls back to
 * its curated catalog.
 */
router.get('/models', (_req: Request, res: Response): void => {
  void (async () => {
    res.json({ models: await listProviderModels(resolveConfig()) })
  })()
})

/**
 * POST /api/llm/complete — run `prompt`, return the raw reply.
 * Body: { prompt, max_tokens?, advanced? }. Returns: { text }.
 *
 * `advanced: true` asks for the high-end budget (bigger prompt, longer reply,
 * longer timeout) and is REFUSED unless the operator declared the model
 * high-end. The client already hides these features, so this is defence in
 * depth rather than the primary gate — but it's the half that a stale tab or a
 * changed setting can't get wrong, and running a whole-CV review on a 3B model
 * produces confident nonsense rather than an error.
 *
 * The reply is returned verbatim: every caller has its own validator
 * (`validateTailorResponse`, `validateBulkImport`, …) and parsing here would
 * just add a second, weaker copy of that.
 */
router.post('/complete', (req: Request, res: Response): void => {
  void (async () => {
    const body = req.body as Record<string, unknown> | undefined
    const prompt = body?.prompt
    const advanced = body?.advanced === true
    if (typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'prompt is required' })
      return
    }
    if (advanced && !isHighEndConfigured()) {
      res.status(403).json({ error: 'This assist needs a model marked as high-end in Settings → AI assist' })
      return
    }
    const promptCap = advanced ? ADVANCED_MAX_PROMPT_CHARS : MAX_PROMPT_CHARS
    if (prompt.length > promptCap) {
      res.status(413).json({ error: `prompt exceeds ${promptCap} characters` })
      return
    }
    const raw = body?.max_tokens
    const tokenCap = advanced ? ADVANCED_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS
    const maxTokens = typeof raw === 'number' && raw > 0
      ? Math.min(Math.floor(raw), tokenCap)
      : DEFAULT_OUTPUT_TOKENS

    try {
      // Temperature 0: every assist wants a structured, reproducible answer,
      // not a creative one.
      const text = await chatComplete(
        [{ role: 'user', content: prompt }],
        { maxTokens, temperature: 0, ...(advanced ? { timeoutMs: ADVANCED_TIMEOUT_MS } : {}) },
      )
      res.json({ text })
    } catch (err) {
      if (err instanceof LlmError) { res.status(err.status).json({ error: err.message }); return }
      res.status(500).json({ error: 'The AI model could not complete that request' })
    }
  })()
})

export default router
