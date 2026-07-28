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
  settingsToSummarizeConfig, validateSettingsPatch, DOCKER_OLLAMA_URL,
} from '../settings.js'
import { isTranslationConfigured, translate, TranslateError } from '../translate.js'
import { startTranslate, stopTranslate, translateReachable, dockerAvailable, DOCKER_TRANSLATE_URL } from '../translateDocker.js'
import { isSummarizeConfigured, summarize, SummarizeError } from '../summarize.js'
import { startSummarize, stopSummarize, ollamaReachable, dockerAvailable as ollamaDockerAvailable } from '../summarizeDocker.js'
import { reconfigureBackup } from '../backupRuntime.js'
import { listFolders, FolderError } from '../folders.js'

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
  // Validation is driven by the field table in server/settings.ts — see
  // validateSettingsPatch. Keeping it there rather than inline here is the
  // point: this route's own copy of the provider list is what made the `llm`
  // translate provider unusable (offered by the UI, 400'd here).
  const result = validateSettingsPatch((req.body ?? {}) as Record<string, unknown>)
  if ('error' in result) {
    res.status(400).json({ error: result.error })
    return
  }
  const { patch } = result

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
 * POST /api/settings/folders — list a folder's subdirectories so the Settings
 * screen can navigate to the backup/sync folder instead of pasting a path.
 * Body: { path?: string } (omitted/empty → the user's home directory).
 *
 * DESKTOP-ONLY: this exposes the local directory tree, which is appropriate on
 * the user's own machine but must never be reachable on the shared VPS build.
 * POST (not GET) so Windows paths with backslashes ride in the JSON body rather
 * than a URL-encoded query string.
 */
router.post('/folders', (req: Request, res: Response): void => {
  if (!isDesktop()) {
    res.status(403).json({ error: 'Folder browsing is only available in the desktop build.' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const dir = typeof body.path === 'string' ? body.path : undefined
  try {
    res.json(listFolders(dir))
  } catch (err) {
    if (err instanceof FolderError) { res.status(err.status).json({ error: err.message }); return }
    res.status(500).json({ error: 'Could not list that folder.' })
  }
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
      if (str('summarize_anthropic_api_key')) merged.summarize_anthropic_api_key = body.summarize_anthropic_api_key as string
      if (str('summarize_gemini_api_key')) merged.summarize_gemini_api_key = body.summarize_gemini_api_key as string
      if (str('summarize_mistral_api_key')) merged.summarize_mistral_api_key = body.summarize_mistral_api_key as string
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
