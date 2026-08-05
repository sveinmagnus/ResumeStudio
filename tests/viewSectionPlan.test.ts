/**
 * The section plan every render adapter shares (CLAUDE.md §7.7).
 *
 * This module had no test file of its own: it was reached only through
 * viewFilter, exporter, pdfExporter and viewText, each of which asserts its own
 * output rather than the plan underneath. That made the plan invisible to the
 * mutation report — it had no score at all rather than a poor one — while being
 * the one place a synthetic section is declared, so a mistake here changes all
 * four exports at once.
 */
import { describe, it, expect } from 'vitest'
import {
  isExportableSection, defaultViewDetail, renderKeyFor, buildViewSections,
  normalizeViewSections, reorderViewSections, promotedProjectItems,
  planViewSections, sectionItems,
} from '../src/lib/viewSectionPlan'
import { SECTIONS } from '../src/lib/sections'
import { emptyStore, makeProject, makeView, makeSkill, makeSkillCategory } from './fixtures'
import type { ResumeView, ViewSection } from '../src/types'

const view = (over: Partial<ResumeView> = {}): ResumeView =>
  makeView({ sections: buildViewSections(), ...over })

describe('isExportableSection', () => {
  it('excludes the registries and the document builders, keeps the content', () => {
    // A registry is structural data other sections reference; a cover letter
    // accompanies a CV rather than being part of one.
    for (const key of ['skills', 'roles', 'views', 'cover_letters']) {
      const s = SECTIONS.find((x) => x.key === key)!
      expect(isExportableSection(s), key).toBe(false)
    }
    for (const key of ['projects', 'work_experiences', 'educations', 'promoted_projects']) {
      const s = SECTIONS.find((x) => x.key === key)!
      expect(isExportableSection(s), key).toBe(true)
    }
  })

  it('excludes a section with no store array at all', () => {
    // Overview and Personal Details are editor pages, not collections.
    expect(isExportableSection({ key: 'overview' })).toBe(false)
    expect(isExportableSection({ key: 'header' })).toBe(false)
  })
})

describe('defaultViewDetail', () => {
  it('starts the synthetic sections off and everything else full', () => {
    // The point of the default: adding a synthetic section must not change
    // what an EXISTING view exports until the user opts in.
    expect(defaultViewDetail('promoted_projects')).toBe('off')
    expect(defaultViewDetail('skill_matrix')).toBe('off')
    expect(defaultViewDetail('projects')).toBe('full')
    expect(defaultViewDetail('technology_categories')).toBe('full')
  })
})

describe('renderKeyFor', () => {
  it('maps each synthetic section onto the descriptor it borrows', () => {
    // Promoted Projects are projects; the Skill Matrix is toggled by CATEGORY
    // in the view editor, so its titles resolve through the category
    // descriptor rather than per-skill.
    expect(renderKeyFor('promoted_projects')).toBe('projects')
    expect(renderKeyFor('skill_matrix')).toBe('technology_categories')
  })

  it('leaves a normal section as itself', () => {
    expect(renderKeyFor('projects')).toBe('projects')
    expect(renderKeyFor('not_a_section')).toBe('not_a_section')
  })
})

describe('buildViewSections', () => {
  it('lists every exportable section once, in master order, numbered from zero', () => {
    const built = buildViewSections()
    const expected = SECTIONS.filter(isExportableSection).map((s) => s.key)
    expect(built.map((s) => s.key)).toEqual(expected)
    expect(built.map((s) => s.sort_order)).toEqual(expected.map((_, i) => i))
    expect(new Set(built.map((s) => s.key)).size).toBe(built.length)
  })

  it('seeds each section with its own default detail', () => {
    const built = buildViewSections()
    expect(built.find((s) => s.key === 'promoted_projects')!.detail).toBe('off')
    expect(built.find((s) => s.key === 'projects')!.detail).toBe('full')
  })
})

describe('normalizeViewSections', () => {
  it('appends sections a view predates, keeping the order the user chose', () => {
    // A view created before a section existed does not list it; without this
    // the view editor cannot configure the new section at all.
    const stored: ViewSection[] = [
      { key: 'work_experiences', detail: 'full', sort_order: 1 },
      { key: 'projects', detail: 'summary', sort_order: 0 },
    ]
    const out = normalizeViewSections(stored)

    expect(out.slice(0, 2).map((s) => s.key)).toEqual(['projects', 'work_experiences'])
    expect(out[0].detail).toBe('summary')          // the user's choice survives
    expect(out.map((s) => s.key)).toContain('educations')
    expect(out.find((s) => s.key === 'promoted_projects')!.detail).toBe('off')
  })

  it('renumbers sort_order into a dense 0..n-1 run', () => {
    const out = normalizeViewSections([
      { key: 'projects', detail: 'full', sort_order: 40 },
      { key: 'educations', detail: 'full', sort_order: 10 },
    ])
    expect(out.map((s) => s.sort_order)).toEqual(out.map((_, i) => i))
  })

  it('does not duplicate a section the view already lists', () => {
    const out = normalizeViewSections(buildViewSections())
    expect(new Set(out.map((s) => s.key)).size).toBe(out.length)
  })

  it('does not mutate the stored array', () => {
    const stored: ViewSection[] = [{ key: 'projects', detail: 'full', sort_order: 5 }]
    normalizeViewSections(stored)
    expect(stored).toEqual([{ key: 'projects', detail: 'full', sort_order: 5 }])
  })
})

describe('reorderViewSections', () => {
  const three: ViewSection[] = [
    { key: 'a', detail: 'full', sort_order: 0 },
    { key: 'b', detail: 'full', sort_order: 1 },
    { key: 'c', detail: 'full', sort_order: 2 },
  ]

  it('swaps with the neighbour in the asked-for direction', () => {
    expect(reorderViewSections(three, 'b', 'up').map((s) => s.key)).toEqual(['b', 'a', 'c'])
    expect(reorderViewSections(three, 'b', 'down').map((s) => s.key)).toEqual(['a', 'c', 'b'])
  })

  it('renumbers after the swap so the order is storable', () => {
    expect(reorderViewSections(three, 'b', 'up').map((s) => s.sort_order)).toEqual([0, 1, 2])
  })

  it('is a no-op at either end, and for a key it does not hold', () => {
    // Same array back, so the editor does not record a change that did not
    // happen — the Up button on the first row is pressable.
    expect(reorderViewSections(three, 'a', 'up')).toBe(three)
    expect(reorderViewSections(three, 'c', 'down')).toBe(three)
    expect(reorderViewSections(three, 'nope', 'up')).toBe(three)
  })

  it('works from a stored order that is not already sorted', () => {
    const jumbled: ViewSection[] = [
      { key: 'c', detail: 'full', sort_order: 2 },
      { key: 'a', detail: 'full', sort_order: 0 },
      { key: 'b', detail: 'full', sort_order: 1 },
    ]
    expect(reorderViewSections(jumbled, 'c', 'up').map((s) => s.key)).toEqual(['a', 'c', 'b'])
  })
})

describe('promotedProjectItems', () => {
  const store = () => ({
    ...emptyStore(),
    projects: [
      makeProject({ id: 'p1', customer: { en: 'Starred' }, starred: true }),
      makeProject({ id: 'p2', customer: { en: 'Plain' } }),
      makeProject({ id: 'p3', customer: { en: 'Starred but off' }, starred: true, disabled: true }),
      makeProject({ id: 'p4', customer: { en: 'Starred but excluded' }, starred: true }),
    ],
  })

  it('takes the starred, enabled, non-excluded projects only', () => {
    const items = promotedProjectItems(store(), view({ excluded_item_ids: ['p4'] })) as Array<{ id: string }>
    expect(items.map((p) => p.id)).toEqual(['p1'])
  })

  it('applies the view-wide anonymization it bypasses applyView for', () => {
    // These derive from the RAW store, so nothing else has anonymised them —
    // without this the promoted section prints real client names on a view the
    // user set to anonymous.
    const anon = promotedProjectItems(store(), view({ force_anonymized: true })) as Array<{ use_anonymized: boolean }>
    expect(anon.every((p) => p.use_anonymized)).toBe(true)

    const plain = promotedProjectItems(store(), view()) as Array<{ use_anonymized: boolean }>
    expect(plain.every((p) => p.use_anonymized)).toBe(false)
  })

  it('does not mutate the store while anonymising', () => {
    const s = store()
    promotedProjectItems(s, view({ force_anonymized: true }))
    expect(s.projects.every((p) => p.use_anonymized === false)).toBe(true)
  })
})

describe('planViewSections', () => {
  it('drops every section set to off', () => {
    const v = view({
      sections: buildViewSections().map((s) => (
        s.key === 'projects' ? { ...s, detail: 'off' as const } : s
      )),
    })
    expect(planViewSections(v).map((s) => s.key)).not.toContain('projects')
    // …and the synthetics, which default to off, are absent from a fresh view.
    expect(planViewSections(view()).map((s) => s.key)).not.toContain('promoted_projects')
  })

  it('returns the sections in the view’s order, not the master order', () => {
    const v = view({
      sections: [
        { key: 'educations', detail: 'full', sort_order: 0 },
        { key: 'projects', detail: 'full', sort_order: 1 },
      ],
    })
    const keys = planViewSections(v).map((s) => s.key)
    expect(keys.indexOf('educations')).toBeLessThan(keys.indexOf('projects'))
  })

  it('places a section the view has never seen after everything it ordered', () => {
    // A view created before a section existed still renders it — at the end,
    // where it cannot displace the layout the user arranged.
    const v = view({ sections: [{ key: 'projects', detail: 'full', sort_order: 0 }] })
    const keys = planViewSections(v).map((s) => s.key)
    expect(keys[0]).toBe('projects')
    expect(keys).toContain('educations')
  })

  it('resolves sort per section, then view-wide, then the arranged order', () => {
    const v = view({
      style: { ...makeView({}).style, sort: 'alpha' },
      sections: buildViewSections().map((s) => (
        s.key === 'projects' ? { ...s, sort: 'start' as const } : s
      )),
    })
    const plan = planViewSections(v)
    expect(plan.find((s) => s.key === 'projects')!.sort).toBe('start')     // per-section wins
    expect(plan.find((s) => s.key === 'educations')!.sort).toBe('alpha')   // view-wide

    const bare = view({ sections: [{ key: 'projects', detail: 'full', sort_order: 0 }] })
    expect(planViewSections(bare).find((s) => s.key === 'projects')!.sort).toBe('custom')
  })

  it('carries the per-section style override through, and undefined when unset', () => {
    const v = view({
      sections: buildViewSections().map((s) => (
        s.key === 'projects' ? { ...s, style: { heading_size: 'large' } as never } : s
      )),
    })
    const plan = planViewSections(v)
    expect(plan.find((s) => s.key === 'projects')!.sectionStyle).toEqual({ heading_size: 'large' })
    expect(plan.find((s) => s.key === 'educations')!.sectionStyle).toBeUndefined()
  })
})

describe('sectionItems', () => {
  const planFor = (v: ResumeView, key: string) =>
    planViewSections(v).find((s) => s.key === key)!

  it('reads a normal section from the FILTERED store, not the raw one', () => {
    // `filtered` is applyView's output: disabled and excluded items are already
    // gone, and reading the raw store would put them back into the export.
    const store = { ...emptyStore(), projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })] }
    const filtered = { ...store, projects: [store.projects[0]] }
    const v = view()
    const items = sectionItems(store, v, filtered, planFor(v, 'projects'), 'en') as Array<{ id: string }>
    expect(items.map((p) => p.id)).toEqual(['p1'])
  })

  it('derives promoted projects from the raw store instead', () => {
    // The synthetic computes its own membership, so an empty `filtered` must
    // not empty it — a Projects='off' + Promoted='full' view is the point.
    const store = {
      ...emptyStore(),
      projects: [makeProject({ id: 'p1', starred: true }), makeProject({ id: 'p2' })],
    }
    const v = view({
      sections: buildViewSections().map((s) => (
        s.key === 'promoted_projects' ? { ...s, detail: 'full' as const } : s
      )),
    })
    const items = sectionItems(store, v, { ...store, projects: [] }, planFor(v, 'promoted_projects'), 'en')
    expect((items as Array<{ id: string }>).map((p) => p.id)).toEqual(['p1'])
  })

  it('returns the showcase groups for the Skills Showcase, in category order', () => {
    const store = {
      ...emptyStore(),
      skill_categories: [
        makeSkillCategory({ id: 'c2', name: { en: 'Second' }, sort_order: 1 }),
        makeSkillCategory({ id: 'c1', name: { en: 'First' }, sort_order: 0 }),
      ],
      skills: [
        makeSkill({ id: 's1', name: { en: 'A' }, category_id: 'c1', is_highlighted: true }),
        makeSkill({ id: 's2', name: { en: 'B' }, category_id: 'c2', is_highlighted: true }),
      ],
    }
    const v = view()
    const groups = sectionItems(store, v, store, planFor(v, 'technology_categories'), 'en') as Array<{ id: string }>
    expect(groups.map((g) => g.id)).toEqual(['c1', 'c2'])
  })

  it('sorts a normal section by the plan’s resolved mode', () => {
    const store = {
      ...emptyStore(),
      projects: [
        makeProject({ id: 'b', customer: { en: 'Beta' }, sort_order: 0 }),
        makeProject({ id: 'a', customer: { en: 'Acme' }, sort_order: 1 }),
      ],
    }
    const v = view({
      sections: buildViewSections().map((s) => (
        s.key === 'projects' ? { ...s, sort: 'alpha' as const } : s
      )),
    })
    const items = sectionItems(store, v, store, planFor(v, 'projects'), 'en') as Array<{ id: string }>
    expect(items.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('is empty for a planned section that owns no store array', () => {
    // Defensive: planViewSections only yields exportable sections, which all
    // have a storeKey. Reached directly, the guard has to answer "no items"
    // rather than index the store with undefined.
    const store = emptyStore()
    const bare = { key: 'overview', label: 'Overview', icon: 'X', group: 'profile',
      detail: 'full' as const, sectionStyle: undefined, sort: 'custom' as const, sort_order: 0 }
    expect(sectionItems(store, view(), store, bare as never, 'en')).toEqual([])
  })
})
