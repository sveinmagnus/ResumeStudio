/**
 * Persisted, user-editable runtime settings for the desktop build.
 *
 * The VPS build is configured purely via environment variables (set by the
 * deployment) and never touches this module. The desktop build instead lets the
 * user edit a few things from an in-app Settings screen; those are stored in
 * `<dataDir>/settings.json` and **applied onto `process.env`** at boot and on
 * every save. Because the translate proxy and backup routes read their env
 * lazily (per request), pushing values into `process.env` makes edits take
 * effect immediately — no restart for URL/key/folder changes.
 *
 * Source-of-truth rule: on first run we seed `settings.json` from whatever env
 * the launcher already had (so a value set in a shim/system env is preserved),
 * after which the file is authoritative and `applyToEnv` overwrites env from it.
 *
 * Pure logic + a small atomic file writer; no Express, no DB.
 */

import fs from 'fs'
import path from 'path'
import { resolvePaths } from './config.js'
import { ltLoadOnly, type TranslateConfig, type TranslateProvider } from './translate.js'
import { DEFAULT_OLLAMA_URL, type SummarizeConfig, type SummarizeProvider } from './summarize.js'

export const SETTINGS_FILENAME = 'settings.json'

/** Fixed URL the app uses when it manages a local Docker LibreTranslate. */
export const DOCKER_TRANSLATE_URL = 'http://localhost:5000'
/** Fixed URL the app uses when it manages a local Docker Ollama. */
export const DOCKER_OLLAMA_URL = DEFAULT_OLLAMA_URL

const PROVIDERS: readonly TranslateProvider[] = ['off', 'libretranslate', 'deepl', 'google', 'azure', 'llm']
const SUMMARIZE_PROVIDERS: readonly SummarizeProvider[] = ['off', 'ollama', 'openai', 'compat']

export interface AppSettings {
  /** Which translation backend to use ('off' = no Draft button). */
  translate_provider: TranslateProvider
  /** Explicit LibreTranslate base URL (remote/manual). Ignored if translate_docker. */
  libretranslate_url: string
  /** Optional API key for the LibreTranslate instance. */
  libretranslate_api_key: string
  /** When provider=libretranslate, run/use a local Docker LibreTranslate at DOCKER_TRANSLATE_URL. */
  translate_docker: boolean
  /** DeepL API key (Free vs Pro auto-detected from the ':fx' suffix). */
  deepl_api_key: string
  /** Google Cloud Translation v2 API key. */
  google_api_key: string
  /** Microsoft Azure Translator key + its resource region (e.g. 'westeurope'). */
  azure_api_key: string
  azure_region: string
  /**
   * App locale codes whose models the Docker LibreTranslate installs
   * (`LT_LOAD_ONLY`). Each language is a few-hundred-MB Argos package, so this
   * is a choice rather than "install all 15". English is always added at the
   * render boundary (`ltLoadOnly`) — Argos pivots through it. Only meaningful
   * for the Docker-managed instance; a remote/cloud provider ignores it.
   */
  translate_languages: string[]
  /** Cloud-synced folder for the whole-store JSON backup (empty = sync off). */
  backup_dir: string
  /** How often (ms) to refresh the backup while running. */
  backup_interval_ms: number
  // ── Summarize (AI short-description) ──
  /** Which LLM backend summarizes long descriptions ('off' = no Summarize button). */
  summarize_provider: SummarizeProvider
  /** Remote Ollama base URL (ignored when summarize_docker manages a local one). */
  summarize_ollama_url: string
  /** When provider=ollama, run/use the local Docker Ollama at DOCKER_OLLAMA_URL. */
  summarize_docker: boolean
  /** OpenAI API key (provider=openai). */
  summarize_openai_api_key: string
  /** Base URL for a generic OpenAI-compatible endpoint (provider=compat). */
  summarize_compat_url: string
  /** Optional API key for the compat endpoint. */
  summarize_compat_api_key: string
  /** Chat model name (e.g. 'llama3.2:3b', 'gpt-4o-mini'). */
  summarize_model: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  translate_provider: 'off',
  libretranslate_url: '',
  libretranslate_api_key: '',
  translate_docker: false,
  deepl_api_key: '',
  google_api_key: '',
  azure_api_key: '',
  azure_region: '',
  // Matches what docker-compose.yml shipped with, so an existing install's
  // container isn't recreated just because the setting appeared.
  translate_languages: ['en', 'no', 'se', 'dk'],
  backup_dir: '',
  backup_interval_ms: 60_000,
  summarize_provider: 'off',
  summarize_ollama_url: '',
  summarize_docker: false,
  summarize_openai_api_key: '',
  summarize_compat_url: '',
  summarize_compat_api_key: '',
  summarize_model: '',
}

/**
 * Whether we're running the desktop build (the launcher sets RESUME_DESKTOP).
 * Gates the settings-management surface so the VPS build stays env-only.
 */
export function isDesktop(): boolean {
  return !!process.env.RESUME_DESKTOP?.trim()
}

export function settingsFilePath(): string {
  return path.join(resolvePaths().dataDir, SETTINGS_FILENAME)
}

/** Coerce an arbitrary parsed object into a complete, typed settings record. */
function coerce(raw: unknown): AppSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  /**
   * Locale codes for the Docker translate install. Untrusted-file surface: this
   * value reaches `docker compose` as an env var, so it's constrained to short
   * a-z/dash codes rather than passed through. A non-array (or one with nothing
   * usable left) falls back to the default rather than installing nothing.
   */
  const langs = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [...DEFAULT_SETTINGS.translate_languages]
    const out = [...new Set(
      v.filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim().toLowerCase())
        .filter((x) => /^[a-z]{2,8}(-[a-z]{2,8})?$/.test(x)),
    )]
    return out.length ? out : [...DEFAULT_SETTINGS.translate_languages]
  }
  const provider = (PROVIDERS as string[]).includes(String(o.translate_provider))
    ? (o.translate_provider as TranslateProvider)
    : DEFAULT_SETTINGS.translate_provider
  const summarizeProvider = (SUMMARIZE_PROVIDERS as string[]).includes(String(o.summarize_provider))
    ? (o.summarize_provider as SummarizeProvider)
    : DEFAULT_SETTINGS.summarize_provider
  return {
    translate_provider: provider,
    libretranslate_url: str(o.libretranslate_url, DEFAULT_SETTINGS.libretranslate_url).trim(),
    libretranslate_api_key: str(o.libretranslate_api_key, DEFAULT_SETTINGS.libretranslate_api_key),
    translate_docker: o.translate_docker === true,
    deepl_api_key: str(o.deepl_api_key, DEFAULT_SETTINGS.deepl_api_key).trim(),
    google_api_key: str(o.google_api_key, DEFAULT_SETTINGS.google_api_key).trim(),
    azure_api_key: str(o.azure_api_key, DEFAULT_SETTINGS.azure_api_key).trim(),
    azure_region: str(o.azure_region, DEFAULT_SETTINGS.azure_region).trim(),
    translate_languages: langs(o.translate_languages),
    backup_dir: str(o.backup_dir, DEFAULT_SETTINGS.backup_dir).trim(),
    backup_interval_ms: Math.max(5_000, num(o.backup_interval_ms, DEFAULT_SETTINGS.backup_interval_ms)),
    summarize_provider: summarizeProvider,
    summarize_ollama_url: str(o.summarize_ollama_url, DEFAULT_SETTINGS.summarize_ollama_url).trim(),
    summarize_docker: o.summarize_docker === true,
    summarize_openai_api_key: str(o.summarize_openai_api_key, DEFAULT_SETTINGS.summarize_openai_api_key).trim(),
    summarize_compat_url: str(o.summarize_compat_url, DEFAULT_SETTINGS.summarize_compat_url).trim(),
    summarize_compat_api_key: str(o.summarize_compat_api_key, DEFAULT_SETTINGS.summarize_compat_api_key).trim(),
    summarize_model: str(o.summarize_model, DEFAULT_SETTINGS.summarize_model).trim(),
  }
}

/** Read settings.json (coerced); returns defaults if the file is absent/garbage. */
export function loadSettings(): AppSettings {
  const file = settingsFilePath()
  if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS }
  try {
    return coerce(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Atomically write settings.json (temp file + rename), 0600 best-effort. */
function writeSettings(settings: AppSettings): void {
  const file = settingsFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* ignore (Windows / best-effort) */ }
}

/**
 * Push settings onto process.env so the lazily-env-reading translate + backup
 * code sees them. For libretranslate the effective URL is the Docker URL when
 * managed, else the explicit URL. Empty values clear the corresponding env var.
 */
export function applyToEnv(s: AppSettings): void {
  process.env.TRANSLATE_PROVIDER = s.translate_provider
  const libreUrl = (s.translate_provider === 'libretranslate' && s.translate_docker)
    ? DOCKER_TRANSLATE_URL
    : s.libretranslate_url
  setOrClear('LIBRETRANSLATE_URL', libreUrl)
  setOrClear('LIBRETRANSLATE_API_KEY', s.libretranslate_api_key)
  setOrClear('DEEPL_API_KEY', s.deepl_api_key)
  setOrClear('GOOGLE_TRANSLATE_API_KEY', s.google_api_key)
  setOrClear('AZURE_TRANSLATOR_KEY', s.azure_api_key)
  setOrClear('AZURE_TRANSLATOR_REGION', s.azure_region)
  // Which Argos models the Docker LibreTranslate installs. docker-compose.yml
  // reads LT_LOAD_ONLY, so this must be on the env before the container starts.
  process.env.LT_LOAD_ONLY = ltLoadOnly(s.translate_languages)
  setOrClear('RESUME_BACKUP_DIR', s.backup_dir)
  process.env.RESUME_BACKUP_INTERVAL_MS = String(s.backup_interval_ms)
  // Summarize — the effective Ollama URL is the Docker URL when managed.
  process.env.SUMMARIZE_PROVIDER = s.summarize_provider
  const ollamaUrl = (s.summarize_provider === 'ollama' && s.summarize_docker) ? DOCKER_OLLAMA_URL : s.summarize_ollama_url
  setOrClear('SUMMARIZE_OLLAMA_URL', ollamaUrl)
  setOrClear('SUMMARIZE_OPENAI_API_KEY', s.summarize_openai_api_key)
  setOrClear('SUMMARIZE_COMPAT_URL', s.summarize_compat_url)
  setOrClear('SUMMARIZE_COMPAT_API_KEY', s.summarize_compat_api_key)
  setOrClear('SUMMARIZE_MODEL', s.summarize_model)
}

/** Map persisted settings to a SummarizeConfig (mirrors settingsToTranslateConfig). */
export function settingsToSummarizeConfig(s: AppSettings): SummarizeConfig {
  const ollamaUrl = (s.summarize_provider === 'ollama' && s.summarize_docker) ? DOCKER_OLLAMA_URL : s.summarize_ollama_url
  return {
    provider: s.summarize_provider,
    ollama: { url: (ollamaUrl || DOCKER_OLLAMA_URL).replace(/\/+$/, '') },
    openai: { apiKey: s.summarize_openai_api_key },
    compat: { url: s.summarize_compat_url.replace(/\/+$/, ''), apiKey: s.summarize_compat_api_key },
    model: s.summarize_model,
  }
}

/** Map persisted settings to a TranslateConfig — used to test pending config
 *  without mutating process.env (the test route) and anywhere a one-off config
 *  is needed. Mirrors applyToEnv's docker-URL rule. */
export function settingsToTranslateConfig(s: AppSettings): TranslateConfig {
  const libreUrl = (s.translate_provider === 'libretranslate' && s.translate_docker)
    ? DOCKER_TRANSLATE_URL
    : (s.libretranslate_url || '')
  return {
    provider: s.translate_provider,
    libretranslate: { url: libreUrl ? libreUrl.replace(/\/+$/, '') : null, apiKey: s.libretranslate_api_key },
    deepl: { apiKey: s.deepl_api_key },
    google: { apiKey: s.google_api_key },
    azure: { apiKey: s.azure_api_key, region: s.azure_region },
  }
}

function setOrClear(key: string, value: string): void {
  if (value && value.trim()) process.env[key] = value.trim()
  else delete process.env[key]
}

/**
 * First-run seed: if settings.json doesn't exist, create it from the current
 * env (preserving any shim/system-provided values), then apply. Returns the
 * effective settings.
 */
export function loadOrInitSettings(): AppSettings {
  const file = settingsFilePath()
  if (fs.existsSync(file)) {
    const s = loadSettings()
    applyToEnv(s)
    return s
  }
  const envProvider = process.env.TRANSLATE_PROVIDER?.trim()
  const seeded = coerce({
    translate_provider: envProvider || (process.env.LIBRETRANSLATE_URL?.trim() ? 'libretranslate' : 'off'),
    libretranslate_url: process.env.LIBRETRANSLATE_URL ?? '',
    libretranslate_api_key: process.env.LIBRETRANSLATE_API_KEY ?? '',
    translate_docker: false,
    deepl_api_key: process.env.DEEPL_API_KEY ?? '',
    google_api_key: process.env.GOOGLE_TRANSLATE_API_KEY ?? '',
    azure_api_key: process.env.AZURE_TRANSLATOR_KEY ?? '',
    azure_region: process.env.AZURE_TRANSLATOR_REGION ?? '',
    backup_dir: process.env.RESUME_BACKUP_DIR ?? '',
    backup_interval_ms: Number(process.env.RESUME_BACKUP_INTERVAL_MS) || DEFAULT_SETTINGS.backup_interval_ms,
    ...summarizeFromEnv(),
  })
  writeSettings(seeded)
  applyToEnv(seeded)
  return seeded
}

/** Merge a partial update over the current settings, persist, and apply to env. */
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = coerce({ ...loadSettings(), ...patch })
  writeSettings(merged)
  applyToEnv(merged)
  return merged
}

/**
 * The effective settings right now: the persisted file on the desktop build, or
 * a read-only snapshot synthesized from env on a server build. Used for the
 * settings view and for the "test connection" config (so VPS can test its env
 * config too).
 */
export function currentSettings(): AppSettings {
  if (isDesktop()) return loadSettings()
  return coerce({
    translate_provider: process.env.TRANSLATE_PROVIDER?.trim()
      || (process.env.LIBRETRANSLATE_URL?.trim() ? 'libretranslate' : 'off'),
    libretranslate_url: process.env.LIBRETRANSLATE_URL ?? '',
    libretranslate_api_key: process.env.LIBRETRANSLATE_API_KEY ?? '',
    translate_docker: false,
    deepl_api_key: process.env.DEEPL_API_KEY ?? '',
    google_api_key: process.env.GOOGLE_TRANSLATE_API_KEY ?? '',
    azure_api_key: process.env.AZURE_TRANSLATOR_KEY ?? '',
    azure_region: process.env.AZURE_TRANSLATOR_REGION ?? '',
    backup_dir: process.env.RESUME_BACKUP_DIR ?? '',
    backup_interval_ms: Number(process.env.RESUME_BACKUP_INTERVAL_MS) || DEFAULT_SETTINGS.backup_interval_ms,
    ...summarizeFromEnv(),
  })
}

/** Summarize settings synthesised from env (VPS snapshot + first-run seed). */
function summarizeFromEnv(): Partial<AppSettings> {
  return {
    summarize_provider: process.env.SUMMARIZE_PROVIDER?.trim() as SummarizeProvider | undefined,
    summarize_ollama_url: process.env.SUMMARIZE_OLLAMA_URL ?? '',
    summarize_openai_api_key: process.env.SUMMARIZE_OPENAI_API_KEY ?? '',
    summarize_compat_url: process.env.SUMMARIZE_COMPAT_URL ?? '',
    summarize_compat_api_key: process.env.SUMMARIZE_COMPAT_API_KEY ?? '',
    summarize_model: process.env.SUMMARIZE_MODEL ?? '',
  }
}

/**
 * The shape returned to the client — API keys are never echoed back, only
 * whether each one is set.
 */
export interface SettingsView {
  translate_provider: TranslateProvider
  libretranslate_url: string
  libretranslate_api_key_set: boolean
  translate_docker: boolean
  deepl_api_key_set: boolean
  google_api_key_set: boolean
  azure_api_key_set: boolean
  azure_region: string
  translate_languages: string[]
  backup_dir: string
  backup_interval_ms: number
  summarize_provider: SummarizeProvider
  summarize_ollama_url: string
  summarize_docker: boolean
  summarize_openai_api_key_set: boolean
  summarize_compat_url: string
  summarize_compat_api_key_set: boolean
  summarize_model: string
}

export function toView(s: AppSettings): SettingsView {
  return {
    translate_provider: s.translate_provider,
    libretranslate_url: s.libretranslate_url,
    libretranslate_api_key_set: s.libretranslate_api_key.trim().length > 0,
    translate_docker: s.translate_docker,
    deepl_api_key_set: s.deepl_api_key.trim().length > 0,
    google_api_key_set: s.google_api_key.trim().length > 0,
    azure_api_key_set: s.azure_api_key.trim().length > 0,
    azure_region: s.azure_region,
    translate_languages: s.translate_languages,
    backup_dir: s.backup_dir,
    backup_interval_ms: s.backup_interval_ms,
    summarize_provider: s.summarize_provider,
    summarize_ollama_url: s.summarize_ollama_url,
    summarize_docker: s.summarize_docker,
    summarize_openai_api_key_set: s.summarize_openai_api_key.trim().length > 0,
    summarize_compat_url: s.summarize_compat_url,
    summarize_compat_api_key_set: s.summarize_compat_api_key.trim().length > 0,
    summarize_model: s.summarize_model,
  }
}
