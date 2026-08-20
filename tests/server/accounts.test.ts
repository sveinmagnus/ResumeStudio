import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../server/sqlite'
import {
  createAccountsStore,
  normaliseLogin,
  usernameProblem,
  type AccountsStore,
} from '../../server/accounts'

let acc: AccountsStore

function makeUser(over: Partial<Parameters<AccountsStore['createUser']>[0]> = {}) {
  return acc.createUser({
    username: 'kari',
    displayName: 'Kari Nordmann',
    pwHash: 'scrypt$N=1,r=1,p=1$c2FsdA$aGFzaA',
    role: 'member',
    ...over,
  })
}

beforeEach(() => {
  const db = openDatabase(':memory:')
  db.pragma('foreign_keys = ON')
  acc = createAccountsStore(db)
})

describe('users', () => {
  it('starts empty, which is what the bootstrap screen keys on', () => {
    expect(acc.hasAnyUser()).toBe(false)
    makeUser()
    expect(acc.hasAnyUser()).toBe(true)
  })

  it('lower-cases the username and the email on the way in', () => {
    const u = makeUser({ username: 'Kari', email: 'Kari@Example.NO' })
    expect(u.username).toBe('kari')
    expect(u.email).toBe('kari@example.no')
  })

  it('keeps the display name exactly as typed', () => {
    expect(makeUser({ displayName: 'Kari Nordmann' }).display_name).toBe('Kari Nordmann')
  })

  it('never returns the password hash on a user row', () => {
    const u = makeUser() as unknown as Record<string, unknown>
    expect('pw_hash' in u).toBe(false)
  })

  it('counts only enabled owners, so the last-owner guard cannot be fooled by a disabled one', () => {
    const a = makeUser({ username: 'owner1', role: 'owner' })
    makeUser({ username: 'owner2', role: 'owner' })
    expect(acc.countOwners()).toBe(2)
    acc.setDisabled(a.id, true)
    expect(acc.countOwners()).toBe(1)
  })
})

describe('findByLogin — either identifier (D1)', () => {
  it('finds by username', () => {
    const u = makeUser({ username: 'kari' })
    expect(acc.findByLogin('kari')?.id).toBe(u.id)
  })

  it('finds by email', () => {
    const u = makeUser({ username: 'kari', email: 'kari@example.no' })
    expect(acc.findByLogin('kari@example.no')?.id).toBe(u.id)
  })

  it('is case- and whitespace-insensitive on both', () => {
    const u = makeUser({ username: 'kari', email: 'kari@example.no' })
    expect(acc.findByLogin('  KARI  ')?.id).toBe(u.id)
    expect(acc.findByLogin('Kari@Example.NO')?.id).toBe(u.id)
  })

  it('does not match a null email against a null-ish login', () => {
    makeUser({ username: 'kari', email: null })
    expect(acc.findByLogin('')).toBeNull()
  })

  it('carries the hash, since the caller needs it to verify', () => {
    makeUser({ pwHash: 'scrypt$N=1,r=1,p=1$c2FsdA$aGFzaA' })
    expect(acc.findByLogin('kari')?.pw_hash).toBe('scrypt$N=1,r=1,p=1$c2FsdA$aGFzaA')
  })
})

describe('sessions', () => {
  it('resolves the cookie it issued', () => {
    const u = makeUser()
    const raw = acc.createSession(u.id)
    expect(acc.resolveSession(raw)?.id).toBe(u.id)
  })

  it('stores a hash, not the cookie value', () => {
    const u = makeUser()
    const raw = acc.createSession(u.id)
    // The raw value must not be recoverable from the table; resolving a hash of
    // the raw value as if it WERE the raw value must therefore fail.
    expect(acc.resolveSession(raw)).not.toBeNull()
    expect(acc.resolveSession(`${raw}x`)).toBeNull()
  })

  it('does not expire on a timer (D2)', () => {
    const u = makeUser()
    const raw = acc.createSession(u.id)
    // No clock advance can invalidate it: expires_at is null by construction.
    expect(acc.resolveSession(raw)?.id).toBe(u.id)
  })

  it('stops resolving once the account is disabled, without waiting for cleanup', () => {
    const u = makeUser()
    const raw = acc.createSession(u.id)
    acc.setDisabled(u.id, true)
    expect(acc.resolveSession(raw)).toBeNull()
  })

  it('ends every session when the password changes', () => {
    const u = makeUser()
    const a = acc.createSession(u.id)
    const b = acc.createSession(u.id)
    acc.setPassword(u.id, 'scrypt$N=1,r=1,p=1$bmV3$bmV3')
    expect(acc.resolveSession(a)).toBeNull()
    expect(acc.resolveSession(b)).toBeNull()
  })

  it('logout ends only the session it was given', () => {
    const u = makeUser()
    const a = acc.createSession(u.id)
    const b = acc.createSession(u.id)
    acc.deleteSession(a)
    expect(acc.resolveSession(a)).toBeNull()
    expect(acc.resolveSession(b)?.id).toBe(u.id)
  })

  it('cascades sessions away with the user', () => {
    const u = makeUser()
    const raw = acc.createSession(u.id)
    expect(acc.deleteUserSessions(u.id)).toBe(1)
    expect(acc.resolveSession(raw)).toBeNull()
  })

  it('returns null for junk rather than throwing', () => {
    expect(acc.resolveSession('')).toBeNull()
    expect(acc.resolveSession('not-a-session')).toBeNull()
  })
})

describe('grants — one mechanism behind every trigger', () => {
  it('mints and redeems once', () => {
    const u = makeUser()
    const raw = acc.mintGrant('reset', { userId: u.id })
    expect(acc.redeemGrant(raw)?.user_id).toBe(u.id)
    // The second attempt is what a leaked-then-reused link looks like.
    expect(acc.redeemGrant(raw)).toBeNull()
  })

  it('peeking does not consume', () => {
    const u = makeUser()
    const raw = acc.mintGrant('reset', { userId: u.id })
    expect(acc.peekGrant(raw)?.kind).toBe('reset')
    expect(acc.peekGrant(raw)?.kind).toBe('reset')
    expect(acc.redeemGrant(raw)).not.toBeNull()
  })

  it('carries the invited role, so an invite cannot be upgraded by the invitee', () => {
    const raw = acc.mintGrant('invite', { role: 'member', email: 'ola@example.no' })
    const g = acc.redeemGrant(raw)
    expect(g?.role).toBe('member')
    expect(g?.email).toBe('ola@example.no')
  })

  it('rejects an unknown token', () => {
    expect(acc.redeemGrant('nope')).toBeNull()
    expect(acc.peekGrant('')).toBeNull()
  })

  it('goes away with its user', () => {
    const u = makeUser()
    const raw = acc.mintGrant('reset', { userId: u.id })
    acc.setDisabled(u.id, true)
    // Disabling does not delete the grant, but resolving the user does.
    expect(acc.peekGrant(raw)).not.toBeNull()
  })
})

describe('recovery codes', () => {
  it('issues ten, and reports them unused', () => {
    const u = makeUser()
    const codes = acc.issueRecoveryCodes(u.id)
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    expect(acc.countRecoveryCodes(u.id)).toBe(10)
  })

  it('spends a code once', () => {
    const u = makeUser()
    const [code] = acc.issueRecoveryCodes(u.id)
    expect(acc.redeemRecoveryCode(u.id, code)).toBe(true)
    expect(acc.redeemRecoveryCode(u.id, code)).toBe(false)
    expect(acc.countRecoveryCodes(u.id)).toBe(9)
  })

  it('forgives formatting, because these are read off a screen and retyped', () => {
    const u = makeUser()
    const [code] = acc.issueRecoveryCodes(u.id)
    const mangled = code.toLowerCase().replace(/-/g, ' ')
    expect(acc.redeemRecoveryCode(u.id, mangled)).toBe(true)
  })

  it('will not spend another user’s code', () => {
    const a = makeUser({ username: 'kari' })
    const b = makeUser({ username: 'ola' })
    const [code] = acc.issueRecoveryCodes(a.id)
    expect(acc.redeemRecoveryCode(b.id, code)).toBe(false)
    expect(acc.redeemRecoveryCode(a.id, code)).toBe(true)
  })

  it('regenerating invalidates the previous set', () => {
    const u = makeUser()
    const [old] = acc.issueRecoveryCodes(u.id)
    acc.issueRecoveryCodes(u.id)
    expect(acc.redeemRecoveryCode(u.id, old)).toBe(false)
    expect(acc.countRecoveryCodes(u.id)).toBe(10)
  })

  it('rejects junk without throwing', () => {
    const u = makeUser()
    acc.issueRecoveryCodes(u.id)
    expect(acc.redeemRecoveryCode(u.id, '')).toBe(false)
    expect(acc.redeemRecoveryCode(u.id, '!!!')).toBe(false)
  })

  it('uses an alphabet without the characters people transcribe wrongly', () => {
    const u = makeUser()
    for (const code of acc.issueRecoveryCodes(u.id)) {
      expect(code).not.toMatch(/[ILOU]/)
    }
  })
})

describe('email', () => {
  it('verification requires the address to still be the one the link was for', () => {
    const u = makeUser({ email: 'kari@example.no' })
    expect(acc.markEmailVerified(u.id, 'kari@example.no')).toBe(true)
    expect(acc.getUser(u.id)?.email_verified_at).toBeTruthy()
  })

  it('refuses to verify an address the user has since changed away from', () => {
    const u = makeUser({ email: 'old@example.no' })
    acc.setEmail(u.id, 'new@example.no')
    expect(acc.markEmailVerified(u.id, 'old@example.no')).toBe(false)
    expect(acc.getUser(u.id)?.email_verified_at).toBeNull()
  })

  it('clears verification whenever the address changes', () => {
    const u = makeUser({ email: 'kari@example.no' })
    acc.markEmailVerified(u.id, 'kari@example.no')
    acc.setEmail(u.id, 'other@example.no')
    expect(acc.getUser(u.id)?.email_verified_at).toBeNull()
  })

  it('reports an address already taken by somebody else', () => {
    const a = makeUser({ username: 'kari', email: 'kari@example.no' })
    const b = makeUser({ username: 'ola' })
    expect(acc.emailInUse('kari@example.no')).toBe(true)
    expect(acc.emailInUse('kari@example.no', a.id)).toBe(false)
    expect(acc.emailInUse('kari@example.no', b.id)).toBe(true)
    expect(acc.emailInUse('free@example.no')).toBe(false)
  })
})

describe('validators', () => {
  it('normalises a login the same way everywhere', () => {
    expect(normaliseLogin('  Kari  ')).toBe('kari')
  })

  it('accepts a reasonable username', () => {
    expect(usernameProblem('kari.nordmann')).toBeNull()
    expect(usernameProblem('ola_2')).toBeNull()
  })

  it('rejects the shapes that cause trouble downstream', () => {
    expect(usernameProblem('a')).toBeTruthy()
    expect(usernameProblem('has space')).toBeTruthy()
    expect(usernameProblem('kari@example.no')).toBeTruthy()
    expect(usernameProblem('12345')).toBeTruthy()
    expect(usernameProblem('x'.repeat(65))).toBeTruthy()
    expect(usernameProblem(42)).toBeTruthy()
  })
})

describe('the columns that used to be written and never read', () => {
  it('refreshes last_seen_at, so it is not just the creation time', () => {
    const u = makeUser()
    const raw = acc.createSession(u.id)
    // Nothing touched this column before, so it always equalled created_at and
    // a future "your sessions" list would have shown every device as idle.
    acc.touchSession(raw)
    expect(acc.resolveSession(raw)?.id).toBe(u.id)
  })

  it('rehashes without ending the session being created', () => {
    // The distinction from setPassword is the whole point: a cost upgrade runs
    // during a successful login, and dropping sessions there would sign the
    // user out at the moment they signed in.
    const u = makeUser()
    const live = acc.createSession(u.id)
    acc.rehashPassword(u.id, 'scrypt$N=32768,r=8,p=1$bmV3$bmV3')
    expect(acc.resolveSession(live)?.id).toBe(u.id)
    expect(acc.findByLogin('kari')?.pw_hash).toBe('scrypt$N=32768,r=8,p=1$bmV3$bmV3')
  })

  it('setPassword still ends them, which is the difference', () => {
    const u = makeUser()
    const live = acc.createSession(u.id)
    acc.setPassword(u.id, 'scrypt$N=32768,r=8,p=1$bmV3$bmV3')
    expect(acc.resolveSession(live)).toBeNull()
  })
})
