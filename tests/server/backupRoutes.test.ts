import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { unzipSync, strFromU8 } from 'fflate'
import type { Express } from 'express'
import { BACKUP_FILENAME } from '../../server/backup'
import { REGISTRY_FILENAME, TOMBSTONE_FILENAME, resumeFileName } from '../../server/backupFiles'

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

const jsonFiles = () => fs.readdirSync(syncDir).filter((f) => f.endsWith('.json'))

describe('GET /api/backup/status', () => {
  it('reports configured:true with the folder and no files yet', async () => {
    const res = await request(app).get('/api/backup/status')
    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(true)
    expect(res.body.dir).toBe(syncDir)
    expect(res.body.exists).toBe(false)
    expect(res.body.upToDate).toBe(false)
  })
})

describe('POST /api/backup/now', () => {
  it('writes ONE FILE PER RESUME, named after the resume and its id', async () => {
    // The unit of the folder is a person, so a single person's CV can be handed
    // over or erased without touching anyone else's.
    const id = await createResume('Backup Me')
    const res = await request(app).post('/api/backup/now')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.resumeCount).toBeGreaterThanOrEqual(1)

    const expected = resumeFileName(id, 'Backup Me')
    expect(expected).toBe(`backup-me__${id}.json`)
    expect(fs.existsSync(path.join(syncDir, expected))).toBe(true)
    expect(fs.existsSync(path.join(syncDir, REGISTRY_FILENAME))).toBe(true)
    // The pre-split monolith is not written any more.
    expect(fs.existsSync(path.join(syncDir, BACKUP_FILENAME))).toBe(false)

    const file = JSON.parse(fs.readFileSync(path.join(syncDir, expected), 'utf8'))
    expect(file.$schema).toBe('resumestudio-resume/v1')
    expect(file.resume.id).toBe(id)
    expect(file.resume.data.resume.full_name).toBe('Backup Me')
  })

  it('a rename moves the file instead of leaving a second copy behind', async () => {
    // The id is the identity; the slug is a convenience. Two files for one
    // resume is exactly how a folder starts growing duplicates.
    const id = await createResume('Before Rename')
    await request(app).post('/api/backup/now')
    expect(jsonFiles()).toContain(`before-rename__${id}.json`)

    await request(app).patch(`/api/resumes/${id}`).send({ name: 'After Rename' })
    await request(app).post('/api/backup/now')

    const files = jsonFiles()
    expect(files).toContain(`after-rename__${id}.json`)
    expect(files).not.toContain(`before-rename__${id}.json`)
    expect(files.filter((f) => f.includes(id))).toHaveLength(1)
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
    // Mutate the resume so the live signature diverges from the folder.
    await request(app).put(`/api/resumes/${id}`).send({ data: { resume: { full_name: 'Changed' } } })
    const res = await request(app).get('/api/backup/status')
    expect(res.body.upToDate).toBe(false)
  })

  it('retires a pre-split combined backup once every resume it held has its own file', async () => {
    const id = await createResume('Legacy Owner')
    // A folder as an older build left it: everything in one file.
    fs.writeFileSync(path.join(syncDir, BACKUP_FILENAME), JSON.stringify({
      $schema: 'resumestudio-store/v1', format_version: 1,
      exported_at: new Date().toISOString(), generator: 'resume-studio',
      resumes: [{
        id, name: 'Legacy Owner', primary_locale: 'en', secondary_locale: null,
        saved_at: '2020-01-01T00:00:00.000Z', created_at: '2020-01-01T00:00:00.000Z',
        data: { resume: { full_name: 'Legacy Owner' } },
      }],
    }))

    await request(app).post('/api/backup/now')
    // Leaving it would keep a file holding every person's CV in the folder,
    // which is precisely what per-person erasure cannot act on.
    expect(fs.existsSync(path.join(syncDir, BACKUP_FILENAME))).toBe(false)
    expect(jsonFiles()).toContain(resumeFileName(id, 'Legacy Owner'))
  })
})

describe('POST /api/backup/restore', () => {
  it('404s when the folder is empty', async () => {
    const res = await request(app).post('/api/backup/restore').send({})
    expect(res.status).toBe(404)
  })

  it('merges a per-resume file written by another machine', async () => {
    const foreignId = '11111111-2222-3333-4444-555555555555'
    fs.writeFileSync(path.join(syncDir, `from-laptop__${foreignId}.json`), JSON.stringify({
      $schema: 'resumestudio-resume/v1', format_version: 1,
      exported_at: new Date().toISOString(), generator: 'resume-studio',
      resume: {
        id: foreignId, name: 'From Laptop', primary_locale: 'en', secondary_locale: null,
        saved_at: '2999-01-01T00:00:00.000Z', created_at: '2999-01-01T00:00:00.000Z',
        data: { resume: { full_name: 'Imported' } },
      },
      registry: [],
    }))

    const res = await request(app).post('/api/backup/restore').send({ mode: 'merge' })
    expect(res.status).toBe(200)
    expect(res.body.inserted).toBe(1)

    const got = await request(app).get(`/api/resumes/${foreignId}`)
    expect(got.status).toBe(200)
    expect(got.body.meta.name).toBe('From Laptop')
  })

  it('still reads a legacy combined backup, so an old folder loses nothing', async () => {
    const foreignId = '22222222-3333-4444-5555-666666666666'
    fs.writeFileSync(path.join(syncDir, BACKUP_FILENAME), JSON.stringify({
      $schema: 'resumestudio-store/v1', format_version: 1,
      exported_at: new Date().toISOString(), generator: 'resume-studio',
      resumes: [{
        id: foreignId, name: 'From The Old Format',
        primary_locale: 'en', secondary_locale: null,
        saved_at: '2999-01-01T00:00:00.000Z', created_at: '2999-01-01T00:00:00.000Z',
        data: { resume: { full_name: 'Imported' } },
      }],
    }))
    const res = await request(app).post('/api/backup/restore').send({ mode: 'merge' })
    expect(res.status).toBe(200)
    expect(res.body.inserted).toBe(1)
  })

  it('422s (not a silent 404) when the only files present are unreadable', async () => {
    fs.writeFileSync(path.join(syncDir, 'broken__abc.json'), '{ not valid json')
    const res = await request(app).post('/api/backup/restore').send({})
    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/broken__abc\.json/)
  })

  it('honours a tombstone: a resume deleted elsewhere is removed here', async () => {
    const id = await createResume('Erase Me')
    fs.writeFileSync(path.join(syncDir, TOMBSTONE_FILENAME), JSON.stringify({
      $schema: 'resumestudio-tombstones/v1', format_version: 1,
      exported_at: new Date().toISOString(), generator: 'resume-studio',
      tombstones: [{ id, deleted_at: '2999-01-01T00:00:00.000Z' }],
    }))
    // A resume file has to be present or the folder looks empty (404).
    const other = await createResume('Keeper')
    await request(app).post('/api/backup/now')
    // Publishing wrote a file for the doomed resume too — the tombstone must
    // still win, or an erasure could never survive one more sync round.
    const res = await request(app).post('/api/backup/restore').send({})
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(1)
    expect((await request(app).get(`/api/resumes/${id}`)).status).toBe(404)
    expect((await request(app).get(`/api/resumes/${other}`)).status).toBe(200)
  })
})

describe('DELETE /api/resumes/:id — erasure reaches the sync folder', () => {
  it('removes the resume file and records a tombstone for the other machines', async () => {
    const id = await createResume('Forget Me')
    await request(app).post('/api/backup/now')
    expect(jsonFiles()).toContain(resumeFileName(id, 'Forget Me'))

    expect((await request(app).delete(`/api/resumes/${id}`)).status).toBe(200)

    expect(jsonFiles()).not.toContain(resumeFileName(id, 'Forget Me'))
    const tomb = JSON.parse(fs.readFileSync(path.join(syncDir, TOMBSTONE_FILENAME), 'utf8'))
    expect(tomb.tombstones.map((t: { id: string }) => t.id)).toContain(id)
    // The marker carries an id and a time and nothing else — it must not become
    // a second copy of the personal data it exists to erase.
    expect(Object.keys(tomb.tombstones[0]).sort()).toEqual(['deleted_at', 'id'])
  })
})

describe('manual backup: GET /export → POST /import', () => {
  it('exports a zip holding one file per resume plus the registry', async () => {
    await createResume('Zip Me')
    const res = await request(app).get('/api/backup/export').buffer().parse((r, cb) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c))
      r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="resume-studio-backup-\d{4}-\d{2}-\d{2}\.zip"/)

    const entries = unzipSync(new Uint8Array(res.body as Buffer))
    const names = Object.keys(entries)
    expect(names).toContain(REGISTRY_FILENAME)
    const resumeFiles = names.filter((n) => n !== REGISTRY_FILENAME)
    expect(resumeFiles.length).toBeGreaterThanOrEqual(1)
    // Each entry is a standalone, portable per-resume file — the same thing the
    // sync folder holds, so the two are interchangeable.
    const parsed = JSON.parse(strFromU8(entries[resumeFiles[0]]))
    expect(parsed.$schema).toBe('resumestudio-resume/v1')
    expect(parsed.resume.id).toBeTruthy()
  })

  it('imports that zip by MERGING on id — a re-import never duplicates', async () => {
    const id = await createResume('Round Trip')
    const exported = await request(app).get('/api/backup/export').buffer().parse((r, cb) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c))
      r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    const before = (await request(app).get('/api/resumes')).body.resumes.length

    const res = await request(app)
      .post('/api/backup/import')
      .set('Content-Type', 'application/zip')
      .send(exported.body as Buffer)
    expect(res.status).toBe(200)
    // Nothing new — every id was already here
    expect(res.body.inserted).toBe(0)

    const after = (await request(app).get('/api/resumes')).body.resumes
    expect(after).toHaveLength(before)
    expect(after.some((r: { id: string }) => r.id === id)).toBe(true)
  })

  it('imports a single per-resume JSON file too', async () => {
    const foreignId = '33333333-4444-5555-6666-777777777777'
    const res = await request(app).post('/api/backup/import').send({
      $schema: 'resumestudio-resume/v1', format_version: 1,
      exported_at: new Date().toISOString(), generator: 'resume-studio',
      resume: {
        id: foreignId, name: 'Single File', primary_locale: 'en', secondary_locale: null,
        saved_at: '2999-01-01T00:00:00.000Z', created_at: '2999-01-01T00:00:00.000Z',
        data: { resume: { full_name: 'Single File' } },
      },
      registry: [],
    })
    expect(res.status).toBe(200)
    expect(res.body.inserted).toBe(1)
    expect((await request(app).get(`/api/resumes/${foreignId}`)).body.meta.name).toBe('Single File')
  })

  it('422s with a readable message when the upload holds none of our files', async () => {
    const res = await request(app).post('/api/backup/import').send({ hello: 'world' })
    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/No Resume Studio backup files/i)
  })

  it('422s when the upload claims to be a zip but is not one', async () => {
    const res = await request(app)
      .post('/api/backup/import')
      .set('Content-Type', 'application/zip')
      .send(Buffer.from('definitely not a zip'))
    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/not a readable zip/i)
  })
})

describe('backup endpoints without a configured folder', () => {
  it('status reports configured:false and folder writes 400', async () => {
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

  it('but the manual zip export still works — it needs no folder', async () => {
    const saved = process.env.RESUME_BACKUP_DIR
    delete process.env.RESUME_BACKUP_DIR
    try {
      const res = await request(app).get('/api/backup/export')
      expect(res.status).toBe(200)
    } finally {
      process.env.RESUME_BACKUP_DIR = saved
    }
  })
})
