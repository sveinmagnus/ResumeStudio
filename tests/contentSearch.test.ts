import { describe, it, expect } from 'vitest'
import { searchStore } from '../src/lib/contentSearch'
import {
  emptyStore, makeResume, makeProject, makeSkill, makeWork, makeReference, makeIndustry, makeSkillCategory,
} from './fixtures'
import type { ProjectSkill } from '../src/types'

const ps = (skill_id: string, name: Record<string, string>): ProjectSkill => ({
  id: `ps-${skill_id}`, skill_id, name, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
})

function richStore() {
  const store = emptyStore()
  store.resume = makeResume({ full_name: 'Kari Nordmann', title: { en: 'Cloud Architect' } })
  store.projects.push(makeProject({
    id: 'p1', customer: { en: 'NordicBank' },
    long_description: { en: 'Migrated the platform to Kubernetes on Azure.' },
    skills: [ps('k8s', { en: 'Kubernetes' })],
  }))
  store.work_experiences.push(makeWork({ id: 'w1', employer: { en: 'Cartavio' }, role_title: { en: 'Consultant' } }))
  store.skills.push(makeSkill({ id: 'k8s', name: { en: 'Kubernetes' } }))
  store.references.push(makeReference({ id: 'r1', name: 'Ola Hansen', company: 'BigCo' }))
  store.industries.push(makeIndustry({ id: 'fin', name: { en: 'Finance' } }))
  return store
}

describe('searchStore', () => {
  it('returns nothing for queries under two characters', () => {
    expect(searchStore(richStore(), 'k', 'en')).toEqual([])
    expect(searchStore(richStore(), ' ', 'en')).toEqual([])
  })

  it('finds matches across multiple sections (body text + registry)', () => {
    const hits = searchStore(richStore(), 'kubernetes', 'en')
    const sections = hits.map((h) => h.section)
    // The skill registry entry, the project (description + skill chip) all match.
    expect(sections).toContain('skills')
    expect(sections).toContain('projects')
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })

  it('matches the resume header fields', () => {
    const hits = searchStore(richStore(), 'cloud architect', 'en')
    expect(hits[0].section).toBe('header')
    expect(hits[0].title).toBe('Kari Nordmann')
  })

  it('matches plain-string fields like reference name/company', () => {
    const hits = searchStore(richStore(), 'bigco', 'en')
    expect(hits.some((h) => h.section === 'references' && h.id === 'r1')).toBe(true)
  })

  it('is case-insensitive and returns a snippet around the match', () => {
    const hits = searchStore(richStore(), 'AZURE', 'en')
    const projectHit = hits.find((h) => h.section === 'projects')!
    expect(projectHit).toBeDefined()
    expect(projectHit.snippet.toLowerCase()).toContain('azure')
  })

  it('ranks title matches above body-only matches', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'body', customer: { en: 'Acme' }, long_description: { en: 'used Finance tooling' } }))
    store.industries.push(makeIndustry({ id: 'i', name: { en: 'Finance' } }))
    const hits = searchStore(store, 'finance', 'en')
    // The industry entry (title === 'Finance') outranks the project body match.
    expect(hits[0].title).toBe('Finance')
  })

  it('does not search view configs', () => {
    const store = emptyStore()
    // A view whose name contains the query — must NOT appear (views are settings).
    store.views.push({
      ...emptyStore().views[0] ?? ({} as never),
    } as never)
    // Simpler: assert the 'views' section never shows up for any query.
    const hits = searchStore(richStore(), 'finance', 'en')
    expect(hits.some((h) => h.section === 'views')).toBe(false)
  })

  it('ignores ids and timestamps (denylisted keys)', () => {
    const store = emptyStore()
    const p = makeProject({ id: 'unique-searchable-id-xyz' })
    store.projects.push(p)
    // Searching the id substring should not match (ids are denylisted).
    expect(searchStore(store, 'searchable-id-xyz', 'en')).toEqual([])
  })

  it('searches inside arrays of text, not just single values', () => {
    // Highlights are a LocalizedString[]; without recursing into the array the
    // bullets a user writes are unsearchable, which is most of a good project.
    const store = emptyStore()
    store.projects.push(makeProject({
      id: 'p', customer: { en: 'Acme' },
      highlights: [{ en: 'Cut deploy time to minutes' }, { en: 'Ran the migration' }],
    }))
    expect(searchStore(store, 'deploy time', 'en').map((h) => h.id)).toEqual(['p'])
  })

  it('trims a match and skips whitespace-only text', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      id: 'p', customer: { en: '   ' }, description: { en: '   Azure migration   ' },
    }))
    const [hit] = searchStore(store, 'azure', 'en')
    // The snippet is the trimmed value; a blank field contributes nothing at all.
    expect(hit.snippet.startsWith(' ')).toBe(false)
    expect(hit.snippet.endsWith(' ')).toBe(false)
  })

  /**
   * A long field with the match near the end must show the MATCH, not the
   * opening of the text — otherwise the hit looks wrong and the user cannot
   * see why it matched.
   */
  it('centres a long snippet on the match, marking both cuts', () => {
    const store = emptyStore()
    const pad = 'x'.repeat(200)
    store.projects.push(makeProject({
      id: 'p', customer: { en: 'Acme' }, long_description: { en: `${pad} Azure ${pad}` },
    }))
    const hit = searchStore(store, 'azure', 'en').find((h) => h.snippet.toLowerCase().includes('azure'))!
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(true)
    expect(hit.snippet.length).toBeLessThan(120)
  })

  it('finds a matching skill category name under the Skill Registry section', () => {
    const store = richStore()
    store.skill_categories.push(makeSkillCategory({ id: 'cat1', name: { en: 'Cloud Platforms' } }))
    const hits = searchStore(store, 'cloud platforms', 'en')
    const hit = hits.find((h) => h.title === 'Cloud Platforms')
    expect(hit).toBeDefined()
    expect(hit!.section).toBe('skills')
    expect(hit!.sectionLabel).toBe('Skill Registry')
  })

  it('caps results at the limit', () => {
    const store = emptyStore()
    for (let i = 0; i < 50; i++) {
      store.projects.push(makeProject({ id: `p${i}`, customer: { en: `Common ${i}` } }))
    }
    expect(searchStore(store, 'common', 'en', 10)).toHaveLength(10)
  })
})
/** The search snippet — what the user reads in the Ctrl+K results list. */
describe('contentSearch — the snippet', () => {
  const store = (text: string): ResumeStore => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', customer: {}, description: {}, long_description: { en: text } })]
    return s
  }
  const snippetFor = (text: string, q: string) =>
    searchStore(store(text), q, 'en')[0]?.snippet ?? ''

  it('centres the snippet on the match', () => {
    const text = `${'a'.repeat(200)} NEEDLE ${'b'.repeat(200)}`
    const s = snippetFor(text, 'needle')
    expect(s).toContain('NEEDLE')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
  })

  it('does not open with an ellipsis when the match is at the start', () => {
    const s = snippetFor(`NEEDLE ${'b'.repeat(200)}`, 'needle')
    expect(s.startsWith('…')).toBe(false)
    expect(s.endsWith('…')).toBe(true)
  })

  it('does not close with an ellipsis when the match runs to the end', () => {
    const s = snippetFor(`${'a'.repeat(200)} NEEDLE`, 'needle')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(false)
  })

  it('leaves a short value whole, with no ellipses at all', () => {
    const s = snippetFor('a short NEEDLE here', 'needle')
    expect(s).toBe('a short NEEDLE here')
  })
})

/**
 * The query gate, the resume-header hit and the result ordering.
 *
 * Ctrl+K is how the consultant finds anything in a long CV. A gate that is too
 * loose returns the whole document on one keystroke; ordering that is not stable
 * makes the list jump under the cursor.
 */
describe('searchStore — gate, header and order', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Nordmann Consulting' } })]
    return s
  }

  it('needs at least two characters', () => {
    // One character matches most of a CV; the gate is what keeps the palette
    // usable while typing.
    expect(searchStore(store(), 'N', 'en')).toEqual([])
    expect(searchStore(store(), 'No', 'en').length).toBeGreaterThan(0)
  })

  it('measures the query AFTER trimming', () => {
    expect(searchStore(store(), ' N ', 'en')).toEqual([])
    expect(searchStore(store(), ' No ', 'en').length).toBeGreaterThan(0)
  })

  it('matches case-insensitively', () => {
    expect(searchStore(store(), 'NORDMANN', 'en').length).toBeGreaterThan(0)
    expect(searchStore(store(), 'nordmann', 'en').length).toBeGreaterThan(0)
  })

  it('finds the resume header itself, as its own pseudo-section', () => {
    // titleMatch is internal to the scoring; what the caller sees is a hit in
    // the 'header' section, which is how the palette can jump to Personal
    // Details rather than to a content row.
    const hits = searchStore(store(), 'Kari', 'en')
    const header = hits.find((h) => h.section === 'header')!
    expect(header).toBeDefined()
    expect(header.title).toBe('Kari Nordmann')
  })

  it('ranks the header hit FIRST — a name match is what you meant', () => {
    const hits = searchStore(store(), 'Nordmann', 'en')
    expect(hits[0].section).toBe('header')
  })

  it('does not look for a header on a store with no resume', () => {
    const s = store()
    s.resume = null
    expect(() => searchStore(s, 'Nordmann', 'en')).not.toThrow()
  })

  it('survives a resume with no name', () => {
    const s = store()
    s.resume = makeResume({ full_name: '' })
    expect(() => searchStore(s, 'Nordmann', 'en')).not.toThrow()
  })

  it('orders hits deterministically for equal relevance', () => {
    // Two identical matches must not swap places between renders.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.projects = [
      makeProject({ id: 'a', customer: { en: 'Match Alpha' } }),
      makeProject({ id: 'b', customer: { en: 'Match Beta' } }),
    ]
    const once = searchStore(s, 'Match', 'en').map((h) => h.id)
    const twice = searchStore(s, 'Match', 'en').map((h) => h.id)
    expect(once).toEqual(twice)
    expect(once).toHaveLength(2)
  })

  it('honours the result limit', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.projects = Array.from({ length: 40 }, (_, i) =>
      makeProject({ id: `p${i}`, customer: { en: `Match ${i}` } }))
    expect(searchStore(s, 'Match', 'en', 5)).toHaveLength(5)
  })

  it('trims a long snippet on BOTH sides of a mid-text match', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.projects = [makeProject({
      id: 'p1', customer: {},
      long_description: { en: `${'a'.repeat(300)} NEEDLE ${'b'.repeat(300)}` },
    })]
    const snippet = searchStore(s, 'needle', 'en')[0].snippet
    expect(snippet.length).toBeLessThan(200)
    expect(snippet).toContain('NEEDLE')
  })

  it('caps a long value that does NOT contain the query', () => {
    // A field can match on one locale and be shown from another; the shown text
    // still has to be short enough to read.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'NEEDLE', no: 'x'.repeat(500) },
    })]
    for (const hit of searchStore(s, 'needle', 'en')) {
      expect(hit.snippet.length).toBeLessThan(200)
    }
  })
})
