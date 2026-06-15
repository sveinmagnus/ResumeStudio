import { describe, it, expect, afterEach } from 'vitest'
import {
  matchTaxonomy, loadSkillTaxonomy, suggestSkillNames, setSkillTaxonomyForTest,
  loadSkillRelations, relatedSkillSuggestions, setSkillRelationsForTest,
} from '../src/lib/skillTaxonomy'
import taxonomy from '../src/generated/skillTaxonomy.json'
import relations from '../src/generated/skillRelations.json'

afterEach(() => { setSkillTaxonomyForTest(null); setSkillRelationsForTest(null) })

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

// ─── Related-skill suggestions (F12 pt3) ──────────────────────────────────────

describe('generated relations file', () => {
  it('is a non-empty, symmetric, self-loop-free adjacency map of known names', () => {
    const names = new Set((taxonomy as string[]).map((n) => n.toLowerCase()))
    const rel = relations as Record<string, string[]>
    const keys = Object.keys(rel)
    expect(keys.length).toBeGreaterThan(100)
    let checked = 0
    for (const [name, list] of Object.entries(rel)) {
      expect(names.has(name.toLowerCase())).toBe(true) // key is a real skill
      for (const other of list) {
        expect(other).not.toBe(name)                   // no self-loops
        expect(names.has(other.toLowerCase())).toBe(true)
        // Bidirectional: the reverse edge exists.
        if (checked < 50) {
          expect(rel[other]?.some((b) => b.toLowerCase() === name.toLowerCase())).toBe(true)
          checked++
        }
      }
    }
  })
})

describe('relatedSkillSuggestions', () => {
  const REL = {
    Scrum: ['Agile Software Development', 'Kanban'],
    'Agile Software Development': ['Scrum', 'Kanban'],
    Kanban: ['Scrum', 'Agile Software Development'],
    React: ['TypeScript'],
    TypeScript: ['React'],
  }

  it('suggests related skills the user does not already have', () => {
    const out = relatedSkillSuggestions(['Scrum'], REL)
    expect(out.map((s) => s.name)).toEqual(['Agile Software Development', 'Kanban'])
  })

  it('excludes skills the user already has (case-insensitive)', () => {
    const out = relatedSkillSuggestions(['scrum', 'KANBAN'], REL)
    expect(out.map((s) => s.name)).toEqual(['Agile Software Development'])
  })

  it('ranks by how many of the user’s skills point to a suggestion', () => {
    // Both Scrum and Kanban point to Agile Software Development → weight 2;
    // each also points to the other (already held) → excluded.
    const out = relatedSkillSuggestions(['Scrum', 'Kanban'], REL)
    expect(out[0]).toEqual({ name: 'Agile Software Development', weight: 2 })
  })

  it('returns nothing for skills with no relations or empty input', () => {
    expect(relatedSkillSuggestions([], REL)).toEqual([])
    expect(relatedSkillSuggestions(['Unknown Skill'], REL)).toEqual([])
  })

  it('honours the limit', () => {
    expect(relatedSkillSuggestions(['Scrum'], REL, 1)).toHaveLength(1)
  })

  it('produces real suggestions against the generated graph', async () => {
    const rel = await loadSkillRelations()
    // Pick any key with relations and confirm we get a non-held suggestion.
    const key = Object.keys(rel).find((k) => rel[k].length > 0)!
    const out = relatedSkillSuggestions([key], rel)
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((s) => s.name.toLowerCase() !== key.toLowerCase())).toBe(true)
  })
})
