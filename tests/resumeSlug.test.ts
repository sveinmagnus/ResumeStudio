import { describe, it, expect } from 'vitest'
import { emailSlug, isSlugSegment, preferredSegment, resolveSegment } from '../src/lib/resumeSlug'

describe('emailSlug', () => {
  it('reads name-domain with a DASH between them, TLD dropped', () => {
    expect(emailSlug('sveins@gmail.com', false)).toBe('sveins-gmail')
    // The collision escape appends the TLD as a third dash-joined part.
    expect(emailSlug('sveins@gmail.com', true)).toBe('sveins-gmail-com')
  })

  it('lowercases and strips symbols WITHIN each part', () => {
    expect(emailSlug('Svein.Magnus+cv@Example.COM', false)).toBe('sveinmagnuscv-example')
    expect(emailSlug('a_b-c@x.no', false)).toBe('abc-x')
  })

  it('a multi-label domain keeps everything but the final label, compacted', () => {
    // "without TLD" is a mechanical rule — drop the last label — so co.uk
    // keeps its second-level label rather than losing the whole country form.
    expect(emailSlug('kim@mail.co.uk', false)).toBe('kim-mailco')
    expect(emailSlug('kim@mail.co.uk', true)).toBe('kim-mailco-uk')
  })

  it('a single-label domain keeps its one label (dropping it would erase the domain)', () => {
    expect(emailSlug('me@localhost', false)).toBe('me-localhost')
    expect(emailSlug('me@localhost', true)).toBe('me-localhost')
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
    expect(emailSlug('sørensen@blåbær.no', false)).toBe('srensen-blbr')
  })
})

describe('isSlugSegment', () => {
  it('accepts dash-joined lowercase alphanumeric runs', () => {
    expect(isSlugSegment('sveins-gmail')).toBe(true)
    expect(isSlugSegment('sveins-gmail-com')).toBe(true)
    expect(isSlugSegment('a1b2')).toBe(true)
    expect(isSlugSegment('Sveins-Gmail')).toBe(false)
    expect(isSlugSegment('-leading')).toBe(false)
    expect(isSlugSegment('trailing-')).toBe(false)
    // The uuid rejection is ANCHORED: a slug that merely contains something
    // uuid-shaped is still a slug, or a person called after one would lose
    // their readable address to the id branch.
    expect(isSlugSegment('9461ca82-d415-48b2-ba5d-3be2cec85cd1')).toBe(false)
    expect(isSlugSegment('x-9461ca82-d415-48b2-ba5d-3be2cec85cd1')).toBe(true)
    expect(isSlugSegment('9461ca82-d415-48b2-ba5d-3be2cec85cd1-x')).toBe(true)
    expect(isSlugSegment('double--dash')).toBe(false)
    expect(isSlugSegment('')).toBe(false)
  })

  it('never reads a UUID as a slug — ids skip the list round-trip', () => {
    expect(isSlugSegment('6f3a1c2e-0000-4000-8000-000000000000')).toBe(false)
    expect(isSlugSegment('0F612F0B-93A1-4FF7-8ED0-D747652C48C7'.toLowerCase())).toBe(false)
  })
})

const A = { id: 'id-a', email: 'anna@gmail.com' }
const B = { id: 'id-b', email: 'bob@corp.no' }

describe('preferredSegment', () => {
  it('prefers the short slug when nobody else answers to it', () => {
    expect(preferredSegment([A, B], 'id-a')).toBe('anna-gmail')
  })

  it('falls back to the TLD-suffixed slug on a short collision', () => {
    const anna2 = { id: 'id-c', email: 'anna@gmail.no' }
    // Both shorten to anna-gmail; the TLD is what still tells them apart.
    expect(preferredSegment([A, anna2], 'id-a')).toBe('anna-gmail-com')
    expect(preferredSegment([A, anna2], 'id-c')).toBe('anna-gmail-no')
  })

  it('falls back to the id when the address yields no slug at all', () => {
    // A non-empty email that reduces to nothing usable (no local part) must
    // produce the id, never an empty or null segment — the segment is going
    // straight into a URL.
    expect(preferredSegment([{ id: 'id-x', email: '@example.com' }], 'id-x')).toBe('id-x')
    expect(preferredSegment([{ id: 'id-y', email: '@@' }], 'id-y')).toBe('id-y')
  })

  it('falls back to the id when even the full slug collides (same email twice)', () => {
    const dup = { id: 'id-d', email: 'anna@gmail.com' }
    expect(preferredSegment([A, dup], 'id-a')).toBe('id-a')
    expect(preferredSegment([A, dup], 'id-d')).toBe('id-d')
  })

  it('collides across FORMS too — my short equal to another’s only form is ambiguity', () => {
    // Y's single-label domain gives it one spelling; X's short form spells the
    // same. Resolution matches both forms, so X must step past it to its TLD.
    const x = { id: 'id-x', email: 'kari@nose.de' } // short: kari-nose
    const y = { id: 'id-y', email: 'kari@nose' }    // only form: kari-nose
    expect(preferredSegment([x, y], 'id-x')).toBe('kari-nose-de')
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
    expect(resolveSegment([A, B], 'anna-gmail')).toBe('id-a')
    expect(resolveSegment([A, B], 'anna-gmail-com')).toBe('id-a')
    expect(resolveSegment([A, B], 'bob-corp')).toBe('id-b')
  })

  it('an ambiguous segment resolves to NOTHING, never to a guess', () => {
    // A collision that appeared after a link was shared: opening the wrong
    // person's CV is worse than a bounce to the picker.
    const anna2 = { id: 'id-c', email: 'anna@gmail.no' }
    expect(resolveSegment([A, anna2], 'anna-gmail')).toBeNull()
    // The disambiguated forms still work.
    expect(resolveSegment([A, anna2], 'anna-gmail-com')).toBe('id-a')
    expect(resolveSegment([A, anna2], 'anna-gmail-no')).toBe('id-c')
  })

  it('an unknown segment resolves to nothing', () => {
    expect(resolveSegment([A, B], 'nobody-here')).toBeNull()
    expect(resolveSegment([], 'anna-gmail')).toBeNull()
  })
})
