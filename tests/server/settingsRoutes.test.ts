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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-setroute-'))
  process.env.RESUME_DATA_DIR = dataDir
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(async () => {
  const { stopBackup } = await import('../../server/backupRuntime')
  stopBackup()
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX', 'RESUME_DESKTOP', 'RESUME_DATA_DIR', 'LIBRETRANSLATE_URL', 'LIBRETRANSLATE_API_KEY', 'RESUME_BACKUP_DIR', 'RESUME_BACKUP_INTERVAL_MS', 'TRANSLATE_PROVIDER', 'DEEPL_API_KEY', 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION']) {
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
