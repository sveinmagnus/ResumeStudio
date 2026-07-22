import { describe, it, expect } from 'vitest'
import {
  groupState, includeIds, excludeIds, toggleIds, selectOnly, isSingleSelectSection,
  typeGroups, hasTypeFacet, itemsMatchingTypeFilter, typeFilterKey,
  type SelectableItem, type FacetGroupSet,
} from '../src/lib/viewItemSelect'
import type { Role } from '../src/types'

const pos = (id: string, position_type?: string | null): SelectableItem => ({ id, position_type })
const pub = (id: string, publication_type: string): SelectableItem => ({ id, publication_type })
const work = (id: string, employment_type: string | null, role_ids: string[] = []): SelectableItem =>
  ({ id, employment_type, role_ids })
const proj = (id: string, roleIds: string[]): SelectableItem =>
  ({ id, roles: roleIds.map((role_id) => ({ role_id })) })

const role = (id: string, name: string): Role =>
  ({ id, resume_id: 'r', name: { en: name }, sort_order: 0 } as Role)

/** Find one facet's groups by heading. */
const facet = (sets: FacetGroupSet[], name: string) => sets.find((s) => s.name === name)

describe('groupState()', () => {
  it('reports all / none / some', () => {
    expect(groupState([], ['a', 'b'])).toBe('all')
    expect(groupState(['a', 'b'], ['a', 'b'])).toBe('none')
    expect(groupState(['a'], ['a', 'b'])).toBe('some')
  })

  it('ignores exclusions belonging to other sections', () => {
    expect(groupState(['zzz'], ['a', 'b'])).toBe('all')
  })

  it('treats an empty group as none rather than vacuously all', () => {
    expect(groupState([], [])).toBe('none')
  })
})

describe('includeIds() / excludeIds()', () => {
  it('includes by dropping ids from the exclusion list', () => {
    expect(includeIds(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b'])
  })

  it('excludes without duplicating what is already excluded', () => {
    expect(excludeIds(['a'], ['a', 'b']).sort()).toEqual(['a', 'b'])
  })

  it('leaves other sections exclusions alone', () => {
    expect(includeIds(['other', 'a'], ['a'])).toEqual(['other'])
    expect(excludeIds(['other'], ['a']).sort()).toEqual(['a', 'other'])
  })

  it('does not mutate its input', () => {
    const excluded = ['a']
    excludeIds(excluded, ['b'])
    includeIds(excluded, ['a'])
    expect(excluded).toEqual(['a'])
  })
})

describe('toggleIds()', () => {
  it('clears a fully-included group', () => {
    expect(toggleIds([], ['a', 'b']).sort()).toEqual(['a', 'b'])
  })

  it('includes a fully-excluded group', () => {
    expect(toggleIds(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('completes a partial group rather than clearing it', () => {
    expect(toggleIds(['a'], ['a', 'b'])).toEqual([])
  })
})

describe('selectOnly() / isSingleSelectSection()', () => {
  it('keeps exactly one id and excludes the rest of the section', () => {
    expect(selectOnly([], ['a', 'b', 'c'], 'b').sort()).toEqual(['a', 'c'])
  })

  it('re-includes the kept id if it was excluded', () => {
    expect(selectOnly(['a', 'b'], ['a', 'b', 'c'], 'a').sort()).toEqual(['b', 'c'])
  })

  it('leaves other sections untouched', () => {
    expect(selectOnly(['other'], ['a', 'b'], 'a').sort()).toEqual(['b', 'other'])
  })

  it('marks only the profile section single-select', () => {
    expect(isSingleSelectSection('key_qualifications')).toBe(true)
    expect(isSingleSelectSection('projects')).toBe(false)
  })
})

describe('typeGroups() — enum facets', () => {
  it('has no facet for sections without one', () => {
    expect(hasTypeFacet('educations')).toBe(false)
    expect(typeGroups('educations', [{ id: 'a' }], 'en')).toEqual([])
  })

  it('groups positions by position_type in the editor order', () => {
    expect(hasTypeFacet('positions')).toBe(true)
    const sets = typeGroups('positions', [
      pos('a', 'volunteer'), pos('b', 'board_member'), pos('c', 'board_member'),
    ], 'en')
    const g = facet(sets, 'Type')!.groups
    expect(g.map((x) => x.value)).toEqual(['board_member', 'volunteer'])
    expect(g[0]).toMatchObject({ label: 'Board member', ids: ['b', 'c'] })
  })

  it('labels enum groups in the editing locale', () => {
    const sets = typeGroups('positions', [pos('a', 'board_member')], 'de')
    expect(facet(sets, 'Type')!.groups[0].label).toBe('Vorstandsmitglied')
  })

  it('collects untyped / unknown items into a trailing group', () => {
    const sets = typeGroups('positions', [pos('a', 'advisor'), pos('b', null), pos('c', 'wat')], 'en')
    const g = facet(sets, 'Type')!.groups
    expect(g.map((x) => x.value)).toEqual(['advisor', ''])
    expect(g[1]).toMatchObject({ label: 'No type', ids: ['b', 'c'] })
  })

  it('groups publications by publication_type', () => {
    const sets = typeGroups('publications', [pub('a', 'book'), pub('b', 'article'), pub('c', 'article')], 'en')
    const g = facet(sets, 'Type')!.groups
    expect(g.map((x) => x.value)).toEqual(['article', 'book'])
    expect(g[0].ids).toEqual(['b', 'c'])
  })
})

describe('typeGroups() — employment (two facets)', () => {
  const roles = [role('r1', 'Project Manager'), role('r2', 'Architect')]
  const items = [
    work('w1', 'permanent', ['r1']),
    work('w2', 'contract', ['r1', 'r2']),
    work('w3', null, []),
  ]

  it('offers both an Employment type and a Role facet', () => {
    const sets = typeGroups('work_experiences', items, 'en', { roles })
    expect(sets.map((s) => s.name)).toEqual(['Employment type', 'Role'])
  })

  it('keeps employment type English-only', () => {
    const sets = typeGroups('work_experiences', items, 'de', { roles })
    const g = facet(sets, 'Employment type')!.groups
    expect(g.map((x) => x.label)).toContain('Permanent')
  })

  it('groups the multi-valued Role facet, sharing items across roles', () => {
    const sets = typeGroups('work_experiences', items, 'en', { roles })
    const g = facet(sets, 'Role')!.groups
    // w2 carries BOTH roles, so it appears under each.
    expect(g.find((x) => x.label === 'Project Manager')!.ids.sort()).toEqual(['w1', 'w2'])
    expect(g.find((x) => x.label === 'Architect')!.ids).toEqual(['w2'])
    // w3 has no role → No type.
    expect(g.find((x) => x.value === '')!.ids).toEqual(['w3'])
  })
})

describe('typeGroups() — project roles', () => {
  const roles = [role('pm', 'PM'), role('dev', 'Developer')]

  it('groups by the roles[].role_id links', () => {
    const sets = typeGroups('projects', [
      proj('p1', ['pm']), proj('p2', ['pm', 'dev']), proj('p3', []),
    ], 'en', { roles })
    const g = facet(sets, 'Role')!.groups
    expect(g.find((x) => x.label === 'PM')!.ids.sort()).toEqual(['p1', 'p2'])
    expect(g.find((x) => x.label === 'Developer')!.ids).toEqual(['p2'])
    expect(g.find((x) => x.value === '')!.ids).toEqual(['p3'])
  })

  it('confirms the overlap semantics: excluding one role flips a shared item', () => {
    const items = [proj('p1', ['pm']), proj('p2', ['pm', 'dev'])]
    const sets = typeGroups('projects', items, 'en', { roles })
    const pmIds = facet(sets, 'Role')!.groups.find((x) => x.label === 'PM')!.ids
    // Untick PM → both PM-carrying items excluded, including the PM+Dev one.
    const excluded = toggleIds([], pmIds)
    expect(excluded.sort()).toEqual(['p1', 'p2'])
    // Developer group then reads as partial (p2 is excluded, but it was its
    // only member) → 'none' here; with another pure-dev item it'd be 'some'.
    const devIds = facet(sets, 'Role')!.groups.find((x) => x.label === 'Developer')!.ids
    expect(groupState(excluded, devIds)).toBe('none')
  })

  it('drops a whole facet the resume has nothing for', () => {
    // No roles referenced anywhere → the Role facet has only "No type", which
    // is a single group and still returned, but a section with zero items yields
    // no facets at all.
    expect(typeGroups('projects', [], 'en', { roles })).toEqual([])
  })
})

describe('typeGroups() — course/certification category', () => {
  const course = (id: string, category?: string | null): SelectableItem => ({ id, category })

  it('groups courses by their editor category', () => {
    const sets = typeGroups('courses', [
      course('a', 'technical_expertise'), course('b', 'finance'), course('c', null),
    ], 'en')
    const g = facet(sets, 'Category')!.groups
    expect(g.find((x) => x.label === 'Expertise, technical')!.ids).toEqual(['a'])
    expect(g.find((x) => x.label === 'Finance')!.ids).toEqual(['b'])
    expect(g.find((x) => x.value === '')!.ids).toEqual(['c'])
  })

  it('offers the same category facet for certifications', () => {
    const sets = typeGroups('certifications', [course('a', 'medical'), course('b', 'medical')], 'en')
    expect(facet(sets, 'Category')!.groups.find((x) => x.label === 'Medical')!.ids.sort()).toEqual(['a', 'b'])
  })

  it('offers no facet for key competencies (bundle scoping replaced the Profile facet)', () => {
    // Competencies are no longer picked per-item in a view — a view shows the
    // selected profile's bundle (shape v12), so the section carries no facet.
    const sets = typeGroups('key_competencies', [
      { id: 'a' }, { id: 'b' }, { id: 'c' },
    ], 'en', { roles: [] })
    expect(sets).toEqual([])
  })
})

describe('itemsMatchingTypeFilter()', () => {
  const course = (id: string, category?: string | null): SelectableItem => ({ id, category })
  const items = [course('a', 'finance'), course('b', 'sales'), course('c', 'finance')]

  it('returns null when there is no filter key', () => {
    expect(itemsMatchingTypeFilter('courses', items, 'en', { roles: [] }, '')).toBeNull()
  })

  it('returns the ids of the matching facet group', () => {
    const key = typeFilterKey('Category', 'finance')
    const match = itemsMatchingTypeFilter('courses', items, 'en', { roles: [] }, key)
    expect(match && [...match].sort()).toEqual(['a', 'c'])
  })

  it('returns an empty set for a stale key that no longer matches', () => {
    const match = itemsMatchingTypeFilter('courses', items, 'en', { roles: [] }, 'Categorynope')
    expect(match && match.size).toBe(0)
  })
})
