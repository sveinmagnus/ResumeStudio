/**
 * In-app settings API (auth-gated, mounted at /api/settings).
 *
 * Desktop-only in effect: when not running the desktop build, GET reports
 * `managed:false` and mutating routes 403, so the VPS build stays env-driven.
 * On the desktop build these let the Settings screen choose a translation
 * provider (LibreTranslate / DeepL / Google / Azure) + keys, set the cloud-sync
 * folder, and drive the optional managed Docker LibreTranslate.
 */

import { Router, type Request, type Response } from 'express'
import {
  type AppSettings,
  isDesktop, saveSettings, toView, currentSettings, settingsToTranslateConfig,
  settingsToSummarizeConfig, DOCKER_OLLAMA_URL,
} from '../settings.js'
import { isTranslationConfigured, translate, TranslateError } from '../translate.js'
import { startTranslate, stopTranslate, translateReachable, dockerAvailable, DOCKER_TRANSLATE_URL } from '../translateDocker.js'
import { isSummarizeConfigured, summarize, SummarizeError } from '../summarize.js'
import { startSummarize, stopSummarize, ollamaReachable, dockerAvailable as ollamaDockerAvailable } from '../summarizeDocker.js'
import { reconfigureBackup } from '../backupRuntime.js'

const router = Router()

function payload() {
  return {
    managed: isDesktop(),
    settings: toView(currentSettings()),
    translate: { configured: isTranslationConfigured() },
    summarize: { configured: isSummarizeConfigured() },
  }
}

/** GET /api/settings — current settings + whether they're editable here. */
router.get('/', (_req: Request, res: Response): void => {
  res.json(payload())
})

/** PUT /api/settings — update (desktop only). Body: partial settings. */
router.put('/', (req: Request, res: Response): void => {
  if (!isDesktop()) {
    res.status(403).json({ error: 'Settings are managed by the server environment on this deployment.' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: Partial<AppSettings> = {}

  if ('translate_provider' in body) {
    const v = body.translate_provider
    if (!['off', 'libretranslate', 'deepl', 'google', 'azure'].includes(String(v))) {
      res.status(400).json({ error: 'translate_provider must be one of off/libretranslate/deepl/google/azure' })
      return
    }
    patch.translate_provider = v as AppSettings['translate_provider']
  }
  if ('libretranslate_url' in body) {
    const v = body.libretranslate_url
    if (typeof v !== 'string') { res.status(400).json({ error: 'libretranslate_url must be a string' }); return }
    const trimmed = v.trim()
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      res.status(400).json({ error: 'libretranslate_url must start with http:// or https://' })
      return
    }
    patch.libretranslate_url = trimmed
  }
  if ('translate_docker' in body) {
    if (typeof body.translate_docker !== 'boolean') { res.status(400).json({ error: 'translate_docker must be a boolean' }); return }
    patch.translate_docker = body.translate_docker
  }
  // API keys + region: only touched when the client explicitly sends them (the
  // GET masks keys, so an unchanged form omits them and the stored key stands).
  for (const key of ['libretranslate_api_key', 'deepl_api_key', 'google_api_key', 'azure_api_key', 'azure_region'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'string') { res.status(400).json({ error: `${key} must be a string` }); return }
      patch[key] = body[key] as string
    }
  }
  if ('backup_dir' in body) {
    if (typeof body.backup_dir !== 'string') { res.status(400).json({ error: 'backup_dir must be a string' }); return }
    patch.backup_dir = body.backup_dir.trim()
  }
  if ('backup_interval_ms' in body) {
    const n = body.backup_interval_ms
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 5_000) {
      res.status(400).json({ error: 'backup_interval_ms must be a number >= 5000' })
      return
    }
    patch.backup_interval_ms = n
  }
  // ── Summarize ──
  if ('summarize_provider' in body) {
    if (!['off', 'ollama', 'openai', 'compat'].includes(String(body.summarize_provider))) {
      res.status(400).json({ error: 'summarize_provider must be one of off/ollama/openai/compat' })
      return
    }
    patch.summarize_provider = body.summarize_provider as AppSettings['summarize_provider']
  }
  for (const key of ['summarize_ollama_url', 'summarize_compat_url'] as const) {
    if (key in body) {
      const v = body[key]
      if (typeof v !== 'string') { res.status(400).json({ error: `${key} must be a string` }); return }
      const trimmed = v.trim()
      if (trimmed && !/^https?:\/\//i.test(trimmed)) { res.status(400).json({ error: `${key} must start with http:// or https://` }); return }
      patch[key] = trimmed
    }
  }
  if ('summarize_docker' in body) {
    if (typeof body.summarize_docker !== 'boolean') { res.status(400).json({ error: 'summarize_docker must be a boolean' }); return }
    patch.summarize_docker = body.summarize_docker
  }
  for (const key of ['summarize_openai_api_key', 'summarize_compat_api_key', 'summarize_model'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'string') { res.status(400).json({ error: `${key} must be a string` }); return }
      patch[key] = body[key] as string
    }
  }

  const updated = saveSettings(patch)
  // Apply the (possibly) new sync folder/interval to the running scheduler live.
  reconfigureBackup(updated.backup_dir || null, updated.backup_interval_ms)
  res.json(payload())
})

/**
 * POST /api/settings/translate/test — verify a translation config actually works
 * by drafting one short phrase. Body may carry pending form values (provider +
 * keys/url/region); anything omitted falls back to the saved/effective config,
 * so a key the user didn't re-type (it's masked) is still used. Never throws.
 */
router.post('/translate/test', (req: Request, res: Response): void => {
  void (async () => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const base = currentSettings()
    const merged: AppSettings = { ...base }
    // SECURITY: pending body values (esp. libretranslate_url) let the caller
    // point the server's probe at an arbitrary host — a server-side request
    // forgery vector. Only honour them on the desktop build, where the user IS
    // the operator configuring their own machine. On the VPS build we test the
    // saved/effective (env-derived) config only, so an authed user can't make
    // the server fetch arbitrary URLs.
    if (isDesktop()) {
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined)
      if (str('translate_provider') !== undefined) merged.translate_provider = body.translate_provider as AppSettings['translate_provider']
      if (str('libretranslate_url') !== undefined) merged.libretranslate_url = (body.libretranslate_url as string).trim()
      if (typeof body.translate_docker === 'boolean') merged.translate_docker = body.translate_docker
      if (str('libretranslate_api_key')) merged.libretranslate_api_key = body.libretranslate_api_key as string
      if (str('deepl_api_key')) merged.deepl_api_key = body.deepl_api_key as string
      if (str('google_api_key')) merged.google_api_key = body.google_api_key as string
      if (str('azure_api_key')) merged.azure_api_key = body.azure_api_key as string
      if (str('azure_region') !== undefined) merged.azure_region = (body.azure_region as string).trim()
    }

    const cfg = settingsToTranslateConfig(merged)
    if (cfg.provider === 'off') {
      res.json({ reachable: false, message: 'No translation provider is selected.' })
      return
    }
    try {
      // A short, neutral probe phrase (English → Norwegian).
      const out = await translate('Hello', 'en', 'no', cfg)
      res.json({ reachable: true, message: `Working — "Hello" → "${out}"` })
    } catch (err) {
      const message = err instanceof TranslateError ? err.message : 'Translation test failed.'
      res.json({ reachable: false, message })
    }
  })()
})

/**
 * POST /api/settings/docker — manage the local Docker LibreTranslate (desktop).
 * Body: { action: 'start' | 'stop' | 'status' }.
 */
router.post('/docker', (req: Request, res: Response): void => {
  if (!isDesktop()) {
    res.status(403).json({ error: 'Docker management is only available in the desktop build.' })
    return
  }
  void (async () => {
    const action = (req.body as Record<string, unknown> | undefined)?.action
    if (action === 'start') { res.json(await startTranslate()); return }
    if (action === 'stop') { res.json(await stopTranslate()); return }
    if (action === 'status') {
      const available = await dockerAvailable()
      const reach = available ? await translateReachable(DOCKER_TRANSLATE_URL) : { reachable: false, message: 'Docker not available.' }
      res.json({ available, ...reach })
      return
    }
    res.status(400).json({ error: "action must be 'start', 'stop' or 'status'" })
  })()
})

/**
 * POST /api/settings/summarize/test — verify a summarize config works by asking
 * for one tiny summary. Same SSRF guard as the translate test: pending body
 * values (esp. URLs) are honoured only on the desktop build.
 */
router.post('/summarize/test', (req: Request, res: Response): void => {
  void (async () => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const base = currentSettings()
    const merged: AppSettings = { ...base }
    if (isDesktop()) {
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined)
      if (str('summarize_provider') !== undefined) merged.summarize_provider = body.summarize_provider as AppSettings['summarize_provider']
      if (str('summarize_ollama_url') !== undefined) merged.summarize_ollama_url = (body.summarize_ollama_url as string).trim()
      if (typeof body.summarize_docker === 'boolean') merged.summarize_docker = body.summarize_docker
      if (str('summarize_compat_url') !== undefined) merged.summarize_compat_url = (body.summarize_compat_url as string).trim()
      if (str('summarize_openai_api_key')) merged.summarize_openai_api_key = body.summarize_openai_api_key as string
      if (str('summarize_compat_api_key')) merged.summarize_compat_api_key = body.summarize_compat_api_key as string
      if (str('summarize_model') !== undefined) merged.summarize_model = (body.summarize_model as string).trim()
    }
    const cfg = settingsToSummarizeConfig(merged)
    if (cfg.provider === 'off') { res.json({ reachable: false, message: 'No summarize provider is selected.' }); return }
    if (!cfg.model) { res.json({ reachable: false, message: 'Set a model name first (e.g. "llama3.2:3b").' }); return }
    try {
      const out = await summarize('Led a small team building a customer-facing web app in React and Node.', 'en', cfg)
      res.json({ reachable: true, message: `Working — e.g. "${out}"` })
    } catch (err) {
      res.json({ reachable: false, message: err instanceof SummarizeError ? err.message : 'Summarize test failed.' })
    }
  })()
})

/**
 * POST /api/settings/summarize/docker — manage the local Docker Ollama (desktop).
 * Body: { action: 'start' | 'stop' | 'status', model? }.
 */
router.post('/summarize/docker', (req: Request, res: Response): void => {
  if (!isDesktop()) {
    res.status(403).json({ error: 'Docker management is only available in the desktop build.' })
    return
  }
  void (async () => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const action = body.action
    if (action === 'start') {
      const model = typeof body.model === 'string' && body.model.trim() ? body.model : currentSettings().summarize_model
      res.json(await startSummarize(model))
      return
    }
    if (action === 'stop') { res.json(await stopSummarize()); return }
    if (action === 'status') {
      const available = await ollamaDockerAvailable()
      const reach = available ? await ollamaReachable(DOCKER_OLLAMA_URL) : { reachable: false, message: 'Docker not available.' }
      res.json({ available, ...reach })
      return
    }
    res.status(400).json({ error: "action must be 'start', 'stop' or 'status'" })
  })()
})

export default router
