import { describe, it, expect } from 'vitest'
import {
  canRead,
  canWrite,
  canReshare,
  readableWhere,
  writableWhere,
  normaliseVisibility,
  isUnrestricted,
} from '../../server/access'
import type { Viewer } from '../../server/accounts'

const owner: Viewer = { userId: 'u-owner', role: 'owner', name: 'Owner' }
const kari: Viewer = { userId: 'u-kari', role: 'member', name: 'Kari' }
const ola: Viewer = { userId: 'u-ola', role: 'member', name: 'Ola' }
const service: Viewer = { userId: null, role: 'owner', name: null }

const karisPrivate = { owner_id: 'u-kari', visibility: 'private' }
const karisShared = { owner_id: 'u-kari', visibility: 'instance' }
const unowned = { owner_id: null, visibility: 'private' }
const unownedShared = { owner_id: null, visibility: 'instance' }

describe('canRead — the matrix', () => {
  const cases: [string, Viewer, { owner_id: string | null; visibility: string }, boolean][] = [
    ['owner reads a member private resume', owner, karisPrivate, true],
    ['owner reads an unowned resume', owner, unowned, true],
    ['service credential reads anything', service, karisPrivate, true],
    ['a member reads their own private resume', kari, karisPrivate, true],
    ['a member reads their own shared resume', kari, karisShared, true],
    ['a member CANNOT read another private resume', ola, karisPrivate, false],
    ['a member CAN read another shared resume', ola, karisShared, true],
    ['a member cannot read an unowned resume', ola, unowned, false],
    ['a member cannot read an unowned resume even if marked shared', ola, unownedShared, false],
  ]
  for (const [name, viewer, row, expected] of cases) {
    it(`${name}`, () => { expect(canRead(viewer, row)).toBe(expected) })
  }
})

describe('canWrite — sharing grants read only', () => {
  const cases: [string, Viewer, { owner_id: string | null; visibility: string }, boolean][] = [
    ['owner writes anything', owner, karisPrivate, true],
    ['service credential writes anything', service, karisPrivate, true],
    ['a member writes their own', kari, karisPrivate, true],
    ['a member does NOT write another private resume', ola, karisPrivate, false],
    // The one that matters: a resume being readable must not make it editable,
    // or "share with the team" would mean "let the team rewrite my CV".
    ['a member does NOT write another SHARED resume', ola, karisShared, false],
    ['a member does not write an unowned resume', ola, unowned, false],
  ]
  for (const [name, viewer, row, expected] of cases) {
    it(`${name}`, () => { expect(canWrite(viewer, row)).toBe(expected) })
  }
})

describe('canReshare', () => {
  it('follows the write rule — the person who owns it decides', () => {
    expect(canReshare(kari, karisPrivate)).toBe(true)
    expect(canReshare(ola, karisShared)).toBe(false)
    expect(canReshare(owner, karisPrivate)).toBe(true)
  })
})

describe('normaliseVisibility', () => {
  it('recognises the shared value', () => {
    expect(normaliseVisibility('instance')).toBe('instance')
  })

  it('treats everything else as private, including junk from an old row', () => {
    for (const v of ['private', '', 'public', 'INSTANCE', null, undefined, 0, {}, []]) {
      expect(normaliseVisibility(v)).toBe('private')
    }
  })
})

describe('readableWhere / writableWhere', () => {
  it('is null for an unrestricted viewer, so their queries stay unscoped', () => {
    expect(readableWhere(owner)).toBeNull()
    expect(readableWhere(service)).toBeNull()
    expect(writableWhere(owner)).toBeNull()
  })

  it('binds the member id, and never interpolates it', () => {
    const where = readableWhere(kari)
    expect(where?.params).toEqual(['u-kari'])
    // The id must reach SQLite as a bound parameter; a fragment containing the
    // id itself would be a string-built query.
    expect(where?.sql).not.toContain('u-kari')
    expect(where?.sql).toContain('?')
  })

  it('excludes unowned rows from a member read, matching canRead', () => {
    expect(readableWhere(kari)?.sql).toContain('owner_id IS NOT NULL')
  })

  it('restricts a member write to rows they own', () => {
    const where = writableWhere(ola)
    expect(where?.sql).toBe('owner_id = ?')
    expect(where?.params).toEqual(['u-ola'])
  })
})

describe('isUnrestricted', () => {
  it('is the role, not the presence of a user id', () => {
    expect(isUnrestricted(owner)).toBe(true)
    expect(isUnrestricted(service)).toBe(true)
    expect(isUnrestricted(kari)).toBe(false)
  })
})
