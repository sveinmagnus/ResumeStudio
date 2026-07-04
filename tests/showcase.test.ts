import { describe, it, expect } from 'vitest'
import { showcaseGroups } from '../src/lib/showcase'
import { emptyStore, makeSkill, makeSkillCategory, makeView } from './fixtures'

function storeWithCats() {
  const store = emptyStore()
  store.skill_categories = [
    makeSkillCategory({ id: 'cat-lang', name: { en: 'Languages' }, sort_order: 0 }),
    makeSkillCategory({ id: 'cat-cloud', name: { en: 'Cloud' }, sort_order: 1 }),
  ]
  return store
}

describe('showcaseGroups()', () => {
  it('groups highlighted skills by their linked category, in category sort_order', () => {
    const store = storeWithCats()
    store.skills.push(makeSkill({ name: { en: 'TypeScript' }, category_id: 'cat-lang', is_highlighted: true }))
    store.skills.push(makeSkill({ name: { en: 'AWS' }, category_id: 'cat-cloud', is_highlighted: true }))
    const groups = showcaseGroups(store, makeView(), 'en')
    expect(groups.map((g) => g.name.en)).toEqual(['Languages', 'Cloud'])
  })

  it('sorts skills within a group alphabetically by resolved name', () => {
    const store = storeWithCats()
    store.skills.push(makeSkill({ name: { en: 'Zig' }, category_id: 'cat-lang', is_highlighted: true }))
    store.skills.push(makeSkill({ name: { en: 'Ada' }, category_id: 'cat-lang', is_highlighted: true }))
    const groups = showcaseGroups(store, makeView(), 'en')
    expect(groups[0].skills.map((s) => s.name.en)).toEqual(['Ada', 'Zig'])
  })

  it('excludes a non-highlighted skill even if categorized', () => {
    const store = storeWithCats()
    store.skills.push(makeSkill({ name: { en: 'COBOL' }, category_id: 'cat-lang', is_highlighted: false }))
    const groups = showcaseGroups(store, makeView(), 'en')
    expect(groups).toHaveLength(0)
  })

  it('excludes a highlighted skill with no linked category', () => {
    const store = storeWithCats()
    store.skills.push(makeSkill({ name: { en: 'Orphan' }, category_id: null, is_highlighted: true }))
    const groups = showcaseGroups(store, makeView(), 'en')
    expect(groups).toHaveLength(0)
  })

  it('omits a category with zero qualifying skills', () => {
    const store = storeWithCats()
    store.skills.push(makeSkill({ name: { en: 'TypeScript' }, category_id: 'cat-lang', is_highlighted: true }))
    const groups = showcaseGroups(store, makeView(), 'en')
    expect(groups.map((g) => g.name.en)).toEqual(['Languages']) // Cloud has none
  })

  it('respects view exclusions by category id', () => {
    const store = storeWithCats()
    store.skills.push(makeSkill({ name: { en: 'TypeScript' }, category_id: 'cat-lang', is_highlighted: true }))
    store.skills.push(makeSkill({ name: { en: 'AWS' }, category_id: 'cat-cloud', is_highlighted: true }))
    const groups = showcaseGroups(store, makeView({ excluded_item_ids: ['cat-cloud'] }), 'en')
    expect(groups.map((g) => g.name.en)).toEqual(['Languages'])
  })

  it('never produces an Uncategorized group', () => {
    const store = storeWithCats()
    store.skills.push(makeSkill({ name: { en: 'NoCategory' }, category_id: null, is_highlighted: true }))
    const groups = showcaseGroups(store, makeView(), 'en')
    expect(groups.some((g) => g.name.en === 'Uncategorized')).toBe(false)
  })

  it('returns an empty list when there are no skill categories at all', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ name: { en: 'TypeScript' }, is_highlighted: true }))
    expect(showcaseGroups(store, makeView(), 'en')).toEqual([])
  })
})
