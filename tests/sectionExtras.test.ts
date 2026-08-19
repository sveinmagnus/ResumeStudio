/**
 * The optional per-section content groups a view switches on (CLAUDE.md §7).
 *
 * Two things are asserted, and only the second is obvious. The first is the
 * DECLARATION: which groups a section offers is what the view editor draws
 * checkboxes from and what `normalizeExtras` accepts, so an emptied list is a
 * silently smaller export rather than an error. The second is the render
 * boundary — `SectionStyle.extras` arrives from imported view JSON, and every
 * guard in `normalizeExtras` survived the mutation report, including the one
 * that makes it accept anything at all.
 */
import { describe, it, expect } from 'vitest'
import {
  SECTION_EXTRAS, extrasFor, normalizeExtras, NO_EXTRAS,
} from '../src/lib/sectionExtras'

describe('SECTION_EXTRAS', () => {
  it('offers each section exactly the groups its renderers read', () => {
    const keys = Object.fromEntries(
      Object.entries(SECTION_EXTRAS).map(([k, gs]) => [k, gs.map((g) => g.key)]),
    )
    expect(keys).toEqual({
      projects: ['lead', 'metrics', 'highlights', 'links', 'location'],
      work_experiences: ['employment_type', 'company_size', 'links'],
      educations: ['grade', 'exchange'],
      certifications: ['expiry', 'links'],
      presentations: ['links'],
      publications: ['links'],
      recommendations: ['links'],
      honor_awards: ['for_work'],
      references: ['contact', 'links'],
    })
  })

  it('names every group and says what it turns on', () => {
    // The hint is the whole reason the checkbox is not a guess: it lists the
    // fields. A blank one is a checkbox that says nothing.
    for (const [section, groups] of Object.entries(SECTION_EXTRAS)) {
      for (const g of groups) {
        expect(g.label.trim(), `${section}.${g.key} label`).not.toBe('')
        expect(g.hint.trim(), `${section}.${g.key} hint`).not.toBe('')
      }
      const keys = groups.map((g) => g.key)
      expect(new Set(keys).size, `${section} keys are unique`).toBe(keys.length)
    }
  })
})

describe('extrasFor', () => {
  it('returns the declared groups for a section that has them', () => {
    expect(extrasFor('educations').map((g) => g.key)).toEqual(['grade', 'exchange'])
  })

  it('returns nothing for a section that declares none', () => {
    expect(extrasFor('courses')).toEqual([])
    expect(extrasFor('nonexistent')).toEqual([])
  })
})

describe('normalizeExtras', () => {
  it('keeps the keys the section declares', () => {
    expect([...normalizeExtras(['grade', 'exchange'], 'educations')])
      .toEqual(['grade', 'exchange'])
  })

  it('drops a key the section does not declare', () => {
    // 'metrics' is a projects group; enabling it on Educations must not carry
    // over just because some other section knows the word.
    expect([...normalizeExtras(['grade', 'metrics'], 'educations')]).toEqual(['grade'])
    expect([...normalizeExtras(['links'], 'educations')]).toEqual([])
  })

  it('drops an entry that is not a string', () => {
    // Imported JSON can hold anything; a nested object must not reach a Set
    // that later answers `has('links')` by accident.
    const raw = [{ key: 'links' }, null, 42, ['links'], 'links']
    expect([...normalizeExtras(raw, 'certifications')]).toEqual(['links'])
  })

  it('reads anything that is not an array as nothing enabled', () => {
    expect(normalizeExtras(undefined, 'projects')).toBe(NO_EXTRAS)
    expect(normalizeExtras(null, 'projects')).toBe(NO_EXTRAS)
    expect(normalizeExtras('links', 'projects')).toBe(NO_EXTRAS)
    expect(normalizeExtras({ links: true }, 'projects')).toBe(NO_EXTRAS)
  })

  it('shares one empty set when nothing survives', () => {
    expect(normalizeExtras([], 'projects')).toBe(NO_EXTRAS)
    expect(normalizeExtras(['bogus'], 'projects')).toBe(NO_EXTRAS)
    expect(normalizeExtras(['links'], 'courses')).toBe(NO_EXTRAS)
  })

  it('ignores an inherited key rather than resolving it off the prototype', () => {
    // Same hazard `lib/lookup.ts` exists for: 'constructor' is a key on every
    // object literal, so the section map must not answer for it.
    expect(normalizeExtras(['constructor'], 'projects')).toBe(NO_EXTRAS)
    expect(normalizeExtras(['links'], 'toString')).toBe(NO_EXTRAS)
  })

  it('de-duplicates a key repeated in the stored list', () => {
    expect([...normalizeExtras(['links', 'links'], 'publications')]).toEqual(['links'])
  })
})
