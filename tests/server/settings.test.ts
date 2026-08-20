import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  loadOrInitSettings, loadSettings, saveSettings, applyToEnv, toView,
  isDesktop, settingsFilePath, DOCKER_TRANSLATE_URL, DEFAULT_SETTINGS,
  validateSettingsPatch, settingsToMailConfig, applyServerSettings, currentSettings,
}  from '../../server/settings'
import { TRANSLATE_PROVIDERS } from '../../server/translate'
import { LLM_PROVIDERS } from '../../server/llm'
import { MAIL_TRANSPORTS, SMTP_SECURITIES, isMailConfigured } from '../../server/mail'

const ENV_KEYS = [
  'RESUME_DATA_DIR', 'RESUME_DESKTOP', 'LIBRETRANSLATE_URL', 'LIBRETRANSLATE_API_KEY',
  'RESUME_BACKUP_DIR', 'RESUME_BACKUP_INTERVAL_MS', 'TRANSLATE_PROVIDER',
  'DEEPL_API_KEY', 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION',
  'MAIL_TRANSPORT', 'MAIL_FROM', 'SENDMAIL_PATH', 'SMTP_HOST', 'SMTP_PORT',
  'SMTP_SECURITY', 'SMTP_USER', 'SMTP_PASS', 'RESUME_APP_BASE_URL',
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
})
