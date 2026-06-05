import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Express } from 'express'
import { BACKUP_FILENAME } from '../../server/backup'

// Drive the real createApp() against an in-memory DB, with the backup folder
// pointed at a throwaway temp dir per test run.
let app: Express
let syncDir: string

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  delete process.env.LIBRETRANSLATE_URL
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'
  syncDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sync-'))
  process.env.RESUME_BACKUP_DIR = syncDir
  const { createApp } = await import('../../server/app')
  app = createApp()
})

afterAll(() => {
  delete process.env.RESUME_DB_PATH
  delete process.env.RESUME_RATE_LIMIT_MAX
  delete process.env.RESUME_BACKUP_DIR
  try { fs.rmSync(syncDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

beforeEach(() => {
  // Clear the sync folder so each test starts from a known state. (The DB
  // singleton persists across tests in-process, which is fine — we assert on
  // counts/deltas, not absolute totals.)
  for (const f of fs.readdirSync(syncDir)) fs.rmSync(path.join(syncDir, f), { force: true })
})

async function createResume(name = 'CV'): Promise<string> {
  const res = await request(app).post('/api/resumes').send({ name, data: { resume: { full_name: name } } })
  expect(res.status).toBe(201)
  return res.body.resume.id as string
}

describe('GET /api/backup/status', () => {
  it('reports configured:true with the folder and no file yet', async () => {
    const res = await request(app).get('/api/backup/status')
    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(true)
    expect(res.body.dir).toBe(syncDir)
    expect(res.body.exists).toBe(false)
    expect(res.body.upToDate).toBe(false)
  })
})

describe('POST /api/backup/now', () => {
  it('writes the store to the sync folder and reports it', async () => {
    await createResume('Backup Me')
    const res = await request(app).post('/api/backup/now')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.resumeCount).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(path.join(syncDir, BACKUP_FILENAME))).toBe(true)
  })

  it('after a backup, status reports exists + upToDate', async () => {
    await createResume()
    await request(app).post('/api/backup/now')
    const res = await request(app).get('/api/backup/status')
    expect(res.body.exists).toBe(true)
    expect(res.body.upToDate).toBe(true)
    expect(res.body.lastBackupAt).toBeTruthy()
  })

  it('editing after a backup flips upToDate to false', async () => {
    const id = await createResume()
    await request(app).post('/api/backup/now')
    // Mutate the resume so the live signature diverges from the file.
    await request(app).put(`/api/resumes/${id}`).send({ data: { resume: { full_name: 'Changed' } } })
    const res = await request(app).get('/api/backup/status')
    expect(res.body.upToDate).toBe(false)
  })
})

describe('POST /api/backup/restore', () => {
  it('404s when no backup file exists', async () => {
    const res = await request(app).post('/api/backup/restore').send({})
    expect(res.status).toBe(404)
  })

  it('merges a backup file written by another machine', async () => {
    // Hand-craft a backup file containing a resume id this DB doesn't have.
    const foreignId = '11111111-2222-3333-4444-555555555555'
    const backup = {
      $schema: 'resumestudio-store/v1',
      format_version: 1,
      exported_at: new Date().toISOString(),
      generator: 'resume-studio',
      resumes: [{
        id: foreignId, name: 'From Laptop',
        primary_locale: 'en', secondary_locale: null,
        saved_at: '2999-01-01T00:00:00.000Z',
        created_at: '2999-01-01T00:00:00.000Z',
        data: { resume: { full_name: 'Imported' } },
      }],
    }
    fs.writeFileSync(path.join(syncDir, BACKUP_FILENAME), JSON.stringify(backup))

    const res = await request(app).post('/api/backup/restore').send({ mode: 'merge' })
    expect(res.status).toBe(200)
    expect(res.body.inserted).toBe(1)

    // The imported resume is now loadable.
    const got = await request(app).get(`/api/resumes/${foreignId}`)
    expect(got.status).toBe(200)
    expect(got.body.meta.name).toBe('From Laptop')
  })

  it('422s on an unreadable backup file', async () => {
    fs.writeFileSync(path.join(syncDir, BACKUP_FILENAME), '{ not valid json')
    const res = await request(app).post('/api/backup/restore').send({})
    expect(res.status).toBe(422)
  })
})

describe('backup endpoints without a configured folder', () => {
  it('status reports configured:false and writes 400', async () => {
    const saved = process.env.RESUME_BACKUP_DIR
    delete process.env.RESUME_BACKUP_DIR
    try {
      const status = await request(app).get('/api/backup/status')
      expect(status.body).toEqual({ configured: false })
      const now = await request(app).post('/api/backup/now')
      expect(now.status).toBe(400)
    } finally {
      process.env.RESUME_BACKUP_DIR = saved
    }
  })
})
