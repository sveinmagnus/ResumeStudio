import { describe, it, expect } from 'vitest'
import {
  applyView, buildViewSections, reorderViewSections,
  getItemTitle, getItemSubtitle, buildViewHtml, isDataImage,
  normalizeViewSections, defaultViewDetail, promotedProjectItems,
} from '../src/lib/viewFilter'
import { SECTIONS } from '../src/lib/sections'
import { DEFAULT_VIEW_STYLE } from '../src/lib/viewStyle'
import { withHeaderDefaults, withFooterDefaults } from '../src/lib/viewHeader'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ,
  makeView, makeReference, makeSpokenLanguage, makeResume,
  makeKeyCompetency, makeRecommendation, makeSkill, makeSkillCategory,
  makeCourse,
} from './fixtures'

// A 1x1 transparent PNG data URL (valid for the isDataImage guard + img embedding).
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='

// ─── buildViewSections ────────────────────────────────────────────────────────

describe('buildViewSections()', () => {
  it('produces one entry per exportable section (excludes views + registries)', () => {
    const sections = buildViewSections()
    const exportable = SECTIONS.filter(
      (s) => s.storeKey && !['views', 'skills', 'roles'].includes(s.key)
    )
    expect(sections).toHaveLength(exportable.length)
    // Every content section defaults to 'full' except the synthetics
    // (promoted_projects, skill_matrix), which default to 'off' so views are
    // unchanged until the user opts in.
    const synthetics = ['promoted_projects', 'skill_matrix']
    expect(sections.filter((s) => !synthetics.includes(s.key)).every((s) => s.detail === 'full')).toBe(true)
    for (const key of synthetics) {
      expect(sections.find((s) => s.key === key)?.detail).toBe('off')
    }
  })

  it('does not include the "views" section', () => {
    const sections = buildViewSections()
    expect(sections.some((s) => s.key === 'views')).toBe(false)
  })

  it('does not include the skill/role registries', () => {
    const sections = buildViewSections()
    expect(sections.some((s) => s.key === 'skills')).toBe(false)
    expect(sections.some((s) => s.key === 'roles')).toBe(false)
  })

  it('assigns unique, gap-free sort_order values', () => {
    const sections = buildViewSections()
    const orders = sections.map((s) => s.sort_order).sort((a, b) => a - b)
    expect(orders).toEqual(Array.from({ length: sections.length }, (_, i) => i))
  })
})

// ─── reorderViewSections ──────────────────────────────────────────────────────

describe('reorderViewSections()', () => {
  it('swaps a section up with its neighbour', () => {
    const sections = [
      { key: 'a', detail: 'full' as const, sort_order: 0 },
      { key: 'b', detail: 'full' as const, sort_order: 1 },
      { key: 'c', detail: 'full' as const, sort_order: 2 },
    ]
    const next = reorderViewSections(sections, 'b', 'up')
    expect(next.map((s) => s.key)).toEqual(['b', 'a', 'c'])
    expect(next.map((s) => s.sort_order)).toEqual([0, 1, 2])
  })

  it('swaps a section down with its neighbour', () => {
    const sections = [
      { key: 'a', detail: 'full' as const, sort_order: 0 },
      { key: 'b', detail: 'full' as const, sort_order: 1 },
    ]
    const next = reorderViewSections(sections, 'a', 'down')
    expect(next.map((s) => s.key)).toEqual(['b', 'a'])
  })

  it('returns input unchanged when trying to move first up', () => {
    const sections = [
      { key: 'a', detail: 'full' as const, sort_order: 0 },
      { key: 'b', detail: 'full' as const, sort_order: 1 },
    ]
    expect(reorderViewSections(sections, 'a', 'up')).toBe(sections)
  })

  it('returns input unchanged when trying to move last down', () => {
    const sections = [
      { key: 'a', detail: 'full' as const, sort_order: 0 },
      { key: 'b', detail: 'full' as const, sort_order: 1 },
    ]
    expect(reorderViewSections(sections, 'b', 'down')).toBe(sections)
  })

  it('returns input unchanged when key is not found', () => {
    const sections = [{ key: 'a', detail: 'full' as const, sort_order: 0 }]
    expect(reorderViewSections(sections, 'missing', 'up')).toBe(sections)
  })

  it('renormalises sort_order even if input was non-contiguous', () => {
    const sections = [
      { key: 'a', detail: 'full' as const, sort_order: 10 },
      { key: 'b', detail: 'full' as const, sort_order: 20 },
      { key: 'c', detail: 'full' as const, sort_order: 30 },
    ]
    const next = reorderViewSections(sections, 'b', 'up')
    expect(next.map((s) => s.sort_order)).toEqual([0, 1, 2])
  })
})

// ─── applyView ────────────────────────────────────────────────────────────────

describe('applyView()', () => {
  it('keeps sections with detail=full and empties detail=off ones', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1' }))
    store.work_experiences.push(makeWork({ id: 'w1' }))
    const view = makeView({
      sections: [
        { key: 'projects', detail: 'full' as const, sort_order: 0 },
        { key: 'work_experiences', detail: 'off' as const, sort_order: 1 },
      ],
    })
    const filtered = applyView(store, view)
    expect(filtered.projects).toHaveLength(1)
    expect(filtered.work_experiences).toHaveLength(0)
  })

  it('drops items present in excluded_item_ids', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'keep' }))
    store.projects.push(makeProject({ id: 'drop' }))
    const view = makeView({
      sections: [{ key: 'projects', detail: 'full' as const, sort_order: 0 }],
      excluded_item_ids: ['drop'],
    })
    const filtered = applyView(store, view)
    expect(filtered.projects.map((p) => p.id)).toEqual(['keep'])
  })

  it('drops items whose disabled flag is true', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'live' }))
    store.projects.push(makeProject({ id: 'soft-deleted', disabled: true }))
    const view = makeView({ sections: [{ key: 'projects', detail: 'full' as const, sort_order: 0 }] })
    const filtered = applyView(store, view)
    expect(filtered.projects.map((p) => p.id)).toEqual(['live'])
  })

  it('with starred_only, keeps only starred items', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1', starred: false }))
    store.projects.push(makeProject({ id: 'p2', starred: true }))
    const view = makeView({
      sections: [{ key: 'projects', detail: 'full' as const, sort_order: 0 }],
      starred_only: true,
    })
    const filtered = applyView(store, view)
    expect(filtered.projects.map((p) => p.id)).toEqual(['p2'])
  })

  it('defaults to full when a view has no entry for a section', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1' }))
    const view = makeView({ sections: [] }) // no entries at all
    const filtered = applyView(store, view)
    expect(filtered.projects).toHaveLength(1)
  })

  it('keeps items when detail=summary (renderer decides what to show)', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1' }))
    const view = makeView({
      sections: [{ key: 'projects', detail: 'summary' as const, sort_order: 0 }],
    })
    const filtered = applyView(store, view)
    expect(filtered.projects).toHaveLength(1)
  })

  it('preserves the resume object', () => {
    const store = emptyStore()
    const view = makeView()
    const filtered = applyView(store, view)
    expect(filtered.resume).toBe(store.resume)
  })

  it('does not mutate the input store arrays', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1' }))
    const originalProjects = store.projects
    const view = makeView({
      sections: [{ key: 'projects', detail: 'off' as const, sort_order: 0 }],
    })
    applyView(store, view)
    expect(store.projects).toBe(originalProjects)
    expect(store.projects).toHaveLength(1)
  })
})

// ─── getItemTitle / getItemSubtitle ───────────────────────────────────────────

describe('getItemTitle()', () => {
  it('uses the configured locale, then falls back', () => {
    const p = makeProject({ customer: { no: 'Kunden' } })
    expect(getItemTitle('projects', p, 'no')).toBe('Kunden')
    // Falls back to en/first via resolve()
    const p2 = makeProject({ customer: { en: 'Customer' } })
    expect(getItemTitle('projects', p2, 'no')).toBe('Customer')
  })

  it('returns "Untitled project" when both customer and description are empty', () => {
    const p = makeProject({ customer: {}, description: {} })
    expect(getItemTitle('projects', p, 'en')).toBe('Untitled project')
  })

  it('falls back to description when customer is empty', () => {
    const p = makeProject({ customer: {}, description: { en: 'A project' } })
    expect(getItemTitle('projects', p, 'en')).toBe('A project')
  })

  it('handles all known section keys without throwing', () => {
    const samples = {
      projects: makeProject(),
      key_qualifications: makeKQ(),
      work_experiences: makeWork(),
      educations: makeEducation(),
      spoken_languages: makeSpokenLanguage(),
      references: makeReference(),
    } as const
    for (const [key, item] of Object.entries(samples)) {
      const title = getItemTitle(key, item, 'en')
      expect(typeof title).toBe('string')
      expect(title.length).toBeGreaterThan(0)
    }
  })

  it('falls back to id for unknown section keys', () => {
    expect(getItemTitle('mystery', { id: 'x' }, 'en')).toBe('x')
  })
})

describe('getItemSubtitle()', () => {
  it('renders project date range', () => {
    const p = makeProject({ start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 } })
    expect(getItemSubtitle('projects', p, 'en')).toBe('Jan 2020 – Jun 2021')
  })

  it('combines role title with date range for work_experiences', () => {
    const w = makeWork({ role_title: { en: 'Engineer' }, start: { year: 2020, month: 1 }, end: null })
    expect(getItemSubtitle('work_experiences', w, 'en')).toBe('Engineer · Jan 2020 – Present')
  })

  it('returns empty string for unknown sections', () => {
    expect(getItemSubtitle('mystery', {}, 'en')).toBe('')
  })
})

// ─── buildViewHtml ───────────────────────────────────────────────────────────

describe('buildViewHtml()', () => {
  it('returns a placeholder when there is no resume', () => {
    const store = emptyStore()
    store.resume = null
    const html = buildViewHtml(store, makeView(), 'en')
    expect(html).toContain('No resume data')
  })

  it('produces a complete HTML document with full_name and title', () => {
    const store = emptyStore()
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Test Person')
    expect(html).toContain('Consultant')
    expect(html).toContain('</html>')
  })

  it('includes a project that is enabled and not excluded', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      id: 'p1',
      customer: { en: 'UniqueCustomerName' },
    }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('UniqueCustomerName')
  })

  it('omits a project that is excluded', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      id: 'p1',
      customer: { en: 'ExcludedCustomerName' },
    }))
    const html = buildViewHtml(
      store,
      makeView({ sections: buildViewSections(), excluded_item_ids: ['p1'] }),
      'en',
    )
    expect(html).not.toContain('ExcludedCustomerName')
  })

  it('respects the chosen locale for translated content', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      customer: { en: 'EN-only', no: 'KUN-NO' },
    }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'no')
    expect(html).toContain('KUN-NO')
  })

  it('includes only references with include_in_exports = true', () => {
    const store = emptyStore()
    store.references.push(makeReference({ id: 'r1', name: 'IncludedRef', include_in_exports: true }))
    store.references.push(makeReference({ id: 'r2', name: 'PrivateRef',  include_in_exports: false }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('IncludedRef')
    expect(html).not.toContain('PrivateRef')
  })

  it('renders the introduction block when set', () => {
    const store = emptyStore()
    const view = makeView({
      sections: buildViewSections(),
      introduction: { en: 'My custom intro' },
    })
    const html = buildViewHtml(store, view, 'en')
    expect(html).toContain('My custom intro')
  })

  it('uses localized section headings for the export locale', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'w1', employer: { en: 'BigCo', no: 'BigCo' } }))
    const view = makeView({ sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0 }] })
    expect(buildViewHtml(store, view, 'no')).toContain('<h2>Arbeidserfaring</h2>')
    expect(buildViewHtml(store, view, 'en')).toContain('<h2>Employment</h2>')
  })

  it('a per-section custom heading still overrides the localized default', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ id: 'w1' }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0, style: { heading_text: { no: 'Erfaring' } } }],
    })
    expect(buildViewHtml(store, view, 'no')).toContain('<h2>Erfaring</h2>')
  })

  it('tabulate lays summary items out in an aligned column grid (one column per field)', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'summary' as const, sort_order: 0, style: { tabulate: true } }],
    })
    const html = buildViewHtml(store, view, 'en')
    // Grid wraps just the item rows; the heading stays outside it.
    expect(html).toContain('ve-tab-grid')
    expect(html).toContain('ve-tab-title')
    // Title, employer, start, (separator,) end each get their own column; the
    // title column is the flexible one so long titles wrap within the page.
    expect(html).toContain('minmax(0, max-content)')
    // A dedicated separator column carries the range mark between the dates.
    expect(html).toContain('ve-tab-sep')
    expect(html).toContain('BigCo')
    expect(html).toContain('Engineer')
    expect(html).toContain('Jan 2020')
    expect(html).toContain('Jun 2022')
    // The section heading must NOT be swallowed into the grid.
    expect(html).toMatch(/<h2>Employment<\/h2>\s*<div class="ve-tab-grid"/)
  })

  it('date format applies to item dates (year-only drops the month)', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0 }],
      style: { ...DEFAULT_VIEW_STYLE, date_format: 'year-only' },
    })
    const html = buildViewHtml(store, view, 'en')
    expect(html).toContain('2020 – 2022')
    expect(html).not.toContain('Jan 2020')
  })

  it('a per-section date format overrides the view default', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0, style: { date_format: 'year-month' } }],
      style: { ...DEFAULT_VIEW_STYLE, date_format: 'month-year' },
    })
    const html = buildViewHtml(store, view, 'en')
    expect(html).toContain('2020 Jan – 2022 Jun')
  })

  it('summary item-layout reorders the slots (date first)', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'summary' as const, sort_order: 0, style: { summary_layout: 'date-title-org' } }],
    })
    const html = buildViewHtml(store, view, 'en')
    // Date slot leads the line, before the (bold) position-title anchor.
    expect(html).toMatch(/Jan 2020[\s\S]*<strong>Engineer<\/strong>/)
  })

  it('every summary item-layout renders the slots in its declared order', () => {
    // work summary slots: title = employer, org = role_title, date = range.
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    }))
    // Title slot = the position title (role); Org slot = the employer.
    const TITLE = 'Engineer', ORG = 'BigCo', DATE = 'Jan 2020'
    const order = (html: string): string[] =>
      [['title', html.indexOf(TITLE)], ['org', html.indexOf(ORG)], ['date', html.indexOf(DATE)]]
        .sort((a, b) => (a[1] as number) - (b[1] as number))
        .map(([k]) => k as string)
    const cases: Array<[string, string[]]> = [
      ['title-org-date', ['title', 'org', 'date']],
      ['title-date-org', ['title', 'date', 'org']],
      ['org-title-date', ['org', 'title', 'date']],
      ['org-date-title', ['org', 'date', 'title']],
      ['date-title-org', ['date', 'title', 'org']],
      ['date-org-title', ['date', 'org', 'title']],
    ]
    for (const [layout, expected] of cases) {
      const view = makeView({
        sections: [{ key: 'work_experiences', detail: 'summary' as const, sort_order: 0, style: { summary_layout: layout as never } }],
      })
      expect(order(buildViewHtml(store, view, 'en')), layout).toEqual(expected)
    }
  })

  it('every tabulated summary layout orders its columns in declared order', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    }))
    // Title slot = the position title (role); Org slot = the employer.
    const TITLE = 'Engineer', ORG = 'BigCo', DATE = 'Jan 2020'
    const order = (html: string): string[] =>
      [['title', html.indexOf(TITLE)], ['org', html.indexOf(ORG)], ['date', html.indexOf(DATE)]]
        .sort((a, b) => (a[1] as number) - (b[1] as number))
        .map(([k]) => k as string)
    const cases: Array<[string, string[]]> = [
      ['title-org-date', ['title', 'org', 'date']],
      ['date-title-org', ['date', 'title', 'org']],
      ['date-org-title', ['date', 'org', 'title']],
    ]
    for (const [layout, expected] of cases) {
      const view = makeView({
        sections: [{ key: 'work_experiences', detail: 'summary' as const, sort_order: 0, style: { summary_layout: layout as never, tabulate: true } }],
      })
      expect(order(buildViewHtml(store, view, 'en')), layout).toEqual(expected)
    }
  })

  it("date_position:'leading' puts the meta line before the item title", () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      start: { year: 2020, month: 1 }, end: null,
    }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0, style: { date_position: 'leading' } }],
    })
    const html = buildViewHtml(store, view, 'en')
    // The meta div (role · dates) appears before the <h3> employer title.
    // ('leading' is a legacy value normalised to 'lead-org-date'.)
    expect(html.indexOf('ve-meta')).toBeLessThan(html.indexOf('<h3>BigCo</h3>'))
  })

  it('full-item layout controls date-before-org vs org-before-date in the details line', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      start: { year: 2020, month: 1 }, end: null, // → "Jan 2020 – Present"
    }))
    const mk = (dp: string) => buildViewHtml(store, makeView({
      sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0, style: { date_position: dp as never } }],
    }), 'en')

    // Org (the role in meta) then date.
    const orgFirst = mk('title-org-date')
    expect(orgFirst.indexOf('Engineer')).toBeLessThan(orgFirst.indexOf('Jan 2020'))
    // Date then org.
    const dateFirst = mk('title-date-org')
    expect(dateFirst.indexOf('Jan 2020')).toBeLessThan(dateFirst.indexOf('Engineer'))
  })

  it('non-tabulated summary uses a dash between from/to dates (dots between items)', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'summary' as const, sort_order: 0 }],
    })
    const html = buildViewHtml(store, view, 'en')
    expect(html).toContain('Jan 2020 – Jun 2022')     // dash between the dates
    expect(html).not.toContain('Jan 2020 · Jun 2022')  // never a dot between dates
    expect(html).toContain('·')                        // dot still separates the items
  })

  it('exports items in sort_order by default even when the array is out of order', () => {
    const store = emptyStore()
    store.resume = makeResume()
    // Array order is Zebra, Alpha — but sort_order says Alpha first.
    store.courses.push(makeCourse({ id: 'c2', name: { en: 'ZebraCourse' }, sort_order: 1 }))
    store.courses.push(makeCourse({ id: 'c1', name: { en: 'AlphaCourse' }, sort_order: 0 }))
    const view = makeView({ sections: [{ key: 'courses', detail: 'full' as const, sort_order: 0 }] })
    const html = buildViewHtml(store, view, 'en')
    expect(html.indexOf('AlphaCourse')).toBeLessThan(html.indexOf('ZebraCourse'))
  })

  it('honours a per-section sort override in the view', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.courses.push(makeCourse({ id: 'c1', name: { en: 'AlphaCourse' }, sort_order: 0, completed: { year: 2019, month: 1 } }))
    store.courses.push(makeCourse({ id: 'c2', name: { en: 'ZebraCourse' }, sort_order: 1, completed: { year: 2023, month: 1 } }))
    // 'date' = newest first → 2023 (Zebra) before 2019 (Alpha), overriding sort_order.
    const view = makeView({ sections: [{ key: 'courses', detail: 'full' as const, sort_order: 0, sort: 'date' }] })
    const html = buildViewHtml(store, view, 'en')
    expect(html.indexOf('ZebraCourse')).toBeLessThan(html.indexOf('AlphaCourse'))
  })

  it('applies the chosen heading/body fonts, and "inherit" uses the global default', () => {
    const store = emptyStore()
    store.resume = makeResume()
    const picked = makeView({ style: { ...DEFAULT_VIEW_STYLE, heading_font: 'serif', body_font: 'times' } })
    const pickedHtml = buildViewHtml(store, picked, 'en')
    expect(pickedHtml).toContain('Georgia')          // serif heading css stack
    expect(pickedHtml).toContain('Times New Roman')  // body css stack

    const inherit = makeView({ style: { ...DEFAULT_VIEW_STYLE, heading_font: 'inherit', body_font: 'inherit' } })
    const inheritHtml = buildViewHtml(store, inherit, 'en', { heading: 'serif', body: 'times' })
    expect(inheritHtml).toContain('Georgia')
    expect(inheritHtml).toContain('Times New Roman')
  })

  it('applies density + divider style to the tabulated summary grid', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'summary' as const, sort_order: 0, style: { tabulate: true, divider_style: 'dashed' } }],
    })
    const html = buildViewHtml(store, view, 'en')
    // The per-section density/divider CSS now targets the tab rows too.
    expect(html).toContain('.ve-sec-work_experiences .ve-tab-row')
    expect(html).toMatch(/\.ve-sec-work_experiences \.ve-tab-row \{[^}]*dashed/)
  })

  it('shows an item short_description below the summary line by default', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      short_description: { en: 'Led the platform team' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    }))
    const view = makeView({ sections: [{ key: 'work_experiences', detail: 'summary' as const, sort_order: 0 }] })
    const html = buildViewHtml(store, view, 'en')
    // The short description renders as its own div below the summary line.
    expect(html).toMatch(/ve-summary-short-below">Led the platform team<\/div>/)
  })

  it('appends the short_description inline when the section asks for it', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      short_description: { en: 'Led the platform team' },
      start: { year: 2020, month: 1 }, end: null,
    }))
    const view = makeView({ sections: [{ key: 'work_experiences', detail: 'summary' as const, sort_order: 0, style: { short_desc_line: 'inline' } }] })
    const html = buildViewHtml(store, view, 'en')
    expect(html).toContain('Led the platform team')
    // No below-div element (the class still appears in the CSS block, so match markup).
    expect(html).not.toMatch(/ve-summary-short-below">/)
  })

  it('does not use the short_description in full mode (long description wins)', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      short_description: { en: 'SHORT-ONLY-TEXT' }, long_description: { en: 'The full story' },
      start: { year: 2020, month: 1 }, end: null,
    }))
    const view = makeView({ sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0 }] })
    const html = buildViewHtml(store, view, 'en')
    expect(html).toContain('The full story')
    expect(html).not.toContain('SHORT-ONLY-TEXT')
  })

  // ─── XSS — escape every interpolated user value ────────────────────────────

  describe('HTML escaping (XSS)', () => {
    const PAYLOAD = `<script>window.__pwned=true</script><img src=x onerror=alert(1)>`
    const ESCAPED_OPEN  = '&lt;script&gt;'
    const ESCAPED_CLOSE = '&lt;/script&gt;'

    function assertSafe(html: string) {
      // The payload must never appear unescaped — no live <script> or
      // <img onerror=…> sequence anywhere in the document.
      expect(html).not.toContain('<script>window.__pwned')
      expect(html).not.toMatch(/<img\s+src=x\s+onerror=/i)
      // Escaped form should be present so the data still renders visibly.
      expect(html).toContain(ESCAPED_OPEN)
      expect(html).toContain(ESCAPED_CLOSE)
    }

    it('escapes the resume full_name', () => {
      const store = emptyStore()
      store.resume!.full_name = PAYLOAD
      const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
      assertSafe(html)
    })

    it('escapes the view introduction', () => {
      const store = emptyStore()
      const view = makeView({
        sections: buildViewSections(),
        introduction: { en: PAYLOAD },
      })
      const html = buildViewHtml(store, view, 'en')
      assertSafe(html)
    })

    it('escapes localized fields on projects (customer, description)', () => {
      const store = emptyStore()
      store.projects.push(makeProject({
        customer:          { en: PAYLOAD },
        long_description:  { en: PAYLOAD },
      }))
      const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
      assertSafe(html)
    })

    it('escapes reference name/title/company (non-localized strings)', () => {
      const store = emptyStore()
      store.references.push(makeReference({
        name: PAYLOAD, title: PAYLOAD, company: PAYLOAD,
        include_in_exports: true,
      }))
      const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
      assertSafe(html)
    })

    it('includes a restrictive Content-Security-Policy meta tag', () => {
      const store = emptyStore()
      const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
      expect(html).toMatch(/<meta http-equiv="Content-Security-Policy"/)
      expect(html).toContain("default-src 'none'")
    })

    // ── CSS-injection / <style> breakout via view style+header config ──
    // These fields come from the view, which can originate from an untrusted
    // backup / snapshot import (the editor UI validates, the import path does
    // not). They flow into the document's <style> block / inline style=/class
    // attributes, so a crafted value must not break out.

    it('neutralises a CSS-injection payload in accent_color', () => {
      const store = emptyStore()
      const view = makeView({
        sections: buildViewSections(),
        // Attempt to close the <style> element and inject active markup.
        style: { ...DEFAULT_VIEW_STYLE, accent_color: '</style><img src=x onerror=alert(1)>' },
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).not.toMatch(/<\/style><img/i)
      expect(html).not.toMatch(/<img\s+src=x\s+onerror=/i)
      // The accent falls back to the Cartavio navy default.
      expect(html).toContain('#002E6E')
    })

    it('neutralises a breakout payload in name_style.size_pt (inline style)', () => {
      const store = emptyStore()
      const header = withHeaderDefaults(undefined)
      // size_pt is typed number|null but a crafted import can smuggle a string.
      ;(header.name_style as { size_pt: unknown }).size_pt = '0pt"><img src=x onerror=alert(1)><span x="'
      const html = buildViewHtml(store, makeView({ sections: buildViewSections(), header }), 'en')
      expect(html).not.toMatch(/<img\s+src=x\s+onerror=/i)
    })

    it('neutralises a breakout payload in photo_placement (class attribute)', () => {
      const store = emptyStore()
      store.resume!.profile_photo = PNG_1x1
      const header = withHeaderDefaults(undefined)
      ;(header as { photo_placement: unknown }).photo_placement = 'left"><img src=x onerror=alert(1)><div class="'
      const html = buildViewHtml(store, makeView({ sections: buildViewSections(), header }), 'en')
      expect(html).not.toMatch(/<img\s+src=x\s+onerror=/i)
    })

    it('neutralises a breakout payload in footer.separator (class attribute)', () => {
      const store = emptyStore()
      const footer = withFooterDefaults(undefined)
      ;(footer as { separator: unknown }).separator = 'line"><img src=x onerror=alert(1)><footer class="'
      const html = buildViewHtml(store, makeView({ sections: buildViewSections(), footer }), 'en')
      expect(html).not.toMatch(/<img\s+src=x\s+onerror=/i)
    })

    it('does not throw on out-of-enum style values from a crafted import', () => {
      const store = emptyStore()
      const view = makeView({
        sections: buildViewSections(),
        style: { ...DEFAULT_VIEW_STYLE, density: 'evil', body_size: 'evil', heading_font: 'evil', page_margin: 'evil' } as never,
      })
      expect(() => buildViewHtml(store, view, 'en')).not.toThrow()
    })
  })

  // ─── Anonymization parity (regression: HTML used to leak the real name) ──

  it('renders the anonymized customer when use_anonymized is set', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      customer: { en: 'RealClientName' },
      customer_anonymized: { en: 'LargeNordicBank' },
      use_anonymized: true,
    }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('LargeNordicBank')
    expect(html).not.toContain('RealClientName')
  })

  it('omits disabled key-qualification points (regression: HTML used to render them)', () => {
    const store = emptyStore()
    store.key_qualifications.push(makeKQ({
      key_points: [
        { id: 'k1', name: { en: 'VisiblePoint' }, long_description: { en: 'shown' }, sort_order: 0 },
        { id: 'k2', name: { en: 'DisabledPoint' }, long_description: { en: 'hidden' }, sort_order: 1, disabled: true },
      ] as never,
    }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('VisiblePoint')
    expect(html).not.toContain('DisabledPoint')
  })

  // ─── Per-view anonymization (F5) ──────────────────────────────────────────

  describe('force_anonymized', () => {
    function anonStore() {
      const store = emptyStore()
      store.projects.push(makeProject({
        id: 'p1',
        customer: { en: 'RealClientName' },
        customer_anonymized: { en: 'NordicBankAlias' },
        use_anonymized: false,
        starred: true,
      }))
      store.references.push(makeReference({
        id: 'r1', name: 'Kari Nordmann', include_in_exports: true,
      }))
      return store
    }

    it('renders every project anonymized even when the project does not ask for it', () => {
      const html = buildViewHtml(anonStore(), makeView({ sections: buildViewSections(), force_anonymized: true }), 'en')
      expect(html).toContain('NordicBankAlias')
      expect(html).not.toContain('RealClientName')
    })

    it('redacts reference names to initials', () => {
      const html = buildViewHtml(anonStore(), makeView({ sections: buildViewSections(), force_anonymized: true }), 'en')
      expect(html).not.toContain('Kari Nordmann')
      expect(html).toContain('K. N.')
    })

    it('applies to the promoted projects section too (bypasses applyView)', () => {
      const sections = buildViewSections().map((s) =>
        s.key === 'promoted_projects' ? { ...s, detail: 'full' as const } : s,
      )
      const html = buildViewHtml(anonStore(), makeView({ sections, force_anonymized: true }), 'en')
      expect(html).not.toContain('RealClientName')
    })

    it('does not mutate the store and leaves normal views untouched', () => {
      const store = anonStore()
      buildViewHtml(store, makeView({ sections: buildViewSections(), force_anonymized: true }), 'en')
      expect(store.projects[0].use_anonymized).toBe(false)
      expect(store.references[0].name).toBe('Kari Nordmann')
      const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
      expect(html).toContain('RealClientName')
      expect(html).toContain('Kari Nordmann')
    })

    it('a project without an alias falls back to its description, never the real name', () => {
      const store = emptyStore()
      store.projects.push(makeProject({
        customer: { en: 'SecretCorp' }, customer_anonymized: {},
        description: { en: 'A modernisation project' },
      }))
      const html = buildViewHtml(store, makeView({ sections: buildViewSections(), force_anonymized: true }), 'en')
      expect(html).not.toContain('SecretCorp')
      expect(html).toContain('A modernisation project')
    })
  })

  // ─── Per-section detail levels ──────────────────────────────────────────

  describe('section detail levels', () => {
    it('summary mode hides project long_description but keeps the customer name', () => {
      const store = emptyStore()
      store.projects.push(makeProject({
        id: 'p1',
        customer: { en: 'AcmeCo' },
        long_description: { en: 'DETAIL_TEXT_THAT_SHOULD_NOT_APPEAR' },
      }))
      const sections = buildViewSections().map((s) =>
        s.key === 'projects' ? { ...s, detail: 'summary' as const } : s
      )
      const html = buildViewHtml(store, makeView({ sections }), 'en')
      expect(html).toContain('AcmeCo')
      expect(html).not.toContain('DETAIL_TEXT_THAT_SHOULD_NOT_APPEAR')
      // Summary items use the .ve-item-line class.
      expect(html).toContain('ve-item-line')
    })

    it('off mode entirely omits the section heading and items', () => {
      const store = emptyStore()
      store.work_experiences.push(makeWork({ employer: { en: 'UNIQUE_EMPLOYER' } }))
      const sections = buildViewSections().map((s) =>
        s.key === 'work_experiences' ? { ...s, detail: 'off' as const } : s
      )
      const html = buildViewHtml(store, makeView({ sections }), 'en')
      expect(html).not.toContain('UNIQUE_EMPLOYER')
      expect(html).not.toContain('ve-sec-work_experiences')
    })

    it('full mode preserves descriptions', () => {
      const store = emptyStore()
      store.projects.push(makeProject({
        customer: { en: 'AcmeCo' },
        long_description: { en: 'FULL_DESCRIPTION_TEXT' },
      }))
      const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
      expect(html).toContain('FULL_DESCRIPTION_TEXT')
    })
  })

  // ─── Styling ────────────────────────────────────────────────────────────

  describe('view styling', () => {
    it('injects the accent color into the document CSS', () => {
      const store = emptyStore()
      const view = makeView({
        sections: buildViewSections(),
        style: {
          density: 'normal', body_size: 'normal', heading_font: 'condensed',
          accent_color: '#FF00AA', page_margin: 'normal', tag_style: 'chips',
        },
      })
      const html = buildViewHtml(store, view, 'en')
      // Case-insensitive — derived tokens uppercase the hex.
      expect(html.toLowerCase()).toContain('#ff00aa')
    })

    it('changes the body font size based on body_size', () => {
      const store = emptyStore()
      const view = makeView({
        sections: buildViewSections(),
        style: {
          density: 'normal', body_size: 'small', heading_font: 'condensed',
          accent_color: '#002E6E', page_margin: 'normal', tag_style: 'chips',
        },
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toMatch(/font-size:\s*9pt/)
    })

    it('renders skill tags as an inline list when tag_style=inline', () => {
      const store = emptyStore()
      store.projects.push(makeProject({
        customer: { en: 'TagTest' },
        skills: [
          { id: 's1', skill_id: '', name: { en: 'TypeScript' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
          { id: 's2', skill_id: '', name: { en: 'React' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 1 },
        ],
      }))
      const view = makeView({
        sections: buildViewSections(),
        style: {
          density: 'normal', body_size: 'normal', heading_font: 'condensed',
          accent_color: '#002E6E', page_margin: 'normal', tag_style: 'inline',
        },
      })
      const html = buildViewHtml(store, view, 'en')
      // Inline list path produces .ve-tags-inline rather than chip spans.
      expect(html).toContain('ve-tags-inline')
      expect(html).not.toMatch(/<span class="ve-tag">TypeScript<\/span>/)
    })

    it('honours per-section hide_heading override', () => {
      const store = emptyStore()
      store.projects.push(makeProject({ customer: { en: 'NoHeading' } }))
      const sections = buildViewSections().map((s) =>
        s.key === 'projects' ? { ...s, style: { hide_heading: true } } : s
      )
      const html = buildViewHtml(store, makeView({ sections }), 'en')
      // Section content is still there.
      expect(html).toContain('NoHeading')
      // But no <h2>Projects</h2> heading for that section.
      expect(html).not.toMatch(/<h2>\s*Projects\s*<\/h2>/)
    })

    it('honours per-section hide_dates override', () => {
      const store = emptyStore()
      store.projects.push(makeProject({
        customer: { en: 'DateHidden' },
        start: { year: 2020, month: 1 },
        end: { year: 2021, month: 6 },
      }))
      const sections = buildViewSections().map((s) =>
        s.key === 'projects' ? { ...s, style: { hide_dates: true } } : s
      )
      const html = buildViewHtml(store, makeView({ sections }), 'en')
      expect(html).toContain('DateHidden')
      expect(html).not.toContain('Jan 2020')
      expect(html).not.toContain('Jun 2021')
    })
  })

  // ─── Configurable header ─────────────────────────────────────────────────

  describe('header configuration', () => {
    it('renders contact rows with descriptor prefixes', () => {
      const store = emptyStore()
      store.resume = makeResume({ phone: '+47 913 04 810', email: 'sm@cartavio.no' })
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({
          fields: [
            { key: 'phone', show: true, label: { en: 'Telefon: ' }, same_line: false, sort_order: 0 },
            { key: 'email', show: true, label: { en: 'Epost: ' }, same_line: true, sort_order: 1 },
          ],
        }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toContain('Telefon: ')
      expect(html).toContain('+47 913 04 810')
      expect(html).toContain('Epost: ')
      expect(html).toContain('sm@cartavio.no')
    })

    it('renders the languages summary row', () => {
      const store = emptyStore()
      store.resume = makeResume()
      store.spoken_languages = [
        makeSpokenLanguage({ name: { en: 'Norwegian' }, level: { en: 'native' }, sort_order: 0 }),
        makeSpokenLanguage({ name: { en: 'English' }, level: { en: 'fluent' }, sort_order: 1 }),
      ]
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({
          fields: [{ key: 'languages', show: true, label: { en: 'Languages: ' }, same_line: false, sort_order: 0 }],
        }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toContain('Norwegian (native), English (fluent)')
    })

    it('applies an explicit name font size', () => {
      const store = emptyStore()
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ name_style: { size_pt: 41, font: 'serif' } }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toMatch(/font-size:41pt/)
    })

    it('a view title override replaces the resume title in the header', () => {
      const store = emptyStore()
      store.resume = makeResume({ title: { en: 'Senior Consultant' } })
      // Baseline: no override → the resume's Personal Details title shows.
      expect(buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en'))
        .toContain('Senior Consultant')
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ title_override: { en: 'Board Member' } }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toContain('Board Member')
      expect(html).not.toContain('Senior Consultant')
    })

    it('embeds the profile photo when placement is set and a data URL exists', () => {
      const store = emptyStore()
      store.resume = makeResume({ profile_photo: PNG_1x1 })
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ photo_placement: 'left' }),
      })
      const html = buildViewHtml(store, view, 'en')
      // The shape class is appended to the base class — match both halves.
      expect(html).toMatch(/class="ve-photo ve-photo-shape-\w+"/)
      expect(html).toContain('ve-photo-left')
      expect(html).toContain(PNG_1x1)
    })

    it('does not embed a photo when placement is none', () => {
      const store = emptyStore()
      store.resume = makeResume({ profile_photo: PNG_1x1 })
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ photo_placement: 'none' }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).not.toContain('class="ve-photo')
    })

    it('applies the per-view profile photo shape as a class', () => {
      const store = emptyStore()
      store.resume = makeResume({ profile_photo: PNG_1x1 })
      for (const shape of ['square', 'rounded', 'circle'] as const) {
        const view = makeView({
          sections: buildViewSections(),
          header: withHeaderDefaults({ photo_placement: 'left', photo_shape: shape }),
        })
        const html = buildViewHtml(store, view, 'en')
        expect(html).toContain(`ve-photo-shape-${shape}`)
      }
    })

    it('defaults profile photo shape to square when the field is missing', () => {
      // Older saved views won't have photo_shape set. withHeaderDefaults must
      // coerce it back to 'square' so the renderer interpolates a known class.
      const store = emptyStore()
      store.resume = makeResume({ profile_photo: PNG_1x1 })
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ photo_placement: 'left' }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toContain('ve-photo-shape-square')
    })

    it('prefers the per-view photo override over the master photo', () => {
      const store = emptyStore()
      store.resume = makeResume({ profile_photo: 'data:image/png;base64,MASTERxx' })
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ photo_placement: 'above', photo_override: PNG_1x1 }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toContain(PNG_1x1)
      expect(html).not.toContain('MASTERxx')
    })

    it('embeds the company logo banner with placement class', () => {
      const store = emptyStore()
      store.resume = makeResume({ company_logo: PNG_1x1 })
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ logo_placement: 'center' }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toContain('ve-logo-banner')
      expect(html).toContain('ve-logo-center')
    })
  })

  // ─── Footer ───────────────────────────────────────────────────────────────

  describe('footer configuration', () => {
    it('renders a person copyright line', () => {
      const store = emptyStore()
      store.resume = makeResume({ full_name: 'Ada Lovelace' })
      const view = makeView({
        sections: buildViewSections(),
        footer: withFooterDefaults({ separator: 'line', copyright: 'person', note: {} }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toContain('ve-footer-line')
      expect(html).toMatch(/©\s*\d{4}\s*Ada Lovelace/)
    })

    it('renders a company copyright + note', () => {
      const store = emptyStore()
      store.resume = makeResume({ company_name: 'Cartavio AS' })
      const view = makeView({
        sections: buildViewSections(),
        footer: withFooterDefaults({ separator: 'thick', copyright: 'company', note: { en: 'Confidential' } }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toContain('Cartavio AS')
      expect(html).toContain('Confidential')
    })

    it('renders a per-view custom copyright holder in the export locale', () => {
      const store = emptyStore()
      store.resume = makeResume({ full_name: 'Ada', company_name: 'Cartavio AS' })
      const view = makeView({
        sections: buildViewSections(),
        footer: withFooterDefaults({
          separator: 'dotted',
          copyright: 'custom',
          copyright_custom: { en: 'Partner Consulting Ltd' },
        }),
      })
      const html = buildViewHtml(store, view, 'en')
      expect(html).toContain('Partner Consulting Ltd')
      expect(html).not.toContain('Cartavio AS')
      expect(html).not.toMatch(/©\s*\d{4}\s*Ada\b/)
    })

    it('omits the footer entirely when separator none and copyright none', () => {
      const store = emptyStore()
      const view = makeView({
        sections: buildViewSections(),
        footer: withFooterDefaults({ separator: 'none', copyright: 'none', note: {} }),
      })
      const html = buildViewHtml(store, view, 'en')
      // The footer CSS classes always exist in the <style> block; assert the
      // footer *element* is absent instead.
      expect(html).not.toContain('<footer')
    })
  })
})

describe('isDataImage()', () => {
  it('accepts base64 image data URLs', () => {
    expect(isDataImage('data:image/png;base64,AAAA')).toBe(true)
    expect(isDataImage('data:image/jpeg;base64,AAAA')).toBe(true)
  })
  it('accepts the other raster formats', () => {
    expect(isDataImage('data:image/gif;base64,AAAA')).toBe(true)
    expect(isDataImage('data:image/bmp;base64,AAAA')).toBe(true)
    expect(isDataImage('data:image/webp;base64,AAAA')).toBe(true)
  })
  it('rejects external URLs, empty, and null', () => {
    expect(isDataImage('https://example.com/a.png')).toBe(false)
    expect(isDataImage('')).toBe(false)
    expect(isDataImage(null)).toBe(false)
    expect(isDataImage(undefined)).toBe(false)
  })
  it('rejects SVG data URLs (markup/script carrier)', () => {
    expect(isDataImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false)
    expect(isDataImage('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false)
  })
  it('rejects a non-image data URL', () => {
    expect(isDataImage('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
  })
})

// ─── New sections + promoted projects (follow-up features) ────────────────────

describe('key_competencies & recommendations rendering', () => {
  it('renders key_competencies (title + description) as a section', () => {
    const store = emptyStore()
    store.key_competencies.push(makeKeyCompetency({
      title: { en: 'Architecture' }, description: { en: 'Designs scalable systems' },
    }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('Architecture')
    expect(html).toContain('Designs scalable systems')
  })

  it('renders recommendations with the quote and recommender name', () => {
    const store = emptyStore()
    store.recommendations.push(makeRecommendation({
      recommender_name: 'Jane Boss', text: { en: 'Excellent to work with' },
    }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('Excellent to work with')
    expect(html).toContain('Jane Boss')
  })

  it('getItemTitle resolves the new sections', () => {
    expect(getItemTitle('key_competencies', makeKeyCompetency({ title: { en: 'X' } }), 'en')).toBe('X')
    expect(getItemTitle('recommendations', makeRecommendation({ recommender_name: 'Y' }), 'en')).toBe('Y')
  })
})

describe('promoted projects', () => {
  it('omits the Promoted Projects section by default', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ customer: { en: 'StarCorp' }, starred: true }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).not.toContain('Promoted Projects')
  })

  it('renders only starred projects in the Promoted Projects section when enabled', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1', customer: { en: 'StarCorp' }, starred: true }))
    store.projects.push(makeProject({ id: 'p2', customer: { en: 'PlainCo' }, starred: false }))
    const sections = buildViewSections().map((s) =>
      s.key === 'promoted_projects' ? { ...s, detail: 'full' as const } : s
    )
    const html = buildViewHtml(store, makeView({ sections }), 'en')
    expect(html).toContain('Promoted Projects')
    expect(html).toContain('StarCorp')
  })

  it('promotedProjectItems returns starred, enabled, non-excluded projects', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1', starred: true }))
    store.projects.push(makeProject({ id: 'p2', starred: false }))
    store.projects.push(makeProject({ id: 'p3', starred: true, disabled: true }))
    store.projects.push(makeProject({ id: 'p4', starred: true }))
    const view = makeView({ sections: buildViewSections(), excluded_item_ids: ['p4'] })
    const ids = (promotedProjectItems(store, view) as Array<{ id: string }>).map((p) => p.id)
    expect(ids).toEqual(['p1'])
  })
})

describe('Skills Showcase (technology_categories, virtual)', () => {
  it('renders on by default (unlike promoted_projects/skill_matrix)', () => {
    const store = emptyStore()
    store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    store.skills.push(makeSkill({ name: { en: 'TypeScript' }, category_id: 'cat1', is_highlighted: true }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('ve-sec-technology_categories')
    expect(html).toContain('Languages')
    expect(html).toContain('TypeScript')
  })

  it('omits the section once every category is empty (no highlighted, categorized skills)', () => {
    const store = emptyStore()
    store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    store.skills.push(makeSkill({ name: { en: 'TypeScript' }, category_id: 'cat1', is_highlighted: false }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).not.toContain('ve-sec-technology_categories')
  })

  it('drops an excluded category from the rendered showcase', () => {
    const store = emptyStore()
    store.skill_categories = [
      makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } }),
      makeSkillCategory({ id: 'cat2', name: { en: 'Cloud' } }),
    ]
    store.skills.push(makeSkill({ name: { en: 'TypeScript' }, category_id: 'cat1', is_highlighted: true }))
    store.skills.push(makeSkill({ name: { en: 'AWS' }, category_id: 'cat2', is_highlighted: true }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections(), excluded_item_ids: ['cat2'] }), 'en')
    expect(html).toContain('Languages')
    expect(html).not.toContain('Cloud')
    expect(html).not.toContain('AWS')
  })

  it('escapes a hostile category name and skill name (XSS regression)', () => {
    const store = emptyStore()
    store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: '<img src=x onerror=alert(1)>' } })]
    store.skills.push(makeSkill({ name: { en: '<script>alert(2)</script>' }, category_id: 'cat1', is_highlighted: true }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>alert(2)</script>')
    expect(html).toContain('&lt;img')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('normalizeViewSections()', () => {
  it('fills in sections missing from an older view', () => {
    const partial = [{ key: 'projects', detail: 'summary' as const, sort_order: 0 }]
    const norm = normalizeViewSections(partial)
    expect(norm.find((s) => s.key === 'recommendations')).toBeTruthy()
    expect(norm.find((s) => s.key === 'key_competencies')).toBeTruthy()
    expect(norm.find((s) => s.key === 'promoted_projects')?.detail).toBe('off')
    // preserves the existing entry's detail
    expect(norm.find((s) => s.key === 'projects')?.detail).toBe('summary')
  })

  it('is a no-op (same coverage) for a freshly built section list', () => {
    const built = buildViewSections()
    const norm = normalizeViewSections(built)
    expect(norm.map((s) => s.key).sort()).toEqual(built.map((s) => s.key).sort())
  })
})

describe('defaultViewDetail()', () => {
  it('is off for promoted_projects, full otherwise', () => {
    expect(defaultViewDetail('promoted_projects')).toBe('off')
    expect(defaultViewDetail('projects')).toBe('full')
    expect(defaultViewDetail('recommendations')).toBe('full')
  })
})
