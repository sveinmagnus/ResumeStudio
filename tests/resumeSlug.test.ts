import { describe, it, expect } from 'vitest'
import { emailSlug, isSlugSegment, preferredSegment, resolveSegment } from '../src/lib/resumeSlug'

describe('emailSlug', () => {
  it('drops the TLD and every symbol: the compact readable form', () => {
    expect(emailSlug('sveins@gmail.com', false)).toBe('sveinsgmail')
    expect(emailSlug('sveins@gmail.com', true)).toBe('sveinsgmailcom')
  })

  it('lowercases and strips symbols in the local part', () => {
    expect(emailSlug('Svein.Magnus+cv@Example.COM', false)).toBe('sveinmagnuscvexample')
    expect(emailSlug('a_b-c@x.no', false)).toBe('abcx')
  })

  it('a multi-label domain keeps everything but the final label', () => {
    // "without TLD" is a mechanical rule — drop the last label — so co.uk
    // keeps its second-level label rather than losing the whole country form.
    expect(emailSlug('kim@mail.co.uk', false)).toBe('kimmailco')
    expect(emailSlug('kim@mail.co.uk', true)).toBe('kimmailcouk')
  })

  it('a single-label domain keeps its one label (dropping it would erase the domain)', () => {
    expect(emailSlug('me@localhost', false)).toBe('melocalhost')
    expect(emailSlug('me@localhost', true)).toBe('melocalhost')
  })

  it('answers null for anything that cannot yield an address', () => {
    expect(emailSlug('', false)).toBeNull()
    expect(emailSlug('no-at-sign', false)).toBeNull()
    expect(emailSlug('@domain.com', false)).toBeNull()
    expect(emailSlug('name@', false)).toBeNull()
    // Nothing alphanumeric survives the strip.
    expect(emailSlug('øæå@łł.þþ', false)).toBeNull()
  })

  it('survives non-ASCII by stripping, when something remains', () => {
    expect(emailSlug('sørensen@blåbær.no', false)).toBe('srensenblbr')
  })
})

describe('isSlugSegment', () => {
  it('accepts only lowercase alphanumerics — a UUID (hyphens) never qualifies', () => {
    expect(isSlugSegment('sveinsgmail')).toBe(true)
    expect(isSlugSegment('a1b2')).toBe(true)
    expect(isSlugSegment('6f3a1c2e-0000-4000-8000-000000000000')).toBe(false)
    expect(isSlugSegment('Sveins')).toBe(false)
    expect(isSlugSegment('')).toBe(false)
  })
})

const A = { id: 'id-a', email: 'anna@gmail.com' }
const B = { id: 'id-b', email: 'bob@corp.no' }

describe('preferredSegment', () => {
  it('prefers the short slug when nobody else answers to it', () => {
    expect(preferredSegment([A, B], 'id-a')).toBe('annagmail')
  })

  it('falls back to the full-domain slug on a short collision', () => {
    const anna2 = { id: 'id-c', email: 'anna@gmail.no' }
    // Both shorten to annagmail; the TLD is what still tells them apart.
    expect(preferredSegment([A, anna2], 'id-a')).toBe('annagmailcom')
    expect(preferredSegment([A, anna2], 'id-c')).toBe('annagmailno')
  })

  it('falls back to the id when even the full slug collides (same email twice)', () => {
    const dup = { id: 'id-d', email: 'anna@gmail.com' }
    expect(preferredSegment([A, dup], 'id-a')).toBe('id-a')
    expect(preferredSegment([A, dup], 'id-d')).toBe('id-d')
  })

  it('collides across FORMS too — my short equal to another full is ambiguity', () => {
    // X's short slug spells exactly Y's full slug; resolution matches both
    // forms, so X must step past it.
    const x = { id: 'id-x', email: 'ka@ri.no.x' } // short: karino
    const y = { id: 'id-y', email: 'kari@no.se' } // full: karinose — short: karino
    expect(preferredSegment([x, y], 'id-x')).toBe('karinox')
  })

  it('keeps the id when there is no usable email', () => {
    expect(preferredSegment([{ id: 'id-e', email: null }], 'id-e')).toBe('id-e')
    expect(preferredSegment([{ id: 'id-f' }], 'id-f')).toBe('id-f')
    expect(preferredSegment([], 'id-g')).toBe('id-g')
  })
})

describe('resolveSegment', () => {
  it('an exact id wins outright — the UUID stays a valid address forever', () => {
    expect(resolveSegment([A, B], 'id-b')).toBe('id-b')
  })

  it('matches either spelling of the address', () => {
    expect(resolveSegment([A, B], 'annagmail')).toBe('id-a')
    expect(resolveSegment([A, B], 'annagmailcom')).toBe('id-a')
    expect(resolveSegment([A, B], 'bobcorp')).toBe('id-b')
  })

  it('an ambiguous segment resolves to NOTHING, never to a guess', () => {
    // A collision that appeared after a link was shared: opening the wrong
    // person's CV is worse than a bounce to the picker.
    const anna2 = { id: 'id-c', email: 'anna@gmail.no' }
    expect(resolveSegment([A, anna2], 'annagmail')).toBeNull()
    // The disambiguated forms still work.
    expect(resolveSegment([A, anna2], 'annagmailcom')).toBe('id-a')
    expect(resolveSegment([A, anna2], 'annagmailno')).toBe('id-c')
  })

  it('an unknown segment resolves to nothing', () => {
    expect(resolveSegment([A, B], 'nobodyhere')).toBeNull()
    expect(resolveSegment([], 'annagmail')).toBeNull()
  })
})
