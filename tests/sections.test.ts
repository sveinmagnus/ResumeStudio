import { describe, it, expect } from 'vitest'
import { SECTIONS, GROUP_ORDER, canonicalSectionKey, localizedSectionHeading, SECTION_HEADINGS } from '../src/lib/sections'
import { isExportableSection } from '../src/lib/viewFilter'

describe('sections', () => {
  it('GROUP_ORDER covers every group exactly once (export first)', () => {
    const used = [...new Set(SECTIONS.map((s) => s.group))]
    expect([...GROUP_ORDER].sort()).toEqual([...used].sort())
    expect(GROUP_ORDER[0]).toBe('export')
  })

  it('profile + competencies are their own sections; the legacy combined key aliases Profile', () => {
    // Split into two sidebar sections — no more combined page.
    expect(SECTIONS.find((s) => s.key === 'profile_competencies')).toBeUndefined()
    // The old combined key still resolves (deep links / snapshots) → Profile.
    expect(canonicalSectionKey('profile_competencies')).toBe('key_qualifications')
    // The content keys are now canonical on their own.
    expect(canonicalSectionKey('key_qualifications')).toBe('key_qualifications')
    expect(canonicalSectionKey('key_competencies')).toBe('key_competencies')
    expect(canonicalSectionKey('projects')).toBe('projects')
  })

  it('profile + competencies are visible, editable, exportable sections', () => {
    for (const key of ['key_qualifications', 'key_competencies']) {
      const def = SECTIONS.find((s) => s.key === key)!
      expect(def, key).toBeDefined()
      expect(def.hidden, key).toBeUndefined()   // shown in the sidebar now
      expect(def.storeKey, key).toBeDefined()   // owns its own array
      expect(isExportableSection(def), key).toBe(true)
    }
    // Profile's sidebar label differs from its export heading — deliberate.
    expect(SECTIONS.find((s) => s.key === 'key_qualifications')!.label).toBe('Profile')
    expect(SECTION_HEADINGS.key_qualifications.en).toBe('Professional summary')
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
      // key_qualifications is a deliberate exception: its sidebar label is
      // "Profile" but its export heading stays "Professional summary" so
      // client-facing documents are unchanged by the section split.
      const HEADING_DIFFERS_FROM_LABEL = new Set(['key_qualifications'])
      for (const [key, ls] of Object.entries(SECTION_HEADINGS)) {
        if (HEADING_DIFFERS_FROM_LABEL.has(key)) continue
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
