import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, emptyLocalized, newId } from '../src/store/useStore'
import { makeProject, makeWork, makeRole } from './fixtures'

// Convenience — the store is a real Zustand singleton; reset between tests.
const reset = () => {
  useStore.setState((st) => ({
    ...st,
    data: {
      resume: {
        id: 'r1', full_name: '', email: '', phone: null,
        title: {}, nationality: {}, place_of_residence: {},
        date_of_birth: null, twitter: null, linkedin_url: null,
        website_url: null, profile_image_url: null,
        default_locale: 'en', supported_locales: ['en'],
        created_at: '2024-01-01', updated_at: '2024-01-01',
      },
      skills: [], roles: [], key_qualifications: [], projects: [],
      work_experiences: [], educations: [], courses: [], certifications: [],
      spoken_languages: [], technology_categories: [], positions: [],
      presentations: [], honor_awards: [], publications: [], references: [],
      views: [],
    },
    activeSection: 'overview',
    primaryLocale: 'en',
    secondaryLocale: null,
    expandedItemId: null,
    hasData: true,
    mutationCount: 0,
  }))
}

beforeEach(reset)

// ─── Helpers ────────────────────────────────────────────────────────────────

describe('newId() & emptyLocalized()', () => {
  it('newId returns a UUID-shaped string', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('newId produces unique ids across calls', () => {
    const ids = new Set([newId(), newId(), newId(), newId(), newId()])
    expect(ids.size).toBe(5)
  })

  it('emptyLocalized returns a fresh empty object each call', () => {
    const a = emptyLocalized()
    const b = emptyLocalized()
    expect(a).toEqual({})
    expect(b).toEqual({})
    expect(a).not.toBe(b)
  })
})

// ─── Generic CRUD ───────────────────────────────────────────────────────────

describe('addItem()', () => {
  it('appends to the section array', () => {
    const p = makeProject({ id: 'p1' })
    useStore.getState().addItem('projects', p)
    expect(useStore.getState().data.projects).toHaveLength(1)
    expect(useStore.getState().data.projects[0].id).toBe('p1')
  })

  it('sets expandedItemId to the newly added item', () => {
    const p = makeProject({ id: 'p1' })
    useStore.getState().addItem('projects', p)
    expect(useStore.getState().expandedItemId).toBe('p1')
  })

  it('does not mutate the original array', () => {
    const originalRef = useStore.getState().data.projects
    useStore.getState().addItem('projects', makeProject())
    expect(useStore.getState().data.projects).not.toBe(originalRef)
  })
})

describe('updateItem()', () => {
  it('shallow-merges the patch into the matching item only', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'p1', team_size: 1 }))
    useStore.getState().addItem('projects', makeProject({ id: 'p2', team_size: 99 }))
    useStore.getState().updateItem('projects', 'p1', { team_size: 7 })
    const projects = useStore.getState().data.projects
    expect(projects.find((p) => p.id === 'p1')!.team_size).toBe(7)
    expect(projects.find((p) => p.id === 'p2')!.team_size).toBe(99)
  })

  it('is a no-op when the id is unknown', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'p1' }))
    const before = useStore.getState().data.projects
    useStore.getState().updateItem('projects', 'missing', { team_size: 7 })
    expect(useStore.getState().data.projects[0]).toEqual(before[0])
  })
})

describe('removeItem()', () => {
  it('drops the item with the given id, preserves the rest', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'p1' }))
    useStore.getState().addItem('projects', makeProject({ id: 'p2' }))
    useStore.getState().removeItem('projects', 'p1')
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['p2'])
  })

  it('is a no-op when the id is unknown', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'p1' }))
    useStore.getState().removeItem('projects', 'nope')
    expect(useStore.getState().data.projects).toHaveLength(1)
  })
})

describe('reorderItem()', () => {
  it('swaps the item with its previous neighbour (up)', () => {
    const items = [
      makeProject({ id: 'a', sort_order: 0 }),
      makeProject({ id: 'b', sort_order: 1 }),
      makeProject({ id: 'c', sort_order: 2 }),
    ]
    items.forEach((p) => useStore.getState().addItem('projects', p))
    useStore.getState().reorderItem('projects', 'b', 'up')
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('renormalises sort_order after swap', () => {
    const items = [
      makeProject({ id: 'a', sort_order: 10 }),
      makeProject({ id: 'b', sort_order: 20 }),
    ]
    items.forEach((p) => useStore.getState().addItem('projects', p))
    useStore.getState().reorderItem('projects', 'a', 'down')
    expect(useStore.getState().data.projects.map((p) => p.sort_order)).toEqual([0, 1])
  })

  it('is a no-op at the top edge (up)', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a' }))
    useStore.getState().addItem('projects', makeProject({ id: 'b' }))
    useStore.getState().reorderItem('projects', 'a', 'up')
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('is a no-op at the bottom edge (down)', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a' }))
    useStore.getState().addItem('projects', makeProject({ id: 'b' }))
    useStore.getState().reorderItem('projects', 'b', 'down')
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('is a no-op when the id is missing', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a' }))
    useStore.getState().reorderItem('projects', 'nope', 'up')
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['a'])
  })
})

describe('moveItem()', () => {
  it('moves the item to the requested index and renormalises sort_order', () => {
    const items = [
      makeProject({ id: 'a', sort_order: 0 }),
      makeProject({ id: 'b', sort_order: 1 }),
      makeProject({ id: 'c', sort_order: 2 }),
      makeProject({ id: 'd', sort_order: 3 }),
    ]
    items.forEach((p) => useStore.getState().addItem('projects', p))
    useStore.getState().moveItem('projects', 'a', 2)
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(useStore.getState().data.projects.map((p) => p.sort_order)).toEqual([0, 1, 2, 3])
  })

  it('clamps a too-high target index to last position', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a' }))
    useStore.getState().addItem('projects', makeProject({ id: 'b' }))
    useStore.getState().moveItem('projects', 'a', 99)
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('clamps a negative target index to 0', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a' }))
    useStore.getState().addItem('projects', makeProject({ id: 'b' }))
    useStore.getState().moveItem('projects', 'b', -5)
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('is a no-op when moving to current position', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a' }))
    useStore.getState().addItem('projects', makeProject({ id: 'b' }))
    const before = useStore.getState().mutationCount
    useStore.getState().moveItem('projects', 'a', 0)
    expect(useStore.getState().mutationCount).toBe(before)
  })

  it('is a no-op for an unknown id', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a' }))
    const before = useStore.getState().mutationCount
    useStore.getState().moveItem('projects', 'missing', 0)
    expect(useStore.getState().mutationCount).toBe(before)
  })

  it('respects current sort_order when computing positions (not raw array order)', () => {
    // Add items with intentionally inverted sort_order
    useStore.getState().addItem('projects', makeProject({ id: 'a', sort_order: 2 }))
    useStore.getState().addItem('projects', makeProject({ id: 'b', sort_order: 0 }))
    useStore.getState().addItem('projects', makeProject({ id: 'c', sort_order: 1 }))
    // Visible order is b, c, a — moving b to index 2 should put it last
    useStore.getState().moveItem('projects', 'b', 2)
    const ordered = [...useStore.getState().data.projects].sort((x, y) => x.sort_order - y.sort_order)
    expect(ordered.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
})

// ─── Resume mutation ────────────────────────────────────────────────────────

describe('updateResume()', () => {
  it('shallow-merges the patch into resume', () => {
    useStore.getState().updateResume({ full_name: 'Ada' })
    expect(useStore.getState().data.resume?.full_name).toBe('Ada')
  })

  it('refreshes updated_at on each update', () => {
    const before = useStore.getState().data.resume?.updated_at
    useStore.getState().updateResume({ full_name: 'Ada' })
    const after = useStore.getState().data.resume?.updated_at
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
  })

  it('is a no-op when resume is null', () => {
    useStore.setState((st) => ({ ...st, data: { ...st.data, resume: null } }))
    expect(() => useStore.getState().updateResume({ full_name: 'X' })).not.toThrow()
    expect(useStore.getState().data.resume).toBeNull()
  })
})

// ─── UI state ───────────────────────────────────────────────────────────────

describe('UI state actions', () => {
  it('setActiveSection updates the active key and resets expanded', () => {
    useStore.getState().setExpandedItem('something')
    useStore.getState().setActiveSection('projects')
    expect(useStore.getState().activeSection).toBe('projects')
    expect(useStore.getState().expandedItemId).toBeNull()
  })

  it('setExpandedItem toggles same-id off but switches different-id', () => {
    useStore.getState().setExpandedItem('a')
    expect(useStore.getState().expandedItemId).toBe('a')
    useStore.getState().setExpandedItem('a')
    expect(useStore.getState().expandedItemId).toBeNull()
    useStore.getState().setExpandedItem('b')
    expect(useStore.getState().expandedItemId).toBe('b')
  })

  it('setPrimaryLocale and setSecondaryLocale persist their values', () => {
    useStore.getState().setPrimaryLocale('no')
    useStore.getState().setSecondaryLocale('se')
    expect(useStore.getState().primaryLocale).toBe('no')
    expect(useStore.getState().secondaryLocale).toBe('se')
    useStore.getState().setSecondaryLocale(null)
    expect(useStore.getState().secondaryLocale).toBeNull()
  })
})

// ─── detectAndSetLocales ───────────────────────────────────────────────────

describe('detectAndSetLocales()', () => {
  it('merges newly used locales into supported_locales', () => {
    useStore.getState().addItem('projects', makeProject({ customer: { no: 'X', se: 'Y' } }))
    useStore.getState().detectAndSetLocales()
    const locales = useStore.getState().data.resume!.supported_locales
    expect(new Set(locales).has('no')).toBe(true)
    expect(new Set(locales).has('se')).toBe(true)
    expect(new Set(locales).has('en')).toBe(true)
  })

  it('is a no-op when the supported list already covers everything', () => {
    const before = useStore.getState().data.resume!.updated_at
    useStore.getState().detectAndSetLocales()
    const after = useStore.getState().data.resume!.updated_at
    expect(after).toBe(before) // no-op did not bump updated_at
  })

  it('does nothing when there is no resume', () => {
    useStore.setState((st) => ({ ...st, data: { ...st.data, resume: null } }))
    expect(() => useStore.getState().detectAndSetLocales()).not.toThrow()
  })
})

// ─── replaceData / mutationCount semantics ────────────────────────────────

describe('replaceData()', () => {
  it('replaces data and bumps mutationCount (unlike loadStore)', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'p1' }))
    const before = useStore.getState().mutationCount
    const replacement = {
      ...useStore.getState().data,
      projects: [makeProject({ id: 'p99' })],
    }
    useStore.getState().replaceData(replacement)
    expect(useStore.getState().data.projects[0].id).toBe('p99')
    expect(useStore.getState().mutationCount).toBe(before + 1)
  })

  it('produces a different observable effect than loadStore for the same data', () => {
    const someStore = useStore.getState().data
    // loadStore resets mutationCount to 0 (I/O semantics)
    useStore.getState().loadStore(someStore)
    expect(useStore.getState().mutationCount).toBe(0)
    // replaceData bumps mutationCount (user-mutation semantics)
    useStore.getState().replaceData(someStore)
    expect(useStore.getState().mutationCount).toBe(1)
  })
})

describe('mutationCount semantics', () => {
  it('every observable mutating action bumps the counter exactly once', () => {
    // Need 2 items so moveItem is a real move (not the from===to no-op).
    useStore.getState().addItem('projects', makeProject({ id: 'p1', sort_order: 0 }))
    useStore.getState().addItem('projects', makeProject({ id: 'p2', sort_order: 1 }))
    const after2Adds = useStore.getState().mutationCount
    useStore.getState().updateItem('projects', 'p1', { team_size: 5 })
    useStore.getState().moveItem('projects', 'p1', 1)
    useStore.getState().removeItem('projects', 'p1')
    expect(useStore.getState().mutationCount).toBe(after2Adds + 3)
  })

  it('updates/removes for a missing id do NOT bump the counter', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'p1' }))
    const before = useStore.getState().mutationCount
    useStore.getState().updateItem('projects', 'missing', { team_size: 7 })
    useStore.getState().removeItem('projects', 'missing')
    expect(useStore.getState().mutationCount).toBe(before)
  })

  it('moveItem to the same position does NOT bump the counter', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a', sort_order: 0 }))
    useStore.getState().addItem('projects', makeProject({ id: 'b', sort_order: 1 }))
    const before = useStore.getState().mutationCount
    useStore.getState().moveItem('projects', 'a', 0) // already at 0
    expect(useStore.getState().mutationCount).toBe(before)
  })

  it('detectAndSetLocales does NOT bump when the locale set is unchanged', () => {
    // Resume already has supported_locales = ['en'] and no content uses
    // anything else, so detection adds nothing.
    const before = useStore.getState().mutationCount
    useStore.getState().detectAndSetLocales()
    expect(useStore.getState().mutationCount).toBe(before)
  })

  it('updateResume on a null resume is a no-op (does not bump counter)', () => {
    useStore.setState((st) => ({ ...st, data: { ...st.data, resume: null } }))
    const before = useStore.getState().mutationCount
    useStore.getState().updateResume({ full_name: 'X' })
    expect(useStore.getState().mutationCount).toBe(before)
  })
})

// ─── loadStore / startFresh ────────────────────────────────────────────────

describe('loadStore() & startFresh()', () => {
  it('loadStore replaces the in-memory store, marks hasData, and resets mutationCount', () => {
    // Push the counter forward first so we can verify the reset.
    useStore.getState().addItem('projects', makeProject({ id: 'temp' }))
    expect(useStore.getState().mutationCount).toBeGreaterThan(0)
    useStore.setState((st) => ({ ...st, hasData: false }))
    const replacement = {
      resume: null,
      skills: [makeRole()] as never, // shape unimportant for this test
      roles: [], key_qualifications: [], projects: [], work_experiences: [],
      educations: [], courses: [], certifications: [], spoken_languages: [],
      technology_categories: [], positions: [], presentations: [],
      honor_awards: [], publications: [], references: [], views: [],
    }
    useStore.getState().loadStore(replacement)
    expect(useStore.getState().hasData).toBe(true)
    expect(useStore.getState().data.skills).toHaveLength(1)
    expect(useStore.getState().mutationCount).toBe(0)
  })

  it('startFresh seeds an empty resume and switches to the Personal Details section', () => {
    useStore.setState((st) => ({ ...st, hasData: false }))
    useStore.getState().startFresh()
    expect(useStore.getState().hasData).toBe(true)
    expect(useStore.getState().data.resume).not.toBeNull()
    expect(useStore.getState().data.resume!.full_name).toBe('')
    expect(useStore.getState().activeSection).toBe('header')
  })
})

// ─── Anti-mutation invariants ──────────────────────────────────────────────

describe('immutability', () => {
  it('addItem produces a fresh array reference', () => {
    const before = useStore.getState().data.projects
    useStore.getState().addItem('projects', makeProject())
    expect(useStore.getState().data.projects).not.toBe(before)
  })

  it('removeItem produces a fresh array reference', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'p1' }))
    const before = useStore.getState().data.projects
    useStore.getState().removeItem('projects', 'p1')
    expect(useStore.getState().data.projects).not.toBe(before)
  })

  it('updateItem produces a fresh array reference', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'p1' }))
    const before = useStore.getState().data.projects
    useStore.getState().updateItem('projects', 'p1', { team_size: 99 })
    expect(useStore.getState().data.projects).not.toBe(before)
  })

  it('works for non-project sections (work_experiences)', () => {
    useStore.getState().addItem('work_experiences', makeWork({ id: 'w1' }))
    useStore.getState().updateItem('work_experiences', 'w1', { company_size: '500' })
    expect(useStore.getState().data.work_experiences[0].company_size).toBe('500')
  })
})
