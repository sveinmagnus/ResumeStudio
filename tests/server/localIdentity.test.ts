import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createResumeDb, SYSTEM_VIEWER } from '../../server/db'
import { localIdentity, resolveViewer } from '../../server/auth'
import type { Request } from 'express'

/**
 * Identity on an install that never asks anyone to log in.
 *
 * The desktop build has no accounts by design, but "no accounts" used to mean
 * "no author": saves were stamped with nothing, and a resume copied to a shared
 * instance arrived anonymous. Settings now carries the same three fields an
 * account does, so the move is a match rather than a re-entry.
 */

const ENV = ['RESUME_USER_USERNAME', 'RESUME_USER_DISPLAY_NAME', 'RESUME_USER_EMAIL'] as const

function setIdentity(username: string, displayName: string, email: string): void {
  process.env.RESUME_USER_USERNAME = username
  process.env.RESUME_USER_DISPLAY_NAME = displayName
  process.env.RESUME_USER_EMAIL = email
}

beforeEach(() => { for (const k of ENV) delete process.env[k] })
afterEach(() => { for (const k of ENV) delete process.env[k] })

/** A bare request object — `resolveViewer` only reads headers. */
const req = () => ({ headers: {} }) as unknown as Request

describe('localIdentity', () => {
  it('is empty when nothing is configured', () => {
    expect(localIdentity()).toEqual({ username: '', displayName: '', email: '' })
  })

  it('reads what Settings projected onto env', () => {
    setIdentity('kari', 'Kari Nordmann', 'kari@example.no')
    expect(localIdentity()).toEqual({
      username: 'kari', displayName: 'Kari Nordmann', email: 'kari@example.no',
    })
  })

  it('trims padding, so a pasted value does not arrive with spaces', () => {
    setIdentity('  kari  ', '  Kari Nordmann  ', '  kari@example.no  ')
    expect(localIdentity().displayName).toBe('Kari Nordmann')
  })
})

describe('the unauthenticated viewer carries a name', () => {
  it('is anonymous when Settings is empty', () => {
    expect(resolveViewer(req())?.name).toBeNull()
  })

  it('stamps the display name, which is what saved_by shows', () => {
    setIdentity('kari', 'Kari Nordmann', 'kari@example.no')
    expect(resolveViewer(req())?.name).toBe('Kari Nordmann')
  })

  it('falls back to the username when no display name is set', () => {
    setIdentity('kari', '', '')
    expect(resolveViewer(req())?.name).toBe('kari')
  })

  it('still owns nothing and still sees everything', () => {
    // The desktop viewer must keep behaving exactly as it did: a name is a
    // label, not an account, so resumes stay unowned and scoping stays open.
    setIdentity('kari', 'Kari Nordmann', '')
    const v = resolveViewer(req())
    expect(v?.userId).toBeNull()
    expect(v?.role).toBe('owner')
  })
})

describe('a dumped resume carries its author', () => {
  it('names the person from Settings on an install with no accounts', () => {
    setIdentity('kari', 'Kari Nordmann', 'kari@example.no')
    const db = createResumeDb(':memory:')
    db.createResume(SYSTEM_VIEWER, { name: 'CV', data: {} })
    const [entry] = db.dumpResumes(SYSTEM_VIEWER)
    expect(entry.author).toEqual({
      username: 'kari', display_name: 'Kari Nordmann', email: 'kari@example.no',
    })
  })

  it('carries no author when nobody has said who they are', () => {
    const db = createResumeDb(':memory:')
    db.createResume(SYSTEM_VIEWER, { name: 'CV', data: {} })
    expect(db.dumpResumes(SYSTEM_VIEWER)[0].author).toBeNull()
  })

  it('prefers the owning account over the local identity when there is one', () => {
    // On a server the account is the truth; the local fields are the desktop's
    // stand-in for one and must not shadow it.
    setIdentity('desktop-person', 'Desktop Person', 'desktop@example.no')
    const db = createResumeDb(':memory:')
    const user = db.accounts.createUser({
      username: 'ola', displayName: 'Ola Nordmann', pwHash: 'x', role: 'member', email: 'ola@example.no',
    })
    const created = db.createResume(
      { userId: user.id, role: 'member', name: 'Ola Nordmann' },
      { name: 'Ola CV', data: {} },
    )
    const entry = db.dumpResumes(SYSTEM_VIEWER).find((e) => e.id === created.id)
    expect(entry?.author).toEqual({
      username: 'ola', display_name: 'Ola Nordmann', email: 'ola@example.no',
    })
  })

  it('is descriptive only — it does not decide ownership on the way back in', () => {
    // A file cannot prove who wrote it. Restoring one that names an author has
    // to leave ownership where restoreResumes' own rule puts it.
    setIdentity('kari', 'Kari Nordmann', 'kari@example.no')
    const src = createResumeDb(':memory:')
    src.createResume(SYSTEM_VIEWER, { name: 'CV', data: {} })
    const entries = src.dumpResumes(SYSTEM_VIEWER)

    const dest = createResumeDb(':memory:')
    const importer = dest.accounts.createUser({
      username: 'importer', displayName: 'Importer', pwHash: 'x', role: 'member',
    })
    dest.restoreResumes({ userId: importer.id, role: 'member', name: 'Importer' }, entries)
    const [restored] = dest.listResumes(SYSTEM_VIEWER)
    expect(restored.owner_id).toBe(importer.id)
  })
})
