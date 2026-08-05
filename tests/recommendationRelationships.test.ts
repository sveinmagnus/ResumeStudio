import { describe, it, expect } from 'vitest'
import {
  RELATIONSHIP_OPTIONS, relationshipLabels, matchRelationshipKey,
} from '../src/lib/recommendationRelationships'

describe('recommendationRelationships', () => {
  it('every option carries the four core locale labels', () => {
    for (const o of RELATIONSHIP_OPTIONS) {
      for (const loc of ['en', 'no', 'se', 'dk']) {
        expect(o.labels[loc], `${o.key} missing ${loc}`).toBeTruthy()
      }
    }
  })

  it('option keys are unique', () => {
    const keys = RELATIONSHIP_OPTIONS.map((o) => o.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps the clustered display order (hierarchy → mentoring → teams → business → education → personal)', () => {
    expect(RELATIONSHIP_OPTIONS.map((o) => o.key)).toEqual([
      'manager', 'reported_to_me', 'senior_colleague', 'junior_colleague',
      'mentor', 'mentee',
      'same_team', 'same_group', 'different_team', 'executive_team',
      'client', 'service_provider', 'business_partner',
      'teacher', 'student', 'studied_together',
      'friend',
    ])
  })

  it('every directional relationship has both directions', () => {
    const keys = new Set(RELATIONSHIP_OPTIONS.map((o) => o.key))
    const pairs: Array<[string, string]> = [
      ['manager', 'reported_to_me'],
      ['senior_colleague', 'junior_colleague'],
      ['mentor', 'mentee'],
      ['client', 'service_provider'],
      ['teacher', 'student'],
    ]
    for (const [a, b] of pairs) {
      expect(keys.has(a), a).toBe(true)
      expect(keys.has(b), b).toBe(true)
    }
  })

  it('relationshipLabels returns a fresh copy of the label set', () => {
    const labels = relationshipLabels('manager')
    expect(labels.en).toBe('Was my manager')
    labels.en = 'mutated'
    expect(relationshipLabels('manager').en).toBe('Was my manager')
  })

  it('relationshipLabels returns {} for an unknown key', () => {
    expect(relationshipLabels('nope')).toEqual({})
  })

  it('matchRelationshipKey round-trips a picked option', () => {
    const picked = relationshipLabels('friend')
    expect(matchRelationshipKey(picked)).toBe('friend')
  })

  it('matches on any locale, case-insensitively', () => {
    expect(matchRelationshipKey({ no: 'var min leder' })).toBe('manager')
    expect(matchRelationshipKey({ se: 'Var min chef' })).toBe('manager')
  })

  it('returns null for free-text / empty values', () => {
    expect(matchRelationshipKey({ en: 'Some bespoke relationship' })).toBeNull()
    expect(matchRelationshipKey({})).toBeNull()
    expect(matchRelationshipKey(undefined)).toBeNull()
  })

  it('ignores padding around a stored value', () => {
    // Stored relationships come from imports as often as from the picker, and
    // an untrimmed value would fall through to free text and lose the link.
    expect(matchRelationshipKey({ en: '  Was my manager  ' })).toBe('manager')
  })

  it('treats a whitespace-only value as no value', () => {
    // Not "no match" by accident — a blank slot must not be compared at all,
    // or an option whose label is empty in that locale would match it.
    expect(matchRelationshipKey({ en: '   ', no: '' })).toBeNull()
  })

  it('matches on a later locale when an earlier one is free text', () => {
    // A bilingual CV can carry a hand-written English line beside a picked
    // Norwegian one. Checking only the first entry would lose the link.
    expect(matchRelationshipKey({ en: 'Some bespoke wording', no: 'Var min leder' })).toBe('manager')
    expect(matchRelationshipKey({ en: '', no: 'Var min leder' })).toBe('manager')
  })
})
