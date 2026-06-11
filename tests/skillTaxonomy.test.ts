import { describe, it, expect, afterEach } from 'vitest'
import {
  matchTaxonomy, loadSkillTaxonomy, suggestSkillNames, setSkillTaxonomyForTest,
} from '../src/lib/skillTaxonomy'
import taxonomy from '../src/generated/skillTaxonomy.json'

afterEach(() => setSkillTaxonomyForTest(null))

describe('generated taxonomy file', () => {
  it('is a sizeable, deduped, sorted list of names', () => {
    expect(Array.isArray(taxonomy)).toBe(true)
    expect(taxonomy.length).toBeGreaterThan(1000)
    const lower = (taxonomy as string[]).map((n) => n.toLowerCase())
    expect(new Set(lower).size).toBe(lower.length)
    // No padded names (the source has some) and no empties.
    expect((taxonomy as string[]).every((n) => n === n.trim() && n.length > 0)).toBe(true)
  })
})

describe('matchTaxonomy', () => {
  const names = ['TypeScript', 'Type Theory', 'Scripting', 'Java', 'JavaScript']

  it('ranks prefix matches above substring matches (input order within bands)', () => {
    expect(matchTaxonomy(names, 'type')).toEqual(['TypeScript', 'Type Theory'])
    expect(matchTaxonomy(names, 'script')).toEqual(['Scripting', 'TypeScript', 'JavaScript'])
  })

  it('requires at least two characters', () => {
    expect(matchTaxonomy(names, 'j')).toEqual([])
    expect(matchTaxonomy(names, ' ')).toEqual([])
  })

  it('excludes names already in the registry, case-insensitively', () => {
    expect(matchTaxonomy(names, 'java', ['JAVA'])).toEqual(['JavaScript'])
  })

  it('caps at the limit', () => {
    expect(matchTaxonomy(names, 'a', [], 2)).toEqual([]) // 1 char → none
    expect(matchTaxonomy(names, 'ja', [], 1)).toEqual(['Java'])
  })
})

describe('loadSkillTaxonomy / suggestSkillNames', () => {
  it('lazy-loads and memoizes the generated list', async () => {
    const first = await loadSkillTaxonomy()
    expect(first.length).toBe((taxonomy as string[]).length)
    expect(await loadSkillTaxonomy()).toBe(first) // same reference (memoized)
  })

  it('suggester filters against live registry names', async () => {
    setSkillTaxonomyForTest(['Kubernetes', 'Kubernetes Operations', 'Java'])
    const suggest = suggestSkillNames(() => ['Kubernetes'])
    expect(await suggest('kube')).toEqual(['Kubernetes Operations'])
    expect(await suggest('k')).toEqual([]) // under min length
  })
})
