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
import type { TranslateConfig, TranslateProvider } from './translate.js'

export const SETTINGS_FILENAME = 'settings.json'

/** Fixed URL the app uses when it manages a local Docker LibreTranslate. */
export const DOCKER_TRANSLATE_URL = 'http://localhost:5000'

const PROVIDERS: readonly TranslateProvider[] = ['off', 'libretranslate', 'deepl', 'google', 'azure']

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
  /** Cloud-synced folder for the whole-store JSON backup (empty = sync off). */
  backup_dir: string
  /** How often (ms) to refresh the backup while running. */
  backup_interval_ms: number
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
  backup_dir: '',
  backup_interval_ms: 60_000,
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
  const provider = (PROVIDERS as string[]).includes(String(o.translate_provider))
    ? (o.translate_provider as TranslateProvider)
    : DEFAULT_SETTINGS.translate_provider
  return {
    translate_provider: provider,
    libretranslate_url: str(o.libretranslate_url, DEFAULT_SETTINGS.libretranslate_url).trim(),
    libretranslate_api_key: str(o.libretranslate_api_key, DEFAULT_SETTINGS.libretranslate_api_key),
    translate_docker: o.translate_docker === true,
    deepl_api_key: str(o.deepl_api_key, DEFAULT_SETTINGS.deepl_api_key).trim(),
    google_api_key: str(o.google_api_key, DEFAULT_SETTINGS.google_api_key).trim(),
    azure_api_key: str(o.azure_api_key, DEFAULT_SETTINGS.azure_api_key).trim(),
    azure_region: str(o.azure_region, DEFAULT_SETTINGS.azure_region).trim(),
    backup_dir: str(o.backup_dir, DEFAULT_SETTINGS.backup_dir).trim(),
    backup_interval_ms: Math.max(5_000, num(o.backup_interval_ms, DEFAULT_SETTINGS.backup_interval_ms)),
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
  setOrClear('RESUME_BACKUP_DIR', s.backup_dir)
  process.env.RESUME_BACKUP_INTERVAL_MS = String(s.backup_interval_ms)
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
  })
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
  backup_dir: string
  backup_interval_ms: number
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
    backup_dir: s.backup_dir,
    backup_interval_ms: s.backup_interval_ms,
  }
}
