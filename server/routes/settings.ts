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
  OWNER_EDITABLE_KEYS,
  type AppSettings,
  isDesktop, saveSettings, toView, currentSettings, settingsToTranslateConfig,
  settingsToLlmConfig, validateSettingsPatch, DOCKER_OLLAMA_URL,
} from '../settings.js'
import { isTranslationConfigured, translate, TranslateError } from '../translate.js'
import { startTranslate, stopTranslate, translateReachable, dockerAvailable, DOCKER_TRANSLATE_URL } from '../translateDocker.js'
import { isLlmConfigured, LlmError } from '../llm.js'
import { summarize } from '../summarize.js'
import { startOllama, stopOllama, ollamaReachable, dockerAvailable as ollamaDockerAvailable } from '../ollamaDocker.js'
import { listProviderModels } from '../llmModels.js'
import { reconfigureBackup } from '../backupRuntime.js'
import { listFolders, FolderError } from '../folders.js'
import {
  hostnameStatus, installHostname, uninstallHostname, isValidLocalHostname,
} from '../localHost.js'
import { viewerOf, requireOwner } from '../auth.js'

const router = Router()


/** Whether this request may write settings, and which ones. */
function writableKeys(res: Response): readonly string[] | null {
  if (isDesktop()) return null
  return viewerOf(res).role === 'owner' ? OWNER_EDITABLE_KEYS : []
}

function payload(res?: Response) {
  return {
    // Unchanged meaning: does the APP own the whole settings surface? Only the
    // desktop build does. A hosted owner can write a subset, which is what
    // `editable_keys` is for — overloading `managed` would tell the client the
    // sync folder and local hostname are editable on a VPS, where they are not.
    managed: isDesktop(),
    /**
     * Which keys this caller may write: null on desktop (all of them), a short
     * list for a hosted owner, empty for anyone else.
     */
    editable_keys: isDesktop() ? null : (res ? writableKeys(res) : []),
    settings: toView(currentSettings()),
    translate: { configured: isTranslationConfigured() },
    llm: { configured: isLlmConfigured() },
  }
}

/** GET /api/settings — current settings + whether they're editable here. */
router.get('/', (_req: Request, res: Response): void => {
  res.json(payload(res))
})

/** PUT /api/settings — update (desktop only). Body: partial settings. */
router.put('/', (req: Request, res: Response): void => {
  const allowed = writableKeys(res)
  if (allowed !== null) {
    if (allowed.length === 0) {
      res.status(403).json({ error: 'Settings are managed by the server environment on this deployment.' })
      return
    }
    const refused = Object.keys((req.body ?? {}) as Record<string, unknown>)
      .filter((k) => !allowed.includes(k))
    if (refused.length > 0) {
      res.status(403).json({
        error: `These settings are managed by the server environment: ${refused.join(', ')}.`,
      })
      return
    }
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
  /*
   * Owner-only, and rate-limited in app.ts alongside the other billable
   * endpoints. These reach the operator's configured provider with the
   * operator's key: a member who could call them at wire speed would be
   * spending somebody else's money, and `apiLimiter` skips successful
   * responses so it never spends its budget on a 200.
   */
  if (!requireOwner(res)) return

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
 * POST /api/settings/hostname — inspect or install a local name for this
 * machine (desktop only). Body: { action: 'status' | 'install' | 'uninstall',
 * hostname }.
 *
 * DESKTOP-ONLY and deliberately so: 'install' edits the system hosts file
 * behind an OS elevation prompt. That is a reasonable thing for a user to do to
 * their own computer and an absurd one for an authed client to do to a shared
 * VPS, which is served on a real domain anyway.
 *
 * The hostname is validated here (`.local` / `.localhost` only) before it goes
 * anywhere near the file — see server/localHost.ts for why the suffixes are
 * constrained.
 */
router.post('/hostname', (req: Request, res: Response): void => {
  if (!isDesktop()) {
    res.status(403).json({ error: 'The local address is managed by the server environment on this deployment.' })
    return
  }
  void (async () => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const action = body.action
    const hostname = typeof body.hostname === 'string' ? body.hostname.trim().toLowerCase() : ''
    if (!isValidLocalHostname(hostname)) {
      res.status(400).json({ error: 'hostname must be a .local or .localhost name' })
      return
    }
    if (action === 'status') { res.json(hostnameStatus(hostname)); return }
    if (action === 'install') {
      const r = await installHostname(hostname)
      res.json({ ...r, status: hostnameStatus(hostname) })
      return
    }
    if (action === 'uninstall') {
      const r = await uninstallHostname(hostname)
      res.json({ ...r, status: hostnameStatus(hostname) })
      return
    }
    res.status(400).json({ error: "action must be 'status', 'install' or 'uninstall'" })
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
 * The saved settings with the form's PENDING values merged over them.
 *
 * SECURITY: pending values (esp. the two base URLs) let the caller point the
 * server's outbound fetch at an arbitrary host — a server-side request forgery
 * vector. They are honoured ONLY on the desktop build, where the user IS the
 * operator configuring their own machine. On the VPS build the saved config is
 * used verbatim, so an authed user can't make the server fetch arbitrary URLs.
 *
 * Shared by "test" and "models" so the guard exists once: a second copy is how
 * one of them would eventually get it wrong.
 */
function withPendingLlm(body: Record<string, unknown>): AppSettings {
  const merged: AppSettings = { ...currentSettings() }
  if (!isDesktop()) return merged

  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined)
  if (str('llm_provider') !== undefined) merged.llm_provider = body.llm_provider as AppSettings['llm_provider']
  if (str('llm_ollama_url') !== undefined) merged.llm_ollama_url = (body.llm_ollama_url as string).trim()
  if (typeof body.llm_docker === 'boolean') merged.llm_docker = body.llm_docker
  if (str('llm_compat_url') !== undefined) merged.llm_compat_url = (body.llm_compat_url as string).trim()
  if (str('llm_openai_api_key')) merged.llm_openai_api_key = body.llm_openai_api_key as string
  if (str('llm_compat_api_key')) merged.llm_compat_api_key = body.llm_compat_api_key as string
  if (str('llm_anthropic_api_key')) merged.llm_anthropic_api_key = body.llm_anthropic_api_key as string
  if (str('llm_gemini_api_key')) merged.llm_gemini_api_key = body.llm_gemini_api_key as string
  if (str('llm_mistral_api_key')) merged.llm_mistral_api_key = body.llm_mistral_api_key as string
  if (str('llm_model') !== undefined) merged.llm_model = (body.llm_model as string).trim()
  return merged
}

/**
 * POST /api/settings/llm/models — the provider's current model list, using the
 * form's pending values.
 *
 * A POST rather than reusing GET /api/llm/models because the useful moment is
 * "I have just pasted an API key and want to see what it can run" — before
 * Save. The GET (saved config only) stays for everything else.
 */
router.post('/llm/models', (req: Request, res: Response): void => {
  /*
   * Owner-only, and rate-limited in app.ts alongside the other billable
   * endpoints. These reach the operator's configured provider with the
   * operator's key: a member who could call them at wire speed would be
   * spending somebody else's money, and `apiLimiter` skips successful
   * responses so it never spends its budget on a 200.
   */
  if (!requireOwner(res)) return

  void (async () => {
    const cfg = settingsToLlmConfig(withPendingLlm((req.body ?? {}) as Record<string, unknown>))
    if (cfg.provider === 'off') { res.json({ models: [] }); return }
    res.json({ models: await listProviderModels(cfg) })
  })()
})

/**
 * POST /api/settings/llm/test — verify the AI-assist config works by asking for
 * one tiny summary (the cheapest round-trip that proves the whole path). Same
 * SSRF guard as the translate test: pending body values (esp. URLs) are honoured
 * only on the desktop build.
 */
router.post('/llm/test', (req: Request, res: Response): void => {
  /*
   * Owner-only, and rate-limited in app.ts alongside the other billable
   * endpoints. These reach the operator's configured provider with the
   * operator's key: a member who could call them at wire speed would be
   * spending somebody else's money, and `apiLimiter` skips successful
   * responses so it never spends its budget on a 200.
   */
  if (!requireOwner(res)) return

  void (async () => {
    const cfg = settingsToLlmConfig(withPendingLlm((req.body ?? {}) as Record<string, unknown>))
    if (cfg.provider === 'off') { res.json({ reachable: false, message: 'No AI provider is selected.' }); return }
    if (!cfg.model) { res.json({ reachable: false, message: 'Set a model name first (e.g. "llama3.2:3b").' }); return }
    try {
      // A heading is passed too, so the test exercises the same prompt shape the
      // editor sends rather than a simpler one that could pass while the real
      // path fails.
      const out = await summarize(
        'Led a small team building a customer-facing web app in React and Node.',
        'en',
        ['Customer: Nordic Retail AS', 'Project name: Self-service portal'],
        cfg,
      )
      res.json({ reachable: true, message: `Working — e.g. "${out}"` })
    } catch (err) {
      res.json({ reachable: false, message: err instanceof LlmError ? err.message : 'AI assist test failed.' })
    }
  })()
})

/**
 * POST /api/settings/llm/docker — manage the local Docker Ollama (desktop).
 * Body: { action: 'start' | 'stop' | 'status', model? }.
 */
router.post('/llm/docker', (req: Request, res: Response): void => {
  if (!isDesktop()) {
    res.status(403).json({ error: 'Docker management is only available in the desktop build.' })
    return
  }
  void (async () => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const action = body.action
    if (action === 'start') {
      const model = typeof body.model === 'string' && body.model.trim() ? body.model : currentSettings().llm_model
      res.json(await startOllama(model))
      return
    }
    if (action === 'stop') { res.json(await stopOllama()); return }
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
