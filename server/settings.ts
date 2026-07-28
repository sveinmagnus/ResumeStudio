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
import { ltLoadOnly, TRANSLATE_PROVIDERS, type TranslateConfig, type TranslateProvider } from './translate.js'
import { DEFAULT_OLLAMA_URL, SUMMARIZE_PROVIDERS, type SummarizeConfig, type SummarizeProvider } from './summarize.js'

export const SETTINGS_FILENAME = 'settings.json'

/** Fixed URL the app uses when it manages a local Docker LibreTranslate. */
export const DOCKER_TRANSLATE_URL = 'http://localhost:5000'
/** Fixed URL the app uses when it manages a local Docker Ollama. */
export const DOCKER_OLLAMA_URL = DEFAULT_OLLAMA_URL

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
  /** Anthropic (Claude) API key (provider=anthropic). */
  summarize_anthropic_api_key: string
  /** Google Gemini API key (provider=gemini). */
  summarize_gemini_api_key: string
  /** Mistral API key (provider=mistral). */
  summarize_mistral_api_key: string
  /** Chat model name (e.g. 'llama3.2:3b', 'gpt-4o-mini', 'claude-haiku-4-5'). */
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
  summarize_anthropic_api_key: '',
  summarize_gemini_api_key: '',
  summarize_mistral_api_key: '',
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

// ─── The field table ─────────────────────────────────────────────────────────

/**
 * ONE descriptor per setting, and everything else is a walk over this table:
 * coercion from disk, the env projection, the env seed, the masked client view,
 * and the PUT validator in routes/settings.ts.
 *
 * This list used to be spelled out seven times (the interface, DEFAULT_SETTINGS,
 * coerce, applyToEnv, settingsFromEnv, toView, and the route validator), so
 * adding a provider meant editing all of them in lockstep. That is not
 * hypothetical: the `llm` translate provider shipped rejectable because the
 * route carried an inline copy of the provider list the UI already offered.
 *
 * `kind` drives behaviour:
 *   enum   — must be one of `values`
 *   url    — trimmed string; if non-empty must start http:// or https://
 *   secret — string, never echoed back (toView emits `<key>_set: boolean`)
 *   text   — trimmed string
 *   bool   — boolean
 *   num    — finite number, floored at `min`
 *   locales— array of locale-shaped codes (reaches docker as LT_LOAD_ONLY)
 *
 * `env` is the variable applyToEnv projects onto. `alwaysSet` writes even when
 * empty (a provider must always be present); the rest clear the var instead.
 */
type FieldKind = 'enum' | 'url' | 'secret' | 'text' | 'bool' | 'num' | 'locales'

interface FieldSpec {
  key: keyof AppSettings
  kind: FieldKind
  /** Env var applyToEnv projects onto (absent = derived//not projected). */
  env?: string
  /** Allowed values for `kind: 'enum'`. */
  values?: readonly string[]
  /** Lower bound for `kind: 'num'`. */
  min?: number
  /** Write the env var even when the value is empty. */
  alwaysSet?: boolean
}

const FIELDS: readonly FieldSpec[] = [
  // ── Translate ──
  { key: 'translate_provider',     kind: 'enum',   env: 'TRANSLATE_PROVIDER', values: TRANSLATE_PROVIDERS, alwaysSet: true },
  // Projected by applyToEnv's docker override, not the generic walk.
  { key: 'libretranslate_url',     kind: 'url' },
  { key: 'libretranslate_api_key', kind: 'secret', env: 'LIBRETRANSLATE_API_KEY' },
  { key: 'translate_docker',       kind: 'bool' },
  { key: 'deepl_api_key',          kind: 'secret', env: 'DEEPL_API_KEY' },
  { key: 'google_api_key',         kind: 'secret', env: 'GOOGLE_TRANSLATE_API_KEY' },
  { key: 'azure_api_key',          kind: 'secret', env: 'AZURE_TRANSLATOR_KEY' },
  { key: 'azure_region',           kind: 'text',   env: 'AZURE_TRANSLATOR_REGION' },
  { key: 'translate_languages',    kind: 'locales' },
  // ── Backup / sync ──
  { key: 'backup_dir',             kind: 'text',   env: 'RESUME_BACKUP_DIR' },
  { key: 'backup_interval_ms',     kind: 'num',    env: 'RESUME_BACKUP_INTERVAL_MS', min: 5_000, alwaysSet: true },
  // ── Summarize ──
  { key: 'summarize_provider',     kind: 'enum',   env: 'SUMMARIZE_PROVIDER', values: SUMMARIZE_PROVIDERS, alwaysSet: true },
  { key: 'summarize_ollama_url',   kind: 'url' }, // docker override, see applyToEnv
  { key: 'summarize_docker',       kind: 'bool' },
  { key: 'summarize_openai_api_key',    kind: 'secret', env: 'SUMMARIZE_OPENAI_API_KEY' },
  { key: 'summarize_compat_url',        kind: 'url',    env: 'SUMMARIZE_COMPAT_URL' },
  { key: 'summarize_compat_api_key',    kind: 'secret', env: 'SUMMARIZE_COMPAT_API_KEY' },
  { key: 'summarize_anthropic_api_key', kind: 'secret', env: 'SUMMARIZE_ANTHROPIC_API_KEY' },
  { key: 'summarize_gemini_api_key',    kind: 'secret', env: 'SUMMARIZE_GEMINI_API_KEY' },
  { key: 'summarize_mistral_api_key',   kind: 'secret', env: 'SUMMARIZE_MISTRAL_API_KEY' },
  { key: 'summarize_model',             kind: 'text',   env: 'SUMMARIZE_MODEL' },
]

/**
 * Validate an untrusted PATCH body against the field table.
 *
 * Only keys actually PRESENT in the body are touched: the GET masks secrets, so
 * an unchanged form omits them and the stored value must stand. Returns the
 * typed patch, or the first error for a 400.
 *
 * This lives here rather than in routes/settings.ts on purpose — the route's
 * own inline copy of the provider list is how the `llm` translate provider
 * shipped rejectable (the UI offered it, the route 400'd it).
 */
export function validateSettingsPatch(
  body: Record<string, unknown>,
): { patch: Partial<AppSettings> } | { error: string } {
  const patch: Record<string, unknown> = {}
  for (const f of FIELDS) {
    if (!(f.key in body)) continue
    const v = body[f.key]
    switch (f.kind) {
      case 'enum':
        if (!(f.values as string[]).includes(String(v))) {
          return { error: `${f.key} must be one of ${(f.values ?? []).join('/')}` }
        }
        patch[f.key] = v
        break
      case 'bool':
        if (typeof v !== 'boolean') return { error: `${f.key} must be a boolean` }
        patch[f.key] = v
        break
      case 'num':
        if (typeof v !== 'number' || !Number.isFinite(v) || (f.min !== undefined && v < f.min)) {
          return { error: `${f.key} must be a number >= ${f.min ?? 0}` }
        }
        patch[f.key] = v
        break
      case 'url': {
        if (typeof v !== 'string') return { error: `${f.key} must be a string` }
        const trimmed = v.trim()
        if (trimmed && !/^https?:\/\//i.test(trimmed)) {
          return { error: `${f.key} must start with http:// or https://` }
        }
        patch[f.key] = trimmed
        break
      }
      case 'locales': {
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
          return { error: `${f.key} must be an array of strings` }
        }
        // These land in LT_LOAD_ONLY, which reaches `docker compose` as an env
        // var — constrain them rather than trusting input.
        const codes = (v as string[]).map((x) => x.trim().toLowerCase())
        if (codes.some((x) => !LOCALE_RE.test(x))) {
          return { error: `${f.key} must contain locale codes` }
        }
        patch[f.key] = [...new Set(codes)]
        break
      }
      default: // secret | text
        if (typeof v !== 'string') return { error: `${f.key} must be a string` }
        patch[f.key] = f.kind === 'text' ? v.trim() : v
        break
    }
  }
  return { patch: patch as Partial<AppSettings> }
}

/** A locale-shaped token, the only thing allowed into LT_LOAD_ONLY. */
const LOCALE_RE = /^[a-z]{2,8}(-[a-z]{2,8})?$/

/**
 * Locale codes for the Docker translate install. Untrusted-file surface: this
 * value reaches `docker compose` as an env var, so it is constrained to short
 * a-z/dash codes rather than passed through. A non-array (or one with nothing
 * usable left) falls back to the default rather than installing nothing.
 */
function coerceLocales(v: unknown): string[] {
  if (!Array.isArray(v)) return [...DEFAULT_SETTINGS.translate_languages]
  const out = [...new Set(
    v.filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().toLowerCase())
      .filter((x) => LOCALE_RE.test(x)),
  )]
  return out.length ? out : [...DEFAULT_SETTINGS.translate_languages]
}

/** Coerce one field's raw value per its `kind`, falling back to the default. */
function coerceField(f: FieldSpec, raw: unknown): AppSettings[keyof AppSettings] {
  const dflt = DEFAULT_SETTINGS[f.key]
  switch (f.kind) {
    case 'enum':
      return (f.values as string[]).includes(String(raw)) ? (raw as string) : dflt
    case 'bool':
      return raw === true
    case 'num': {
      const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : (dflt as number)
      return f.min !== undefined ? Math.max(f.min, n) : n
    }
    case 'locales':
      return coerceLocales(raw)
    // url / secret / text are all trimmed strings. Trimming a key is safe and
    // was already the rule for every secret except libretranslate_api_key,
    // whose copy simply omitted it.
    default:
      return typeof raw === 'string' ? raw.trim() : (dflt as string)
  }
}

/** Coerce an arbitrary parsed object into a complete, typed settings record. */
function coerce(raw: unknown): AppSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_SETTINGS }
  for (const f of FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any)[f.key] = coerceField(f, o[f.key])
  }
  return out
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
 * The effective LibreTranslate / Ollama base URL: the app-managed Docker URL
 * when this provider is Docker-managed, else whatever the user configured.
 * Shared by applyToEnv and the settingsTo*Config mappers so they can't drift.
 */
function effectiveLibreUrl(s: AppSettings): string {
  return s.translate_provider === 'libretranslate' && s.translate_docker
    ? DOCKER_TRANSLATE_URL
    : s.libretranslate_url
}

function effectiveOllamaUrl(s: AppSettings): string {
  return s.summarize_provider === 'ollama' && s.summarize_docker
    ? DOCKER_OLLAMA_URL
    : s.summarize_ollama_url
}

/**
 * Push settings onto process.env so the lazily-env-reading translate + backup
 * code sees them, with no restart. Empty values clear their variable unless the
 * field is `alwaysSet`.
 *
 * Three fields aren't a straight projection and are handled explicitly: the two
 * base URLs (whose effective value depends on the docker toggle) and the Argos
 * language list (which is rendered by `ltLoadOnly`).
 */
export function applyToEnv(s: AppSettings): void {
  for (const f of FIELDS) {
    if (!f.env) continue
    const v = s[f.key]
    if (f.alwaysSet) process.env[f.env] = String(v)
    else setOrClear(f.env, typeof v === 'string' ? v : String(v))
  }
  setOrClear('LIBRETRANSLATE_URL', effectiveLibreUrl(s))
  setOrClear('SUMMARIZE_OLLAMA_URL', effectiveOllamaUrl(s))
  // docker-compose.yml reads LT_LOAD_ONLY, so this must be on the env before
  // the container starts.
  process.env.LT_LOAD_ONLY = ltLoadOnly(s.translate_languages)
}

/** Map persisted settings to a SummarizeConfig (mirrors settingsToTranslateConfig). */
export function settingsToSummarizeConfig(s: AppSettings): SummarizeConfig {
  const ollamaUrl = (s.summarize_provider === 'ollama' && s.summarize_docker) ? DOCKER_OLLAMA_URL : s.summarize_ollama_url
  return {
    provider: s.summarize_provider,
    ollama: { url: (ollamaUrl || DOCKER_OLLAMA_URL).replace(/\/+$/, '') },
    openai: { apiKey: s.summarize_openai_api_key },
    compat: { url: s.summarize_compat_url.replace(/\/+$/, ''), apiKey: s.summarize_compat_api_key },
    anthropic: { apiKey: s.summarize_anthropic_api_key },
    gemini: { apiKey: s.summarize_gemini_api_key },
    mistral: { apiKey: s.summarize_mistral_api_key },
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
 * A settings record synthesised from the current env — the first-run seed on
 * the desktop build, and the read-only view on a server build. ONE builder for
 * both so the two can't drift.
 *
 * Read straight off the field table: a field with an `env` var takes its value
 * from there. The three fields with no plain projection are seeded explicitly
 * below.
 */
function settingsFromEnv(): AppSettings {
  const raw: Record<string, unknown> = {}
  for (const f of FIELDS) {
    if (!f.env) continue
    const v = process.env[f.env]
    if (v === undefined) continue
    raw[f.key] = f.kind === 'num' ? Number(v) : v
  }
  // Back-compat: an instance that only ever set LIBRETRANSLATE_URL (before the
  // provider setting existed) still means "use libretranslate".
  raw.translate_provider = process.env.TRANSLATE_PROVIDER?.trim()
    || (process.env.LIBRETRANSLATE_URL?.trim() ? 'libretranslate' : 'off')
  raw.libretranslate_url = process.env.LIBRETRANSLATE_URL ?? ''
  raw.summarize_ollama_url = process.env.SUMMARIZE_OLLAMA_URL ?? ''
  // Docker management is a desktop-only choice, never inherited from env.
  raw.translate_docker = false
  raw.summarize_docker = false
  return coerce(raw)
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
  const seeded = settingsFromEnv()
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
  return isDesktop() ? loadSettings() : settingsFromEnv()
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
  summarize_anthropic_api_key_set: boolean
  summarize_gemini_api_key_set: boolean
  summarize_mistral_api_key_set: boolean
  summarize_model: string
}

export function toView(s: AppSettings): SettingsView {
  const out: Record<string, unknown> = {}
  for (const f of FIELDS) {
    // A secret is reported only as "is it set", never echoed back.
    if (f.kind === 'secret') out[`${f.key}_set`] = String(s[f.key]).trim().length > 0
    else out[f.key] = s[f.key]
  }
  return out as unknown as SettingsView
}
