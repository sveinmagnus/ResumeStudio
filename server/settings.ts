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
import { DEFAULT_OLLAMA_URL, LLM_PROVIDERS, type LlmConfig, type LlmProvider } from './llm.js'
import { isValidLocalHostname } from './localHost.js'

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
  // ── Local address (desktop) ──
  /**
   * The name this machine reaches the app at instead of `127.0.0.1`
   * (`resumestudio.localhost` / `resumestudio.local`). Empty = the IP.
   * Also widens the desktop Host guard — see server/app.ts.
   */
  local_hostname: string
  /**
   * Preferred TCP port. 0 = the automatic ladder (80, then 1923, then up),
   * which is what makes the name usable without a port suffix on a machine
   * where 80 happens to be free — and keeps working on one running IIS.
   */
  local_port: number
  /** Cloud-synced folder for the whole-store JSON backup (empty = sync off). */
  backup_dir: string
  /** How often (ms) to refresh the backup while running. */
  backup_interval_ms: number
  // ── AI assist (the one LLM behind every assist) ──
  //
  // These were `summarize_*` until the model stopped being just a summarizer.
  // The old key names are still READ from an existing settings.json (see
  // `legacyKey` in the field table) so an upgrade doesn't silently drop a
  // configured provider and API key.
  /** Which LLM backend powers the AI assists ('off' = no AI features at all). */
  llm_provider: LlmProvider
  /** Remote Ollama base URL (ignored when llm_docker manages a local one). */
  llm_ollama_url: string
  /** When provider=ollama, run/use the local Docker Ollama at DOCKER_OLLAMA_URL. */
  llm_docker: boolean
  /** OpenAI API key (provider=openai). */
  llm_openai_api_key: string
  /** Base URL for a generic OpenAI-compatible endpoint (provider=compat). */
  llm_compat_url: string
  /** Optional API key for the compat endpoint. */
  llm_compat_api_key: string
  /** Anthropic (Claude) API key (provider=anthropic). */
  llm_anthropic_api_key: string
  /** Google Gemini API key (provider=gemini). */
  llm_gemini_api_key: string
  /** Mistral API key (provider=mistral). */
  llm_mistral_api_key: string
  /** Chat model name (e.g. 'llama3.2:3b', 'gpt-4o-mini', 'claude-opus-4-5'). */
  llm_model: string
  /**
   * The user's declaration that the configured model is strong enough for the
   * ADVANCED assists (whole-CV review, positioning, cross-language semantics).
   * Declared rather than sniffed — see LlmConfig.highEnd.
   */
  llm_high_end: boolean
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
  local_hostname: '',
  local_port: 0,
  backup_dir: '',
  backup_interval_ms: 60_000,
  llm_provider: 'off',
  llm_ollama_url: '',
  llm_docker: false,
  llm_openai_api_key: '',
  llm_compat_url: '',
  llm_compat_api_key: '',
  llm_anthropic_api_key: '',
  llm_gemini_api_key: '',
  llm_mistral_api_key: '',
  llm_model: '',
  llm_high_end: false,
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
 * Spelling the list out per consumer (the interface, DEFAULT_SETTINGS, coerce,
 * applyToEnv, settingsFromEnv, toView, the route validator) means adding a
 * provider in seven places in lockstep. That failure is not hypothetical: the
 * `llm` translate provider shipped rejectable because the route carried an
 * inline copy of the provider list the UI already offered.
 *
 * `kind` drives behaviour:
 *   enum   — must be one of `values`
 *   url    — trimmed string; if non-empty must start http:// or https://
 *   secret — string, never echoed back (toView emits `<key>_set: boolean`)
 *   text   — trimmed string
 *   bool   — boolean
 *   num    — finite number, floored at `min` (and capped at `max`)
 *   locales— array of locale-shaped codes (reaches docker as LT_LOAD_ONLY)
 *   host   — empty, or a valid .local/.localhost name (see localHost.ts)
 *
 * `env` is the variable applyToEnv projects onto. `alwaysSet` writes even when
 * empty (a provider must always be present); the rest clear the var instead.
 */
type FieldKind = 'enum' | 'url' | 'secret' | 'text' | 'bool' | 'num' | 'locales' | 'host'

interface FieldSpec {
  key: keyof AppSettings
  kind: FieldKind
  /** Env var applyToEnv projects onto (absent = derived//not projected). */
  env?: string
  /** Allowed values for `kind: 'enum'`. */
  values?: readonly string[]
  /** Lower bound for `kind: 'num'`. */
  min?: number
  /** Upper bound for `kind: 'num'`. */
  max?: number
  /** Write the env var even when the value is empty. */
  alwaysSet?: boolean
  /**
   * A previous name for this setting, still read from an existing settings.json
   * when the current key is absent. The `summarize_*` → `llm_*` rename would
   * otherwise reset every desktop user's provider, model and API key to the
   * defaults on upgrade — silently, since a missing key coerces to "off".
   * Write-side is unaffected: saving always writes the current key.
   */
  legacyKey?: string
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
  // ── Local address ──
  // RESUME_LOCAL_HOSTNAME is read by the desktop Host guard (app.ts) as well as
  // the launcher, so it has to reach env, not just the launcher's own scope.
  { key: 'local_hostname',         kind: 'host',   env: 'RESUME_LOCAL_HOSTNAME' },
  { key: 'local_port',             kind: 'num',    env: 'RESUME_LOCAL_PORT', min: 0, max: 65535 },
  // ── Backup / sync ──
  { key: 'backup_dir',             kind: 'text',   env: 'RESUME_BACKUP_DIR' },
  { key: 'backup_interval_ms',     kind: 'num',    env: 'RESUME_BACKUP_INTERVAL_MS', min: 5_000, alwaysSet: true },
  // ── AI assist (renamed from summarize_*; legacyKey keeps old files working) ──
  { key: 'llm_provider',     kind: 'enum',   env: 'LLM_PROVIDER', values: LLM_PROVIDERS, alwaysSet: true, legacyKey: 'summarize_provider' },
  { key: 'llm_ollama_url',   kind: 'url',    legacyKey: 'summarize_ollama_url' }, // docker override, see applyToEnv
  { key: 'llm_docker',       kind: 'bool',   legacyKey: 'summarize_docker' },
  { key: 'llm_openai_api_key',    kind: 'secret', env: 'LLM_OPENAI_API_KEY',    legacyKey: 'summarize_openai_api_key' },
  { key: 'llm_compat_url',        kind: 'url',    env: 'LLM_COMPAT_URL',        legacyKey: 'summarize_compat_url' },
  { key: 'llm_compat_api_key',    kind: 'secret', env: 'LLM_COMPAT_API_KEY',    legacyKey: 'summarize_compat_api_key' },
  { key: 'llm_anthropic_api_key', kind: 'secret', env: 'LLM_ANTHROPIC_API_KEY', legacyKey: 'summarize_anthropic_api_key' },
  { key: 'llm_gemini_api_key',    kind: 'secret', env: 'LLM_GEMINI_API_KEY',    legacyKey: 'summarize_gemini_api_key' },
  { key: 'llm_mistral_api_key',   kind: 'secret', env: 'LLM_MISTRAL_API_KEY',   legacyKey: 'summarize_mistral_api_key' },
  { key: 'llm_model',             kind: 'text',   env: 'LLM_MODEL',             legacyKey: 'summarize_model' },
  { key: 'llm_high_end',          kind: 'bool',   env: 'LLM_HIGH_END' },
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
        if (f.max !== undefined && v > f.max) return { error: `${f.key} must be <= ${f.max}` }
        patch[f.key] = v
        break
      case 'host': {
        if (typeof v !== 'string') return { error: `${f.key} must be a string` }
        const trimmed = v.trim().toLowerCase()
        // Empty is a real value: "go back to using the IP".
        if (trimmed && !isValidLocalHostname(trimmed)) {
          return { error: `${f.key} must be a .local or .localhost name` }
        }
        patch[f.key] = trimmed
        break
      }
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
      // secret | text
      default:
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
      const floored = f.min !== undefined ? Math.max(f.min, n) : n
      return f.max !== undefined ? Math.min(f.max, floored) : floored
    }
    // An invalid stored name falls back to empty (the IP) rather than being
    // written onto the Host guard's allow-list unchecked.
    case 'host': {
      const h = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
      return isValidLocalHostname(h) ? h : ''
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

/**
 * Coerce an arbitrary parsed object into a complete, typed settings record.
 *
 * A field whose current key is absent falls back to its `legacyKey`, so a
 * settings.json written before the `summarize_*` → `llm_*` rename still
 * configures the app. `in` rather than `??` on purpose: an explicitly-stored
 * empty string is a real value ("I cleared this key"), not a reason to reach
 * back to the old one.
 */
function coerce(raw: unknown): AppSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_SETTINGS }
  for (const f of FIELDS) {
    const value = (f.key in o) || !f.legacyKey ? o[f.key] : o[f.legacyKey];
    // The semicolon above is load-bearing: the next line starts with '(' and
    // would otherwise be parsed as a call on this expression.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically-keyed write onto a typed settings object; the key is validated above
    (out as any)[f.key] = coerceField(f, value)
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
  return s.llm_provider === 'ollama' && s.llm_docker
    ? DOCKER_OLLAMA_URL
    : s.llm_ollama_url
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
    // A boolean projects as '1' / cleared, never the string "false" — every
    // env-reading consumer tests truthiness, and "false" is a truthy string.
    const text = f.kind === 'bool' ? (v === true ? '1' : '') : (typeof v === 'string' ? v : String(v))
    if (f.alwaysSet) process.env[f.env] = text
    else setOrClear(f.env, text)
  }
  setOrClear('LIBRETRANSLATE_URL', effectiveLibreUrl(s))
  setOrClear('LLM_OLLAMA_URL', effectiveOllamaUrl(s))
  // docker-compose.yml reads LT_LOAD_ONLY, so this must be on the env before
  // the container starts.
  process.env.LT_LOAD_ONLY = ltLoadOnly(s.translate_languages)
}

/** Map persisted settings to an LlmConfig (mirrors settingsToTranslateConfig). */
export function settingsToLlmConfig(s: AppSettings): LlmConfig {
  return {
    provider: s.llm_provider,
    ollama: { url: (effectiveOllamaUrl(s) || DOCKER_OLLAMA_URL).replace(/\/+$/, '') },
    openai: { apiKey: s.llm_openai_api_key },
    compat: { url: s.llm_compat_url.replace(/\/+$/, ''), apiKey: s.llm_compat_api_key },
    anthropic: { apiKey: s.llm_anthropic_api_key },
    gemini: { apiKey: s.llm_gemini_api_key },
    mistral: { apiKey: s.llm_mistral_api_key },
    model: s.llm_model,
    highEnd: s.llm_high_end,
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
    // An LLM_* var falls back to its pre-rename SUMMARIZE_* name, so a
    // deployment configured before the rename keeps working (see llm.ts).
    const v = process.env[f.env] ?? (f.env.startsWith('LLM_')
      ? process.env[f.env.replace(/^LLM_/, 'SUMMARIZE_')]
      : undefined)
    if (v === undefined) continue
    if (f.kind === 'num') raw[f.key] = Number(v)
    else if (f.kind === 'bool') raw[f.key] = ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())
    else raw[f.key] = v
  }
  // Back-compat: an instance that only ever set LIBRETRANSLATE_URL (before the
  // provider setting existed) still means "use libretranslate".
  raw.translate_provider = process.env.TRANSLATE_PROVIDER?.trim()
    || (process.env.LIBRETRANSLATE_URL?.trim() ? 'libretranslate' : 'off')
  raw.libretranslate_url = process.env.LIBRETRANSLATE_URL ?? ''
  raw.llm_ollama_url = process.env.LLM_OLLAMA_URL ?? process.env.SUMMARIZE_OLLAMA_URL ?? ''
  // Docker management is a desktop-only choice, never inherited from env.
  raw.translate_docker = false
  raw.llm_docker = false
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
  local_hostname: string
  local_port: number
  backup_dir: string
  backup_interval_ms: number
  llm_provider: LlmProvider
  llm_ollama_url: string
  llm_docker: boolean
  llm_openai_api_key_set: boolean
  llm_compat_url: string
  llm_compat_api_key_set: boolean
  llm_anthropic_api_key_set: boolean
  llm_gemini_api_key_set: boolean
  llm_mistral_api_key_set: boolean
  llm_model: string
  llm_high_end: boolean
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
