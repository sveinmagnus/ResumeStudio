import { describe, it, expect, beforeEach } from 'vitest'
import {
  issueBootstrapCode,
  hasBootstrapCode,
  clearBootstrapCode,
  bootstrapCodeMatches,
  bootstrapBanner,
} from '../../server/bootstrap'

/**
 * The one-time code that authorises creating the owner.
 *
 * It had no unit test — only two route suites that spent it in passing — and
 * the mutation report showed 35 of its 66 mutants unkilled, including the loop
 * that generates it and the whole of `hasBootstrapCode`. That is the module
 * standing between a fresh public instance and "first visitor becomes the
 * owner", so what it promises is worth stating.
 *
 * Module-level state, so each test starts from a known one. Vitest gives a test
 * FILE its own module registry, so this cannot disturb the route suites.
 */
beforeEach(() => { clearBootstrapCode() })

describe('the issued code', () => {
  it('is four groups of five from an alphabet without misread letters', () => {
    const code = issueBootstrapCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/)
    // 20 characters plus three separators. Pinned because the grouping is what
    // makes it readable off a console, and the length is its entropy.
    expect(code).toHaveLength(23)
    expect(code.replace(/-/g, '')).toHaveLength(20)
  })

  it('excludes the letters that are misread for digits', () => {
    // I/L/O/U are absent by design: read off a terminal and retyped, they are
    // the ones that become 1/1/0/V.
    const codes = Array.from({ length: 40 }, () => issueBootstrapCode()).join('')
    expect(codes).not.toMatch(/[ILOU]/)
  })

  it('is different every time it is issued', () => {
    const seen = new Set(Array.from({ length: 20 }, () => issueBootstrapCode()))
    expect(seen.size).toBe(20)
  })
})

describe('hasBootstrapCode', () => {
  it('is false before one is issued', () => {
    expect(hasBootstrapCode()).toBe(false)
  })

  it('is true once issued, and false once spent', () => {
    issueBootstrapCode()
    expect(hasBootstrapCode()).toBe(true)
    clearBootstrapCode()
    expect(hasBootstrapCode()).toBe(false)
  })
})

describe('bootstrapCodeMatches', () => {
  it('refuses everything while no code is issued', () => {
    // Including a well-formed one: "no code outstanding" must not be a state in
    // which some string happens to work.
    expect(bootstrapCodeMatches('ABCDE-FGHJK-MNPQR-STVWX')).toBe(false)
  })

  it('accepts the code exactly as issued', () => {
    const code = issueBootstrapCode()
    expect(bootstrapCodeMatches(code)).toBe(true)
  })

  it('accepts it retyped without the dashes, in lower case, with padding', () => {
    // Read off a console and retyped: dropping the dashes is not a mistake
    // worth failing over, and neither is shift.
    const code = issueBootstrapCode()
    expect(bootstrapCodeMatches(`  ${code.replace(/-/g, '').toLowerCase()}  `)).toBe(true)
  })

  it('refuses a wrong code of the right shape', () => {
    const code = issueBootstrapCode()
    const wrong = code.replace(/[0-9A-Z]/, (c) => (c === 'Z' ? 'Y' : 'Z'))
    expect(wrong).not.toBe(code)
    expect(bootstrapCodeMatches(wrong)).toBe(false)
  })

  it('refuses a code of the wrong length rather than throwing', () => {
    // timingSafeEqual REQUIRES equal lengths — an unguarded call throws, which
    // on the bootstrap route would be a 500 instead of a refusal.
    issueBootstrapCode()
    expect(bootstrapCodeMatches('ABC')).toBe(false)
    expect(bootstrapCodeMatches('A'.repeat(200))).toBe(false)
  })

  it('refuses a non-string', () => {
    issueBootstrapCode()
    for (const v of [null, undefined, 42, {}, ['a']]) expect(bootstrapCodeMatches(v)).toBe(false)
  })

  it('stops matching the moment the code is spent', () => {
    const code = issueBootstrapCode()
    expect(bootstrapCodeMatches(code)).toBe(true)
    clearBootstrapCode()
    expect(bootstrapCodeMatches(code)).toBe(false)
  })

  it('stops matching a previous code once a new one is issued', () => {
    const first = issueBootstrapCode()
    const second = issueBootstrapCode()
    expect(bootstrapCodeMatches(first)).toBe(false)
    expect(bootstrapCodeMatches(second)).toBe(true)
  })
})

describe('bootstrapBanner', () => {
  it('carries the code and the URL an operator needs', () => {
    const banner = bootstrapBanner('ABCDE-FGHJK-MNPQR-STVWX', 'http://localhost:1923')
    expect(banner).toContain('ABCDE-FGHJK-MNPQR-STVWX')
    expect(banner).toContain('http://localhost:1923')
  })

  it('keeps the box square whatever the code and URL lengths', () => {
    // The padding is what stops a long URL breaking the frame in a terminal.
    const banner = bootstrapBanner('SHORT', 'http://a-very-long-hostname.example.test:1923/setup')
    const widths = new Set(banner.split('\n').filter((l) => l.startsWith('  │')).map((l) => [...l].length))
    expect(widths.size).toBe(1)
  })
})
