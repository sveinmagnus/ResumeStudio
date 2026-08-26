import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import {
  initUpdateRuntime, __resetUpdateRuntimeForTests,
} from '../../server/desktop/updateRuntime'
import { assetNameFor } from '../../server/desktop/updater'

let app: Express
const asset = assetNameFor()

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX']) delete process.env[k]
  __resetUpdateRuntimeForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('/api/update when the updater is not wired (VPS build)', () => {
  beforeAll(() => __resetUpdateRuntimeForTests())

  it('GET /status reports supported:false', async () => {
    const res = await request(app).get('/api/update/status')
    expect(res.status).toBe(200)
    expect(res.body.supported).toBe(false)
  })

  it('POST /check is 403', async () => {
    const res = await request(app).post('/api/update/check')
    expect(res.status).toBe(403)
  })

  it('POST /install is 403', async () => {
    const res = await request(app).post('/api/update/install')
    expect(res.status).toBe(403)
  })

  // /check-only is the deliberate exception: ASKING works on every build —
  // it is a hosted owner's only way to learn a release exists — while
  // installing stays desktop-only. The whole route ran in no test at all.
  it('POST /check-only answers on a VPS build, and says installing is not', async () => {
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({
      tag_name: 'v9.9.9',
      body: 'release notes',
      assets: [],
    }), { status: 200 })) as unknown as typeof fetch)

    const res = await request(app).post('/api/update/check-only')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.latest).toBe('9.9.9')
    expect(res.body.update_available).toBe(true)
    expect(res.body.installable).toBe(false)
    expect(typeof res.body.current).toBe('string')
    expect(res.body.notes).toBe('release notes')
  })

  it('POST /check-only reports an unreachable feed as 502 without echoing upstream detail', async () => {
    vi.stubGlobal('fetch', (async () => {
      throw new Error('secret internal https://api.github.com detail')
    }) as unknown as typeof fetch)

    const res = await request(app).post('/api/update/check-only')
    expect(res.status).toBe(502)
    expect(res.body).toEqual({ ok: false, error: 'Could not reach the release feed.' })
  })
})

describe('/api/update when the updater IS wired (desktop build)', () => {
  beforeAll(() => {
    __resetUpdateRuntimeForTests()
    initUpdateRuntime({
      installDir: '/tmp/resume-studio',
      appVersion: '0.0.1',
      log: () => {},
      // Never actually shut down a test
      requestShutdown: () => {},
    })
  })

  it('GET /status reports supported:true with the current version', async () => {
    const res = await request(app).get('/api/update/status')
    expect(res.status).toBe(200)
    expect(res.body.supported).toBe(true)
    expect(res.body.currentVersion).toBe('0.0.1')
  })

  it('POST /install is 409 when nothing has been found yet', async () => {
    const res = await request(app).post('/api/update/install')
    expect(res.status).toBe(409)
  })

  it('POST /check finds a newer release (mocked GitHub) without installing', async () => {
    const url = `https://github.com/sveinmagnus/resumestudio/releases/download/v9.9.9/${asset}`
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({
      tag_name: 'v9.9.9',
      body: 'notes',
      html_url: 'https://github.com/sveinmagnus/resumestudio/releases/tag/v9.9.9',
      assets: [
        { name: asset, browser_download_url: url },
        // A real release also ships the digest sidecar; without it the updater
        // reports the release as not auto-installable (see updater.ts).
        { name: `${asset}.sha256`, browser_download_url: `${url}.sha256` },
      ],
    }), { status: 200 })) as unknown as typeof fetch)

    const res = await request(app).post('/api/update/check')
    expect(res.status).toBe(200)
    expect(res.body.updateAvailable).toBe(true)
    expect(res.body.downloadable).toBe(true)
    expect(res.body.latestVersion).toBe('9.9.9')
    expect(res.body.state).toBe('available')
  })

  it('POST /install is 409 when the available update has no asset for this platform', async () => {
    // A newer release exists, but only carries an asset for some OTHER platform.
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({
      tag_name: 'v9.9.9',
      assets: [{ name: 'resume-studio-someotheros-mips.tar.gz', browser_download_url: 'https://github.com/x/y/z.tar.gz' }],
    }), { status: 200 })) as unknown as typeof fetch)
    const check = await request(app).post('/api/update/check')
    expect(check.body.updateAvailable).toBe(true)
    expect(check.body.downloadable).toBe(false)

    const res = await request(app).post('/api/update/install')
    expect(res.status).toBe(409)
  })

  it('POST /install accepts (202) once a downloadable update is available', async () => {
    const url = `https://github.com/sveinmagnus/resumestudio/releases/download/v9.9.9/${asset}`
    // The check succeeds; the fire-and-forget install's own download then fails
    // fast against the same stub — progress lands in /status, the response is
    // already out, and nothing touches the filesystem.
    vi.stubGlobal('fetch', (async (input: unknown) => {
      const target = String(input)
      if (target.includes('/releases/latest') || target.includes('api.github.com')) {
        return new Response(JSON.stringify({
          tag_name: 'v9.9.9',
          assets: [
            { name: asset, browser_download_url: url },
            { name: `${asset}.sha256`, browser_download_url: `${url}.sha256` },
          ],
        }), { status: 200 })
      }
      throw new Error('no downloads in a unit test')
    }) as unknown as typeof fetch)

    const check = await request(app).post('/api/update/check')
    expect(check.body.state).toBe('available')

    const res = await request(app).post('/api/update/install')
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ ok: true })
  })
})
