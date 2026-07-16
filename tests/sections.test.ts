import { describe, it, expect } from 'vitest'
import { SECTIONS, GROUP_ORDER, canonicalSectionKey, localizedSectionHeading, SECTION_HEADINGS } from '../src/lib/sections'
import { isExportableSection } from '../src/lib/viewFilter'

describe('sections', () => {
  it('GROUP_ORDER covers every group exactly once (export first)', () => {
    const used = [...new Set(SECTIONS.map((s) => s.group))]
    expect([...GROUP_ORDER].sort()).toEqual([...used].sort())
    expect(GROUP_ORDER[0]).toBe('export')
  })

  it('canonicalSectionKey folds the profile content keys into the combined page', () => {
    expect(canonicalSectionKey('key_qualifications')).toBe('profile_competencies')
    expect(canonicalSectionKey('key_competencies')).toBe('profile_competencies')
    expect(canonicalSectionKey('projects')).toBe('projects')
    expect(canonicalSectionKey('header')).toBe('header')
  })

  it('profile_competencies is a visible page but never an exportable section', () => {
    const def = SECTIONS.find((s) => s.key === 'profile_competencies')
    expect(def).toBeDefined()
    expect(def?.hidden).toBeUndefined()
    expect(def?.storeKey).toBeUndefined()
    expect(isExportableSection(def!)).toBe(false)
    // The underlying content sections remain exportable.
    expect(isExportableSection(SECTIONS.find((s) => s.key === 'key_qualifications')!)).toBe(true)
    expect(isExportableSection(SECTIONS.find((s) => s.key === 'key_competencies')!)).toBe(true)
  })

  describe('localizedSectionHeading', () => {
    it('returns the locale-specific default heading', () => {
      expect(localizedSectionHeading('work_experiences', 'no')).toBe('Arbeidserfaring')
      expect(localizedSectionHeading('projects', 'se')).toBe('Projekt')
      expect(localizedSectionHeading('key_qualifications', 'dk')).toBe('Resumé')
    })
    it('falls back to English, then the section label', () => {
      // 'ja' is deliberately not an offerable locale (see LOCALE_LABELS) and so
      // has no headings — any code outside the offered set behaves this way.
      expect(localizedSectionHeading('work_experiences', 'ja')).toBe('Employment') // unknown locale → en
      expect(localizedSectionHeading('nonexistent', 'no')).toBe('nonexistent')     // no map → label/key
    })
    it('translates the sections it offers rather than falling back', () => {
      // Guards the fallback test above from silently becoming vacuous: these
      // are offered locales, so they must NOT resolve to the English label.
      expect(localizedSectionHeading('work_experiences', 'de')).toBe('Berufserfahrung')
      expect(localizedSectionHeading('educations', 'fi')).toBe('Koulutus')
      expect(localizedSectionHeading('projects', 'uk')).toBe('Проєкти')
    })
    it("en matches the section label so English output doesn't change", () => {
      for (const [key, ls] of Object.entries(SECTION_HEADINGS)) {
        const def = SECTIONS.find((s) => s.key === key)
        if (def) expect(ls.en, key).toBe(def.label)
      }
    })
    it('every exportable content section has a heading translation', () => {
      for (const s of SECTIONS.filter(isExportableSection)) {
        expect(SECTION_HEADINGS[s.key], s.key).toBeDefined()
        expect(SECTION_HEADINGS[s.key].no, s.key).toBeTruthy()
      }
    })
  })
})
