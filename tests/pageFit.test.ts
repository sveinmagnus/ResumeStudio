/**
 * @vitest-environment jsdom
 *
 * jsdom: the tailor catalog resolves item titles through the section catalog.
 */
import { describe, it, expect } from 'vitest'
import {
  buildPageFitPrompt, validatePageFit, applyCuts, InvalidPageFitError, PAGE_FIT_SCHEMA,
} from '../src/lib/pageFit'
import { buildViewSections } from '../src/lib/viewFilter'
import { emptyStore, makeProject, makeView, makeResume } from './fixtures'
import type { ResumeStore, ResumeView } from '../src/types'

const store = (): ResumeStore => ({
  ...emptyStore(),
  resume: makeResume(),
  projects: [
    makeProject({ id: 'p1', customer: { en: 'Acme' }, sort_order: 0 }),
    makeProject({ id: 'p2', customer: { en: 'Globex' }, sort_order: 1 }),
  ],
})

const view = (over: Partial<ResumeView> = {}): ResumeView =>
  makeView({ sections: buildViewSections(), page_limit: 1, ...over })

describe('buildPageFitPrompt()', () => {
  it('states the overage so the model sizes its answer', () => {
    const p = buildPageFitPrompt(store(), view(), 'en', 2.4, 1)
    expect(p).toContain('2.4 pages but must fit 1')
    expect(p).toMatch(/save 1 page\b/)
  })

  it('forbids rewriting — only whole items may be dropped', () => {
    // The invention failure mode: shortening prose to fit fabricates claims.
    expect(buildPageFitPrompt(store(), view(), 'en', 2, 1))
      .toMatch(/do not suggest rewriting or shortening/i)
  })

  it('sends the item catalog with ids, not the prose', () => {
    const p = buildPageFitPrompt(store(), view(), 'en', 2, 1)
    expect(p).toContain('p1')
    expect(p).toContain('Acme')
    expect(p).toContain(PAGE_FIT_SCHEMA)
  })

  it('asks to keep starred items', () => {
    expect(buildPageFitPrompt(store(), view(), 'en', 2, 1)).toMatch(/keep anything starred/i)
  })

  it('sizes the ask in whole pages, and never asks for less than one', () => {
    // A 4.6-page CV limited to 2 needs three pages saved, not 2.6; and a CV
    // barely over its limit still has to be asked for a page, or the model is
    // told to save zero.
    expect(buildPageFitPrompt(store(), view(), 'en', 4.6, 2)).toMatch(/save 3 pages\b/)
    expect(buildPageFitPrompt(store(), view(), 'en', 2.1, 2)).toMatch(/save 1 page\b/)
    expect(buildPageFitPrompt(store(), view(), 'en', 1, 3)).toMatch(/save 1 page\b/)
  })

  it('says "page" for one and "pages" for more', () => {
    expect(buildPageFitPrompt(store(), view(), 'en', 3, 1)).toMatch(/save 2 pages\b/)
    expect(buildPageFitPrompt(store(), view(), 'en', 2, 1)).toMatch(/save 1 page —/)
  })
})

describe('validatePageFit()', () => {
  it('resolves ids to titles and sections', () => {
    const s = validatePageFit({ cut: [{ id: 'p1', why: 'oldest' }] }, store(), view(), 'en')
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ itemId: 'p1', title: 'Acme', why: 'oldest' })
    expect(s[0].section).toBeTruthy()
  })

  it('drops an id the catalog never had', () => {
    // A model that invents an id would otherwise offer a cut that silently does
    // nothing when applied.
    expect(validatePageFit({ cut: [{ id: 'nope', why: 'x' }] }, store(), view(), 'en')).toEqual([])
  })

  it('drops an item the view already excludes', () => {
    const v = view({ excluded_item_ids: ['p1'] })
    const s = validatePageFit({ cut: [{ id: 'p1' }, { id: 'p2' }] }, store(), v, 'en')
    expect(s.map((x) => x.itemId)).toEqual(['p2'])
  })

  it('dedupes repeated ids', () => {
    const s = validatePageFit({ cut: [{ id: 'p1' }, { id: 'p1' }] }, store(), view(), 'en')
    expect(s).toHaveLength(1)
  })

  it('tolerates a missing reason', () => {
    expect(validatePageFit({ cut: [{ id: 'p1' }] }, store(), view(), 'en')[0].why).toBe('')
  })

  it('rejects a malformed reply', () => {
    expect(() => validatePageFit({}, store(), view(), 'en')).toThrow(InvalidPageFitError)
    expect(() => validatePageFit(null, store(), view(), 'en')).toThrow(InvalidPageFitError)
  })
})

describe('applyCuts()', () => {
  it('adds the cuts to the view exclusions', () => {
    expect(applyCuts(view(), ['p1']).sort()).toEqual(['p1'])
  })

  it('keeps existing exclusions and never duplicates', () => {
    const v = view({ excluded_item_ids: ['p1'] })
    expect(applyCuts(v, ['p1', 'p2']).sort()).toEqual(['p1', 'p2'])
  })

  it('does not mutate the view', () => {
    const v = view({ excluded_item_ids: ['p1'] })
    applyCuts(v, ['p2'])
    expect(v.excluded_item_ids).toEqual(['p1'])
  })
})

describe('validatePageFit — what it refuses to pass on', () => {
  it('says which of the two malformed replies it got', () => {
    expect(() => validatePageFit('a string', store(), view(), 'en')).toThrow(/not a JSON object/i)
    expect(() => validatePageFit(null, store(), view(), 'en')).toThrow(/not a JSON object/i)
    expect(() => validatePageFit({ items: [] }, store(), view(), 'en')).toThrow(/no "cut" array/i)
    expect(() => validatePageFit('a string', store(), view(), 'en')).toThrow(InvalidPageFitError)
  })

  it('skips an entry that is not an object, or has no string id', () => {
    const out = validatePageFit(
      { cut: [null, 'p1', 42, { id: 42 }, { why: 'no id' }, { id: 'p1', why: 'ok' }] },
      store(), view(), 'en',
    )
    expect(out.map((s) => s.itemId)).toEqual(['p1'])
  })

  it('trims the reason, and tolerates one that is not a string', () => {
    expect(validatePageFit({ cut: [{ id: 'p1', why: '  oldest  ' }] }, store(), view(), 'en')[0].why)
      .toBe('oldest')
    expect(validatePageFit({ cut: [{ id: 'p1', why: 42 }] }, store(), view(), 'en')[0].why).toBe('')
    expect(validatePageFit({ cut: [{ id: 'p1' }] }, store(), view(), 'en')[0].why).toBe('')
  })
})
