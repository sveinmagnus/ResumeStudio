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
})
