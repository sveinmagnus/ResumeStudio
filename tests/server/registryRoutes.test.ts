import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Drives the real createApp() against /api/registry with auth disabled (no
// token), like the other route suites. Registry ops read the singleton DB
// (RESUME_DB_PATH=':memory:').

let app: Express

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  delete process.env.RESUME_API_TOKEN // auth disabled for the test
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX']) delete process.env[k]
})

describe('/api/registry', () => {
  it('creates, lists, reads, updates and deletes a canonical entry', async () => {
    // Create
    const created = await request(app).post('/api/registry').send({ kind: 'skill', name: { en: 'Kubernetes' } })
    expect(created.status).toBe(201)
    const id = created.body.entry.id as string
    expect(created.body.entry.version).toBe(1)
    expect(created.body.entry.key).toBe('kubernetes')

    // List (filtered)
    const list = await request(app).get('/api/registry?kind=skill')
    expect(list.status).toBe(200)
    expect(list.body.entries.some((e: { id: string }) => e.id === id)).toBe(true)

    // Read one
    const one = await request(app).get(`/api/registry/${id}`)
    expect(one.body.entry.name.en).toBe('Kubernetes')

    // Update (rename + add locale)
    const upd = await request(app).put(`/api/registry/${id}`).send({ name: { en: 'Kubernetes', no: 'Kubernetes' } })
    expect(upd.status).toBe(200)
    expect(upd.body.entry.version).toBe(2)

    // Delete
    const del = await request(app).delete(`/api/registry/${id}`)
    expect(del.body.deleted).toBe(true)
    expect((await request(app).get(`/api/registry/${id}`)).status).toBe(404)
  })

  it('409s an update with a stale base_version and returns the current entry', async () => {
    const created = await request(app).post('/api/registry').send({ kind: 'role', name: { en: 'SRE' } })
    const id = created.body.entry.id as string
    // Bump to v2.
    await request(app).put(`/api/registry/${id}`).send({ name: { en: 'SRE!' } })
    // Stale write against v1.
    const conflict = await request(app).put(`/api/registry/${id}`).send({ name: { en: 'nope' }, base_version: 1 })
    expect(conflict.status).toBe(409)
    expect(conflict.body.current.version).toBe(2)
  })

  it('rejects an unknown kind and a non-localized name', async () => {
    expect((await request(app).get('/api/registry?kind=bogus')).status).toBe(400)
    expect((await request(app).post('/api/registry').send({ kind: 'bogus', name: {} })).status).toBe(400)
    expect((await request(app).post('/api/registry').send({ kind: 'skill', name: 'not-a-map' })).status).toBe(400)
  })

  it('404s a read/update of a missing id', async () => {
    expect((await request(app).get('/api/registry/ghost')).status).toBe(404)
    expect((await request(app).put('/api/registry/ghost').send({ name: { en: 'x' } })).status).toBe(404)
  })
})
