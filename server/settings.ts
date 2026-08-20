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
import {
  DEFAULT_SENDMAIL_PATH, isValidEmailAddress, MAIL_TRANSPORTS, SMTP_SECURITIES,
  type MailConfig, type MailTransport, type SmtpSecurity,
} from './mail.js'

export const SETTINGS_FILENAME = 'settings.json'

/** Fixed URL the app uses when it manages a local Docker LibreTranslate. */
export const DOCKER_TRANSLATE_URL = 'http://localhost:5000'
/** Fixed URL the app uses when it manages a local Docker Ollama. */
export const DOCKER_OLLAMA_URL = DEFAULT_OLLAMA_URL

export interface AppSettings {
  /**
   * Who is using this desktop install.
   *
   * The desktop build has no accounts and never asks anyone to log in — one
   * person, own machine, loopback. It still needs to know whose CVs these are,
   * for two reasons: `saved_by` should read "Kari Nordmann" rather than nothing,
   * and a resume that later moves to a shared instance should arrive carrying
   * its author instead of arriving anonymous. These are the same three fields an
   * account has, so the move is a match rather than a re-entry.
   *
   * Purely local identity: nothing here authenticates anything.
   */
  user_username: string
  user_display_name: string
  user_email: string
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
  // ── Outbound email (optional; see server/mail.ts) ──
  //
  // Off by default, and the only feature it unlocks is self-service password
  // reset. Nothing else in the app sends mail.
  /** Which transport sends the message ('off' = the app never sends mail). */
  mail_transport: MailTransport
  /** Envelope sender and `From:`. Also the domain the SMTP client EHLOs as. */
  mail_from: string
  /** Path to the local sendmail-compatible binary (transport=sendmail). */
  sendmail_path: string
  /** SMTP relay host (transport=smtp). */
  smtp_host: string
  /** SMTP port. 0 = the standard port for `smtp_security` (465 / 587 / 25). */
  smtp_port: number
  /** Implicit TLS, STARTTLS, or an unencrypted relay (a local one). */
  smtp_security: SmtpSecurity
  /** SMTP username (empty = no AUTH attempted). */
  smtp_user: string
  /** SMTP password. */
  smtp_pass: string
  /**
   * Absolute base URL this instance is reached at (e.g. https://cv.example.com).
   * A reset link has to be absolute, and one built from the request's Host
   * header is a link whoever sent the request chooses — pointed at their own
   * server, it collects the credential instead of delivering it.
   */
  app_base_url: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  user_username: '',
  user_display_name: '',
  user_email: '',
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
  mail_transport: 'off',
  mail_from: '',
  sendmail_path: DEFAULT_SENDMAIL_PATH,
  smtp_host: '',
  smtp_port: 0,
  smtp_security: 'starttls',
  smtp_user: '',
  smtp_pass: '',
  app_base_url: '',
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
 *   email  — empty, or an address safe to put in a header (see mail.ts)
 *
 * `env` is the variable applyToEnv projects onto. `alwaysSet` writes even when
 * empty (a provider must always be present); the rest clear the var instead.
 */
type FieldKind = 'enum' | 'url' | 'secret' | 'text' | 'bool' | 'num' | 'locales' | 'host' | 'email'

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
  // ── Who is using this install (desktop; see AppSettings) ──
  { key: 'user_username',     kind: 'text',  env: 'RESUME_USER_USERNAME' },
  { key: 'user_display_name', kind: 'text',  env: 'RESUME_USER_DISPLAY_NAME' },
  { key: 'user_email',        kind: 'email', env: 'RESUME_USER_EMAIL' },
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
  // ── Outbound email (see server/mail.ts) ──
  // The SMTP_* / MAIL_* names are the conventional ones every relay's docs use;
  // app_base_url is the app's own configuration, hence the RESUME_ prefix.
  { key: 'mail_transport', kind: 'enum',   env: 'MAIL_TRANSPORT', values: MAIL_TRANSPORTS, alwaysSet: true },
  { key: 'mail_from',      kind: 'email',  env: 'MAIL_FROM' },
  { key: 'sendmail_path',  kind: 'text',   env: 'SENDMAIL_PATH' },
  { key: 'smtp_host',      kind: 'text',   env: 'SMTP_HOST' },
  { key: 'smtp_port',      kind: 'num',    env: 'SMTP_PORT', min: 0, max: 65535 },
  { key: 'smtp_security',  kind: 'enum',   env: 'SMTP_SECURITY', values: SMTP_SECURITIES, alwaysSet: true },
  { key: 'smtp_user',      kind: 'text',   env: 'SMTP_USER' },
  { key: 'smtp_pass',      kind: 'secret', env: 'SMTP_PASS' },
  { key: 'app_base_url',   kind: 'url',    env: 'RESUME_APP_BASE_URL' },
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
      case 'email': {
        if (typeof v !== 'string') return { error: `${f.key} must be a string` }
        const trimmed = trimSpaces(v)
        // Empty is a real value ("mail is not configured"). Anything else faces
        // the same gate the send path uses: this value lands in a From: header,
        // where a control character writes a header of the caller's choosing.
        if (trimmed && !isValidEmailAddress(trimmed)) {
          return { error: `${f.key} must be an email address` }
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
 * Padding spaces only — the trim for `kind: 'email'`.
 *
 * Every other kind uses `String.trim()`, which also strips CR and LF. For a
 * value that lands in a mail header, quietly removing the two characters that
 * inject one is precisely the sanitising server/mail.ts refuses to do: a pasted
 * space is forgiven, a control character is a rejection.
 */
function trimSpaces(v: string): string {
  return v.replace(/^ +| +$/g, '')
}

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
    // An invalid stored address falls back to empty, which reads as "mail is
    // not configured" rather than being written into a header unchecked.
    case 'email': {
      const address = typeof raw === 'string' ? trimSpaces(raw) : ''
      return isValidEmailAddress(address) ? address : ''
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

/**
 * Read settings.json, or null when there is no readable one.
 *
 * Distinct from `loadSettings`, which substitutes defaults: a server needs to
 * tell "the owner saved nothing" from "the owner saved the default", because
 * only the first should fall through to the environment.
 */
/**
 * The settings file exactly as written, WITHOUT coerce's defaults filled in.
 *
 * The distinction is load-bearing. `coerce` returns every key, so a caller
 * asking "did the owner set this one?" of a coerced object always hears yes,
 * and both env-projection paths below asked exactly that. On a hosted instance
 * they answered by writing defaults over the real environment.
 */
function parseSettingsFile(): Record<string, unknown> | null {
  const file = settingsFilePath()
  if (!fs.existsSync(file)) return null
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
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

/**
 * Atomically write settings.json (temp file + rename), 0600 best-effort.
 *
 * Takes a loose record because a server's file is a SPARSE overlay of the
 * owner-editable keys, not a whole AppSettings snapshot — see saveSettings.
 */
function writeSettings(settings: AppSettings | Record<string, unknown>): void {
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

/** Map persisted settings to a MailConfig (mirrors settingsToLlmConfig). */
export function settingsToMailConfig(s: AppSettings): MailConfig {
  return {
    transport: s.mail_transport,
    from: s.mail_from,
    sendmailPath: s.sendmail_path || DEFAULT_SENDMAIL_PATH,
    smtp: {
      host: s.smtp_host,
      port: s.smtp_port,
      security: s.smtp_security,
      user: s.smtp_user,
      pass: s.smtp_pass,
    },
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

/**
 * Merge a partial update over the current settings, persist, and apply to env.
 *
 * The desktop build's file is authoritative for everything, so it is written as
 * a whole snapshot. A SERVER's file is a sparse overlay of the owner-editable
 * keys on top of the environment, and writing a snapshot there was destructive:
 * `loadSettings()` answers DEFAULT_SETTINGS when no file exists, so the first
 * time an owner saved any single field, every other key was written too — and
 * since anything the file holds wins at startup, that handed the whole default
 * set authority over the operator's environment. `applyToEnv` then projected it
 * onto the LIVE process, including the machine-level keys a web request is
 * never allowed to move. Hence: persist only what was actually set, and project
 * only the owner-editable keys.
 */
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  if (isDesktop()) {
    const merged = coerce({ ...loadSettings(), ...patch })
    writeSettings(merged)
    applyToEnv(merged)
    return merged
  }
  const raw = parseSettingsFile() ?? {}
  for (const key of OWNER_EDITABLE_KEYS) {
    if (Object.hasOwn(patch, key)) raw[key] = patch[key]
  }
  writeSettings(raw)
  applyServerSettings()
  return currentSettings()
}

/**
 * The settings a SERVER owner may change from inside the app, and therefore the
 * only ones that persist to `settings.json` on a hosted instance.
 *
 * Lives here rather than in the route because it is a property of the fields:
 * everything else — ports, the local hostname, the sync folder — is a property
 * of the machine, and a web request that could move those is how an instance
 * talks itself off the network.
 */
export const OWNER_EDITABLE_KEYS: readonly (keyof AppSettings)[] = [
  'mail_transport', 'mail_from', 'sendmail_path',
  'smtp_host', 'smtp_port', 'smtp_security', 'smtp_user', 'smtp_pass',
  'app_base_url',
  'user_username', 'user_display_name', 'user_email',
]

/**
 * Current settings.
 *
 * The desktop build's `settings.json` is authoritative for everything. A server
 * is env-driven, EXCEPT for the keys its owner can edit in the app — those are
 * read back from the file, or an owner would configure mail, watch it work, and
 * find it gone after the next restart. Which is exactly what happened.
 */
export function currentSettings(): AppSettings {
  if (isDesktop()) return loadSettings()
  const fromEnv = settingsFromEnv()
  const raw = parseSettingsFile()
  if (!raw) return fromEnv
  const saved = coerce(raw)
  const merged = { ...fromEnv }
  for (const key of OWNER_EDITABLE_KEYS) {
    // hasOwn on the RAW object, never `saved[key] !== undefined`: saved is
    // coerced, so every key is present and that test is always true.
    if (Object.hasOwn(raw, key)) (merged as Record<string, unknown>)[key] = saved[key]
  }
  return merged
}

/**
 * Apply the persisted owner-editable settings onto env at server startup.
 *
 * The value saved in the app wins over the environment for these keys, and only
 * these: the owner set them deliberately and more recently, and if env won, the
 * settings screen would accept an edit that silently reverted. Machine-level
 * keys are not writable through the app at all, so there is no conflict to
 * resolve for them.
 */
export function applyServerSettings(): void {
  if (isDesktop()) return
  const raw = parseSettingsFile()
  if (!raw) return
  const saved = coerce(raw)
  for (const f of FIELDS) {
    if (!f.env || !OWNER_EDITABLE_KEYS.includes(f.key)) continue
    // hasOwn on the RAW object. Guarding on the coerced value instead was a
    // guard that never fired, so every owner-editable key the file did not
    // carry was projected as its DEFAULT over the operator's environment:
    // RESUME_APP_BASE_URL and SMTP_HOST cleared, and MAIL_TRANSPORT — which is
    // alwaysSet — forced to off. Invite and reset links came out as bare paths
    // and mail stopped, silently, on the deployment this branch exists for.
    if (!Object.hasOwn(raw, f.key)) continue
    const v = saved[f.key]
    const text = f.kind === 'bool' ? (v === true ? '1' : '') : String(v)
    if (f.alwaysSet) process.env[f.env] = text
    else setOrClear(f.env, text)
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
  mail_transport: MailTransport
  mail_from: string
  sendmail_path: string
  smtp_host: string
  smtp_port: number
  smtp_security: SmtpSecurity
  smtp_user: string
  smtp_pass_set: boolean
  app_base_url: string
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
