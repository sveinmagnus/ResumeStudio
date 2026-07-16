import { describe, it, expect } from 'vitest'
import {
  forcedLanguages, resolveTranslateLanguages, isOfferedLocale,
  DEFAULT_TRANSLATE_LANGUAGES, PIVOT_LOCALE,
} from '../src/lib/translateLanguages'
import { LOCALE_CODES } from '../src/lib/locales'

describe('forcedLanguages()', () => {
  it('always forces English (the Argos pivot)', () => {
    // Without `en` even a fully-selected no↔se pair can fail to resolve, and
    // the user has no way to know that — so it isn't offered as a choice.
    expect(forcedLanguages('no', 'se')).toContain(PIVOT_LOCALE)
    expect(forcedLanguages('de', null)).toContain('en')
  })

  it('forces the locales currently being edited', () => {
    expect(forcedLanguages('no', 'de').sort()).toEqual(['de', 'en', 'no'])
  })

  it('handles single-column mode (no secondary)', () => {
    expect(forcedLanguages('fi', null).sort()).toEqual(['en', 'fi'])
  })

  it('does not force a locale the app does not offer', () => {
    expect(forcedLanguages('zz', 'qq')).toEqual(['en'])
  })

  it('never duplicates when editing in English', () => {
    expect(forcedLanguages('en', null)).toEqual(['en'])
  })
})

describe('resolveTranslateLanguages()', () => {
  it('adds the forced locales to the user selection', () => {
    // User picked only English; they're editing no/de → both come along.
    expect(resolveTranslateLanguages(['en'], 'no', 'de').sort()).toEqual(['de', 'en', 'no'])
  })

  it('keeps the user selection', () => {
    const out = resolveTranslateLanguages(['fr', 'es'], 'en', null)
    expect(out).toContain('fr')
    expect(out).toContain('es')
  })

  it('drops codes the app does not offer', () => {
    expect(resolveTranslateLanguages(['fr', 'zz'], 'en', null)).not.toContain('zz')
  })

  it('dedupes and returns a stable order regardless of input order', () => {
    // The value decides whether the container must be recreated, so it has to
    // be order-stable, not "whatever order the checkboxes were clicked".
    const a = resolveTranslateLanguages(['fr', 'en', 'fr', 'de'], 'no', null)
    const b = resolveTranslateLanguages(['de', 'fr', 'en'], 'no', null)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(a.length)
    // Ordered by the canonical locale list.
    expect(a).toEqual(LOCALE_CODES.filter((c) => a.includes(c)))
  })

  it('cannot produce an empty install', () => {
    expect(resolveTranslateLanguages([], 'en', null)).toEqual(['en'])
  })
})

describe('defaults', () => {
  it('the default set matches what the compose file shipped with', () => {
    expect(DEFAULT_TRANSLATE_LANGUAGES).toEqual(['en', 'no', 'se', 'dk'])
  })
  it('every default is an offered locale', () => {
    for (const c of DEFAULT_TRANSLATE_LANGUAGES) expect(isOfferedLocale(c), c).toBe(true)
  })
})
