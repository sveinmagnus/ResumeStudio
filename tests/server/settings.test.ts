import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  loadOrInitSettings, loadSettings, saveSettings, applyToEnv, toView,
  isDesktop, settingsFilePath, DOCKER_TRANSLATE_URL, DOCKER_OLLAMA_URL, DEFAULT_SETTINGS,
  validateSettingsPatch, settingsToMailConfig, settingsToLlmConfig, settingsToTranslateConfig,
  applyServerSettings, currentSettings,
}  from '../../server/settings'
import { TRANSLATE_PROVIDERS } from '../../server/translate'
import { LLM_PROVIDERS } from '../../server/llm'
import { MAIL_TRANSPORTS, SMTP_SECURITIES, isMailConfigured, DEFAULT_SENDMAIL_PATH } from '../../server/mail'

const ENV_KEYS = [
  'RESUME_DATA_DIR', 'RESUME_DESKTOP', 'LIBRETRANSLATE_URL', 'LIBRETRANSLATE_API_KEY',
  'RESUME_LOCAL_HOSTNAME', 'RESUME_LOCAL_PORT',
  'RESUME_BACKUP_DIR', 'RESUME_BACKUP_INTERVAL_MS', 'TRANSLATE_PROVIDER',
  'DEEPL_API_KEY', 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION',
  'MAIL_TRANSPORT', 'MAIL_FROM', 'SENDMAIL_PATH', 'SMTP_HOST', 'SMTP_PORT',
  'SMTP_SECURITY', 'SMTP_USER', 'SMTP_PASS', 'RESUME_APP_BASE_URL',
  'RESUME_USER_USERNAME', 'RESUME_USER_DISPLAY_NAME', 'RESUME_USER_EMAIL',
  'RESUME_LOCAL_HOSTNAME', 'RESUME_LOCAL_PORT', 'LT_LOAD_ONLY',
  'LLM_PROVIDER', 'LLM_OLLAMA_URL', 'LLM_OPENAI_API_KEY', 'LLM_COMPAT_URL', 'LLM_COMPAT_API_KEY',
  'LLM_ANTHROPIC_API_KEY', 'LLM_GEMINI_API_KEY', 'LLM_MISTRAL_API_KEY', 'LLM_MODEL', 'LLM_HIGH_END',
  'SUMMARIZE_PROVIDER', 'SUMMARIZE_MODEL', 'SUMMARIZE_OLLAMA_URL',
]
const savedEnv: Record<string, string | undefined> = {}
let dir: string

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-set-'))
  process.env.RESUME_DATA_DIR = dir
})
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('isDesktop', () => {
  it('reflects RESUME_DESKTOP', () => {
    expect(isDesktop()).toBe(false)
    process.env.RESUME_DESKTOP = '1'
    expect(isDesktop()).toBe(true)
  })

  it('treats a whitespace-only value as unset', () => {
    process.env.RESUME_DESKTOP = '   '
    expect(isDesktop()).toBe(false)
  })
})

describe('loadOrInitSettings', () => {
  it('creates a settings file with defaults on first run', () => {
    const s = loadOrInitSettings()
    expect(fs.existsSync(settingsFilePath())).toBe(true)
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  it('seeds from existing env on first run (preserves shim/system values)', () => {
    process.env.LIBRETRANSLATE_URL = 'https://lt.example.com'
    process.env.RESUME_BACKUP_DIR = '/drive/rs'
    const s = loadOrInitSettings()
    expect(s.libretranslate_url).toBe('https://lt.example.com')
    expect(s.backup_dir).toBe('/drive/rs')
    // Persisted, so a later load (env now empty) still has them.
    delete process.env.LIBRETRANSLATE_URL
    expect(loadSettings().libretranslate_url).toBe('https://lt.example.com')
  })

  it('applies settings onto process.env', () => {
    process.env.LIBRETRANSLATE_URL = 'https://lt.example.com'
    loadOrInitSettings()
    expect(process.env.LIBRETRANSLATE_URL).toBe('https://lt.example.com')
  })

  it('loads the existing file on a second run instead of reseeding from env', () => {
    process.env.LIBRETRANSLATE_URL = 'https://first.example'
    loadOrInitSettings()
    process.env.LIBRETRANSLATE_URL = 'https://drifted.example'
    const s = loadOrInitSettings()
    expect(s.libretranslate_url).toBe('https://first.example')
    // The file is authoritative after the seed, so it wins over the drifted env.
    expect(process.env.LIBRETRANSLATE_URL).toBe('https://first.example')
  })
})

describe('saveSettings + applyToEnv', () => {
  /*
   * Desktop, declared rather than assumed.
   *
   * Every case here writes a MACHINE-level key — the translate provider, the
   * sync folder, the poll interval — and those are desktop-only by design: on a
   * server they are refused by the route, because a web request that could move
   * them is how an instance talks itself off the network. The cases were
   * accurate about the behaviour and silent about the mode, and passed because
   * saveSettings did not distinguish the two. It does now: a server's file is a
   * sparse overlay of the owner-editable keys, and only the desktop build's is
   * an authoritative snapshot of everything.
   */
  beforeEach(() => { process.env.RESUME_DESKTOP = '1' })
  afterEach(() => { delete process.env.RESUME_DESKTOP })

  it('docker mode forces the LibreTranslate URL to the docker URL', () => {
    loadOrInitSettings()
    saveSettings({ translate_provider: 'libretranslate', translate_docker: true })
    expect(process.env.LIBRETRANSLATE_URL).toBe(DOCKER_TRANSLATE_URL)
    expect(process.env.TRANSLATE_PROVIDER).toBe('libretranslate')
    expect(loadSettings().translate_docker).toBe(true)
  })

  it('persists a cloud provider + its key and applies them to env', () => {
    loadOrInitSettings()
    const s = saveSettings({ translate_provider: 'deepl', deepl_api_key: 'k:fx' })
    expect(s.translate_provider).toBe('deepl')
    expect(process.env.TRANSLATE_PROVIDER).toBe('deepl')
    expect(process.env.DEEPL_API_KEY).toBe('k:fx')
    expect(loadSettings().deepl_api_key).toBe('k:fx')
    // The view masks every provider key.
    expect(toView(loadSettings()).deepl_api_key_set).toBe(true)
    expect(toView(loadSettings())).not.toHaveProperty('deepl_api_key')
  })

  it('rejects an unknown provider via coerce (falls back to off)', () => {
    loadOrInitSettings()
    // @ts-expect-error — deliberately invalid provider value
    const s = saveSettings({ translate_provider: 'bogus' })
    expect(s.translate_provider).toBe('off')
  })

  it('turning translate off clears the URL env', () => {
    loadOrInitSettings()
    saveSettings({ libretranslate_url: 'https://lt.example.com' })
    expect(process.env.LIBRETRANSLATE_URL).toBe('https://lt.example.com')
    saveSettings({ libretranslate_url: '', translate_docker: false })
    expect(process.env.LIBRETRANSLATE_URL).toBeUndefined()
  })

  it('persists + applies the backup folder and interval', () => {
    loadOrInitSettings()
    saveSettings({ backup_dir: '/drive/rs', backup_interval_ms: 120000 })
    expect(process.env.RESUME_BACKUP_DIR).toBe('/drive/rs')
    expect(process.env.RESUME_BACKUP_INTERVAL_MS).toBe('120000')
    const reloaded = loadSettings()
    expect(reloaded.backup_dir).toBe('/drive/rs')
    expect(reloaded.backup_interval_ms).toBe(120000)
  })

  it('clamps an absurdly small interval up to the floor', () => {
    loadOrInitSettings()
    const s = saveSettings({ backup_interval_ms: 10 })
    expect(s.backup_interval_ms).toBe(5000)
  })

  it('a blank backup_dir clears the env var (sync off)', () => {
    loadOrInitSettings()
    saveSettings({ backup_dir: '/drive/rs' })
    saveSettings({ backup_dir: '' })
    expect(process.env.RESUME_BACKUP_DIR).toBeUndefined()
  })
})

describe('toView', () => {
  it('masks the API key to a boolean', () => {
    const view = toView({ ...DEFAULT_SETTINGS, libretranslate_api_key: 'secret' })
    expect(view).not.toHaveProperty('libretranslate_api_key')
    expect(view.libretranslate_api_key_set).toBe(true)
    expect(toView(DEFAULT_SETTINGS).libretranslate_api_key_set).toBe(false)
  })

  it('reports a whitespace-only secret as not set', () => {
    expect(toView({ ...DEFAULT_SETTINGS, smtp_pass: '   ' }).smtp_pass_set).toBe(false)
  })
})

describe('applyToEnv directly', () => {
  it('clears keys for empty values', () => {
    process.env.LIBRETRANSLATE_URL = 'x'
    process.env.RESUME_BACKUP_DIR = 'y'
    applyToEnv(DEFAULT_SETTINGS)
    expect(process.env.LIBRETRANSLATE_URL).toBeUndefined()
    expect(process.env.RESUME_BACKUP_DIR).toBeUndefined()
  })
})

/**
 * The contract driven by the FIELDS table in server/settings.ts — one
 * descriptor per setting, rather than seven hand-maintained copies.
 */
describe('validateSettingsPatch', () => {
  /**
   * Regression: the `llm` translate provider shipped unusable because the PUT
   * route carried its own inline copy of the provider list — the UI offered
   * `llm`, the route 400'd it. The validator now reads the same canonical
   * lists the providers are defined by, so this cannot recur silently.
   */
  it('accepts every provider the canonical lists offer', () => {
    for (const p of TRANSLATE_PROVIDERS) {
      expect(validateSettingsPatch({ translate_provider: p }), `translate_provider=${p}`)
        .toEqual({ patch: { translate_provider: p } })
    }
    for (const p of LLM_PROVIDERS) {
      expect(validateSettingsPatch({ llm_provider: p }), `llm_provider=${p}`)
        .toEqual({ patch: { llm_provider: p } })
    }
  })

  it('rejects a provider outside the list', () => {
    expect(validateSettingsPatch({ translate_provider: 'bogus' })).toHaveProperty('error')
    expect(validateSettingsPatch({ llm_provider: 'bogus' })).toHaveProperty('error')
  })

  it('only touches keys actually present (a masked key must not be cleared)', () => {
    // The GET masks secrets, so an unchanged form omits them entirely.
    expect(validateSettingsPatch({ backup_dir: '/tmp/x' }))
      .toEqual({ patch: { backup_dir: '/tmp/x' } })
  })

  it('enforces each kind', () => {
    expect(validateSettingsPatch({ translate_docker: 'yes' })).toHaveProperty('error')
    expect(validateSettingsPatch({ backup_interval_ms: 1000 })).toHaveProperty('error')
    expect(validateSettingsPatch({ backup_interval_ms: 60000 })).toEqual({ patch: { backup_interval_ms: 60000 } })
    expect(validateSettingsPatch({ libretranslate_url: 'ftp://x' })).toHaveProperty('error')
    expect(validateSettingsPatch({ libretranslate_url: 'https://x' })).toEqual({ patch: { libretranslate_url: 'https://x' } })
    expect(validateSettingsPatch({ llm_model: 42 })).toHaveProperty('error')
  })

  /*
   * The rest of each kind. This is the gate on the only settings a hosted owner
   * can write, and whatever passes it lands in settings.json and then on
   * process.env — so "rejects the wrong type" is not enough; it has to accept
   * the right ones and refuse the shapes that are numbers only technically.
   */
  it('refuses a number that is not finite', () => {
    // typeof NaN is 'number', so the type check alone lets both of these
    // through and they reach the environment as "NaN" and "Infinity".
    expect(validateSettingsPatch({ backup_interval_ms: Number.NaN })).toHaveProperty('error')
    expect(validateSettingsPatch({ backup_interval_ms: Number.POSITIVE_INFINITY })).toHaveProperty('error')
    expect(validateSettingsPatch({ backup_interval_ms: '60000' })).toHaveProperty('error')
  })

  it('accepts both boolean values, not merely rejecting non-booleans', () => {
    expect(validateSettingsPatch({ translate_docker: true })).toEqual({ patch: { translate_docker: true } })
    expect(validateSettingsPatch({ translate_docker: false })).toEqual({ patch: { translate_docker: false } })
  })

  it('names the permitted values when refusing an enum', () => {
    // The message is the only guidance a caller gets, and an empty list in it
    // says "must be one of " with nothing after.
    const r = validateSettingsPatch({ translate_provider: 'carrier-pigeon' })
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toContain('deepl')
  })

  it('holds an address to the same gate the send path uses', () => {
    // It lands in a From: header, where a control character writes a header of
    // the caller's choosing.
    expect(validateSettingsPatch({ mail_from: 'not-an-address' })).toHaveProperty('error')
    expect(validateSettingsPatch({ mail_from: `a@b.no${String.fromCharCode(13)}Bcc: x@y.no` }))
      .toHaveProperty('error')
    expect(validateSettingsPatch({ mail_from: '  noreply@example.no  ' }))
      .toEqual({ patch: { mail_from: 'noreply@example.no' } })
    // Empty is a real value: mail is not configured.
    expect(validateSettingsPatch({ mail_from: '' })).toEqual({ patch: { mail_from: '' } })
  })

  it('keeps the language list to real locale codes, de-duplicated', () => {
    // These reach `docker compose` as LT_LOAD_ONLY, so the shape is constrained
    // rather than trusted.
    expect(validateSettingsPatch({ translate_languages: ['NO', ' en ', 'no'] }))
      .toEqual({ patch: { translate_languages: ['no', 'en'] } })
  })

  it('refuses anything that is not a locale code, rather than dropping it', () => {
    // Dropping would silently install a different set from the one asked for.
    expect(validateSettingsPatch({ translate_languages: ['no', 'nonsense!'] })).toHaveProperty('error')
    expect(validateSettingsPatch({ translate_languages: ['no', 42] })).toHaveProperty('error')
    expect(validateSettingsPatch({ translate_languages: 'no' })).toHaveProperty('error')
  })

  it('accepts an empty list here, which the read path then fills in', () => {
    // Deliberately asymmetric and worth knowing: the WRITE path takes [] as
    // written, while `coerce` on the way back out substitutes the default,
    // because an empty LT_LOAD_ONLY is not a configuration anyone wants.
    expect(validateSettingsPatch({ translate_languages: [] }))
      .toEqual({ patch: { translate_languages: [] } })
  })

  /**
   * `local_hostname` is written onto the desktop Host guard's allow-list AND
   * into the system hosts file, so the validator is the gate on both. Empty is
   * a real value ("go back to the IP"), and anything outside the two reserved
   * suffixes is refused — a name like mail.company.com would otherwise be
   * pointed at this machine for as long as the entry survived.
   */
  it('constrains local_hostname to the reserved local suffixes', () => {
    expect(validateSettingsPatch({ local_hostname: 'resumestudio.local' }))
      .toEqual({ patch: { local_hostname: 'resumestudio.local' } })
    expect(validateSettingsPatch({ local_hostname: 'ResumeStudio.LOCALHOST' }))
      .toEqual({ patch: { local_hostname: 'resumestudio.localhost' } })
    expect(validateSettingsPatch({ local_hostname: '' })).toEqual({ patch: { local_hostname: '' } })
    for (const bad of ['mail.company.com', 'localhost', '-x.local', 42]) {
      expect(validateSettingsPatch({ local_hostname: bad }), String(bad)).toHaveProperty('error')
    }
  })

  it('bounds local_port to a real port number', () => {
    expect(validateSettingsPatch({ local_port: 0 })).toEqual({ patch: { local_port: 0 } })
    expect(validateSettingsPatch({ local_port: 1923 })).toEqual({ patch: { local_port: 1923 } })
    expect(validateSettingsPatch({ local_port: -1 })).toHaveProperty('error')
    expect(validateSettingsPatch({ local_port: 70000 })).toHaveProperty('error')
  })

  /**
   * The readable name is the DEFAULT: a settings.json that predates the feature
   * (no key at all) must come back as `resumestudio.localhost` so the launcher
   * opens the name with zero configuration — that key being absent was exactly
   * why an upgraded install kept opening 127.0.0.1. An explicitly stored '' is
   * the Address tab's "Use the IP address" choice and must survive the load.
   */
  it('defaults an ABSENT local_hostname to resumestudio.localhost, keeps an explicit ""', () => {
    expect(DEFAULT_SETTINGS.local_hostname).toBe('resumestudio.localhost')

    fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true })
    fs.writeFileSync(settingsFilePath(), JSON.stringify({ llm_model: 'x' }))
    expect(loadSettings().local_hostname).toBe('resumestudio.localhost')

    fs.writeFileSync(settingsFilePath(), JSON.stringify({ local_hostname: '' }))
    expect(loadSettings().local_hostname).toBe('')

    // A garbled stored name falls back to the default — which is `.localhost`,
    // so nothing unvetted ever widens the desktop Host guard.
    fs.writeFileSync(settingsFilePath(), JSON.stringify({ local_hostname: 'mail.company.com' }))
    expect(loadSettings().local_hostname).toBe('resumestudio.localhost')
  })

  it('constrains translate_languages to locale-shaped codes', () => {
    // These reach `docker compose` as LT_LOAD_ONLY.
    expect(validateSettingsPatch({ translate_languages: ['en', 'NO'] }))
      .toEqual({ patch: { translate_languages: ['en', 'no'] } })
    expect(validateSettingsPatch({ translate_languages: ['en; rm -rf /'] })).toHaveProperty('error')
    expect(validateSettingsPatch({ translate_languages: 'en' })).toHaveProperty('error')
  })

  /**
   * The summarize_* → llm_* rename is only safe because `coerce` falls back to
   * each field's `legacyKey`. Without it, every existing desktop settings.json
   * would silently reset to the defaults on upgrade — a missing key coerces to
   * "off", so a configured provider, model and API key would just vanish with
   * no error. Worth pinning rather than trusting.
   */
  it('reads a pre-rename settings.json through legacyKey', () => {
    process.env.RESUME_DESKTOP = '1'
    fs.writeFileSync(settingsFilePath(), JSON.stringify({
      summarize_provider: 'anthropic',
      summarize_model: 'claude-opus-4-5',
      summarize_openai_api_key: 'sk-old',
      summarize_docker: true,
    }))
    const s = loadSettings()
    expect(s.llm_provider).toBe('anthropic')
    expect(s.llm_model).toBe('claude-opus-4-5')
    expect(s.llm_openai_api_key).toBe('sk-old')
    expect(s.llm_docker).toBe(true)
  })

  it('prefers the current key when a file carries both', () => {
    process.env.RESUME_DESKTOP = '1'
    fs.writeFileSync(settingsFilePath(), JSON.stringify({
      summarize_model: 'stale', llm_model: 'current',
    }))
    expect(loadSettings().llm_model).toBe('current')
  })

  /**
   * `mail_from` is written into a `From:` header, so the validator is the first
   * of the two gates on it (server/mail.ts refuses it again at send time). A CR
   * or LF here would end the header line early and everything after it would be
   * parsed as further headers — a Bcc: of the caller's choosing.
   */
  it('constrains mail_from to an address safe to put in a header', () => {
    expect(validateSettingsPatch({ mail_from: 'noreply@example.com' }))
      .toEqual({ patch: { mail_from: 'noreply@example.com' } })
    // Empty is a real value: "mail is not configured".
    expect(validateSettingsPatch({ mail_from: '' })).toEqual({ patch: { mail_from: '' } })
    // Padding spaces are forgiven; a control character never is.
    expect(validateSettingsPatch({ mail_from: '  noreply@example.com  ' }))
      .toEqual({ patch: { mail_from: 'noreply@example.com' } })
    const cr = String.fromCharCode(13)
    const lf = String.fromCharCode(10)
    for (const bad of [
      `noreply@example.com${cr}${lf}Bcc: attacker@evil.test`,
      // A plain String.trim() would strip these three and store a valid
      // address, which is the sanitising this field is not allowed to do.
      `noreply@example.com${lf}`,
      `noreply@example.com${cr}`,
      `noreply@example.com${String.fromCharCode(9)}`,
      `noreply@example.com${String.fromCharCode(0)}`,
      'Noreply <noreply@example.com>',
      'not-an-address',
      'a@b@c.com',
      42,
    ]) {
      expect(validateSettingsPatch({ mail_from: bad }), String(bad)).toHaveProperty('error')
    }
  })

  it('a stored mail_from that is no longer valid coerces to empty, not into a header', () => {
    process.env.RESUME_DESKTOP = '1'
    fs.writeFileSync(settingsFilePath(), JSON.stringify({
      mail_from: `noreply@example.com${String.fromCharCode(13)}${String.fromCharCode(10)}Bcc: x@y.test`,
    }))
    expect(loadSettings().mail_from).toBe('')
  })

  it('accepts every mail transport and smtp security the canonical lists offer', () => {
    for (const t of MAIL_TRANSPORTS) {
      expect(validateSettingsPatch({ mail_transport: t }), t).toEqual({ patch: { mail_transport: t } })
    }
    for (const s of SMTP_SECURITIES) {
      expect(validateSettingsPatch({ smtp_security: s }), s).toEqual({ patch: { smtp_security: s } })
    }
    expect(validateSettingsPatch({ mail_transport: 'carrier-pigeon' })).toHaveProperty('error')
    expect(validateSettingsPatch({ smtp_security: 'maybe' })).toHaveProperty('error')
  })

  it('persists the mail settings and projects them onto env', () => {
    loadOrInitSettings()
    saveSettings({
      mail_transport: 'smtp',
      mail_from: 'noreply@example.com',
      smtp_host: 'relay.example.com',
      smtp_port: 2525,
      smtp_security: 'tls',
      smtp_user: 'u',
      smtp_pass: 'p',
      app_base_url: 'https://cv.example.com',
    })
    expect(process.env.MAIL_TRANSPORT).toBe('smtp')
    expect(process.env.MAIL_FROM).toBe('noreply@example.com')
    expect(process.env.SMTP_HOST).toBe('relay.example.com')
    expect(process.env.SMTP_PORT).toBe('2525')
    expect(process.env.SMTP_SECURITY).toBe('tls')
    expect(process.env.SMTP_PASS).toBe('p')
    expect(process.env.RESUME_APP_BASE_URL).toBe('https://cv.example.com')
    // The saved settings feed the transport without a second mapping.
    expect(isMailConfigured(settingsToMailConfig(loadSettings()))).toBe(true)
  })

  it('reports the SMTP password only as "set", never by value', () => {
    const view = toView({ ...DEFAULT_SETTINGS, smtp_pass: 'relay-secret' }) as unknown as Record<string, unknown>
    expect(JSON.stringify(view)).not.toContain('relay-secret')
    expect(view.smtp_pass_set).toBe(true)
    expect(view.smtp_pass).toBeUndefined()
    expect(toView(DEFAULT_SETTINGS).smtp_pass_set).toBe(false)
  })

  it('never echoes a secret back through toView', () => {
    const s = { ...DEFAULT_SETTINGS, deepl_api_key: 'super-secret', azure_region: 'westeurope' }
    const view = toView(s) as unknown as Record<string, unknown>
    expect(JSON.stringify(view)).not.toContain('super-secret')
    expect(view.deepl_api_key_set).toBe(true)
    expect(view.deepl_api_key).toBeUndefined()
    // Non-secrets still pass through by value.
    expect(view.azure_region).toBe('westeurope')
  })
})

describe('validateSettingsPatch — every field in the table is reachable', () => {
  it('accepts a valid value for each identity, key and mail field', () => {
    /*
     * One row per previously-unexercised descriptor. The FIELDS table is what
     * the validator, the env projection and the client view all walk, so a
     * descriptor mutated away shows up here as its key silently vanishing from
     * the returned patch.
     */
    const rows: Array<[string, unknown, unknown]> = [
      ['user_username', ' svein ', 'svein'],
      ['user_display_name', ' Svein M. ', 'Svein M.'],
      ['user_email', '  svein@example.no  ', 'svein@example.no'],
      ['google_api_key', 'g-key', 'g-key'],
      ['azure_api_key', 'az-key', 'az-key'],
      ['azure_region', ' westeurope ', 'westeurope'],
      ['llm_ollama_url', 'http://ollama.lan:11434', 'http://ollama.lan:11434'],
      ['llm_compat_url', 'https://compat.example', 'https://compat.example'],
      ['llm_compat_api_key', 'c-key', 'c-key'],
      ['llm_anthropic_api_key', 'a-key', 'a-key'],
      ['llm_gemini_api_key', 'ge-key', 'ge-key'],
      ['llm_mistral_api_key', 'mi-key', 'mi-key'],
      ['llm_openai_api_key', 'oa-key', 'oa-key'],
      ['llm_model', ' llama3.2:3b ', 'llama3.2:3b'],
      ['llm_high_end', true, true],
      ['llm_docker', false, false],
      ['sendmail_path', ' /usr/sbin/sendmail ', '/usr/sbin/sendmail'],
      ['smtp_user', ' relay-user ', 'relay-user'],
      // A secret passes through undimmed on the write side (coerce trims on
      // the way back out) — which is also what tells `secret` from `text`.
      ['smtp_pass', ' relay-pass ', ' relay-pass '],
    ]
    for (const [key, sent, expected] of rows) {
      expect(validateSettingsPatch({ [key]: sent }), key).toEqual({ patch: { [key]: expected } })
    }
  })

  it('refuses a user_email that is not an address', () => {
    expect(validateSettingsPatch({ user_email: 'not-an-address' })).toHaveProperty('error')
  })

  it('holds the numeric bounds at their edges', () => {
    expect(validateSettingsPatch({ local_port: 65535 })).toEqual({ patch: { local_port: 65535 } })
    expect(validateSettingsPatch({ local_port: 65536 })).toHaveProperty('error')
    expect(validateSettingsPatch({ smtp_port: 65535 })).toEqual({ patch: { smtp_port: 65535 } })
    expect(validateSettingsPatch({ backup_interval_ms: 5000 })).toEqual({ patch: { backup_interval_ms: 5000 } })
    expect(validateSettingsPatch({ backup_interval_ms: 4999 })).toHaveProperty('error')
  })

  it('refuses an interior space in an address rather than collapsing it', () => {
    // trimSpaces strips PADDING only; a mutant stripping interior spaces would
    // quietly turn "no reply@…" into a valid address on its way to a header.
    expect(validateSettingsPatch({ mail_from: 'no reply@example.no' })).toHaveProperty('error')
    expect(validateSettingsPatch({ user_email: 'no reply@example.no' })).toHaveProperty('error')
  })

  it('accepts a region-qualified locale and anchors the code shape', () => {
    expect(validateSettingsPatch({ translate_languages: ['pt-br'] }))
      .toEqual({ patch: { translate_languages: ['pt-br'] } })
    for (const bad of [['!en'], ['a'], ['abcdefghi'], ['en-x']]) {
      expect(validateSettingsPatch({ translate_languages: bad }), JSON.stringify(bad)).toHaveProperty('error')
    }
  })
})

describe('coerce — what a stored file can and cannot smuggle in', () => {
  const writeFile = (data: unknown) =>
    fs.writeFileSync(settingsFilePath(), typeof data === 'string' ? data : JSON.stringify(data))

  it('answers pure defaults when there is no file, or an unparseable one', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    writeFile('{not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back to the shipped language set when the stored list is unusable', () => {
    // The concrete four match docker-compose.yml, so an existing install's
    // container is not recreated just because the setting appeared.
    writeFile({ translate_languages: 'garbage' })
    expect(loadSettings().translate_languages).toEqual(['en', 'no', 'se', 'dk'])
    writeFile({ translate_languages: ['zz!', 42, '###'] })
    expect(loadSettings().translate_languages).toEqual(['en', 'no', 'se', 'dk'])
  })

  it('cleans a usable stored list: trims, lower-cases, drops junk, de-duplicates', () => {
    writeFile({ translate_languages: [' EN ', 'no', 42, 'no', 'zz!'] })
    expect(loadSettings().translate_languages).toEqual(['en', 'no'])
  })

  it('lower-cases a stored hostname and drops one outside the reserved suffixes', () => {
    writeFile({ local_hostname: 'RS.LOCALHOST' })
    expect(loadSettings().local_hostname).toBe('rs.localhost')
    writeFile({ local_hostname: 'mail.company.com' })
    expect(loadSettings().local_hostname).toBe('')
  })

  it('clamps stored numbers into their bounds instead of trusting them', () => {
    writeFile({ local_port: 99999 })
    expect(loadSettings().local_port).toBe(65535)
    writeFile({ local_port: -5 })
    expect(loadSettings().local_port).toBe(0)
    writeFile({ local_port: 'eighty' })
    expect(loadSettings().local_port).toBe(0)
  })

  it('trims stored text and secret values', () => {
    writeFile({ azure_region: '  westeurope  ', libretranslate_api_key: '  k  ' })
    const s = loadSettings()
    expect(s.azure_region).toBe('westeurope')
    expect(s.libretranslate_api_key).toBe('k')
  })

  it('reads every renamed llm field through its legacy summarize_* key', () => {
    // The existing legacy test covers provider/model/openai/docker; these are
    // the remaining descriptors whose legacyKey could silently vanish.
    writeFile({
      summarize_ollama_url: 'http://old-ollama:11434',
      summarize_compat_url: 'https://old-compat.example',
      summarize_compat_api_key: 'compat-key',
      summarize_anthropic_api_key: 'anthropic-key',
      summarize_gemini_api_key: 'gemini-key',
      summarize_mistral_api_key: 'mistral-key',
    })
    const s = loadSettings()
    expect(s.llm_ollama_url).toBe('http://old-ollama:11434')
    expect(s.llm_compat_url).toBe('https://old-compat.example')
    expect(s.llm_compat_api_key).toBe('compat-key')
    expect(s.llm_anthropic_api_key).toBe('anthropic-key')
    expect(s.llm_gemini_api_key).toBe('gemini-key')
    expect(s.llm_mistral_api_key).toBe('mistral-key')
  })
})

describe('applyToEnv — projection details', () => {
  it('projects a boolean as "1" or clears it — never the string "false"', () => {
    process.env.LLM_HIGH_END = 'stale'
    applyToEnv({ ...DEFAULT_SETTINGS, llm_high_end: true })
    expect(process.env.LLM_HIGH_END).toBe('1')
    applyToEnv({ ...DEFAULT_SETTINGS, llm_high_end: false })
    expect(process.env.LLM_HIGH_END).toBeUndefined()
  })

  it('treats a whitespace-only value as empty, and trims one that is not', () => {
    process.env.AZURE_TRANSLATOR_REGION = 'stale'
    applyToEnv({ ...DEFAULT_SETTINGS, azure_region: '   ' })
    expect(process.env.AZURE_TRANSLATOR_REGION).toBeUndefined()
    applyToEnv({ ...DEFAULT_SETTINGS, azure_region: ' westeurope ' })
    expect(process.env.AZURE_TRANSLATOR_REGION).toBe('westeurope')
  })

  it('projects the identity and llm fields their consumers read', () => {
    applyToEnv({
      ...DEFAULT_SETTINGS,
      user_username: 'svein',
      user_display_name: 'Svein M.',
      user_email: 'svein@example.no',
      llm_provider: 'compat',
      llm_compat_url: 'https://compat.example',
      llm_compat_api_key: 'c-key',
      llm_anthropic_api_key: 'a-key',
      llm_gemini_api_key: 'ge-key',
      llm_mistral_api_key: 'mi-key',
      llm_openai_api_key: 'oa-key',
      llm_model: 'claude-opus-4-5',
      google_api_key: 'g-key',
      azure_api_key: 'az-key',
      sendmail_path: '/usr/local/bin/sendmail',
      smtp_user: 'relay-user',
    })
    expect(process.env.RESUME_USER_USERNAME).toBe('svein')
    expect(process.env.RESUME_USER_DISPLAY_NAME).toBe('Svein M.')
    expect(process.env.RESUME_USER_EMAIL).toBe('svein@example.no')
    expect(process.env.LLM_PROVIDER).toBe('compat')
    expect(process.env.LLM_COMPAT_URL).toBe('https://compat.example')
    expect(process.env.LLM_COMPAT_API_KEY).toBe('c-key')
    expect(process.env.LLM_ANTHROPIC_API_KEY).toBe('a-key')
    expect(process.env.LLM_GEMINI_API_KEY).toBe('ge-key')
    expect(process.env.LLM_MISTRAL_API_KEY).toBe('mi-key')
    expect(process.env.LLM_OPENAI_API_KEY).toBe('oa-key')
    expect(process.env.LLM_MODEL).toBe('claude-opus-4-5')
    expect(process.env.GOOGLE_TRANSLATE_API_KEY).toBe('g-key')
    expect(process.env.AZURE_TRANSLATOR_KEY).toBe('az-key')
    expect(process.env.SENDMAIL_PATH).toBe('/usr/local/bin/sendmail')
    expect(process.env.SMTP_USER).toBe('relay-user')
  })

  it('keeps a manual LibreTranslate URL when docker is off, even with the provider selected', () => {
    applyToEnv({
      ...DEFAULT_SETTINGS,
      translate_provider: 'libretranslate',
      translate_docker: false,
      libretranslate_url: 'https://manual.example',
    })
    expect(process.env.LIBRETRANSLATE_URL).toBe('https://manual.example')
  })
})

describe('settingsTo*Config — the docker override and the slash rule', () => {
  it('maps the llm settings, stripping trailing slashes from both URLs', () => {
    const cfg = settingsToLlmConfig({
      ...DEFAULT_SETTINGS,
      llm_provider: 'compat',
      llm_ollama_url: 'http://ollama.lan:11434///',
      llm_compat_url: 'https://compat.example//',
      llm_compat_api_key: 'c-key',
      llm_openai_api_key: 'oa-key',
      llm_anthropic_api_key: 'a-key',
      llm_gemini_api_key: 'ge-key',
      llm_mistral_api_key: 'mi-key',
      llm_model: 'm',
      llm_high_end: true,
    })
    expect(cfg.provider).toBe('compat')
    expect(cfg.ollama.url).toBe('http://ollama.lan:11434')
    expect(cfg.compat).toEqual({ url: 'https://compat.example', apiKey: 'c-key' })
    expect(cfg.openai.apiKey).toBe('oa-key')
    expect(cfg.anthropic.apiKey).toBe('a-key')
    expect(cfg.gemini.apiKey).toBe('ge-key')
    expect(cfg.mistral.apiKey).toBe('mi-key')
    expect(cfg.model).toBe('m')
    expect(cfg.highEnd).toBe(true)
  })

  it('overrides the ollama URL for docker only under the ollama provider', () => {
    const base = { ...DEFAULT_SETTINGS, llm_ollama_url: 'http://manual.lan:11434' }
    expect(settingsToLlmConfig({ ...base, llm_provider: 'ollama', llm_docker: true }).ollama.url)
      .toBe(DOCKER_OLLAMA_URL)
    expect(settingsToLlmConfig({ ...base, llm_provider: 'ollama', llm_docker: false }).ollama.url)
      .toBe('http://manual.lan:11434')
    // docker=true with another provider must not hijack the manual URL.
    expect(settingsToLlmConfig({ ...base, llm_provider: 'openai', llm_docker: true }).ollama.url)
      .toBe('http://manual.lan:11434')
    // Nothing configured at all still yields a usable default.
    expect(settingsToLlmConfig(DEFAULT_SETTINGS).ollama.url).toBe(DOCKER_OLLAMA_URL)
  })

  it('maps the translate settings: docker URL, null for none, slash-stripped otherwise', () => {
    expect(settingsToTranslateConfig({
      ...DEFAULT_SETTINGS, translate_provider: 'libretranslate', translate_docker: true,
    }).libretranslate.url).toBe(DOCKER_TRANSLATE_URL)
    expect(settingsToTranslateConfig(DEFAULT_SETTINGS).libretranslate.url).toBeNull()
    const cfg = settingsToTranslateConfig({
      ...DEFAULT_SETTINGS,
      translate_provider: 'deepl',
      libretranslate_url: 'https://lt.example//',
      libretranslate_api_key: 'lt-key',
      deepl_api_key: 'd-key',
      google_api_key: 'g-key',
      azure_api_key: 'az-key',
      azure_region: 'westeurope',
    })
    expect(cfg.provider).toBe('deepl')
    expect(cfg.libretranslate).toEqual({ url: 'https://lt.example', apiKey: 'lt-key' })
    expect(cfg.deepl.apiKey).toBe('d-key')
    expect(cfg.google.apiKey).toBe('g-key')
    expect(cfg.azure).toEqual({ apiKey: 'az-key', region: 'westeurope' })
  })

  it('substitutes the stock sendmail path when the setting is empty', () => {
    expect(settingsToMailConfig({ ...DEFAULT_SETTINGS, sendmail_path: '' }).sendmailPath)
      .toBe(DEFAULT_SENDMAIL_PATH)
    expect(settingsToMailConfig({ ...DEFAULT_SETTINGS, sendmail_path: '/opt/msmtp' }).sendmailPath)
      .toBe('/opt/msmtp')
  })
})

describe('settingsFromEnv — reading a server environment (via currentSettings)', () => {
  it('reads an LLM_* value, falling back to its pre-rename SUMMARIZE_* name', () => {
    process.env.SUMMARIZE_MODEL = 'old-model'
    expect(currentSettings().llm_model).toBe('old-model')
    process.env.LLM_MODEL = 'new-model'
    expect(currentSettings().llm_model).toBe('new-model')
  })

  it('parses a boolean env var by value, case- and padding-insensitively', () => {
    process.env.LLM_HIGH_END = ' TRUE '
    expect(currentSettings().llm_high_end).toBe(true)
    process.env.LLM_HIGH_END = 'on'
    expect(currentSettings().llm_high_end).toBe(true)
    process.env.LLM_HIGH_END = '0'
    expect(currentSettings().llm_high_end).toBe(false)
  })

  it('parses numeric env vars as numbers', () => {
    process.env.RESUME_BACKUP_INTERVAL_MS = '120000'
    expect(currentSettings().backup_interval_ms).toBe(120000)
  })

  it('trims TRANSLATE_PROVIDER before matching it against the enum', () => {
    process.env.TRANSLATE_PROVIDER = ' deepl '
    expect(currentSettings().translate_provider).toBe('deepl')
  })

  it('infers libretranslate from a bare LIBRETRANSLATE_URL, but not a blank one', () => {
    process.env.LIBRETRANSLATE_URL = 'https://lt.example'
    expect(currentSettings().translate_provider).toBe('libretranslate')
    expect(currentSettings().libretranslate_url).toBe('https://lt.example')
    process.env.LIBRETRANSLATE_URL = '   '
    expect(currentSettings().translate_provider).toBe('off')
  })

  it('prefers LLM_OLLAMA_URL over SUMMARIZE_OLLAMA_URL, and takes the legacy one alone', () => {
    process.env.SUMMARIZE_OLLAMA_URL = 'http://legacy:11434'
    expect(currentSettings().llm_ollama_url).toBe('http://legacy:11434')
    process.env.LLM_OLLAMA_URL = 'http://current:11434'
    expect(currentSettings().llm_ollama_url).toBe('http://current:11434')
  })
})

describe('a hosted owner’s settings survive a restart', () => {
  const KEYS = ['RESUME_DESKTOP', 'RESUME_DATA_DIR', 'SMTP_HOST', 'RESUME_BACKUP_DIR',
    'RESUME_APP_BASE_URL', 'MAIL_TRANSPORT', 'MAIL_FROM']
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-settings-'))
    for (const k of KEYS) delete process.env[k]
    process.env.RESUME_DATA_DIR = dir
  })

  afterEach(() => {
    for (const k of KEYS) delete process.env[k]
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reads an owner-editable key back from the file', () => {
    // The bug this pins: PUT wrote settings.json and pushed onto process.env,
    // but a server synthesised currentSettings() from env alone — so the edit
    // worked until the process restarted and then silently vanished.
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ smtp_host: 'smtp.saved.no' }))
    expect(currentSettings().smtp_host).toBe('smtp.saved.no')
  })

  it('projects it onto env at startup', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ smtp_host: 'smtp.saved.no' }))
    applyServerSettings()
    expect(process.env.SMTP_HOST).toBe('smtp.saved.no')
  })

  it('ignores a machine-level key even if the file names one', () => {
    // The sync folder is not owner-editable, so a settings.json carrying one
    // (copied from a desktop install, say) must not move a server's folder.
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ backup_dir: '/tmp/elsewhere' }))
    applyServerSettings()
    expect(process.env.RESUME_BACKUP_DIR).toBeUndefined()
  })

  it('falls through to the environment when nothing was saved', () => {
    process.env.SMTP_HOST = 'smtp.from-env.no'
    expect(currentSettings().smtp_host).toBe('smtp.from-env.no')
  })

  /*
   * The other half of every test above: what happens to the keys the file does
   * NOT carry.
   *
   * Each case above writes a settings.json holding one key and asserts that key
   * arrives. All of them passed while the file was clobbering the whole
   * environment around it, because none of them looked. The guard was
   * `saved[key] !== undefined` against a COERCED object, which fills in every
   * key, so it never fired and each absent key was projected as its default.
   */
  it('leaves an env key the file does not mention alone', () => {
    process.env.RESUME_APP_BASE_URL = 'https://cv.example.no'
    process.env.MAIL_TRANSPORT = 'smtp'
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ smtp_host: 'smtp.saved.no' }))

    applyServerSettings()

    // Cleared and forced to 'off' respectively, before the fix. Invite and
    // reset links came out as bare paths, and mail stopped.
    expect(process.env.RESUME_APP_BASE_URL).toBe('https://cv.example.no')
    expect(process.env.MAIL_TRANSPORT).toBe('smtp')
  })

  it('reads an unmentioned key from the environment even though the file exists', () => {
    process.env.RESUME_APP_BASE_URL = 'https://cv.example.no'
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ smtp_host: 'smtp.saved.no' }))

    expect(currentSettings().app_base_url).toBe('https://cv.example.no')
  })

  it('saves one field without writing a snapshot of every other default', () => {
    // loadSettings() answers DEFAULT_SETTINGS when there is no file, so merging
    // a patch into it wrote every key — and since anything the file holds wins
    // at startup, the first save handed the whole default set authority over
    // the operator's environment, permanently.
    saveSettings({ mail_from: 'cv@example.no' })

    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(raw)).toEqual(['mail_from'])
  })

  it('saves one field without disturbing the live environment around it', () => {
    process.env.RESUME_APP_BASE_URL = 'https://cv.example.no'
    process.env.SMTP_HOST = 'smtp.from-env.no'

    saveSettings({ mail_from: 'cv@example.no' })

    expect(process.env.MAIL_FROM).toBe('cv@example.no')
    expect(process.env.RESUME_APP_BASE_URL).toBe('https://cv.example.no')
    expect(process.env.SMTP_HOST).toBe('smtp.from-env.no')
  })

  it('accumulates saves rather than replacing the file each time', () => {
    saveSettings({ mail_from: 'cv@example.no' })
    saveSettings({ smtp_host: 'smtp.saved.no' })

    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(raw).toEqual({ mail_from: 'cv@example.no', smtp_host: 'smtp.saved.no' })
  })

  it('still writes a whole snapshot on the desktop build, where the file is authoritative', () => {
    process.env.RESUME_DESKTOP = '1'
    saveSettings({ mail_from: 'cv@example.no' })

    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(raw).length).toBeGreaterThan(1)
    expect(raw.mail_from).toBe('cv@example.no')
  })

  it('drops a machine-level key from a server save entirely', () => {
    // A backup_dir smuggled into a PUT body must reach neither the file nor
    // env — a web request that can move the sync folder is how an instance
    // talks itself off the network.
    saveSettings({ mail_from: 'cv@example.no', backup_dir: '/tmp/elsewhere' })
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(raw).toEqual({ mail_from: 'cv@example.no' })
    expect(process.env.RESUME_BACKUP_DIR).toBeUndefined()
  })

  it('treats a garbage settings file as empty when saving over it', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '[1,2]')
    saveSettings({ mail_from: 'cv@example.no' })
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(raw).toEqual({ mail_from: 'cv@example.no' })
  })

  it('ignores an unparseable settings file rather than dying on it', () => {
    process.env.SMTP_HOST = 'smtp.from-env.no'
    fs.writeFileSync(path.join(dir, 'settings.json'), '{not json')
    expect(currentSettings().smtp_host).toBe('smtp.from-env.no')
    expect(() => { applyServerSettings() }).not.toThrow()
  })

  it('survives having no file at all', () => {
    expect(() => { applyServerSettings() }).not.toThrow()
    expect(process.env.MAIL_FROM).toBeUndefined()
  })

  it('does nothing at all on the desktop build, where applyToEnv owns projection', () => {
    process.env.RESUME_DESKTOP = '1'
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ mail_from: 'cv@example.no' }))
    applyServerSettings()
    expect(process.env.MAIL_FROM).toBeUndefined()
  })

  it('an explicitly cleared owner key clears the env var it maps to', () => {
    // The owner saved "" deliberately; leaving the stale env value standing
    // would mean the settings screen accepts an edit that silently reverts.
    process.env.MAIL_FROM = 'stale@example.no'
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ mail_from: '' }))
    applyServerSettings()
    expect(process.env.MAIL_FROM).toBeUndefined()
  })

  it('projects a saved enum through its alwaysSet path', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ mail_transport: 'sendmail' }))
    applyServerSettings()
    expect(process.env.MAIL_TRANSPORT).toBe('sendmail')
  })

  it('the desktop build reads machine keys back from its own file', () => {
    process.env.RESUME_DESKTOP = '1'
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ backup_dir: '/drive/rs' }))
    expect(currentSettings().backup_dir).toBe('/drive/rs')
  })
})
