import { describe, it, expect } from 'vitest'
import { emptyStore, freshStore } from '../src/lib/freshStore'

describe('emptyStore()', () => {
  it('has a null resume and every section as an empty array', () => {
    const s = emptyStore()
    expect(s.resume).toBeNull()
    expect(s.skills).toEqual([])
    expect(s.projects).toEqual([])
    expect(s.views).toEqual([])
  })

  it('returns a fresh object each call (no shared array references)', () => {
    const a = emptyStore()
    const b = emptyStore()
    a.projects.push({} as never)
    expect(b.projects).toEqual([]) // not aliased to a's array
  })

  /**
   * Adding a section means adding its empty array HERE as well as to the type
   * (CLAUDE.md §7). Miss it and the field is undefined, which every consumer
   * meets as a crash on .map the first time that section renders. Spot-checking
   * four of the nineteen arrays cannot catch that, so this walks all of them.
   */
  it('gives every section an empty array — no undefined, no seeded content', () => {
    const s = emptyStore() as unknown as Record<string, unknown>
    // Named explicitly: walking the keys the object HAS cannot notice one that
    // was never added, which is exactly the mistake this guards against.
    const sections = [
      'certifications', 'courses', 'cover_letters', 'educations', 'honor_awards',
      'industries', 'key_competencies', 'key_qualifications', 'positions',
      'presentations', 'projects', 'publications', 'recommendations', 'references',
      'roles', 'skill_categories', 'skills', 'spoken_languages', 'views',
      'work_experiences',
    ]
    expect(Object.keys(s).filter((k) => k !== 'shape_version' && k !== 'resume').sort())
      .toEqual(sections)
    for (const key of sections) {
      expect(Array.isArray(s[key]), key).toBe(true)
      expect(s[key], key).toEqual([])
    }
  })
})

describe('freshStore()', () => {
  it('scaffolds a non-null resume with en as the only locale', () => {
    const s = freshStore()
    expect(s.resume).not.toBeNull()
    expect(s.resume!.supported_locales).toEqual(['en'])
    expect(s.resume!.default_locale).toBe('en')
    expect(s.resume!.full_name).toBe('')
  })

  it('mints a fresh uuid on each call', () => {
    const a = freshStore()
    const b = freshStore()
    expect(a.resume!.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.resume!.id).not.toBe(b.resume!.id)
  })

  it('starts with empty sections like emptyStore', () => {
    const s = freshStore()
    expect(s.projects).toEqual([])
    expect(s.skills).toEqual([])
  })

  it('carries exactly the same section keys as emptyStore', () => {
    // The two are edited together and drift apart silently otherwise: a new
    // resume would be missing a section an imported one has.
    const fresh = freshStore() as unknown as Record<string, unknown>
    for (const key of Object.keys(emptyStore() as unknown as Record<string, unknown>)) {
      if (key === 'shape_version' || key === 'resume') continue
      expect(fresh[key], key).toEqual([])
    }
  })

  it('stamps the current shape version so nothing tries to migrate it', () => {
    expect(freshStore().shape_version).toBe(emptyStore().shape_version)
    expect(typeof freshStore().shape_version).toBe('number')
  })
})
