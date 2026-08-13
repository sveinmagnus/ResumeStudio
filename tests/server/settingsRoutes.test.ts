import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Express } from 'express'

let app: Express
let dataDir: string

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  for (const k of ['LIBRETRANSLATE_URL', 'LIBRETRANSLATE_API_KEY', 'RESUME_BACKUP_DIR', 'TRANSLATE_PROVIDER', 'DEEPL_API_KEY', 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION']) {
    delete process.env[k]
  }
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
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
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_DESKTOP', 'RESUME_DATA_DIR', 'LIBRETRANSLATE_URL', 'LIBRETRANSLATE_API_KEY', 'RESUME_BACKUP_DIR', 'RESUME_BACKUP_INTERVAL_MS', 'TRANSLATE_PROVIDER', 'DEEPL_API_KEY', 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION', 'RESUME_LOCAL_HOSTNAME', 'RESUME_LOCAL_PORT']) {
    delete process.env[k]
  }
  try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch { /* ignore */ }
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
  it('rejects a URL without an http(s) scheme', async () => {
    const res = await request(app).put('/api/settings').send({ libretranslate_url: 'localhost:5000' })
    expect(res.status).toBe(400)
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

  it('403s when not running the desktop build', async () => {
    delete process.env.RESUME_DESKTOP
    try {
      const res = await request(app).put('/api/settings').send({ libretranslate_url: 'https://x.example.com' })
      expect(res.status).toBe(403)
      const get = await request(app).get('/api/settings')
      expect(get.body.managed).toBe(false)
    } finally {
      process.env.RESUME_DESKTOP = '1'
    }
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
})

describe('POST /api/settings/docker', () => {
  it('400s on an invalid action', async () => {
    const res = await request(app).post('/api/settings/docker').send({ action: 'frobnicate' })
    expect(res.status).toBe(400)
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
    }
  })

  it('rejects an unknown action', async () => {
    const res = await request(app).post('/api/settings/hostname')
      .send({ action: 'destroy', hostname: 'resumestudio.local' })
    expect(res.status).toBe(400)
  })

  // Editing the hosts file is a reasonable thing to do to your own computer and
  // an absurd one to do to a shared server.
  it('403s when not running the desktop build', async () => {
    delete process.env.RESUME_DESKTOP
    try {
      const res = await request(app).post('/api/settings/hostname')
        .send({ action: 'install', hostname: 'resumestudio.local' })
      expect(res.status).toBe(403)
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

  it('404s for a folder that does not exist', async () => {
    const res = await request(app).post('/api/settings/folders').send({ path: path.join(dataDir, 'nope-nope') })
    expect(res.status).toBe(404)
  })

  it('403s when not running the desktop build', async () => {
    delete process.env.RESUME_DESKTOP
    try {
      const res = await request(app).post('/api/settings/folders').send({})
      expect(res.status).toBe(403)
    } finally {
      process.env.RESUME_DESKTOP = '1'
    }
  })
})
