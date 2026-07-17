import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, newId } from '../src/store/useStore'
import { CURRENT_SHAPE_VERSION } from '../src/lib/migrate'
import { emptyStore, makeProject, makeWork, makeRole } from './fixtures'

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
      skills: [], roles: [], key_qualifications: [], key_competencies: [],
      recommendations: [], projects: [],
      work_experiences: [], educations: [], courses: [], certifications: [],
      spoken_languages: [], positions: [],
      presentations: [], honor_awards: [], publications: [], references: [],
      views: [], skill_categories: [],
    },
    activeSection: 'overview',
    primaryLocale: 'en',
    secondaryLocale: null,
    expandedItemId: null,
    hasData: true,
    dataFromNewerApp: false,
    currentResumeId: null,
    sectionSort: {},
    mutationCount: 0,
  }))
}

beforeEach(reset)

/**
 * Seed a section's items directly, bypassing addItem's "place new items on
 * top" policy. Used by the moveItem/reorderItem mechanics tests so they can
 * assert on known, explicit sort_order values.
 */
const seed = (section: 'projects', items: ReturnType<typeof makeProject>[]) =>
  useStore.setState((st) => ({ data: { ...st.data, [section]: items } }))

// ─── Helpers ────────────────────────────────────────────────────────────────

describe('newId()', () => {
  it('newId returns a UUID-shaped string', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('newId produces unique ids across calls', () => {
    const ids = new Set([newId(), newId(), newId(), newId(), newId()])
    expect(ids.size).toBe(5)
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

  it('places the new item at the TOP of the custom order (sort_order below existing)', () => {
    seed('projects', [makeProject({ id: 'a', sort_order: 0 }), makeProject({ id: 'b', sort_order: 1 })])
    useStore.getState().addItem('projects', makeProject({ id: 'new', sort_order: 999 }))
    const added = useStore.getState().data.projects.find((p) => p.id === 'new')!
    // Its sort_order is below every existing one, so custom sort ranks it first.
    expect(added.sort_order).toBeLessThan(0)
    const byOrder = [...useStore.getState().data.projects].sort((x, y) => x.sort_order - y.sort_order)
    expect(byOrder[0].id).toBe('new')
  })

  it('{ open: false } leaves expandedItemId unchanged (nested registry creation)', () => {
    useStore.setState({ expandedItemId: 'parent-card' })
    useStore.getState().addItem('roles', makeRole({ id: 'r1' }), { open: false })
    expect(useStore.getState().expandedItemId).toBe('parent-card')
    expect(useStore.getState().data.roles.map((r) => r.id)).toContain('r1')
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
    seed('projects', [
      makeProject({ id: 'a', sort_order: 0 }),
      makeProject({ id: 'b', sort_order: 1 }),
      makeProject({ id: 'c', sort_order: 2 }),
    ])
    useStore.getState().reorderItem('projects', 'b', 'up')
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('renormalises sort_order after swap', () => {
    seed('projects', [
      makeProject({ id: 'a', sort_order: 10 }),
      makeProject({ id: 'b', sort_order: 20 }),
    ])
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
    seed('projects', [
      makeProject({ id: 'a', sort_order: 0 }),
      makeProject({ id: 'b', sort_order: 1 }),
      makeProject({ id: 'c', sort_order: 2 }),
      makeProject({ id: 'd', sort_order: 3 }),
    ])
    useStore.getState().moveItem('projects', 'a', 2)
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(useStore.getState().data.projects.map((p) => p.sort_order)).toEqual([0, 1, 2, 3])
  })

  it('clamps a too-high target index to last position', () => {
    seed('projects', [makeProject({ id: 'a', sort_order: 0 }), makeProject({ id: 'b', sort_order: 1 })])
    useStore.getState().moveItem('projects', 'a', 99)
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('clamps a negative target index to 0', () => {
    seed('projects', [makeProject({ id: 'a', sort_order: 0 }), makeProject({ id: 'b', sort_order: 1 })])
    useStore.getState().moveItem('projects', 'b', -5)
    expect(useStore.getState().data.projects.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('is a no-op when moving to current position', () => {
    seed('projects', [makeProject({ id: 'a', sort_order: 0 }), makeProject({ id: 'b', sort_order: 1 })])
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
    // Seed items with intentionally inverted sort_order
    seed('projects', [
      makeProject({ id: 'a', sort_order: 2 }),
      makeProject({ id: 'b', sort_order: 0 }),
      makeProject({ id: 'c', sort_order: 1 }),
    ])
    // Visible order is b, c, a — moving b to index 2 should put it last
    useStore.getState().moveItem('projects', 'b', 2)
    const ordered = [...useStore.getState().data.projects].sort((x, y) => x.sort_order - y.sort_order)
    expect(ordered.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('sectionSort + mode-aware reorder', () => {
  it('setSectionSort sets the mode without bumping mutationCount', () => {
    const before = useStore.getState().mutationCount
    useStore.getState().setSectionSort('projects', 'alpha')
    expect(useStore.getState().sectionSort.projects).toBe('alpha')
    expect(useStore.getState().mutationCount).toBe(before)
  })

  it('a manual move in a computed mode bakes the displayed order and switches to custom', () => {
    // sort_order is a,b,c but alpha order is the title order.
    useStore.getState().addItem('projects', makeProject({ id: 'a', sort_order: 0, customer: { en: 'Banana' } }))
    useStore.getState().addItem('projects', makeProject({ id: 'b', sort_order: 1, customer: { en: 'Apple' } }))
    useStore.getState().addItem('projects', makeProject({ id: 'c', sort_order: 2, customer: { en: 'Cherry' } }))
    useStore.getState().setSectionSort('projects', 'alpha')
    // Alpha display order: Apple(b), Banana(a), Cherry(c).
    // Move Cherry (index 2) to the top (index 0).
    useStore.getState().moveItem('projects', 'c', 0)
    // Section flipped back to custom.
    expect(useStore.getState().sectionSort.projects).toBe('custom')
    // The baked custom order is the displayed order with the move applied:
    // Cherry, Apple, Banana.
    const ordered = [...useStore.getState().data.projects].sort((x, y) => x.sort_order - y.sort_order)
    expect(ordered.map((p) => p.id)).toEqual(['c', 'b', 'a'])
    expect(ordered.map((p) => p.sort_order)).toEqual([0, 1, 2])
  })

  it('reorderItem up/down operates on the displayed (alpha) order', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a', sort_order: 0, customer: { en: 'Banana' } }))
    useStore.getState().addItem('projects', makeProject({ id: 'b', sort_order: 1, customer: { en: 'Apple' } }))
    useStore.getState().setSectionSort('projects', 'alpha')
    // Alpha order: Apple(b), Banana(a). Move Apple down → Banana, Apple.
    useStore.getState().reorderItem('projects', 'b', 'down')
    const ordered = [...useStore.getState().data.projects].sort((x, y) => x.sort_order - y.sort_order)
    expect(ordered.map((p) => p.id)).toEqual(['a', 'b'])
    expect(useStore.getState().sectionSort.projects).toBe('custom')
  })

  it('a move in custom mode leaves the mode as custom (unset)', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'a' }))
    useStore.getState().addItem('projects', makeProject({ id: 'b' }))
    useStore.getState().moveItem('projects', 'a', 1)
    // Never explicitly set → still undefined (treated as custom).
    expect(useStore.getState().sectionSort.projects).toBeUndefined()
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

  // Decision 10: per-resume locales are server-persisted, so a locale change
  // must register as a mutation (otherwise auto-save never fires and the
  // choice silently fails to persist across reloads).
  it('changing a locale to a NEW value bumps mutationCount (so it auto-saves)', () => {
    const before = useStore.getState().mutationCount
    useStore.getState().setPrimaryLocale('no')
    expect(useStore.getState().mutationCount).toBe(before + 1)
    useStore.getState().setSecondaryLocale('se')
    expect(useStore.getState().mutationCount).toBe(before + 2)
  })

  it('setting a locale to its CURRENT value is a no-op (no bump)', () => {
    useStore.getState().setPrimaryLocale('no')        // en → no (bumps)
    const after = useStore.getState().mutationCount
    useStore.getState().setPrimaryLocale('no')        // no → no (no-op)
    expect(useStore.getState().mutationCount).toBe(after)
    // secondary starts null in the reset — setting null again is also a no-op
    useStore.getState().setSecondaryLocale(null)
    expect(useStore.getState().mutationCount).toBe(after)
  })
})

// ─── Multi-resume state (currentResumeId / unloadStore / loadStore locales) ──

describe('multi-resume store actions', () => {
  it('setCurrentResumeId tracks the active resume', () => {
    useStore.getState().setCurrentResumeId('abc-123')
    expect(useStore.getState().currentResumeId).toBe('abc-123')
  })

  it('unloadStore ejects to empty and resets bookkeeping', () => {
    useStore.getState().setCurrentResumeId('abc-123')
    useStore.getState().addItem('projects', makeProject({ id: 'p1' }))
    expect(useStore.getState().mutationCount).toBeGreaterThan(0)

    useStore.getState().unloadStore()
    const st = useStore.getState()
    expect(st.hasData).toBe(false)
    expect(st.mutationCount).toBe(0)
    expect(st.currentResumeId).toBeNull()
    expect(st.data.resume).toBeNull()
    expect(st.data.projects).toEqual([])
  })

  it('loadStore seeds primary/secondary from the supplied locales (server row)', () => {
    const store = {
      ...useStore.getState().data,
      resume: {
        ...useStore.getState().data.resume!,
        supported_locales: ['no', 'en', 'se'],
      },
    }
    // Supplied locales win over supported_locales[0/1].
    useStore.getState().loadStore(store, { primary: 'se', secondary: 'dk' })
    expect(useStore.getState().primaryLocale).toBe('se')
    expect(useStore.getState().secondaryLocale).toBe('dk')
    expect(useStore.getState().mutationCount).toBe(0) // load is I/O, not a mutation
  })

  it('loadStore without locales falls back to supported_locales[0/1]', () => {
    const store = {
      ...useStore.getState().data,
      resume: {
        ...useStore.getState().data.resume!,
        supported_locales: ['no', 'en'],
      },
    }
    useStore.getState().loadStore(store)
    expect(useStore.getState().primaryLocale).toBe('no')
    expect(useStore.getState().secondaryLocale).toBe('en')
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
    // Seed explicit order so p1 is first and moving it to index 1 is a real move.
    seed('projects', [makeProject({ id: 'p1', sort_order: 0 }), makeProject({ id: 'p2', sort_order: 1 })])
    const baseline = useStore.getState().mutationCount
    useStore.getState().updateItem('projects', 'p1', { team_size: 5 })
    useStore.getState().moveItem('projects', 'p1', 1)
    useStore.getState().removeItem('projects', 'p1')
    expect(useStore.getState().mutationCount).toBe(baseline + 3)
  })

  it('updates/removes for a missing id do NOT bump the counter', () => {
    useStore.getState().addItem('projects', makeProject({ id: 'p1' }))
    const before = useStore.getState().mutationCount
    useStore.getState().updateItem('projects', 'missing', { team_size: 7 })
    useStore.getState().removeItem('projects', 'missing')
    expect(useStore.getState().mutationCount).toBe(before)
  })

  it('moveItem to the same position does NOT bump the counter', () => {
    seed('projects', [makeProject({ id: 'a', sort_order: 0 }), makeProject({ id: 'b', sort_order: 1 })])
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
      roles: [], key_qualifications: [], key_competencies: [], recommendations: [],
      projects: [], work_experiences: [],
      educations: [], courses: [], certifications: [], spoken_languages: [],
      skill_categories: [], positions: [], presentations: [],
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

// ─── Shape versioning on load ───────────────────────────────────────────────

describe('loadStore() shape versioning', () => {
  it('stamps unversioned (legacy) data with the current shape version', () => {
    const legacy = emptyStore()
    delete legacy.shape_version
    useStore.getState().loadStore(legacy)
    expect(useStore.getState().data.shape_version).toBe(CURRENT_SHAPE_VERSION)
    expect(useStore.getState().dataFromNewerApp).toBe(false)
  })

  it('flags data saved by a newer build and preserves its higher stamp', () => {
    const newer = emptyStore()
    newer.shape_version = CURRENT_SHAPE_VERSION + 1
    useStore.getState().loadStore(newer)
    expect(useStore.getState().dataFromNewerApp).toBe(true)
    // Never downgrade: a later save must carry the newer build's stamp.
    expect(useStore.getState().data.shape_version).toBe(CURRENT_SHAPE_VERSION + 1)
  })

  it('unloadStore clears the newer-data flag', () => {
    const newer = emptyStore()
    newer.shape_version = CURRENT_SHAPE_VERSION + 1
    useStore.getState().loadStore(newer)
    expect(useStore.getState().dataFromNewerApp).toBe(true)
    useStore.getState().unloadStore()
    expect(useStore.getState().dataFromNewerApp).toBe(false)
  })

  it('startFresh produces current-shape data with the flag off', () => {
    useStore.getState().startFresh()
    expect(useStore.getState().data.shape_version).toBe(CURRENT_SHAPE_VERSION)
    expect(useStore.getState().dataFromNewerApp).toBe(false)
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

describe('setActiveView()', () => {
  it('opens a view id and switches to the Views section', () => {
    useStore.getState().setActiveSection('projects')
    useStore.getState().setActiveView('v123')
    expect(useStore.getState().activeViewId).toBe('v123')
    expect(useStore.getState().activeSection).toBe('views')
  })

  it('null returns to the view list', () => {
    useStore.getState().setActiveView('v1')
    useStore.getState().setActiveView(null)
    expect(useStore.getState().activeViewId).toBeNull()
    expect(useStore.getState().activeSection).toBe('views')
  })

  it('does not bump mutationCount (UI-only navigation)', () => {
    const before = useStore.getState().mutationCount
    useStore.getState().setActiveView('v1')
    expect(useStore.getState().mutationCount).toBe(before)
  })
})

describe('addSupportedLocale()', () => {
  it('appends a new locale to supported_locales (sorted)', () => {
    useStore.getState().addSupportedLocale('de')
    expect(useStore.getState().data.resume!.supported_locales).toContain('de')
  })

  it('is a no-op for a locale already present', () => {
    const before = useStore.getState().mutationCount
    const existing = useStore.getState().data.resume!.supported_locales[0]
    useStore.getState().addSupportedLocale(existing)
    expect(useStore.getState().mutationCount).toBe(before)
  })

  it('lower-cases and trims the code, and bumps mutationCount on a real add', () => {
    const before = useStore.getState().mutationCount
    useStore.getState().addSupportedLocale('  FR  ')
    expect(useStore.getState().data.resume!.supported_locales).toContain('fr')
    expect(useStore.getState().mutationCount).toBe(before + 1)
  })
})

describe('dismissAttention() / clearAttentionDismissal()', () => {
  it('records a dismissal and bumps mutationCount', () => {
    const before = useStore.getState().mutationCount
    useStore.getState().dismissAttention('cert:c1', '2027-06-15T00:00:00Z')
    expect(useStore.getState().data.resume!.attention_dismissals).toEqual({ 'cert:c1': '2027-06-15T00:00:00Z' })
    expect(useStore.getState().mutationCount).toBe(before + 1)
  })

  it('is a no-op when re-dismissing with the same until value', () => {
    useStore.getState().dismissAttention('cert:c1', '2027-06-15T00:00:00Z')
    const before = useStore.getState().mutationCount
    useStore.getState().dismissAttention('cert:c1', '2027-06-15T00:00:00Z')
    expect(useStore.getState().mutationCount).toBe(before)
  })

  it('clears a dismissal so the warning can surface again', () => {
    useStore.getState().dismissAttention('stale:projects:p1', '2027-06-15T00:00:00Z')
    useStore.getState().clearAttentionDismissal('stale:projects:p1')
    expect(useStore.getState().data.resume!.attention_dismissals).toEqual({})
  })

  it('clear is a no-op when the key was never dismissed', () => {
    const before = useStore.getState().mutationCount
    useStore.getState().clearAttentionDismissal('nope')
    expect(useStore.getState().mutationCount).toBe(before)
  })
})
