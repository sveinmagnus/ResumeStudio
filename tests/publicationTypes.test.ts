import { describe, it, expect } from 'vitest'
import { PUBLICATION_TYPES, publicationTypeLabel } from '../src/lib/publicationTypes'

describe('PUBLICATION_TYPES', () => {
  /**
   * Stored values are identifiers carried by every publication, so a rename
   * un-types the ones already saved. Labels are display text and may change;
   * their per-locale completeness is enforced by tests/localeCoverage.test.ts.
   */
  it('pins the stored vocabulary — a renamed value un-types existing entries', () => {
    expect(PUBLICATION_TYPES.map((t) => t.value)).toEqual([
      'article',
      'research',
      'whitepaper',
      'report',
      'thesis',
      'book',
      'book_chapter',
      'blog_post',
    ])
  })

  it('gives every type an English label, and no duplicates', () => {
    const values = PUBLICATION_TYPES.map((t) => t.value)
    expect(new Set(values).size).toBe(values.length)
    for (const t of PUBLICATION_TYPES) {
      expect(t.label, t.value).toBe(t.labels.en)
    }
  })
})

describe('publicationTypeLabel()', () => {
  it('resolves a stored value in the asked-for language', () => {
    expect(publicationTypeLabel('article')).toBe('Article')
    expect(publicationTypeLabel('article', 'no')).toBe('Artikkel')
  })

  it('falls back to English for a language the labels do not cover', () => {
    expect(publicationTypeLabel('article', 'ja')).toBe('Article')
  })

  it('is empty for no type and for one it does not know', () => {
    // Not the raw value: a type from a newer build would otherwise render as
    // "book_chapter" in an exported CV.
    expect(publicationTypeLabel(null)).toBe('')
    expect(publicationTypeLabel(undefined)).toBe('')
    expect(publicationTypeLabel('')).toBe('')
    expect(publicationTypeLabel('not_a_type')).toBe('')
  })
})
