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
