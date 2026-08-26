import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Express } from 'express'
import { TranslateError, type TranslateConfig } from '../../server/translate'
import { LlmError, type LlmConfig } from '../../server/llm'
import type { DockerActionResult, ReachResult } from '../../server/translateDocker'
import type { LlmModel } from '../../server/llmModels'
import { DOCKER_TRANSLATE_URL, DOCKER_OLLAMA_URL, OWNER_EDITABLE_KEYS } from '../../server/settings'

/*
 * The provider / Docker / scheduler boundaries, overridable per test.
 *
 * The desktop-only halves of these routes end in a shell-out (docker compose),
 * a paid provider, or a live filesystem-watching scheduler — none of which a
 * test may reach. Each mock calls through to the REAL module until a test
 * installs an impl (reset in beforeEach), so the pre-existing live-failure
 * cases (e.g. the unreachable-URL probe) still exercise the genuine code path.
 */
const boundary = vi.hoisted(() => ({
  translate: null as ((text: string, source: string, target: string, cfg?: TranslateConfig) => Promise<string>) | null,
  summarize: null as ((text: string, locale: string, context: readonly string[], cfg?: LlmConfig) => Promise<string>) | null,
  listModels: null as ((cfg: LlmConfig) => Promise<LlmModel[]>) | null,
  startTranslate: null as (() => Promise<DockerActionResult>) | null,
  stopTranslate: null as (() => Promise<DockerActionResult>) | null,
  translateDockerAvailable: null as (() => Promise<boolean>) | null,
  translateReachable: null as ((url: string) => Promise<ReachResult>) | null,
  startOllama: null as ((model: string) => Promise<DockerActionResult>) | null,
  stopOllama: null as (() => Promise<DockerActionResult>) | null,
  ollamaDockerAvailable: null as (() => Promise<boolean>) | null,
  ollamaReachable: null as ((url: string) => Promise<ReachResult>) | null,
  /** Every reconfigureBackup the routes issue — the scheduler contract is the CALL. */
  backupCalls: [] as { dir: string | null; intervalMs: number }[],
}))

vi.mock('../../server/translate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/translate')>()
  const translate: typeof actual.translate = (text, source, target, cfg, glossary) =>
    boundary.translate ? boundary.translate(text, source, target, cfg) : actual.translate(text, source, target, cfg, glossary)
  return { ...actual, translate }
})

vi.mock('../../server/summarize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/summarize')>()
  const summarize: typeof actual.summarize = (text, locale, context, cfg) =>
    boundary.summarize ? boundary.summarize(text, locale, context ?? [], cfg) : actual.summarize(text, locale, context, cfg)
  return { ...actual, summarize }
})

vi.mock('../../server/llmModels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/llmModels')>()
  const listProviderModels: typeof actual.listProviderModels = (cfg) =>
    boundary.listModels ? boundary.listModels(cfg) : actual.listProviderModels(cfg)
  return { ...actual, listProviderModels }
})

vi.mock('../../server/translateDocker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/translateDocker')>()
  const startTranslate: typeof actual.startTranslate = () =>
    boundary.startTranslate ? boundary.startTranslate() : actual.startTranslate()
  const stopTranslate: typeof actual.stopTranslate = () =>
    boundary.stopTranslate ? boundary.stopTranslate() : actual.stopTranslate()
  const dockerAvailable: typeof actual.dockerAvailable = () =>
    boundary.translateDockerAvailable ? boundary.translateDockerAvailable() : actual.dockerAvailable()
  const translateReachable: typeof actual.translateReachable = (url, timeoutMs) =>
    boundary.translateReachable ? boundary.translateReachable(url) : actual.translateReachable(url, timeoutMs)
  return { ...actual, startTranslate, stopTranslate, dockerAvailable, translateReachable }
})

vi.mock('../../server/ollamaDocker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/ollamaDocker')>()
  const startOllama: typeof actual.startOllama = (model) =>
    boundary.startOllama ? boundary.startOllama(model) : actual.startOllama(model)
  const stopOllama: typeof actual.stopOllama = () =>
    boundary.stopOllama ? boundary.stopOllama() : actual.stopOllama()
  const dockerAvailable: typeof actual.dockerAvailable = () =>
    boundary.ollamaDockerAvailable ? boundary.ollamaDockerAvailable() : actual.dockerAvailable()
  const ollamaReachable: typeof actual.ollamaReachable = (url, timeoutMs) =>
    boundary.ollamaReachable ? boundary.ollamaReachable(url) : actual.ollamaReachable(url, timeoutMs)
  return { ...actual, startOllama, stopOllama, dockerAvailable, ollamaReachable }
})

// The real reconfigureBackup starts a scheduler + fs watcher against the DB;
// the route's contract is the call itself (folder or null, interval), so it is
// recorded instead of run.
vi.mock('../../server/backupRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/backupRuntime')>()
  const reconfigureBackup: typeof actual.reconfigureBackup = (dir, intervalMs) => {
    boundary.backupCalls.push({ dir, intervalMs })
  }
  return { ...actual, reconfigureBackup }
})

let app: Express
let dataDir: string

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  for (const k of ['LIBRETRANSLATE_URL', 'LIBRETRANSLATE_API_KEY', 'RESUME_BACKUP_DIR', 'TRANSLATE_PROVIDER', 'DEEPL_API_KEY', 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION']) {
    delete process.env[k]
  }
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  // The three billable probes carry the success-inclusive limiter too.
  process.env.RESUME_TRANSLATE_RATE_LIMIT_MAX = '1000000'
  // Run as the desktop build so settings are editable.
  process.env.RESUME_DESKTOP = '1'
  // realpath at creation: on macOS os.tmpdir() is /var/folders/... which is a
  // symlink to /private/var/..., and listFolders normalises without following
  // symlinks (by design). Same fix as tests/server/folders.test.ts.
  dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rs-setroute-')))
  process.env.RESUME_DATA_DIR = dataDir
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(async () => {
  const { stopBackup } = await import('../../server/backupRuntime')
  stopBackup()
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_TRANSLATE_RATE_LIMIT_MAX', 'RESUME_DESKTOP', 'RESUME_DATA_DIR', 'LIBRETRANSLATE_URL', 'LIBRETRANSLATE_API_KEY', 'RESUME_BACKUP_DIR', 'RESUME_BACKUP_INTERVAL_MS', 'TRANSLATE_PROVIDER', 'DEEPL_API_KEY', 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION', 'RESUME_LOCAL_HOSTNAME', 'RESUME_LOCAL_PORT', 'LT_LOAD_ONLY', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_OLLAMA_URL', 'LLM_OPENAI_API_KEY', 'LLM_COMPAT_URL', 'LLM_COMPAT_API_KEY', 'LLM_ANTHROPIC_API_KEY', 'LLM_GEMINI_API_KEY', 'LLM_MISTRAL_API_KEY', 'LLM_HIGH_END', 'MAIL_TRANSPORT', 'MAIL_FROM', 'SENDMAIL_PATH', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USER', 'SMTP_PASS', 'RESUME_APP_BASE_URL']) {
    delete process.env[k]
  }
  try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

beforeEach(() => {
  boundary.translate = null
  boundary.summarize = null
  boundary.listModels = null
  boundary.startTranslate = null
  boundary.stopTranslate = null
  boundary.translateDockerAvailable = null
  boundary.translateReachable = null
  boundary.startOllama = null
  boundary.stopOllama = null
  boundary.ollamaDockerAvailable = null
  boundary.ollamaReachable = null
  boundary.backupCalls.length = 0
})

describe('GET /api/settings', () => {
  it('reports managed:true on the desktop build with a settings view', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body.managed).toBe(true)
    expect(res.body.settings).toMatchObject({ libretranslate_api_key_set: false })
    expect(res.body.translate).toHaveProperty('configured')
  })
})

describe('PUT /api/settings', () => {
  it('rejects a URL without an http(s) scheme, naming the key', async () => {
    const res = await request(app).put('/api/settings').send({ libretranslate_url: 'localhost:5000' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('libretranslate_url')
  })

  it('saves a remote LibreTranslate URL and reflects it + translate.configured', async () => {
    const put = await request(app).put('/api/settings').send({
      translate_provider: 'libretranslate', libretranslate_url: 'https://lt.example.com',
    })
    expect(put.status).toBe(200)
    expect(put.body.settings.translate_provider).toBe('libretranslate')
    expect(put.body.settings.libretranslate_url).toBe('https://lt.example.com')
    expect(put.body.translate.configured).toBe(true)

    const get = await request(app).get('/api/settings')
    expect(get.body.settings.libretranslate_url).toBe('https://lt.example.com')
  })

  it('saves a cloud provider + key, masking the key in responses', async () => {
    const put = await request(app).put('/api/settings').send({ translate_provider: 'deepl', deepl_api_key: 'k:fx' })
    expect(put.status).toBe(200)
    expect(put.body.settings.translate_provider).toBe('deepl')
    expect(put.body.settings.deepl_api_key_set).toBe(true)
    expect(put.body.settings).not.toHaveProperty('deepl_api_key')
    expect(put.body.translate.configured).toBe(true)
  })

  it('rejects an unknown provider', async () => {
    const res = await request(app).put('/api/settings').send({ translate_provider: 'bogus' })
    expect(res.status).toBe(400)
  })

  it("saves the 'llm' translate provider (regression: the route's inline allowlist once rejected it)", async () => {
    const put = await request(app).put('/api/settings').send({ translate_provider: 'llm' })
    expect(put.status).toBe(200)
    expect(put.body.settings.translate_provider).toBe('llm')
  })

  it('docker mode reports translate configured (URL set under the hood)', async () => {
    const res = await request(app).put('/api/settings').send({ translate_provider: 'libretranslate', translate_docker: true })
    expect(res.status).toBe(200)
    expect(res.body.settings.translate_docker).toBe(true)
    expect(res.body.translate.configured).toBe(true)
  })

  it('rejects a too-small backup interval', async () => {
    const res = await request(app).put('/api/settings').send({ backup_interval_ms: 100 })
    expect(res.status).toBe(400)
  })

  it('403s when not running the desktop build, changing nothing', async () => {
    delete process.env.RESUME_DESKTOP
    try {
      const res = await request(app).put('/api/settings').send({ libretranslate_url: 'https://x.example.com' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/managed by the server environment/)
      expect(boundary.backupCalls).toEqual([])
      const get = await request(app).get('/api/settings')
      expect(get.body.managed).toBe(false)
    } finally {
      process.env.RESUME_DESKTOP = '1'
    }
    // The refused value must not have landed in the desktop settings either.
    const get = await request(app).get('/api/settings')
    expect(get.body.settings.libretranslate_url).not.toBe('https://x.example.com')
  })

  it('a validation reject names the key and leaves settings + scheduler untouched', async () => {
    const before = (await request(app).get('/api/settings')).body
    const res = await request(app).put('/api/settings').send({ translate_provider: 'bogus' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('translate_provider')
    expect(boundary.backupCalls).toEqual([])
    expect((await request(app).get('/api/settings')).body).toEqual(before)
  })
})

describe('PUT /api/settings — the running scheduler is retargeted on save', () => {
  it('hands the saved folder + interval to the scheduler', async () => {
    const res = await request(app).put('/api/settings').send({ backup_dir: '/drive/sync', backup_interval_ms: 30000 })
    expect(res.status).toBe(200)
    expect(boundary.backupCalls).toEqual([{ dir: '/drive/sync', intervalMs: 30000 }])
  })

  it('a cleared folder reaches the scheduler as null, never the empty string', async () => {
    const res = await request(app).put('/api/settings').send({ backup_dir: '', backup_interval_ms: 30000 })
    expect(res.status).toBe(200)
    expect(boundary.backupCalls).toEqual([{ dir: null, intervalMs: 30000 }])
  })
})

describe('secrets are write-only through the routes', () => {
  it('no secret value appears in any PUT or GET response, including right after a save', async () => {
    const secrets = {
      libretranslate_api_key: 'secret-lt-value',
      deepl_api_key: 'secret-deepl-value',
      llm_anthropic_api_key: 'secret-anthropic-value',
      smtp_pass: 'secret-smtp-value',
    }
    const put = await request(app).put('/api/settings')
      .send({ translate_provider: 'deepl', llm_provider: 'anthropic', mail_transport: 'smtp', ...secrets })
    expect(put.status).toBe(200)
    for (const v of Object.values(secrets)) expect(JSON.stringify(put.body)).not.toContain(v)
    expect(put.body.settings).toMatchObject({
      libretranslate_api_key_set: true,
      deepl_api_key_set: true,
      llm_anthropic_api_key_set: true,
      smtp_pass_set: true,
    })
    const get = await request(app).get('/api/settings')
    for (const v of Object.values(secrets)) expect(JSON.stringify(get.body)).not.toContain(v)
  })
})

describe('POST /api/settings/translate/test', () => {
  it('reports not reachable for an unreachable LibreTranslate URL', async () => {
    const res = await request(app).post('/api/settings/translate/test').send({
      translate_provider: 'libretranslate', libretranslate_url: 'http://127.0.0.1:1',
    })
    expect(res.status).toBe(200)
    expect(res.body.reachable).toBe(false)
  })

  it('reports "no provider selected" when provider is off', async () => {
    const res = await request(app).post('/api/settings/translate/test').send({ translate_provider: 'off' })
    expect(res.status).toBe(200)
    expect(res.body.reachable).toBe(false)
    expect(res.body.message).toMatch(/provider/i)
  })

  it('ignores pending URL/provider overrides on a non-desktop build (SSRF guard)', async () => {
    // On the VPS build the test route must use the saved/effective (env) config
    // only — otherwise an authed user could point the server probe at an
    // arbitrary internal host (e.g. cloud metadata). Clear the translate env so
    // the effective provider is genuinely 'off' (earlier PUT tests push config
    // onto process.env via applyToEnv).
    delete process.env.RESUME_DESKTOP
    const TRANSLATE_ENV = ['TRANSLATE_PROVIDER', 'LIBRETRANSLATE_URL', 'LIBRETRANSLATE_API_KEY', 'DEEPL_API_KEY', 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION']
    const saved = Object.fromEntries(TRANSLATE_ENV.map((k) => [k, process.env[k]]))
    for (const k of TRANSLATE_ENV) delete process.env[k]
    try {
      const res = await request(app).post('/api/settings/translate/test').send({
        translate_provider: 'libretranslate',
        libretranslate_url: 'http://169.254.169.254/latest/meta-data',
      })
      expect(res.status).toBe(200)
      // The override is ignored → effective provider is 'off' → "no provider",
      // NOT an attempt to reach the supplied URL. If the guard regressed, the
      // route would instead try the supplied host and report it unreachable.
      expect(res.body.reachable).toBe(false)
      expect(res.body.message).toMatch(/provider/i)
    } finally {
      process.env.RESUME_DESKTOP = '1'
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  /** Persist a fully-populated translate config for pending values to merge over. */
  async function saveTranslateBaseline(): Promise<void> {
    const res = await request(app).put('/api/settings').send({
      translate_provider: 'libretranslate', translate_docker: true,
      libretranslate_url: 'https://saved-lt.example', libretranslate_api_key: 'saved-lt-key',
      deepl_api_key: 'saved-deepl', google_api_key: 'saved-google',
      azure_api_key: 'saved-azure', azure_region: 'saved-region',
    })
    expect(res.status).toBe(200)
  }

  it('on desktop, honours every pending field — trimmed — over the saved config', async () => {
    await saveTranslateBaseline()
    let seen: TranslateConfig | undefined
    boundary.translate = (_text, _source, _target, cfg) => {
      seen = cfg
      return Promise.resolve('Hei fra testen')
    }
    const res = await request(app).post('/api/settings/translate/test').send({
      translate_provider: 'azure',
      libretranslate_url: '  https://pending-lt.example  ',
      translate_docker: false,
      libretranslate_api_key: 'pending-lt-key',
      deepl_api_key: 'pending-deepl',
      google_api_key: 'pending-google',
      azure_api_key: 'pending-azure',
      azure_region: '  pending-region  ',
    })
    expect(res.status).toBe(200)
    expect(res.body.reachable).toBe(true)
    expect(res.body.message).toContain('Hei fra testen')
    expect(seen).toMatchObject({
      provider: 'azure',
      libretranslate: { url: 'https://pending-lt.example', apiKey: 'pending-lt-key' },
      deepl: { apiKey: 'pending-deepl' },
      google: { apiKey: 'pending-google' },
      azure: { apiKey: 'pending-azure', region: 'pending-region' },
    })
  })

  it('falls back to the saved value for every omitted field, and ignores a non-string', async () => {
    await saveTranslateBaseline()
    let seen: TranslateConfig | undefined
    boundary.translate = (_text, _source, _target, cfg) => {
      seen = cfg
      return Promise.resolve('ok')
    }
    const res = await request(app).post('/api/settings/translate/test').send({ azure_region: 42 })
    expect(res.status).toBe(200)
    expect(seen).toMatchObject({
      provider: 'libretranslate',
      // The saved docker toggle survives the merge, so the managed URL wins.
      libretranslate: { url: DOCKER_TRANSLATE_URL, apiKey: 'saved-lt-key' },
      deepl: { apiKey: 'saved-deepl' },
      google: { apiKey: 'saved-google' },
      azure: { apiKey: 'saved-azure', region: 'saved-region' },
    })
  })

  it("answers the exact 'off' message without ever calling the provider", async () => {
    await saveTranslateBaseline()
    let called = false
    boundary.translate = () => {
      called = true
      return Promise.resolve('must not run')
    }
    const res = await request(app).post('/api/settings/translate/test').send({ translate_provider: 'off' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ reachable: false, message: 'No translation provider is selected.' })
    expect(called).toBe(false)
  })

  it('maps a TranslateError to its own message and anything else to the generic one', async () => {
    boundary.translate = () => Promise.reject(new TranslateError(502, 'DeepL rejected the API key'))
    const first = await request(app).post('/api/settings/translate/test')
      .send({ translate_provider: 'deepl', deepl_api_key: 'k' })
    expect(first.body).toEqual({ reachable: false, message: 'DeepL rejected the API key' })

    boundary.translate = () => Promise.reject(new Error('boom'))
    const second = await request(app).post('/api/settings/translate/test')
      .send({ translate_provider: 'deepl', deepl_api_key: 'k' })
    expect(second.body).toEqual({ reachable: false, message: 'Translation test failed.' })
  })
})

describe('POST /api/settings/docker', () => {
  it('400s on an invalid action, naming the grammar', async () => {
    const res = await request(app).post('/api/settings/docker').send({ action: 'frobnicate' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/action/)
  })

  it('a missing body is an invalid action, not a crash', async () => {
    const res = await request(app).post('/api/settings/docker')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/action/)
  })

  it('403s, naming the reason, when not running the desktop build', async () => {
    delete process.env.RESUME_DESKTOP
    try {
      const res = await request(app).post('/api/settings/docker').send({ action: 'status' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/desktop/)
    } finally {
      process.env.RESUME_DESKTOP = '1'
    }
  })

  it('start hands back the compose result verbatim', async () => {
    const result = { ok: true, available: true, message: 'container started (test)' }
    boundary.startTranslate = () => Promise.resolve(result)
    const res = await request(app).post('/api/settings/docker').send({ action: 'start' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(result)
  })

  it('stop hands back the compose result verbatim', async () => {
    const result = { ok: true, available: true, message: 'container stopped (test)' }
    boundary.stopTranslate = () => Promise.resolve(result)
    const res = await request(app).post('/api/settings/docker').send({ action: 'stop' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(result)
  })

  it('status without docker answers unavailable and never probes the container', async () => {
    boundary.translateDockerAvailable = () => Promise.resolve(false)
    let probed = false
    boundary.translateReachable = () => {
      probed = true
      return Promise.resolve({ reachable: true, message: 'x' })
    }
    const res = await request(app).post('/api/settings/docker').send({ action: 'status' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ available: false, reachable: false, message: 'Docker not available.' })
    expect(probed).toBe(false)
  })

  it('status with docker probes the fixed managed URL, not a configurable one', async () => {
    boundary.translateDockerAvailable = () => Promise.resolve(true)
    let probedUrl = ''
    boundary.translateReachable = (url) => {
      probedUrl = url
      return Promise.resolve({ reachable: true, message: 'up (test)' })
    }
    const res = await request(app).post('/api/settings/docker').send({ action: 'status' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ available: true, reachable: true, message: 'up (test)' })
    expect(probedUrl).toBe(DOCKER_TRANSLATE_URL)
  })
})

describe('PUT /api/settings — hosted LLM providers', () => {
  it('saves anthropic + key, masking the key and reflecting llm.configured', async () => {
    const put = await request(app).put('/api/settings').send({
      llm_provider: 'anthropic', llm_anthropic_api_key: 'sk-ant-xxx',
    })
    expect(put.status).toBe(200)
    expect(put.body.settings.llm_provider).toBe('anthropic')
    expect(put.body.settings.llm_anthropic_api_key_set).toBe(true)
    expect(put.body.settings).not.toHaveProperty('llm_anthropic_api_key')
    // A key alone is enough — the default model kicks in.
    expect(put.body.llm.configured).toBe(true)
  })

  it('rejects an unknown LLM provider', async () => {
    const res = await request(app).put('/api/settings').send({ llm_provider: 'bogus' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/settings/hostname', () => {
  it('reports a .localhost name as needing no setup at all', async () => {
    const res = await request(app).post('/api/settings/hostname')
      .send({ action: 'status', hostname: 'resumestudio.localhost' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ automatic: true, installed: true })
  })

  it('reports a .local name with the hosts file path and a manual command', async () => {
    const res = await request(app).post('/api/settings/hostname')
      .send({ action: 'status', hostname: 'resumestudio.local' })
    expect(res.status).toBe(200)
    expect(res.body.automatic).toBe(false)
    expect(String(res.body.file)).toMatch(/hosts$/)
    expect(res.body.manualCommand).toContain('resumestudio.local')
  })

  // The hostname reaches a system file, so the route validates it before
  // localHost.ts is ever called — the same rule the PUT validator enforces.
  it('rejects a hostname outside the reserved suffixes', async () => {
    for (const hostname of ['mail.company.com', '', 'localhost']) {
      const res = await request(app).post('/api/settings/hostname').send({ action: 'status', hostname })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/\.local/)
    }
  })

  it('rejects a non-string hostname the same way', async () => {
    const res = await request(app).post('/api/settings/hostname').send({ action: 'status', hostname: 42 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/hostname/)
  })

  it('normalises case and padding before validating or answering', async () => {
    const res = await request(app).post('/api/settings/hostname')
      .send({ action: 'status', hostname: '  ResumeStudio.LOCAL  ' })
    expect(res.status).toBe(200)
    // The status echoes the name it was asked about — the normalised one.
    expect(res.body.hostname).toBe('resumestudio.local')
  })

  /*
   * install/uninstall are exercised with a .localhost name ONLY: those need no
   * hosts entry, so both paths answer without writing anything (no elevation
   * prompt, no system file touched). A .local install would edit the real
   * hosts file and is not a thing a test may do.
   */
  it('install of a .localhost name succeeds without touching any file', async () => {
    const res = await request(app).post('/api/settings/hostname')
      .send({ action: 'install', hostname: 'resumestudio.localhost' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.message).toMatch(/needs no setup/)
    expect(res.body.status).toMatchObject({ automatic: true, installed: true })
  })

  it('uninstall answers the result together with a fresh status', async () => {
    const res = await request(app).post('/api/settings/hostname')
      .send({ action: 'uninstall', hostname: 'resumestudio.localhost' })
    expect(res.status).toBe(200)
    expect(typeof res.body.ok).toBe('boolean')
    expect(res.body.status).toMatchObject({ automatic: true, installed: true })
  })

  it('rejects an unknown action, naming the grammar', async () => {
    const res = await request(app).post('/api/settings/hostname')
      .send({ action: 'destroy', hostname: 'resumestudio.local' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/action/)
  })

  // Editing the hosts file is a reasonable thing to do to your own computer and
  // an absurd one to do to a shared server.
  it('403s when not running the desktop build', async () => {
    delete process.env.RESUME_DESKTOP
    try {
      const res = await request(app).post('/api/settings/hostname')
        .send({ action: 'install', hostname: 'resumestudio.local' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/managed by the server environment/)
    } finally {
      process.env.RESUME_DESKTOP = '1'
    }
  })
})

describe('PUT /api/settings — local address', () => {
  it('round-trips a hostname and port, and projects the name onto env', async () => {
    const res = await request(app).put('/api/settings')
      .send({ local_hostname: 'resumestudio.local', local_port: 1923 })
    expect(res.status).toBe(200)
    expect(res.body.settings.local_hostname).toBe('resumestudio.local')
    expect(res.body.settings.local_port).toBe(1923)
    // app.ts's Host guard reads this variable, not the settings file.
    expect(process.env.RESUME_LOCAL_HOSTNAME).toBe('resumestudio.local')
  })

  it('refuses a name that could shadow a real site', async () => {
    const res = await request(app).put('/api/settings').send({ local_hostname: 'mail.company.com' })
    expect(res.status).toBe(400)
  })

  it('clears back to the IP', async () => {
    const res = await request(app).put('/api/settings').send({ local_hostname: '' })
    expect(res.status).toBe(200)
    expect(res.body.settings.local_hostname).toBe('')
    expect(process.env.RESUME_LOCAL_HOSTNAME).toBeUndefined()
  })
})

describe('POST /api/settings/folders', () => {
  it('lists the home directory by default (desktop build)', async () => {
    const res = await request(app).post('/api/settings/folders').send({})
    expect(res.status).toBe(200)
    expect(res.body.path).toBe(os.homedir())
    expect(Array.isArray(res.body.entries)).toBe(true)
  })

  it('lists a given folder\'s subfolders', async () => {
    const res = await request(app).post('/api/settings/folders').send({ path: dataDir })
    expect(res.status).toBe(200)
    expect(res.body.path).toBe(dataDir)
  })

  it('a non-string path falls back to the home directory rather than being used', async () => {
    const res = await request(app).post('/api/settings/folders').send({ path: 123 })
    expect(res.status).toBe(200)
    expect(res.body.path).toBe(os.homedir())
  })

  it('404s for a folder that does not exist, with the reason', async () => {
    const res = await request(app).post('/api/settings/folders').send({ path: path.join(dataDir, 'nope-nope') })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/no longer exists/)
  })

  it('403s, naming the reason, when not running the desktop build', async () => {
    delete process.env.RESUME_DESKTOP
    try {
      const res = await request(app).post('/api/settings/folders').send({})
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/desktop/)
    } finally {
      process.env.RESUME_DESKTOP = '1'
    }
  })
})

/**
 * A hosted instance is not the desktop build, but its owner still has to be
 * able to configure the things that only exist at runtime — above all mail,
 * without which the password-reset email is unreachable on exactly the
 * deployment that needs it. Everything else stays a property of the machine.
 */
describe('a hosted owner may write a subset', () => {
  /** Run `fn` as a hosted instance, restoring the suite's desktop default. */
  async function hosted(fn: () => Promise<void>): Promise<void> {
    delete process.env.RESUME_DESKTOP
    try {
      await fn()
    } finally {
      process.env.RESUME_DESKTOP = '1'
    }
  }

  it('reports the subset rather than claiming the app manages settings', async () => {
    await hosted(async () => {
      const res = await request(app).get('/api/settings')
      expect(res.body.managed).toBe(false)
      expect(res.body.editable_keys).toContain('smtp_host')
      expect(res.body.editable_keys).not.toContain('backup_dir')
      // The whole list, so a key quietly added to the wire surface fails here.
      expect(res.body.editable_keys).toEqual([...OWNER_EDITABLE_KEYS])
    })
  })

  it('accepts a mail setting', async () => {
    await hosted(async () => {
      const res = await request(app).put('/api/settings').send({ smtp_host: 'smtp.example.no' })
      expect(res.status).not.toBe(403)
    })
  })

  it('refuses a machine-level setting, naming it, and moves nothing', async () => {
    // The sync folder and the local hostname are properties of the box. A web
    // request that could move them is how an instance talks itself off the net.
    await hosted(async () => {
      const before = (await request(app).get('/api/settings')).body.settings.backup_dir
      const res = await request(app).put('/api/settings').send({ backup_dir: '/tmp/anywhere' })
      expect(res.status).toBe(403)
      expect(res.body.error).toContain('backup_dir')
      const after = (await request(app).get('/api/settings')).body.settings.backup_dir
      expect(after).toBe(before)
      expect(after).not.toBe('/tmp/anywhere')
    })
  })

  it('refuses a mixed patch outright rather than applying the allowed half', async () => {
    await hosted(async () => {
      const res = await request(app).put('/api/settings')
        .send({ smtp_host: 'smtp.other.example', backup_dir: '/tmp/anywhere' })
      expect(res.status).toBe(403)
      // The allowed half must not have been applied on the side.
      const get = await request(app).get('/api/settings')
      expect(get.body.settings.smtp_host).not.toBe('smtp.other.example')
    })
  })
})

/** Persist a fully-populated AI-assist config for pending values to merge over. */
async function saveLlmBaseline(): Promise<void> {
  const res = await request(app).put('/api/settings').send({
    llm_provider: 'ollama', llm_docker: true,
    llm_ollama_url: 'https://saved-ollama.example',
    llm_openai_api_key: 'saved-openai',
    llm_compat_url: 'https://saved-compat.example', llm_compat_api_key: 'saved-compat-key',
    llm_anthropic_api_key: 'saved-anthropic', llm_gemini_api_key: 'saved-gemini',
    llm_mistral_api_key: 'saved-mistral',
    llm_model: 'saved-model',
  })
  expect(res.status).toBe(200)
}

describe('POST /api/settings/llm/models — the pending-values merge (desktop)', () => {
  const MODELS: LlmModel[] = [{ id: 'model-a' }, { id: 'model-b', label: 'B' }]

  it('honours every pending field — trimmed — over the saved config', async () => {
    await saveLlmBaseline()
    let seen: LlmConfig | undefined
    boundary.listModels = (cfg) => {
      seen = cfg
      return Promise.resolve(MODELS)
    }
    const res = await request(app).post('/api/settings/llm/models').send({
      llm_provider: 'compat',
      llm_ollama_url: '  http://pending-ollama.example  ',
      llm_docker: false,
      llm_compat_url: '  https://pending-compat.example/  ',
      llm_openai_api_key: 'pending-openai',
      llm_compat_api_key: 'pending-compat-key',
      llm_anthropic_api_key: 'pending-anthropic',
      llm_gemini_api_key: 'pending-gemini',
      llm_mistral_api_key: 'pending-mistral',
      llm_model: '  pending-model  ',
    })
    expect(res.status).toBe(200)
    expect(res.body.models).toEqual(MODELS)
    expect(seen).toMatchObject({
      provider: 'compat',
      ollama: { url: 'http://pending-ollama.example' },
      openai: { apiKey: 'pending-openai' },
      compat: { url: 'https://pending-compat.example', apiKey: 'pending-compat-key' },
      anthropic: { apiKey: 'pending-anthropic' },
      gemini: { apiKey: 'pending-gemini' },
      mistral: { apiKey: 'pending-mistral' },
      model: 'pending-model',
    })
  })

  it('falls back to the saved value for every omitted field, and ignores a non-string', async () => {
    await saveLlmBaseline()
    let seen: LlmConfig | undefined
    boundary.listModels = (cfg) => {
      seen = cfg
      return Promise.resolve(MODELS)
    }
    const res = await request(app).post('/api/settings/llm/models').send({ llm_model: 42 })
    expect(res.status).toBe(200)
    expect(seen).toMatchObject({
      provider: 'ollama',
      // The saved docker toggle survives the merge, so the managed URL wins.
      ollama: { url: DOCKER_OLLAMA_URL },
      openai: { apiKey: 'saved-openai' },
      compat: { url: 'https://saved-compat.example', apiKey: 'saved-compat-key' },
      anthropic: { apiKey: 'saved-anthropic' },
      gemini: { apiKey: 'saved-gemini' },
      mistral: { apiKey: 'saved-mistral' },
      model: 'saved-model',
    })
  })

  it("answers an empty list for provider 'off' without asking any provider", async () => {
    let called = false
    boundary.listModels = () => {
      called = true
      return Promise.resolve(MODELS)
    }
    const res = await request(app).post('/api/settings/llm/models').send({ llm_provider: 'off' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ models: [] })
    expect(called).toBe(false)
  })

  it('ignores pending values entirely on a non-desktop build (SSRF guard)', async () => {
    // Same guard as /translate/test: on the VPS build a pending llm_compat_url
    // would point the server's outbound fetch at a host of the caller's choice.
    const LLM_ENV = ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_OLLAMA_URL', 'LLM_OPENAI_API_KEY', 'LLM_COMPAT_URL',
      'LLM_COMPAT_API_KEY', 'LLM_ANTHROPIC_API_KEY', 'LLM_GEMINI_API_KEY', 'LLM_MISTRAL_API_KEY', 'LLM_HIGH_END',
      'SUMMARIZE_PROVIDER', 'SUMMARIZE_MODEL', 'SUMMARIZE_OLLAMA_URL', 'SUMMARIZE_OPENAI_API_KEY',
      'SUMMARIZE_COMPAT_URL', 'SUMMARIZE_COMPAT_API_KEY', 'SUMMARIZE_ANTHROPIC_API_KEY',
      'SUMMARIZE_GEMINI_API_KEY', 'SUMMARIZE_MISTRAL_API_KEY']
    const saved = Object.fromEntries(LLM_ENV.map((k) => [k, process.env[k]]))
    for (const k of LLM_ENV) delete process.env[k]
    delete process.env.RESUME_DESKTOP
    let called = false
    boundary.listModels = () => {
      called = true
      return Promise.resolve(MODELS)
    }
    try {
      const res = await request(app).post('/api/settings/llm/models').send({
        llm_provider: 'compat', llm_compat_url: 'http://169.254.169.254/latest', llm_model: 'x',
      })
      expect(res.status).toBe(200)
      // Pending ignored → the effective provider is 'off' → empty list, no call.
      expect(res.body).toEqual({ models: [] })
      expect(called).toBe(false)
    } finally {
      process.env.RESUME_DESKTOP = '1'
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})

describe('POST /api/settings/llm/test', () => {
  it("answers the exact 'off' message without asking the model", async () => {
    let called = false
    boundary.summarize = () => {
      called = true
      return Promise.resolve('must not run')
    }
    const res = await request(app).post('/api/settings/llm/test').send({ llm_provider: 'off' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ reachable: false, message: 'No AI provider is selected.' })
    expect(called).toBe(false)
  })

  it('asks for a model name before spending a request', async () => {
    await saveLlmBaseline()
    let called = false
    boundary.summarize = () => {
      called = true
      return Promise.resolve('must not run')
    }
    // A pending empty model must OVERRIDE the saved one — the form is asking
    // about the config as edited, not as stored.
    const res = await request(app).post('/api/settings/llm/test').send({ llm_provider: 'ollama', llm_model: '' })
    expect(res.status).toBe(200)
    expect(res.body.reachable).toBe(false)
    expect(res.body.message).toMatch(/model name/i)
    expect(called).toBe(false)
  })

  it('probes with the same prompt shape the editor sends — text, locale, heading context', async () => {
    let args: { text: string; locale: string; context: readonly string[]; cfg?: LlmConfig } | undefined
    boundary.summarize = (text, locale, context, cfg) => {
      args = { text, locale, context, cfg }
      return Promise.resolve('Kort linje.')
    }
    const res = await request(app).post('/api/settings/llm/test')
      .send({ llm_provider: 'ollama', llm_model: 'llama3.2:3b' })
    expect(res.status).toBe(200)
    expect(res.body.reachable).toBe(true)
    expect(res.body.message).toContain('Kort linje.')
    expect(args?.locale).toBe('en')
    expect(args?.text).toContain('customer-facing web app')
    // The heading context is the point of the probe: without it this test
    // could pass while the editor's real prompt shape fails.
    expect(args?.context).toEqual(['Customer: Nordic Retail AS', 'Project name: Self-service portal'])
    expect(args?.cfg).toMatchObject({ provider: 'ollama', model: 'llama3.2:3b' })
  })

  it('maps an LlmError to its own message and anything else to the generic one', async () => {
    boundary.summarize = () => Promise.reject(new LlmError(502, 'Model not found (test)'))
    const first = await request(app).post('/api/settings/llm/test')
      .send({ llm_provider: 'ollama', llm_model: 'm' })
    expect(first.body).toEqual({ reachable: false, message: 'Model not found (test)' })

    boundary.summarize = () => Promise.reject(new Error('boom'))
    const second = await request(app).post('/api/settings/llm/test')
      .send({ llm_provider: 'ollama', llm_model: 'm' })
    expect(second.body).toEqual({ reachable: false, message: 'AI assist test failed.' })
  })
})

describe('POST /api/settings/llm/docker', () => {
  it('403s, naming the reason, when not running the desktop build', async () => {
    delete process.env.RESUME_DESKTOP
    try {
      const res = await request(app).post('/api/settings/llm/docker').send({ action: 'status' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/desktop/)
    } finally {
      process.env.RESUME_DESKTOP = '1'
    }
  })

  it('start pulls the model named in the request', async () => {
    const result = { ok: true, available: true, message: 'ollama started (test)' }
    let pulled = ''
    boundary.startOllama = (model) => {
      pulled = model
      return Promise.resolve(result)
    }
    const res = await request(app).post('/api/settings/llm/docker').send({ action: 'start', model: 'llama3.2:3b' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(result)
    expect(pulled).toBe('llama3.2:3b')
  })

  it('start falls back to the saved model when the request names none, or a blank one', async () => {
    const put = await request(app).put('/api/settings').send({ llm_provider: 'ollama', llm_model: 'saved-model' })
    expect(put.status).toBe(200)
    const pulls: string[] = []
    boundary.startOllama = (model) => {
      pulls.push(model)
      return Promise.resolve({ ok: true, available: true, message: 'ok' })
    }
    await request(app).post('/api/settings/llm/docker').send({ action: 'start' })
    await request(app).post('/api/settings/llm/docker').send({ action: 'start', model: '   ' })
    expect(pulls).toEqual(['saved-model', 'saved-model'])
  })

  it('stop hands back the compose result verbatim', async () => {
    const result = { ok: true, available: true, message: 'ollama stopped (test)' }
    boundary.stopOllama = () => Promise.resolve(result)
    const res = await request(app).post('/api/settings/llm/docker').send({ action: 'stop' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(result)
  })

  it('status without docker answers unavailable and never probes the container', async () => {
    boundary.ollamaDockerAvailable = () => Promise.resolve(false)
    let probed = false
    boundary.ollamaReachable = () => {
      probed = true
      return Promise.resolve({ reachable: true, message: 'x' })
    }
    const res = await request(app).post('/api/settings/llm/docker').send({ action: 'status' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ available: false, reachable: false, message: 'Docker not available.' })
    expect(probed).toBe(false)
  })

  it('status with docker probes the fixed managed URL, not a configurable one', async () => {
    boundary.ollamaDockerAvailable = () => Promise.resolve(true)
    let probedUrl = ''
    boundary.ollamaReachable = (url) => {
      probedUrl = url
      return Promise.resolve({ reachable: true, message: 'up (test)' })
    }
    const res = await request(app).post('/api/settings/llm/docker').send({ action: 'status' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ available: true, reachable: true, message: 'up (test)' })
    expect(probedUrl).toBe(DOCKER_OLLAMA_URL)
  })

  it('400s on an unknown action, naming the grammar', async () => {
    const res = await request(app).post('/api/settings/llm/docker').send({ action: 'frobnicate' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/action/)
  })
})
