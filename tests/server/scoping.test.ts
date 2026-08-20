/**
 * Route × role scoping — the matrix that has to be exhaustive.
 *
 * The failure mode this guards is silent: a query that forgot its viewer hands
 * back somebody else's CV and nothing goes red. `access.test.ts` pins the
 * RULES; this pins that every route actually asks them, over the real
 * `createApp()` + supertest stack rather than a stand-in for it.
 *
 * Four askers, because those are the four cases the model distinguishes: the
 * owner role, the member who owns the resume, a member who does not, and that
 * same member looking at one shared with the instance.
 *
 * Two properties matter more than any single status code:
 *
 *  - A resume a member may not see answers EXACTLY as one that does not exist.
 *    A distinct 403 would turn the API into an oracle for which ids are real,
 *    and "there is a CV here you may not read" is itself a disclosure in a firm
 *    where the resumes are the people.
 *  - A refused write leaves the row untouched. A status-only assertion would
 *    pass just as happily against a 404 that wrote first and refused after.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { zipSync, strToU8 } from 'fflate'
import type { Express } from 'express'
import { SESSION_COOKIE } from '../../server/auth'
import { SYSTEM_VIEWER, type ResumeDb } from '../../server/db'
import type { AccountsStore, UserRow, Viewer } from '../../server/accounts'

let app: Express
let db: ResumeDb
let accounts: AccountsStore

let owner: UserRow
let kari: UserRow
let ola: UserRow

/** Cookie headers. Sessions are minted once — nothing here logs out. */
let asOwner: string
let asKari: string
let asOla: string

const viewerOf = (u: UserRow): Viewer => ({ userId: u.id, role: u.role, name: u.display_name })

/** An id shaped like a real one that was never issued. */
const GHOST = '11111111-2222-3333-4444-555555555555'

beforeAll(async () => {
  process.env.RESUME_DB_PATH = ':memory:'
  delete process.env.RESUME_API_TOKEN
  delete process.env.RESUME_API_TOKENS
  delete process.env.RESUME_BACKUP_DIR
  // This suite is mostly deliberate 401/403/404s, which is precisely what the
  // failure-focused limiter counts. Raise the ceiling; rateLimit.test.ts owns
  // that behaviour.
  process.env.RESUME_RATE_LIMIT_MAX = '1000000'

  const { createApp } = await import('../../server/app')
  const { getDefaultDb } = await import('../../server/db')
  app = createApp()
  db = getDefaultDb()
  accounts = db.accounts

  // Created directly rather than through the bootstrap route: this suite is
  // about authorization, and going through a password would only add scrypt
  // time to every run. `pw_hash` is never verified here.
  owner = accounts.createUser({ username: 'stine', displayName: 'Stine', pwHash: 'x', role: 'owner' })
  kari = accounts.createUser({ username: 'kari', displayName: 'Kari', pwHash: 'x', role: 'member' })
  ola = accounts.createUser({ username: 'ola', displayName: 'Ola', pwHash: 'x', role: 'member' })

  asOwner = session(owner.id)
  asKari = session(kari.id)
  asOla = session(ola.id)
})

afterAll(() => {
  for (const k of ['RESUME_DB_PATH', 'RESUME_RATE_LIMIT_MAX']) delete process.env[k]
})

/**
 * The CSRF pair. `createApp` mounts the double-submit brake, which refuses a
 * state-changing request that carries a session cookie without a matching
 * header — so a session built directly from the accounts store, rather than
 * through the login route that would normally issue both, has to supply both.
 */
const TEST_CSRF = 'test-csrf-value'

function session(userId: string): string {
  return `${SESSION_COOKIE}=${accounts.createSession(userId)}; rs_csrf=${TEST_CSRF}`
}

interface Fixture {
  /** Kari's, private. The resume every "another member" case is aimed at. */
  karisPrivate: string
  /** Kari's, shared with the instance. */
  karisShared: string
  /** Ola's own, so his side of the matrix has something legitimate in it. */
  olas: string
  /** The newest snapshot id per resume, so the snapshot route can be scoped too. */
  snapshotOf: Record<string, number>
}

let fx: Fixture

async function create(cookie: string, name: string): Promise<string> {
  const res = await request(app).post('/api/resumes').set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)
    .send({ name, data: { resume: { full_name: name } } })
  expect(res.status).toBe(201)
  return res.body.resume.id as string
}

/** One save, so the resume has a snapshot to ask for. Returns its id. */
async function snapshot(cookie: string, id: string): Promise<number> {
  const put = await request(app).put(`/api/resumes/${id}`).set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)
    .send({ data: { resume: { full_name: 'v1' } } })
  expect(put.status).toBe(200)
  const list = await request(app).get(`/api/resumes/${id}/snapshots`).set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)
  expect(list.status).toBe(200)
  return list.body.snapshots[0].id as number
}

beforeEach(async () => {
  // The DB singleton lives for the whole file, and DELETE is one of the routes
  // under test — so each case starts from a known, freshly built set.
  for (const r of db.listResumes(SYSTEM_VIEWER)) db.deleteResume(SYSTEM_VIEWER, r.id)

  const karisPrivate = await create(asKari, 'Kari CV')
  const karisShared = await create(asKari, 'Kari Shared CV')
  const olas = await create(asOla, 'Ola CV')
  const snapshotOf: Record<string, number> = {
    [karisPrivate]: await snapshot(asKari, karisPrivate),
    [karisShared]: await snapshot(asKari, karisShared),
    [olas]: await snapshot(asOla, olas),
  }
  db.setVisibility(viewerOf(kari), karisShared, 'instance')
  fx = { karisPrivate, karisShared, olas, snapshotOf }
})

// ─── The matrix ──────────────────────────────────────────────────────────────

const ASKERS = ['owner', 'mine', 'other', 'shared'] as const
type Asker = (typeof ASKERS)[number]

const LABEL: Record<Asker, string> = {
  owner: 'the owner role',
  mine: 'the member who owns it',
  other: 'a member who does not own it',
  shared: 'a member, on a resume shared with the instance',
}

/** Who is asking, and about which resume. */
function subject(asker: Asker): { cookie: string; id: string } {
  switch (asker) {
    case 'owner': return { cookie: asOwner, id: fx.karisPrivate }
    case 'mine': return { cookie: asKari, id: fx.karisPrivate }
    case 'other': return { cookie: asOla, id: fx.karisPrivate }
    case 'shared': return { cookie: asOla, id: fx.karisShared }
  }
}

type Call = (cookie: string, id: string) => Promise<number>

interface RouteCase {
  route: string
  call: Call
  expected: Record<Asker, number>
}

const status = async (t: request.Test): Promise<number> => (await t).status

const CASES: RouteCase[] = [
  {
    route: 'GET /api/resumes/:id',
    call: (cookie, id) => status(request(app).get(`/api/resumes/${id}`).set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)),
    expected: { owner: 200, mine: 200, other: 404, shared: 200 },
  },
  {
    route: 'GET /api/resumes/:id/snapshots',
    call: (cookie, id) =>
      status(request(app).get(`/api/resumes/${id}/snapshots`).set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)),
    expected: { owner: 200, mine: 200, other: 404, shared: 200 },
  },
  {
    route: 'GET /api/resumes/:id/snapshots/:sid',
    call: (cookie, id) =>
      // A snapshot is the CV as it was, so it needs the same guard as the CV.
      // The id is taken from the fixture rather than looked up as the asker,
      // because for the refused cases the lookup itself is what is refused.
      status(request(app).get(`/api/resumes/${id}/snapshots/${fx.snapshotOf[id] ?? 1}`)
        .set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)),
    expected: { owner: 200, mine: 200, other: 404, shared: 200 },
  },
  {
    route: 'PUT /api/resumes/:id',
    call: (cookie, id) =>
      status(request(app).put(`/api/resumes/${id}`).set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)
        .send({ data: { resume: { full_name: 'rewritten' } } })),
    // `shared` is 404, not 200: sharing grants READ. A member who could write a
    // shared resume could rewrite a colleague's CV, and "share with the team"
    // has to be safe to switch on.
    expected: { owner: 200, mine: 200, other: 404, shared: 404 },
  },
  {
    route: 'PATCH /api/resumes/:id',
    call: (cookie, id) =>
      status(request(app).patch(`/api/resumes/${id}`).set('Cookie', cookie).set('x-csrf-token', TEST_CSRF).send({ name: 'Renamed' })),
    expected: { owner: 200, mine: 200, other: 404, shared: 404 },
  },
  {
    route: 'DELETE /api/resumes/:id',
    call: (cookie, id) => status(request(app).delete(`/api/resumes/${id}`).set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)),
    expected: { owner: 200, mine: 200, other: 404, shared: 404 },
  },
]

describe('route × role matrix', () => {
  for (const c of CASES) {
    describe(`${c.route}`, () => {
      for (const asker of ASKERS) {
        it(`${LABEL[asker]} → ${c.expected[asker]}`, async () => {
          const { cookie, id } = subject(asker)
          expect(await c.call(cookie, id)).toBe(c.expected[asker])
        })
      }

      it('answers a resume it will not show exactly as it answers one that does not exist', async () => {
        const hidden = await c.call(asOla, fx.karisPrivate)
        const missing = await c.call(asOla, GHOST)
        expect(hidden).toBe(missing)
      })
    })
  }
})

// ─── The writes that must not land ───────────────────────────────────────────

describe('a refused write changes nothing', () => {
  const stored = (id: string) => db.getResume(SYSTEM_VIEWER, id)

  it('PUT by a member who does not own it leaves the data alone', async () => {
    const before = stored(fx.karisPrivate)!
    await request(app).put(`/api/resumes/${fx.karisPrivate}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)
      .send({ data: { resume: { full_name: 'Ola was here' } } })
    const after = stored(fx.karisPrivate)!
    expect(after.data).toEqual(before.data)
    expect(after.meta.version).toBe(before.meta.version)
  })

  it('PUT on a SHARED resume leaves the data alone', async () => {
    const before = stored(fx.karisShared)!
    await request(app).put(`/api/resumes/${fx.karisShared}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)
      .send({ data: { resume: { full_name: 'Ola was here' } } })
    expect(stored(fx.karisShared)!.data).toEqual(before.data)
  })

  it('PATCH by a member who does not own it leaves the name alone', async () => {
    await request(app).patch(`/api/resumes/${fx.karisPrivate}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)
      .send({ name: 'Ola CV 2' })
    expect(stored(fx.karisPrivate)!.meta.name).toBe('Kari CV')
  })

  it('DELETE by a member who does not own it leaves the resume standing', async () => {
    await request(app).delete(`/api/resumes/${fx.karisPrivate}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)
    expect(stored(fx.karisPrivate)).not.toBeNull()
  })

  it('a refused PUT does not mint a snapshot either', async () => {
    const before = db.listSnapshots(SYSTEM_VIEWER, fx.karisPrivate).length
    await request(app).put(`/api/resumes/${fx.karisPrivate}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)
      .send({ data: { resume: { full_name: 'sneaky' } } })
    expect(db.listSnapshots(SYSTEM_VIEWER, fx.karisPrivate)).toHaveLength(before)
  })
})

// ─── Collection routes ───────────────────────────────────────────────────────

const idsOf = (body: { resumes: { id: string }[] }) => body.resumes.map((r) => r.id).sort()

describe('GET /api/resumes', () => {
  it('the owner role sees every resume on the instance', async () => {
    const res = await request(app).get('/api/resumes').set('Cookie', asOwner).set('x-csrf-token', TEST_CSRF)
    expect(res.status).toBe(200)
    expect(idsOf(res.body)).toEqual([fx.karisPrivate, fx.karisShared, fx.olas].sort())
  })

  it('a member sees their own', async () => {
    const res = await request(app).get('/api/resumes').set('Cookie', asKari).set('x-csrf-token', TEST_CSRF)
    expect(idsOf(res.body)).toEqual([fx.karisPrivate, fx.karisShared].sort())
  })

  it('a member sees their own plus what is shared — never another private one', async () => {
    const res = await request(app).get('/api/resumes').set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)
    expect(idsOf(res.body)).toEqual([fx.karisShared, fx.olas].sort())
    expect(idsOf(res.body)).not.toContain(fx.karisPrivate)
  })
})

describe('GET /api/resumes/storage', () => {
  it('measures only what the asker can read', async () => {
    const mine = await request(app).get('/api/resumes/storage').set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)
    expect(mine.status).toBe(200)
    expect(mine.body.resumes.map((r: { id: string }) => r.id).sort())
      .toEqual([fx.karisShared, fx.olas].sort())

    const all = await request(app).get('/api/resumes/storage').set('Cookie', asOwner).set('x-csrf-token', TEST_CSRF)
    expect(all.body.resumes).toHaveLength(3)
  })
})

describe('POST /api/resumes', () => {
  it('stamps the creator as the owner, private', async () => {
    const id = await create(asKari, 'Fresh')
    const row = db.getResume(SYSTEM_VIEWER, id)!
    expect(row.meta.owner_id).toBe(kari.id)
    expect(row.meta.visibility).toBe('private')
  })

  it('leaves a resume created by a service credential unowned', async () => {
    vi.stubEnv('RESUME_API_TOKEN', 'service-secret')
    try {
      const res = await request(app).post('/api/resumes')
        .set('Authorization', 'Bearer service-secret').send({ name: 'Scripted' })
      expect(res.status).toBe(201)
      expect(db.getResume(SYSTEM_VIEWER, res.body.resume.id)!.meta.owner_id).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('stamps saved_by with the signed-in name, not a token label', async () => {
    const id = await create(asKari, 'Attributed')
    await request(app).put(`/api/resumes/${id}`).set('Cookie', asKari).set('x-csrf-token', TEST_CSRF).send({ data: { v: 1 } })
    expect(db.getResume(SYSTEM_VIEWER, id)!.meta.saved_by).toBe('Kari')
  })
})

// ─── Visibility ──────────────────────────────────────────────────────────────

describe('setVisibility', () => {
  it('the owner of the resume may share it and take it back', async () => {
    expect(db.setVisibility(viewerOf(kari), fx.karisPrivate, 'instance')).toBe(true)
    expect((await request(app).get(`/api/resumes/${fx.karisPrivate}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)).status).toBe(200)
    expect(db.setVisibility(viewerOf(kari), fx.karisPrivate, 'private')).toBe(true)
    expect((await request(app).get(`/api/resumes/${fx.karisPrivate}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)).status).toBe(404)
  })

  it('another member cannot share someone else\'s resume, nor unshare a shared one', () => {
    expect(db.setVisibility(viewerOf(ola), fx.karisPrivate, 'instance')).toBe(false)
    expect(db.setVisibility(viewerOf(ola), fx.karisShared, 'private')).toBe(false)
    expect(db.getResume(SYSTEM_VIEWER, fx.karisPrivate)!.meta.visibility).toBe('private')
    expect(db.getResume(SYSTEM_VIEWER, fx.karisShared)!.meta.visibility).toBe('instance')
  })

  it('the owner role can always intervene', () => {
    expect(db.setVisibility(viewerOf(owner), fx.karisPrivate, 'instance')).toBe(true)
  })
})

// ─── Backup routes ───────────────────────────────────────────────────────────

describe('backup routes', () => {
  /** Read a zip response as raw bytes rather than supertest's default parse. */
  const zipOf = (cookie: string) =>
    request(app).get('/api/backup/export').set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)
      .buffer().parse((r, cb) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })

  it('GET /api/backup/export gives a member their OWN resumes', async () => {
    // Ola's side, because it is the one that distinguishes "mine" from "what I
    // can see": `karisShared` is readable by Ola in the app, and must still not
    // ride out in his archive.
    const res = await zipOf(asOla)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    // Filenames carry the resume id in the zip's central directory, so whose
    // resumes an archive holds is checkable without unzipping it.
    const body = (res.body as Buffer).toString('latin1')
    expect(body).toContain(fx.olas)
    expect(body).not.toContain(fx.karisShared)
    expect(body).not.toContain(fx.karisPrivate)
  })

  it('GET /api/backup/export gives an owner the whole instance', async () => {
    const res = await zipOf(asOwner)
    expect(res.status).toBe(200)
    const body = (res.body as Buffer).toString('latin1')
    expect(body).toContain(fx.karisPrivate)
    expect(body).toContain(fx.olas)
  })

  it('GET /api/backup/export still refuses an anonymous caller', async () => {
    expect((await request(app).get('/api/backup/export')).status).toBe(401)
  })

  it('the export zip is a real archive', async () => {
    const ok = await request(app).get('/api/backup/export').set('Cookie', asOwner).set('x-csrf-token', TEST_CSRF)
      .buffer().parse((r, cb) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toBe('application/zip')
  })

  it('POST /api/backup/restore is owner-only, and refuses BEFORE it looks at the folder', async () => {
    expect((await request(app).post('/api/backup/restore').set('Cookie', asKari).set('x-csrf-token', TEST_CSRF).send({})).status).toBe(403)
    // No RESUME_BACKUP_DIR here, so an owner gets the configuration error — which
    // is the proof the role check ran first rather than after.
    expect((await request(app).post('/api/backup/restore').set('Cookie', asOwner).set('x-csrf-token', TEST_CSRF).send({})).status).toBe(400)
  })

  it('GET /api/backup/status stays open to members', async () => {
    expect((await request(app).get('/api/backup/status').set('Cookie', asKari).set('x-csrf-token', TEST_CSRF)).status).toBe(200)
  })

  it('an imported file lands owned by the importer', async () => {
    const foreign = '99999999-8888-7777-6666-555555555555'
    const res = await request(app).post('/api/backup/import').set('Cookie', asOla).set('x-csrf-token', TEST_CSRF).send({
      $schema: 'resumestudio-resume/v1', format_version: 1,
      exported_at: new Date().toISOString(), generator: 'resume-studio',
      resume: {
        id: foreign, name: 'Imported', primary_locale: 'en', secondary_locale: null,
        saved_at: '2999-01-01T00:00:00.000Z', created_at: '2999-01-01T00:00:00.000Z',
        // A member's import cannot hand ownership to somebody else, whatever the
        // file claims — otherwise "import this" would be a way to plant a CV in
        // a colleague's account.
        owner_id: kari.id,
        data: { resume: { full_name: 'Imported' } },
      },
      registry: [],
    })
    expect(res.status).toBe(200)
    expect(res.body.inserted).toBe(1)
    expect(db.getResume(SYSTEM_VIEWER, foreign)!.meta.owner_id).toBe(ola.id)
  })

  it('an owner\'s import keeps the ownership the file records', async () => {
    const foreign = '44444444-3333-2222-1111-000000000000'
    const res = await request(app).post('/api/backup/import').set('Cookie', asOwner).set('x-csrf-token', TEST_CSRF).send({
      $schema: 'resumestudio-resume/v1', format_version: 1,
      exported_at: new Date().toISOString(), generator: 'resume-studio',
      resume: {
        id: foreign, name: 'Restored', primary_locale: 'en', secondary_locale: null,
        saved_at: '2999-01-01T00:00:00.000Z', created_at: '2999-01-01T00:00:00.000Z',
        owner_id: kari.id,
        data: { resume: { full_name: 'Restored' } },
      },
      registry: [],
    })
    expect(res.status).toBe(200)
    expect(db.getResume(SYSTEM_VIEWER, foreign)!.meta.owner_id).toBe(kari.id)
  })

  it('an owner\'s import ignores an owner_id no account here answers to', async () => {
    const foreign = '55555555-4444-3333-2222-111111111111'
    await request(app).post('/api/backup/import').set('Cookie', asOwner).set('x-csrf-token', TEST_CSRF).send({
      $schema: 'resumestudio-resume/v1', format_version: 1,
      exported_at: new Date().toISOString(), generator: 'resume-studio',
      resume: {
        id: foreign, name: 'From Elsewhere', primary_locale: 'en', secondary_locale: null,
        saved_at: '2999-01-01T00:00:00.000Z', created_at: '2999-01-01T00:00:00.000Z',
        owner_id: 'a-user-from-another-instance',
        data: { resume: { full_name: 'From Elsewhere' } },
      },
      registry: [],
    })
    expect(db.getResume(SYSTEM_VIEWER, foreign)!.meta.owner_id).toBe(owner.id)
  })

  /**
   * The one that would be worst to get wrong: merging is BY ID, so an upload
   * naming a colleague's resume is a write to it unless the merge is scoped.
   */
  it('an import cannot rewrite a resume the importer does not own', async () => {
    const before = db.getResume(SYSTEM_VIEWER, fx.karisPrivate)!
    const res = await request(app).post('/api/backup/import').set('Cookie', asOla).set('x-csrf-token', TEST_CSRF).send({
      $schema: 'resumestudio-resume/v1', format_version: 1,
      exported_at: new Date().toISOString(), generator: 'resume-studio',
      resume: {
        id: fx.karisPrivate, name: 'Hijacked', primary_locale: 'en', secondary_locale: null,
        // Newest-wins would otherwise make this the winning copy.
        saved_at: '2999-01-01T00:00:00.000Z', created_at: '2000-01-01T00:00:00.000Z',
        data: { resume: { full_name: 'Ola was here' } },
      },
      registry: [],
    })
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(0)
    expect(res.body.skipped).toBe(1)
    const after = db.getResume(SYSTEM_VIEWER, fx.karisPrivate)!
    expect(after.data).toEqual(before.data)
    expect(after.meta.name).toBe('Kari CV')
    expect(after.meta.owner_id).toBe(kari.id)
  })

  /** A tombstone is an erasure order, and it arrives inside a file the user chose. */
  it('an imported tombstone cannot erase a resume the importer does not own', async () => {
    const zip = zipSync({
      'ola.json': strToU8(JSON.stringify({
        $schema: 'resumestudio-resume/v1', format_version: 1,
        exported_at: new Date().toISOString(), generator: 'resume-studio',
        resume: {
          id: fx.olas, name: 'Ola CV', primary_locale: 'en', secondary_locale: null,
          saved_at: '2999-01-01T00:00:00.000Z', created_at: '2000-01-01T00:00:00.000Z',
          data: { resume: { full_name: 'Ola CV' } },
        },
        registry: [],
      })),
      'resume-studio-deleted-resumes.json': strToU8(JSON.stringify({
        $schema: 'resumestudio-tombstones/v1', format_version: 1,
        exported_at: new Date().toISOString(), generator: 'resume-studio',
        tombstones: [{ id: fx.karisPrivate, deleted_at: '2999-01-01T00:00:00.000Z' }],
      })),
    })

    const res = await request(app).post('/api/backup/import').set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)
      .set('Content-Type', 'application/zip').send(Buffer.from(zip))
    expect(res.status).toBe(200)
    expect(db.getResume(SYSTEM_VIEWER, fx.karisPrivate)).not.toBeNull()
  })
})

// ─── Registry ────────────────────────────────────────────────────────────────

describe('registry routes', () => {
  const makeEntry = async (cookie: string, name: string) => {
    const res = await request(app).post('/api/registry').set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)
      .send({ kind: 'skill', name: { en: name } })
    expect([200, 201]).toContain(res.status)
    return res.body.entry.id as string
  }

  it('stays instance-wide: a member reads and writes it', async () => {
    const id = await makeEntry(asKari, `Kubernetes ${Date.now()}`)
    expect((await request(app).get('/api/registry').set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)).status).toBe(200)
    expect((await request(app).get(`/api/registry/${id}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)).status).toBe(200)
    const put = await request(app).put(`/api/registry/${id}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)
      .send({ name: { en: `Kubernetes renamed ${Date.now()}` } })
    expect(put.status).toBe(200)
  })

  it('DELETE is owner-only — it rewrites references across resumes the deleter cannot see', async () => {
    const id = await makeEntry(asKari, `Doomed ${Date.now()}`)
    expect((await request(app).delete(`/api/registry/${id}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)).status).toBe(403)
    expect((await request(app).get(`/api/registry/${id}`).set('Cookie', asOla).set('x-csrf-token', TEST_CSRF)).status).toBe(200)
    expect((await request(app).delete(`/api/registry/${id}`).set('Cookie', asOwner).set('x-csrf-token', TEST_CSRF)).status).toBe(200)
  })
})

// ─── The credentials themselves ──────────────────────────────────────────────

describe('who gets in at all', () => {
  it('no session, no access — every resume route 401s', async () => {
    for (const t of [
      request(app).get('/api/resumes'),
      request(app).get(`/api/resumes/${fx.karisPrivate}`),
      request(app).put(`/api/resumes/${fx.karisPrivate}`).send({ data: {} }),
      request(app).delete(`/api/resumes/${fx.karisPrivate}`),
      request(app).get('/api/backup/export'),
    ]) {
      expect((await t).status).toBe(401)
    }
  })

  it('a bad session id is a plain 401, not a hint', async () => {
    const res = await request(app).get('/api/resumes').set('Cookie', `${SESSION_COOKIE}=nonsense`)
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
  })

  it('a service token still sees everything, so scripts and CI keep working', async () => {
    vi.stubEnv('RESUME_API_TOKEN', 'service-secret')
    try {
      const res = await request(app).get('/api/resumes').set('Authorization', 'Bearer service-secret')
      expect(res.status).toBe(200)
      expect(idsOf(res.body)).toEqual([fx.karisPrivate, fx.karisShared, fx.olas].sort())
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('a disabled account loses access immediately, session or not', async () => {
    const gone = accounts.createUser({ username: 'temp', displayName: 'Temp', pwHash: 'x', role: 'member' })
    const cookie = session(gone.id)
    expect((await request(app).get('/api/resumes').set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)).status).toBe(200)
    accounts.setDisabled(gone.id, true)
    expect((await request(app).get('/api/resumes').set('Cookie', cookie).set('x-csrf-token', TEST_CSRF)).status).toBe(401)
  })
})
