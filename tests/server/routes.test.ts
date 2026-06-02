import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
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

// Convenience: create a resume and return its id for follow-up tests.
async function createResume(name = 'Test CV', body?: Record<string, unknown>): Promise<string> {
  const res = await request(app).post('/api/resumes').send({ name, ...body })
  expect(res.status).toBe(201)
  return res.body.resume.id as string
}

describe('health (no auth)', () => {
  it('GET /api/health → 200 {ok:true}', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('resume collection', () => {
  it('GET /api/resumes → 200 with empty list on a fresh DB', async () => {
    const res = await request(app).get('/api/resumes')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ resumes: [] })
  })

  it('POST /api/resumes → 400 when name is missing', async () => {
    const res = await request(app).post('/api/resumes').send({})
    expect(res.status).toBe(400)
  })

  it('POST /api/resumes → 400 when name is blank', async () => {
    const res = await request(app).post('/api/resumes').send({ name: '   ' })
    expect(res.status).toBe(400)
  })

  it('POST /api/resumes → 400 for a non-object body', async () => {
    const res = await request(app)
      .post('/api/resumes')
      .set('Content-Type', 'application/json')
      .send('"hi"')
    expect(res.status).toBe(400)
  })

  it('POST /api/resumes → 201 with metadata; GET reflects it', async () => {
    const create = await request(app).post('/api/resumes').send({
      name: 'Sales CV',
      data: { resume: { full_name: 'Astrid' } },
      primary_locale: 'no',
      secondary_locale: 'en',
    })
    expect(create.status).toBe(201)
    const id = create.body.resume.id as string
    expect(typeof id).toBe('string')
    expect(create.body.resume.name).toBe('Sales CV')
    expect(create.body.resume.primary_locale).toBe('no')

    const list = await request(app).get('/api/resumes')
    expect(list.body.resumes.find((r: { id: string }) => r.id === id)).toBeTruthy()
  })
})

describe('single resume', () => {
  let id: string
  beforeEach(async () => { id = await createResume() })

  it('GET /api/resumes/:id → 404 for an unknown id', async () => {
    const res = await request(app).get('/api/resumes/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('GET /api/resumes/:id → 200 with {data, meta}', async () => {
    const res = await request(app).get(`/api/resumes/${id}`)
    expect(res.status).toBe(200)
    expect(res.body.meta.id).toBe(id)
    expect(res.body.meta.name).toBe('Test CV')
    expect(res.body.data).toEqual({})
  })

  it('PUT /api/resumes/:id → 400 for a non-object body', async () => {
    const res = await request(app)
      .put(`/api/resumes/${id}`)
      .set('Content-Type', 'application/json')
      .send('42')
    expect(res.status).toBe(400)
  })

  it('PUT /api/resumes/:id → 404 for unknown id', async () => {
    const res = await request(app).put('/api/resumes/bogus').send({ data: {} })
    expect(res.status).toBe(404)
  })

  it('PUT /api/resumes/:id → 200 and round-trips via GET', async () => {
    const payload = { data: { resume: { full_name: 'New' }, projects: [] } }
    const put = await request(app).put(`/api/resumes/${id}`).send(payload)
    expect(put.status).toBe(200)
    expect(put.body.ok).toBe(true)
    expect(put.body.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const get = await request(app).get(`/api/resumes/${id}`)
    expect(get.body.data).toEqual(payload.data)
  })

  it('PUT /api/resumes/:id → updates locales when supplied alongside data', async () => {
    await request(app).put(`/api/resumes/${id}`).send({
      data: { v: 1 }, primary_locale: 'no', secondary_locale: 'en',
    })
    const get = await request(app).get(`/api/resumes/${id}`)
    expect(get.body.meta.primary_locale).toBe('no')
    expect(get.body.meta.secondary_locale).toBe('en')
  })

  it('PUT /api/resumes/:id → 400 when only one locale field is supplied', async () => {
    const res = await request(app).put(`/api/resumes/${id}`).send({
      data: { v: 1 }, primary_locale: 'no',
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/resumes/:id → renames without rewriting data', async () => {
    await request(app).put(`/api/resumes/${id}`).send({ data: { keep: true } })
    const patch = await request(app).patch(`/api/resumes/${id}`).send({ name: 'Renamed' })
    expect(patch.status).toBe(200)
    const get = await request(app).get(`/api/resumes/${id}`)
    expect(get.body.meta.name).toBe('Renamed')
    expect(get.body.data).toEqual({ keep: true })
  })

  it('PATCH /api/resumes/:id → 400 for missing/blank name', async () => {
    const r1 = await request(app).patch(`/api/resumes/${id}`).send({})
    expect(r1.status).toBe(400)
    const r2 = await request(app).patch(`/api/resumes/${id}`).send({ name: '  ' })
    expect(r2.status).toBe(400)
  })

  it('PATCH /api/resumes/:id → 404 for unknown id', async () => {
    const res = await request(app).patch('/api/resumes/bogus').send({ name: 'x' })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/resumes/:id → removes it, subsequent GET is 404', async () => {
    const del = await request(app).delete(`/api/resumes/${id}`)
    expect(del.status).toBe(200)
    const get = await request(app).get(`/api/resumes/${id}`)
    expect(get.status).toBe(404)
  })

  it('DELETE /api/resumes/:id → 404 the second time', async () => {
    await request(app).delete(`/api/resumes/${id}`)
    const res = await request(app).delete(`/api/resumes/${id}`)
    expect(res.status).toBe(404)
  })
})

describe('snapshot endpoints (scoped per resume)', () => {
  let id: string
  beforeEach(async () => {
    id = await createResume('Snap CV')
    await request(app).put(`/api/resumes/${id}`).send({ data: { v: 1 } })
    await request(app).put(`/api/resumes/${id}`).send({ data: { v: 2 } })
  })

  it('GET /api/resumes/:id/snapshots → 200 with newest-first list', async () => {
    const res = await request(app).get(`/api/resumes/${id}/snapshots`)
    expect(res.status).toBe(200)
    expect(res.body.snapshots).toHaveLength(2)
    expect(res.body.snapshots[0].id).toBeGreaterThan(res.body.snapshots[1].id)
  })

  it('GET /api/resumes/:id/snapshots → 404 when resume unknown', async () => {
    const res = await request(app).get('/api/resumes/bogus/snapshots')
    expect(res.status).toBe(404)
  })

  it('GET /api/resumes/:id/snapshots/:sid → 200 with that snapshot data', async () => {
    const list = await request(app).get(`/api/resumes/${id}/snapshots`)
    const snapId = list.body.snapshots[0].id as number
    const res = await request(app).get(`/api/resumes/${id}/snapshots/${snapId}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ v: 2 })
  })

  it('GET /api/resumes/:id/snapshots/:sid → 400 for non-integer sid', async () => {
    const res = await request(app).get(`/api/resumes/${id}/snapshots/abc`)
    expect(res.status).toBe(400)
  })

  it('GET /api/resumes/:id/snapshots/:sid → 404 for unknown sid', async () => {
    const res = await request(app).get(`/api/resumes/${id}/snapshots/99999`)
    expect(res.status).toBe(404)
  })

  it('snapshots are isolated by resume — A.sid is not visible under B', async () => {
    const other = await createResume('Other CV')
    await request(app).put(`/api/resumes/${other}`).send({ data: { v: 'other' } })

    const aList = await request(app).get(`/api/resumes/${id}/snapshots`)
    const aSid = aList.body.snapshots[0].id as number

    // Looking up A's snapshot under B's id must 404.
    const cross = await request(app).get(`/api/resumes/${other}/snapshots/${aSid}`)
    expect(cross.status).toBe(404)
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
    const res = await request(app).get('/api/resumes')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
  })

  it('accepts the correct bearer token', async () => {
    vi.stubEnv('RESUME_API_TOKEN', 'topsecret')
    const res = await request(app).get('/api/resumes').set('Authorization', 'Bearer topsecret')
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
