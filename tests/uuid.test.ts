/**
 * @vitest-environment jsdom
 *
 * The in-repo id generator that replaced the `uuid` package.
 *
 * The fallback path is the reason this file exists: `crypto.randomUUID` is only
 * exposed in SECURE contexts, so a self-hosted build served over plain http on a
 * LAN has `crypto` without it. That is a supported way to run this app, and it
 * must still produce ids.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { uuidv4 } from '../src/lib/uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => { vi.restoreAllMocks() })

describe('uuidv4', () => {
  it('produces a well-formed version-4 uuid', () => {
    expect(uuidv4()).toMatch(V4)
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => uuidv4()))
    expect(seen.size).toBe(2000)
  })

  it('uses the platform generator when it is available', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID')
    uuidv4()
    expect(spy).toHaveBeenCalled()
  })

  it('falls back to getRandomValues in a non-secure context', () => {
    // Exactly what a plain-http LAN deployment looks like: crypto is there,
    // randomUUID is not.
    const original = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    const getRandom = vi.spyOn(globalThis.crypto, 'getRandomValues')
    try {
      const id = uuidv4()
      expect(getRandom).toHaveBeenCalled()
      expect(id).toMatch(V4)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true })
    }
  })

  it('still returns an id with no Web Crypto at all', () => {
    const original = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    try {
      expect(uuidv4()).toMatch(V4)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
    }
  })

  it('fills all sixteen bytes on the Math.random path', () => {
    // The hand-assembled path is the one nothing else checks. A loop that
    // stops short leaves trailing zeros — ids that look valid and collide far
    // sooner than they should; one that runs long writes past the array and
    // produces an id with an "undefined" in it.
    const original = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    try {
      const ids = Array.from({ length: 40 }, () => uuidv4())
      for (const id of ids) {
        expect(id).toMatch(V4)
        expect(id).not.toContain('undefined')
        expect(id).toHaveLength(36)
      }
      // The last group is six bytes of entropy: across 40 ids it cannot be
      // constant unless part of the loop never ran.
      expect(new Set(ids.map((i) => i.split('-')[4])).size).toBeGreaterThan(1)
      expect(new Set(ids.map((i) => i.split('-')[0])).size).toBeGreaterThan(1)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
    }
  })
})

describe('uuidv4 without a platform randomUUID', () => {
  const withCrypto = (c: unknown, run: () => void) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { value: c, configurable: true })
    try { run() } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original)
      else delete (globalThis as unknown as Record<string, unknown>).crypto
    }
  }
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('assembles a valid v4 from getRandomValues', () => {
    withCrypto({ getRandomValues: (a: Uint8Array) => { a.fill(0xff); return a } }, () => {
      const id = uuidv4()
      expect(id).toMatch(V4)
      // Every byte is filled: a short buffer would leave zeroes at the end.
      expect(id.replace(/-/g, '')).toHaveLength(32)
      expect(id.endsWith('ffffffffffff')).toBe(true)
    })
  })

  it('falls back to Math.random rather than refusing to create an item', () => {
    // These are collision-avoidance ids for rows in one person's CV, not
    // security tokens; refusing here would block adding a project.
    withCrypto({}, () => {
      expect(uuidv4()).toMatch(V4)
      expect(uuidv4()).not.toBe(uuidv4())
    })
    withCrypto(undefined, () => {
      expect(uuidv4()).toMatch(V4)
    })
  })
})
