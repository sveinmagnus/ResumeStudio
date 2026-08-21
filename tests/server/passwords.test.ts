import { describe, it, expect } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  passwordProblem,
  PASSWORD_MIN_LENGTH,
} from '../../server/passwords'

// scrypt at the configured cost takes a few hundred ms per derivation, and
// several of these hash more than once.
const SLOW = { timeout: 30_000 }

describe('hashPassword / verifyPassword', SLOW, () => {
  it('accepts the password it hashed', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
  })

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('correct horse battery staple')
    const b = await hashPassword('correct horse battery staple')
    expect(a).not.toEqual(b)
    // Both still verify — the difference is the salt, not the input.
    expect(await verifyPassword('correct horse battery staple', a)).toBe(true)
    expect(await verifyPassword('correct horse battery staple', b)).toBe(true)
  })

  it('stores its own parameters so the cost can be raised later', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored.startsWith('scrypt$N=')).toBe(true)
    expect(stored.split('$')).toHaveLength(4)
  })

  it('normalises unicode, so the same passphrase typed two ways still verifies', async () => {
    // U+00E5 vs 'a' + U+030A — visually identical, different bytes. A macOS
    // keyboard and a Windows one can genuinely produce the two forms.
    const composed = 'blåbærsyltetøy!'
    const decomposed = composed.normalize('NFD')
    expect(composed).not.toEqual(decomposed)
    const stored = await hashPassword(composed)
    expect(await verifyPassword(decomposed, stored)).toBe(true)
  })
})

/**
 * Stored values `decode()` must refuse, and the reason they are asserted TWICE.
 *
 * Through `verifyPassword` they all answer the same way whatever decode does:
 * it catches everything and returns false, so a guard that stopped working
 * would still produce `false` — by mis-parsing and failing the comparison, or by
 * throwing into the catch. Mutation testing showed exactly that: every guard in
 * the parser could be deleted with this table still green.
 *
 * `needsRehash` is the channel that can tell the difference. It answers TRUE for
 * a value it cannot read and compares parameters for one it can, so a guard
 * that stops firing flips it to false. That is also a real property rather than
 * a testing trick: a row we cannot read has to be replaced at the next
 * successful login, not left to sit there.
 */
const BAD_HASHES = [
  ['empty', ''],
  ['not ours', 'bcrypt$2b$12$abcdefg'],
  ['too few fields', 'scrypt$N=32768,r=8,p=1$c2FsdA'],
  ['unknown parameter', 'scrypt$N=32768,r=8,p=1,q=2$c2FsdA$aGFzaA'],
  ['non-numeric cost', 'scrypt$N=abc,r=8,p=1$c2FsdA$aGFzaA'],
  ['zero cost', 'scrypt$N=0,r=8,p=1$c2FsdA$aGFzaA'],
  ['negative cost', 'scrypt$N=-1,r=8,p=1$c2FsdA$aGFzaA'],
  ['missing r', 'scrypt$N=32768,p=1$c2FsdA$aGFzaA'],
  ['empty salt', 'scrypt$N=32768,r=8,p=1$$aGFzaA'],
  ['empty key', 'scrypt$N=32768,r=8,p=1$c2FsdA$'],
  // Reaches scrypt and THROWS without the ceiling guard, turning one crafted
  // row into a 500 on every login attempt against it.
  ['cost above the memory ceiling', 'scrypt$N=1048576,r=8,p=1$c2FsdA$aGFzaA'],
] as const

describe('verifyPassword — malformed stored values', SLOW, () => {
  // A login route must not 500 because a row is corrupt; the answer to "is this
  // the right password" for an unreadable hash is no.
  for (const [label, stored] of BAD_HASHES) {
    it(`returns false for ${label}`, async () => {
      expect(await verifyPassword('correct horse battery staple', stored)).toBe(false)
    })
  }

})

describe('needsRehash', () => {
  // The observable side of every decode guard — see BAD_HASHES.
  for (const [label, stored] of BAD_HASHES) {
    it(`is true for ${label}`, () => { expect(needsRehash(stored)).toBe(true) })
  }

  it('is true for a hash made at a lower cost', () => {
    expect(needsRehash('scrypt$N=16384,r=8,p=1$c2FsdA$aGFzaA')).toBe(true)
  })

  it('is false for a hash at the current cost', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(needsRehash(stored)).toBe(false)
  }, 30_000)
})

describe('passwordProblem', () => {
  it('rejects a short password', () => {
    expect(passwordProblem('short')).toMatch(/at least/)
  })

  it('rejects a non-string', () => {
    expect(passwordProblem(undefined)).toBeTruthy()
    expect(passwordProblem(12345678901234)).toBeTruthy()
  })

  it('accepts one at the minimum length', () => {
    expect(passwordProblem('x'.repeat(PASSWORD_MIN_LENGTH))).toBeNull()
  })

  it('counts code points, not UTF-16 units', () => {
    // 11 astral code points is 22 UTF-16 units — a `.length` check would wave
    // this through as comfortably over the minimum.
    const eleven = '\u{1F600}'.repeat(11)
    expect(eleven.length).toBeGreaterThan(PASSWORD_MIN_LENGTH)
    expect(passwordProblem(eleven)).toMatch(/at least/)
  })
})
