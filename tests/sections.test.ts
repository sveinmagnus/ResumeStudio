import { describe, it, expect } from 'vitest'
import { SECTIONS, GROUP_ORDER, canonicalSectionKey } from '../src/lib/sections'
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
})
