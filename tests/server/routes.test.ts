import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// The default DB singleton reads RESUME_DB_PATH lazily on first use; point it at
// an in-memory database so these tests never touch data/resume.db. auth and
// translate read their env lazily too, so we can toggle them per test.
let app: Express

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  delete process.env.LIBRETRANSLATE_URL
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(() => {
  delete process.env.RESUME_DB_PATH
})

describe('health + resume CRUD (no auth)', () => {
  const sample = { resume: { full_name: 'Astrid Solberg' }, projects: [] }

  it('GET /api/health → 200 {ok:true} (no auth required)', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('GET /api/resume → 404 before anything is saved', async () => {
    const res = await request(app).get('/api/resume')
    expect(res.status).toBe(404)
  })

  it('PUT /api/resume → 400 for a non-object body', async () => {
    const res = await request(app)
      .put('/api/resume')
      .set('Content-Type', 'application/json')
      .send('42')
    expect(res.status).toBe(400)
  })

  it('PUT /api/resume → 200 and round-trips via GET', async () => {
    const put = await request(app).put('/api/resume').send(sample)
    expect(put.status).toBe(200)
    expect(put.body.ok).toBe(true)
    expect(put.body.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const get = await request(app).get('/api/resume')
    expect(get.status).toBe(200)
    expect(get.body.data).toEqual(sample)
  })
})

describe('snapshot endpoints', () => {
  it('GET /api/resume/snapshots → lists at least the save above', async () => {
    const res = await request(app).get('/api/resume/snapshots')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.snapshots)).toBe(true)
    expect(res.body.snapshots.length).toBeGreaterThanOrEqual(1)
    expect(res.body.snapshots[0]).toHaveProperty('id')
    expect(res.body.snapshots[0]).toHaveProperty('saved_at')
    expect(res.body.snapshots[0]).toHaveProperty('size')
  })

  it('GET /api/resume/snapshots/:id → returns that snapshot data', async () => {
    const list = await request(app).get('/api/resume/snapshots')
    const id = list.body.snapshots[0].id
    const res = await request(app).get(`/api/resume/snapshots/${id}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('resume')
  })

  it('GET /api/resume/snapshots/:id → 400 for a non-integer id', async () => {
    const res = await request(app).get('/api/resume/snapshots/abc')
    expect(res.status).toBe(400)
  })

  it('GET /api/resume/snapshots/:id → 404 for an unknown id', async () => {
    const res = await request(app).get('/api/resume/snapshots/99999')
    expect(res.status).toBe(404)
  })
})

describe('translate endpoints (no backend configured)', () => {
  it('GET /api/translate/status → {configured:false}', async () => {
    const res = await request(app).get('/api/translate/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ configured: false })
  })

  it('POST /api/translate → 400 when fields are missing', async () => {
    const res = await request(app).post('/api/translate').send({ text: 'hi' })
    expect(res.status).toBe(400)
  })

  it('POST /api/translate → 400 when source equals target', async () => {
    const res = await request(app).post('/api/translate').send({ text: 'hi', source: 'en', target: 'en' })
    expect(res.status).toBe(400)
  })

  it('POST /api/translate → 413 when text exceeds the cap', async () => {
    const res = await request(app)
      .post('/api/translate')
      .send({ text: 'a'.repeat(5001), source: 'en', target: 'no' })
    expect(res.status).toBe(413)
  })

  it('POST /api/translate → 503 for a valid request when no backend is set', async () => {
    const res = await request(app).post('/api/translate').send({ text: 'hi', source: 'en', target: 'no' })
    expect(res.status).toBe(503)
  })
})

describe('auth gating (token configured)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('rejects an unauthenticated resume read with 401', async () => {
    vi.stubEnv('RESUME_API_TOKEN', 'topsecret')
    const res = await request(app).get('/api/resume')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
  })

  it('accepts the correct bearer token', async () => {
    vi.stubEnv('RESUME_API_TOKEN', 'topsecret')
    const res = await request(app).get('/api/resume').set('Authorization', 'Bearer topsecret')
    expect(res.status).toBe(200)
  })

  it('still serves the health check without a token', async () => {
    vi.stubEnv('RESUME_API_TOKEN', 'topsecret')
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
  })

  it('gates the translate status endpoint too', async () => {
    vi.stubEnv('RESUME_API_TOKEN', 'topsecret')
    const res = await request(app).get('/api/translate/status')
    expect(res.status).toBe(401)
  })
})
