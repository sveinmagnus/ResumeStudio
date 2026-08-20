import { describe, it, expect } from 'vitest'
import {
  applyView, buildViewSections, reorderViewSections,
  getItemTitle, getItemSubtitle, buildViewHtml, isDataImage, escapeHtml,
  normalizeViewSections, defaultViewDetail, promotedProjectItems, sectionStarredOnly,
  viewProfileTagLine,
} from '../src/lib/viewFilter'
import { SECTIONS } from '../src/lib/sections'
import { DEFAULT_VIEW_STYLE, deriveTokens, withDefaults } from '../src/lib/viewStyle'
import { withHeaderDefaults, withFooterDefaults } from '../src/lib/viewHeader'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ,
  makeView, makeReference, makeSpokenLanguage, makeResume,
  makeKeyCompetency, makeRecommendation, makeSkill, makeSkillCategory,
  makeCourse, makePosition, makeIndustry,
} from './fixtures'
import type { ResumeStore } from '../src/types'

// A 1x1 transparent PNG data URL (valid for the isDataImage guard + img embedding).
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='

// ─── buildViewSections ────────────────────────────────────────────────────────

describe('buildViewSections()', () => {
  it('produces one entry per exportable section (excludes views + registries)', () => {
    const sections = buildViewSections()
    const exportable = SECTIONS.filter(
      (s) => s.storeKey && !['views', 'skills', 'roles', 'cover_letters'].includes(s.key)
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

  // Per-section starred override: lets one view show every course but only the
  // featured projects.
  describe('per-section starred_only override', () => {
    const twoOfEach = () => {
      const store = emptyStore()
      store.projects.push(makeProject({ id: 'p1', starred: false }))
      store.projects.push(makeProject({ id: 'p2', starred: true }))
      store.courses.push(makeCourse({ id: 'c1', starred: false }))
      store.courses.push(makeCourse({ id: 'c2', starred: true }))
      return store
    }
    const sections = (projectStyle?: { starred_only?: boolean }) => [
      { key: 'projects', detail: 'full' as const, sort_order: 0, ...(projectStyle ? { style: projectStyle } : {}) },
      { key: 'courses', detail: 'full' as const, sort_order: 1 },
    ]

    it('starres one section while the rest of the view keeps everything', () => {
      const filtered = applyView(twoOfEach(), makeView({ sections: sections({ starred_only: true }) }))
      expect(filtered.projects.map((p) => p.id)).toEqual(['p2'])
      expect(filtered.courses.map((c) => c.id)).toEqual(['c1', 'c2'])
    })

    it('lets a section opt OUT of a starred-only view', () => {
      const filtered = applyView(twoOfEach(), makeView({
        sections: sections({ starred_only: false }),
        starred_only: true,
      }))
      // Explicit false beats the view default; courses still follow it.
      expect(filtered.projects.map((p) => p.id)).toEqual(['p1', 'p2'])
      expect(filtered.courses.map((c) => c.id)).toEqual(['c2'])
    })

    it('inherits the view default when the section says nothing', () => {
      const filtered = applyView(twoOfEach(), makeView({ sections: sections(), starred_only: true }))
      expect(filtered.projects.map((p) => p.id)).toEqual(['p2'])
      expect(filtered.courses.map((c) => c.id)).toEqual(['c2'])
    })

    it('sectionStarredOnly resolves the same precedence', () => {
      const v = makeView({ sections: sections({ starred_only: false }), starred_only: true })
      expect(sectionStarredOnly(v, 'projects')).toBe(false)
      expect(sectionStarredOnly(v, 'courses')).toBe(true)
      expect(sectionStarredOnly(v, 'nonexistent')).toBe(true)
    })
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

  describe('the document language', () => {
    // Regression: the export emitted the raw app locale code, so a Norwegian
    // CV was tagged `lang="no"` correctly but a Swedish one claimed `lang="se"`
    // (Northern Sami) and a Danish one `lang="dk"` (unassigned). Screen readers
    // and PDF metadata read this tag, so it has to be real BCP-47.
    const langOf = (locale: string): string =>
      buildViewHtml(emptyStore(), makeView({ sections: buildViewSections() }), locale)
        .match(/<html lang="([^"]*)"/)?.[1] ?? ''

    it('maps the CVpartner-flavoured codes onto real BCP-47 tags', () => {
      expect(langOf('se')).toBe('sv')
      expect(langOf('dk')).toBe('da')
    })

    it('passes through codes that are already valid', () => {
      expect(langOf('en')).toBe('en')
      expect(langOf('no')).toBe('no')
      expect(langOf('de')).toBe('de')
    })
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
      sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0, style: { date_position: 'leading' as never } }],
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
    store.courses.push(makeCourse({ id: 'c1', name: { en: 'AlphaCourse' }, sort_order: 0, end: { year: 2019, month: 1 } }))
    store.courses.push(makeCourse({ id: 'c2', name: { en: 'ZebraCourse' }, sort_order: 1, end: { year: 2023, month: 1 } }))
    // Courses sort by their end (to) date now; 'end' = newest first → 2023
    // (Zebra) before 2019 (Alpha), overriding sort_order.
    const view = makeView({ sections: [{ key: 'courses', detail: 'full' as const, sort_order: 0, sort: 'end' }] })
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

  it('exports dates with localized month abbreviations', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'BigCo' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 5 },
    }))
    const view = makeView({ sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0 }] })
    const html = buildViewHtml(store, view, 'no')
    expect(html).toContain('jan. 2020')
    expect(html).toContain('mai 2021')
    expect(html).not.toContain('Jan 2020')
  })

  it('renders Other roles with the organisation as the heading', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.positions.push(makePosition({
      id: 'pos1', name: { en: 'Board Member' }, organisation: { en: 'Acme Foundation' },
      position_type: 'board_member', description: { en: 'Governance' },
      start: { year: 2020, month: 1 }, end: null,
    }))
    const view = makeView({ sections: [{ key: 'positions', detail: 'full' as const, sort_order: 0 }] })
    const html = buildViewHtml(store, view, 'en')
    expect(html).toContain('<h3>Acme Foundation</h3>') // org is the heading
    expect(html).toContain('Board Member')             // role name in the meta line
  })

  it('prefixes the heading with the section icon only when enabled', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.work_experiences.push(makeWork({ id: 'w1', employer: { en: 'BigCo' } }))
    const on = makeView({ sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0 }], style: { ...DEFAULT_VIEW_STYLE, section_icons: true } })
    expect(buildViewHtml(store, on, 'en')).toContain('<svg class="ve-sec-icon"')
    const off = makeView({ sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0 }] })
    expect(buildViewHtml(store, off, 'en')).not.toContain('<svg class="ve-sec-icon"')
  })

  it('uses a distinct heading colour, keeping the accent for the underline', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.work_experiences.push(makeWork({ id: 'w1', employer: { en: 'BigCo' } }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0 }],
      style: { ...DEFAULT_VIEW_STYLE, accent_color: '#00AA00', heading_color: '#FF0000' },
    })
    const html = buildViewHtml(store, view, 'en')
    expect(html).toContain('color: #FF0000')   // heading text
    expect(html).toContain('#00AA0033')          // accent underline
  })

  // Languages: every mode is a line — see the descriptor. These pin the three
  // densities so the special case can't silently drift back to a prose block.
  describe('languages (the one-line special case)', () => {
    const langStore = (cefr?: Record<string, string>) => {
      const store = emptyStore()
      store.resume = makeResume()
      store.spoken_languages.push(makeSpokenLanguage({
        name: { en: 'German' }, level: { en: 'Fluent' }, cefr,
      }) as never)
      return store
    }
    const render = (detail: 'summary' | 'full', cefr?: Record<string, string>, tabulate = false) =>
      buildViewHtml(langStore(cefr), makeView({
        sections: [{ key: 'spoken_languages', detail, sort_order: 0, ...(tabulate ? { style: { tabulate: true } } : {}) }],
      }), 'en')

    it('summary is the compact flow — name + level, no passport', () => {
      const html = render('summary', { listening: 'C1', reading: 'C1', writing: 'B2' })
      expect(html).toContain('German')
      expect(html).toContain('Fluent')
      expect(html).not.toContain('Understanding')
      expect(html).not.toContain('C1')
      // Languages flow side by side rather than one block per language.
      expect(html).toContain('.ve-sec-spoken_languages .ve-item-line { display: inline-block')
    })

    it('summary keeps the classic "Name — level" dash despite the date-first layout', () => {
      // The default layout leads with the date slot, but Languages has no
      // dates — so the title still renders first and must read as a title.
      expect(render('summary')).toContain('<strong>German</strong> — ')
    })

    it('full puts a single passport value on the line', () => {
      const html = render('full', {
        listening: 'B2', reading: 'B2', spoken_interaction: 'B2', spoken_production: 'B2', writing: 'B2',
      })
      expect(html).toContain('<div class="ve-item ve-inline">')
      expect(html).toContain('Fluent · B2')
      // Match the ELEMENT: the class name itself always appears in the <style>.
      expect(html).not.toContain('<div class="ve-inline-extra">')
    })

    it('full splits a differing passport onto understanding/spoken/written lines', () => {
      const html = render('full', { listening: 'C1', reading: 'C1', writing: 'B2' })
      expect(html).toContain('<div class="ve-inline-extra">Understanding: C1</div>')
      expect(html).toContain('<div class="ve-inline-extra">Written: B2</div>')
      expect(html).not.toContain('<h3>German</h3>')   // never a prose block
    })

    it('tabulated gives the passport its own column, line-broken in the cell', () => {
      const html = render('summary', { listening: 'C1', reading: 'C1', writing: 'B2' }, true)
      expect(html).toContain('ve-tab-grid')
      // name | level | passport = three columns, the passport its own cell.
      expect(html).toContain('<span class="ve-tab-text">Fluent</span>')
      expect(html).toContain('<span class="ve-tab-text">Understanding: C1<br>Written: B2</span>')
    })

    it('escapes a line-broken cell rather than trusting the break marker', () => {
      const html = render('summary', { listening: 'C1', writing: 'B2' }, true)
      expect(html).not.toContain('<script')
      // The only <br> in a cell is ours — the value itself is escaped.
      expect(html).toContain('Understanding: C1<br>Written: B2')
    })
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

    it('states every CSP directive, not just the default one', () => {
      // This is the document's defence in depth behind the render-time
      // escaping, and each directive closes a distinct hole. Emptied, a
      // directive falls back to `default-src 'none'` for some and to the
      // browser's permissive default for others (`base-uri`, `form-action`
      // are NOT covered by default-src) — so the policy quietly gets weaker
      // while a "has a CSP" check keeps passing.
      const html = buildViewHtml(emptyStore(), makeView({ sections: buildViewSections() }), 'en')
      const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]
      expect(csp.split('; ')).toEqual([
        "default-src 'none'",
        "style-src 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'none'",
      ])
      // No directive permits script, in any form.
      expect(csp).not.toMatch(/script-src/)
      expect(csp).not.toMatch(/unsafe-eval/)
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

    it('reduces every part of a name, however it is spaced or capitalised', () => {
      // The point of initials is that nothing identifying survives. A middle
      // name left whole, or a lower-case initial that reads as a fragment of
      // the real name, both defeat that — and a name arrives from an import
      // with whatever spacing it had.
      const store = anonStore()
      store.references[0].name = '  kari  anne   nordmann-berg  '
      const html = buildViewHtml(store, makeView({ sections: buildViewSections(), force_anonymized: true }), 'en')

      // The whole element content, not a substring: untrimmed input splits
      // into empty leading/trailing parts and renders ". K. A. N. ." — which
      // still CONTAINS the right initials.
      expect(html).toMatch(/>\s*K\. A\. N\.\s*</)
      // Word-bounded: the stylesheet contains "banner", which trivially
      // contains "anne".
      expect(html).not.toMatch(/\bkari\b/i)
      expect(html).not.toMatch(/\banne\b/i)
      expect(html).not.toMatch(/\bnordmann\b/i)
    })

    it('leaves an empty reference name empty rather than emitting a stray dot', () => {
      const store = anonStore()
      store.references[0].name = ''
      const html = buildViewHtml(store, makeView({ sections: buildViewSections(), force_anonymized: true }), 'en')
      expect(html).not.toContain('.  .')
      expect(html).not.toMatch(/>\s*\.\s*</)
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

    describe('item bullets', () => {
      const projStore = () => {
        const s = emptyStore()
        s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: { en: 'Did things.' } })]
        return s
      }
      const bulletView = (style?: Record<string, unknown>) => makeView({
        sections: [{ key: 'projects', detail: 'full' as const, sort_order: 0 }],
        style: { ...DEFAULT_VIEW_STYLE, ...style },
      })

      // The bullet CSS rules live in the static stylesheet whether or not any
      // item uses them (like every other feature's rules), so these assertions
      // target the MARKUP — the class on an item and the glyph span — not the
      // raw string, which would match the <style> block.
      it('adds no bullet markup by default', () => {
        const html = buildViewHtml(projStore(), bulletView(), 'en')
        expect(html).toContain('class="ve-item"')
        expect(html).not.toContain('class="ve-item ve-bulleted"')
        expect(html).not.toContain('<span class="ve-bullet"')
      })

      it('wraps each item with a glyph column when bullets are on', () => {
        const html = buildViewHtml(projStore(), bulletView({ item_bullets: true, bullet_style: 'arrow' }), 'en')
        expect(html).toContain('ve-item ve-bulleted')
        expect(html).toContain('<span class="ve-bullet" aria-hidden="true">›</span>')
        expect(html).toContain('class="ve-item-main"')
        // The content (heading + body) lives inside the aligned column.
        expect(html).toMatch(/ve-item-main">[\s\S]*Acme[\s\S]*Did things\./)
      })

      it('a section override turns bullets off under a bulleted view', () => {
        const view = makeView({
          sections: [{ key: 'projects', detail: 'full' as const, sort_order: 0, style: { item_bullets: false } }],
          style: { ...DEFAULT_VIEW_STYLE, item_bullets: true },
        })
        const html = buildViewHtml(projStore(), view, 'en')
        expect(html).not.toContain('class="ve-item ve-bulleted"')
        expect(html).not.toContain('<span class="ve-bullet"')
        expect(html).toContain('class="ve-item"')
      })
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

describe('escapeHtml()', () => {
  /**
   * SECURITY. The primary defence for the generated document, and until now it
   * was only ever exercised through buildViewHtml's script-injection cases —
   * which pin `<` and `>` and nothing else. Three of the five characters it
   * escapes had no assertion anywhere in the suite.
   */
  it('escapes all five of the characters it claims to', () => {
    expect(escapeHtml('&')).toBe('&amp;')
    expect(escapeHtml('<')).toBe('&lt;')
    expect(escapeHtml('>')).toBe('&gt;')
    expect(escapeHtml('"')).toBe('&quot;')
    expect(escapeHtml("'")).toBe('&#39;')
  })

  it('escapes the ampersand FIRST, so an entity cannot be reconstructed', () => {
    // The ordering property is the whole reason & is in the set: if `<` were
    // escaped before `&`, then the input `&lt;script&gt;` would come out as
    // literal `<script>` in the document. Escaping & first makes it inert.
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;')
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })

  it('closes the attribute-breakout route in both quote styles', () => {
    // A value interpolated into an attribute must not be able to end it and
    // start an event handler.
    expect(escapeHtml('" onload="alert(1)')).not.toContain('"')
    expect(escapeHtml("' onload='alert(1)")).not.toContain("'")
  })

  it('replaces EVERY occurrence, not just the first', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;')
    expect(escapeHtml('a & b & c')).toBe('a &amp; b &amp; c')
  })

  it('leaves ordinary text — including non-ASCII — untouched', () => {
    expect(escapeHtml('Ærlig Ståle — Kunde AS')).toBe('Ærlig Ståle — Kunde AS')
  })

  it('is empty for nullish and empty input, never "null"', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml('')).toBe('')
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

  it('anchors at the START, so a prefix cannot smuggle the allowlisted part in', () => {
    // SECURITY: without the ^ anchor every one of the rejections above still
    // passes, because they contain no allowlisted substring — so the anchor
    // itself was unpinned. These are the strings that need it: the scheme the
    // browser acts on is the one at the front.
    expect(isDataImage('javascript:alert(1)//data:image/png;base64,AAAA')).toBe(false)
    expect(isDataImage(' data:image/png;base64,AAAA')).toBe(false)
    expect(isDataImage('https://evil.test/#data:image/png;base64,AAAA')).toBe(false)
  })

  it('requires the separator that ends the media type', () => {
    // 'data:image/pngx' must not read as PNG, and both legal separators after
    // the media type — ';' before parameters and ',' before inline data — are
    // accepted.
    expect(isDataImage('data:image/png,AAAA')).toBe(true)
    expect(isDataImage('data:image/pngx;base64,AAAA')).toBe(false)
    expect(isDataImage('data:image/png')).toBe(false)
  })
})

// ─── New sections + promoted projects (follow-up features) ────────────────────

describe('key_competencies & recommendations rendering', () => {
  it('renders the selected profile bundle\'s key_competencies (title + description)', () => {
    const store = emptyStore()
    store.key_competencies.push(makeKeyCompetency({
      id: 'c1', title: { en: 'Architecture' }, description: { en: 'Designs scalable systems' },
    }))
    // Shape v12: a competency only renders when it's in the selected profile's bundle.
    store.key_qualifications.push(makeKQ({ id: 'p1', tag_line: { en: 'Architect' }, competency_ids: ['c1'] }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('Architecture')
    expect(html).toContain('Designs scalable systems')
  })

  it('shows exactly the selected profile\'s bundle, in bundle order, and hides others', () => {
    const store = emptyStore()
    store.key_competencies.push(
      makeKeyCompetency({ id: 'c1', title: { en: 'Alpha' } }),
      makeKeyCompetency({ id: 'c2', title: { en: 'Beta' } }),
      makeKeyCompetency({ id: 'c3', title: { en: 'Gamma' } }),
    )
    // p1 (the first, selected) bundles c3 then c1 — c2 belongs to p2 only.
    store.key_qualifications.push(
      makeKQ({ id: 'p1', tag_line: { en: 'One' }, competency_ids: ['c3', 'c1'] }),
      makeKQ({ id: 'p2', tag_line: { en: 'Two' }, competency_ids: ['c2'] }),
    )
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('Gamma')
    expect(html).toContain('Alpha')
    expect(html).not.toContain('Beta') // c2 is in p2's bundle, not the selected p1
    // Bundle order: Gamma (c3) precedes Alpha (c1).
    expect(html.indexOf('Gamma')).toBeLessThan(html.indexOf('Alpha'))
  })

  it('renders no competencies when the view selects a profile whose bundle is empty', () => {
    const store = emptyStore()
    store.key_competencies.push(makeKeyCompetency({ id: 'c1', title: { en: 'Orphan' } }))
    store.key_qualifications.push(makeKQ({ id: 'p1', tag_line: { en: 'Empty' }, competency_ids: [] }))
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).not.toContain('Orphan')
  })

  it('drops a bundle member that is disabled, excluded or unstarred', () => {
    // Three independent filters on the bundle, each of which can stop running
    // without the others noticing — and each puts something in a client-facing
    // document that the user took out.
    const store = emptyStore()
    store.key_competencies.push(
      makeKeyCompetency({ id: 'c1', title: { en: 'Keeper' }, starred: true }),
      makeKeyCompetency({ id: 'c2', title: { en: 'Disabled one' }, disabled: true, starred: true }),
      makeKeyCompetency({ id: 'c3', title: { en: 'Excluded one' }, starred: true }),
      makeKeyCompetency({ id: 'c4', title: { en: 'Unstarred one' }, starred: false }),
    )
    store.key_qualifications.push(makeKQ({
      id: 'p1', tag_line: { en: 'Profile' }, competency_ids: ['c1', 'c2', 'c3', 'c4'],
    }))

    const view = makeView({
      sections: buildViewSections(),
      excluded_item_ids: ['c3'],
      starred_only: true,
    })
    const html = buildViewHtml(store, view, 'en')

    expect(html).toContain('Keeper')
    expect(html).not.toContain('Disabled one')
    expect(html).not.toContain('Excluded one')
    expect(html).not.toContain('Unstarred one')
  })

  it('carries no competencies at all when the section is turned off', () => {
    // Asserted on the FILTERED STORE, not the HTML: the renderer skips an
    // "off" section regardless, so a page-level check passes even when the
    // data is still in there for every other consumer of applyView — the ATS
    // text export, the DOCX builder, the tailoring pass.
    const store = emptyStore()
    store.key_competencies.push(makeKeyCompetency({ id: 'c1', title: { en: 'Hidden' } }))
    store.key_qualifications.push(makeKQ({ id: 'p1', competency_ids: ['c1'] }))
    const view = makeView({
      sections: buildViewSections().map((s) => (
        s.key === 'key_competencies' ? { ...s, detail: 'off' as const } : s
      )),
    })
    expect(applyView(store, view).key_competencies).toEqual([])
    expect(buildViewHtml(store, view, 'en')).not.toContain('Hidden')
  })

  it('ignores a bundle id whose competency has been deleted', () => {
    const store = emptyStore()
    store.key_competencies.push(makeKeyCompetency({ id: 'c1', title: { en: 'Present' } }))
    store.key_qualifications.push(makeKQ({ id: 'p1', competency_ids: ['c1', 'deleted-since'] }))
    expect(() => buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')).not.toThrow()
    expect(buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')).toContain('Present')
  })

  it('presents exactly one profile even when several survive the filter', () => {
    // The editor renders profiles as radios; a newly added profile is in no
    // view's exclusion list yet, and would otherwise surface as a second
    // opening block in every existing view.
    const store = emptyStore()
    store.key_qualifications.push(
      makeKQ({ id: 'p1', tag_line: { en: 'First profile' }, summary: { en: 'One.' } }),
      makeKQ({ id: 'p2', tag_line: { en: 'Second profile' }, summary: { en: 'Two.' } }),
    )
    const html = buildViewHtml(store, makeView({ sections: buildViewSections() }), 'en')
    expect(html).toContain('One.')
    expect(html).not.toContain('Two.')
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

describe('hidden section heading keeps a top margin', () => {
  it('tags a heading-hidden section so it does not crowd the previous one', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ employer: { en: 'Acme' } }))
    const view = makeView({
      sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0, style: { hide_heading: true } }],
    })
    const html = buildViewHtml(store, view, 'en')
    // The <section> carries the marker class (which owns the top margin)...
    expect(html).toContain('ve-sec-work_experiences ve-section-noheading')
    // ...and the stylesheet defines that margin.
    expect(html).toContain('.ve-section-noheading { margin-top:')
    // No heading element for the hidden section.
    expect(html).not.toMatch(/<h2[^>]*>\s*Employment/)
  })

  it('leaves a section with a visible heading untagged', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ employer: { en: 'Acme' } }))
    const view = makeView({ sections: [{ key: 'work_experiences', detail: 'full' as const, sort_order: 0 }] })
    const html = buildViewHtml(store, view, 'en')
    // Class list is exactly the two base classes — no noheading marker.
    expect(html).toContain('<section class="ve-section ve-sec-work_experiences">')
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

describe('single profile per view + tag-line title', () => {
  const storeWith = (kqs: Array<Parameters<typeof makeKQ>[0]>) => {
    const store = emptyStore()
    store.resume = makeResume({ title: { en: 'Master Title' } })
    store.key_qualifications = kqs.map((o) => makeKQ(o))
    return store
  }

  it('applyView keeps only the first non-excluded profile (fixes the surprise 2nd block)', () => {
    const store = storeWith([
      { id: 'k1', tag_line: { en: 'Architect' } },
      { id: 'k2', tag_line: { en: 'Leader' } },
    ])
    const view = makeView({})
    expect(applyView(store, view).key_qualifications.map((k) => k.id)).toEqual(['k1'])
  })

  it('excluding the first profile promotes the next one', () => {
    const store = storeWith([
      { id: 'k1', tag_line: { en: 'Architect' } },
      { id: 'k2', tag_line: { en: 'Leader' } },
    ])
    const view = makeView({ excluded_item_ids: ['k1'] })
    expect(applyView(store, view).key_qualifications.map((k) => k.id)).toEqual(['k2'])
  })

  it('viewProfileTagLine returns the shown profile’s tag line', () => {
    const store = storeWith([
      { id: 'k1', tag_line: { en: 'Architect' } },
      { id: 'k2', tag_line: { en: 'Leader' } },
    ])
    expect(viewProfileTagLine(store, makeView({}), 'en')).toBe('Architect')
    expect(viewProfileTagLine(store, makeView({ excluded_item_ids: ['k1'] }), 'en')).toBe('Leader')
  })

  it('the view header title defaults to the selected profile’s tag line, not the master title', () => {
    const store = storeWith([{ id: 'k1', tag_line: { en: 'Cloud Architect' } }])
    const html = buildViewHtml(store, makeView({}), 'en')
    expect(html).toContain('Cloud Architect')
    expect(html).not.toContain('Master Title')
  })

  it('falls back to the master title when there is no profile', () => {
    const store = emptyStore()
    store.resume = makeResume({ title: { en: 'Master Title' } })
    const html = buildViewHtml(store, makeView({}), 'en')
    expect(html).toContain('Master Title')
  })
})

/**
 * The per-section visual chrome. dividerRule had 20 mutants no test reached
 * and 6 killed — every style but 'dashed' was unexercised, and they all render
 * *something*, so a swap between them is invisible to a test that only checks
 * markup came back.
 */
describe('section divider styles', () => {
  const cssFor = (over: Record<string, unknown>): string => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'X' })
    store.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' } })]
    return buildViewHtml(store, makeView({
      sections: [{ key: 'work_experiences', detail: 'full', sort_order: 0, style: over as never }],
    }), 'en')
  }

  it('draws each divider style differently', () => {
    // Every case returns a border, so the risk is one case falling through to
    // another — which no "has a border" assertion would notice.
    expect(cssFor({ item_divider: true, divider_style: 'thick' })).toMatch(/border-bottom:\s*2px solid/)
    expect(cssFor({ item_divider: true, divider_style: 'dashed' })).toMatch(/border-bottom:\s*1px dashed/)
    expect(cssFor({ item_divider: true, divider_style: 'dotted' })).toMatch(/border-bottom:\s*1px dotted/)
    expect(cssFor({ item_divider: true, divider_style: 'double' })).toMatch(/border-bottom:\s*3px double/)
    expect(cssFor({ item_divider: true, divider_style: 'line' })).toMatch(/border-bottom:\s*1px solid/)
  })

  it('draws the short rule as a background gradient, not a border', () => {
    // A border cannot be width-limited, which is the whole reason this case
    // exists — so it must NOT also emit a border.
    const css = cssFor({ item_divider: true, divider_style: 'short' })
    expect(css).toMatch(/background-image:\s*linear-gradient/)
    expect(css).toMatch(/background-size:\s*48px 1px/)
    expect(css).toMatch(/\.ve-item\s*\{[^}]*border-bottom:\s*none/)
  })

  it('draws nothing at all for space', () => {
    const css = cssFor({ item_divider: true, divider_style: 'space' })
    expect(css).toMatch(/\.ve-item\s*\{[^}]*border-bottom:\s*none/)
    expect(css).not.toMatch(/linear-gradient/)
  })

  it('suppresses the rule entirely when item_divider is off, whatever the style', () => {
    const css = cssFor({ item_divider: false, divider_style: 'thick' })
    expect(css).not.toMatch(/border-bottom:\s*2px solid/)
    expect(css).toMatch(/\.ve-item\s*\{[^}]*padding-bottom:\s*0px/)
  })
})

describe('tabulated summary — the grid', () => {
  const store = () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    return s
  }
  const tabulated = (s: ReturnType<typeof store>) => buildViewHtml(s, makeView({
    sections: [{ key: 'work_experiences', detail: 'summary', sort_order: 0, style: { tabulate: true } as never }],
  }), 'en')

  it('inserts a separator column only BETWEEN start and end', () => {
    const s = store()
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
    })]
    const html = tabulated(s)
    // Count the rendered SPANS, not the class name — it also appears in the
    // stylesheet, which would make any count off by the CSS rules.
    expect((html.match(/<span class="ve-tab-sep">/g) ?? []).length).toBe(1)
  })

  it('leaves the separator EMPTY for a row missing one side of the range', () => {
    // The column still exists so the grid stays aligned, but a lone "·" beside
    // a single date reads as a broken range.
    const s = store()
    s.work_experiences = [
      makeWork({ id: 'w1', employer: { en: 'Acme' }, start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 } }),
      makeWork({ id: 'w2', employer: { en: 'Beta' }, start: null as never, end: null as never }),
    ]
    const html = tabulated(s)
    expect(html).toContain('<span class="ve-tab-sep">·</span>')
    expect(html).toContain('<span class="ve-tab-sep"></span>')
  })

  it('gives text columns a flexible track and date columns a rigid one', () => {
    // Computed from column KINDS only — the comment says it is safe to inline
    // BECAUSE it never touches user data, so the shape is worth pinning.
    const s = store()
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
    })]
    // The GRID DIV's inline style, not the stylesheet's own grid rules.
    const m = /<div class="ve-tab-grid" style="grid-template-columns:([^"]+)">/.exec(tabulated(s))
    expect(m).not.toBeNull()
    // employer + start + sep + end → one flexible text track, three rigid ones.
    expect(m![1]).toContain('minmax(0, max-content)')
    expect(m![1].split(' ').filter((t) => t === 'max-content').length).toBeGreaterThan(0)
  })

  it('keeps a blank item as a labelled row rather than an empty one', () => {
    // The descriptor supplies a fallback title, so the grid is never empty —
    // an item with nothing filled in still occupies a row you can see and fix,
    // instead of silently vanishing from the export.
    const s = store()
    s.work_experiences = [makeWork({ id: 'w1', employer: {}, role_title: {}, start: null as never, end: null as never })]
    const html = tabulated(s)
    expect(html).toContain('<span class="ve-tab-title">Role</span>')
    // One column only — nothing else had a value, so no empty date tracks.
    const m = /<div class="ve-tab-grid" style="grid-template-columns:([^"]+)">/.exec(html)
    expect(m![1].trim()).toBe('minmax(0, max-content)')
  })

  it('escapes each line and then joins with its OWN <br>, never the reverse', () => {
    // SECURITY: a part may carry newlines (the Languages Europass column). If
    // the join happened first, the <br> would be escaped and the payload would
    // not — this asserts the order.
    const s = store()
    s.spoken_languages = [makeSpokenLanguage({
      id: 'l1', name: { en: 'English\n<img src=x onerror=alert(1)>' }, level: { en: 'Native' },
    })]
    const html = buildViewHtml(s, makeView({
      sections: [{ key: 'spoken_languages', detail: 'summary', sort_order: 0, style: { tabulate: true } as never }],
    }), 'en')
    expect(html).toContain('<br>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })
})

/**
 * The skill matrix in the HTML adapter — the one the consultant actually looks
 * at while editing, and the only one of the four that had no test.
 *
 * That is worth stating plainly: the DOCX, PDF and both text renderings of this
 * table are now pinned, and the live preview was left as the gap. Its cells
 * also carry the escaping ("All cell values are escaped right here — keep it
 * that way"), which nothing checked.
 */
describe('skill matrix — the HTML adapter', () => {
  const matrixStore = (withCategory = false): ResumeStore => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'Kari Nordmann' })
    if (withCategory) store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    store.skills.push(makeSkill({
      id: 'ts', name: { en: 'TypeScript' }, total_duration_in_years: 8, proficiency: 4,
      category_id: withCategory ? 'cat1' : null,
    }))
    return store
  }
  const matrixView = (over: Record<string, unknown> = {}) => makeView({
    sections: buildViewSections().map((s) =>
      s.key === 'skill_matrix' ? { ...s, detail: 'full' as const, style: { ...s.style, ...over } } : s),
  })
  const html = (store = matrixStore(), view = matrixView()) => buildViewHtml(store, view, 'en')
  /** The matrix table's cell text, in document order. */
  const cells = (out: string): string[] =>
    [...(/<table class="ve-matrix">[\s\S]*?<\/table>/.exec(out)?.[0] ?? '')
      .matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/g)].map((m) => m[1])

  it('writes a header row and one row per skill', () => {
    const c = cells(html())
    expect(c.slice(0, 4)).toEqual(['Skill', 'Experience', 'Proficiency', 'Last used'])
    expect(c.slice(4, 8)).toEqual(['TypeScript', '8 yrs', '4/5', ''])
  })

  it('adds the Category column only when a row has one', () => {
    expect(cells(html(matrixStore(true))).slice(0, 5))
      .toEqual(['Skill', 'Category', 'Experience', 'Proficiency', 'Last used'])
    expect(cells(html())[1]).toBe('Experience')
  })

  it('drops the Last used column when the section hides dates', () => {
    const c = cells(html(matrixStore(), matrixView({ hide_dates: true })))
    expect(c.slice(0, 3)).toEqual(['Skill', 'Experience', 'Proficiency'])
    expect(c).not.toContain('Last used')
  })

  it('localizes the column headings', () => {
    const out = buildViewHtml(matrixStore(), matrixView(), 'no')
    expect(cells(out).slice(0, 4)).toEqual(['Ferdighet', 'Erfaring', 'Nivå', 'Sist brukt'])
  })

  it('summary detail shows only HIGHLIGHTED skills; full shows every one', () => {
    // The section's two detail levels mean different things here than
    // elsewhere: 'full' is every skill, 'summary' is the highlighted ones. A
    // view set to summary that still listed everything would leak the whole
    // registry into a deliberately short CV.
    const s = matrixStore()
    s.skills.push(makeSkill({
      id: 'go', name: { en: 'Go' }, total_duration_in_years: 2, proficiency: 3,
      is_highlighted: true,
    }))
    const view = (detail: 'full' | 'summary') => makeView({
      sections: buildViewSections().map((x) =>
        x.key === 'skill_matrix' ? { ...x, detail } : x),
    })
    expect(cells(buildViewHtml(s, view('full'), 'en'))).toContain('TypeScript')
    const summary = cells(buildViewHtml(s, view('summary'), 'en'))
    expect(summary).toContain('Go')
    expect(summary).not.toContain('TypeScript')
  })

  it('renders no section at all when the registry has no skills', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    // The rendered TABLE, not the class name — that also appears in the
    // stylesheet, which is always emitted.
    expect(html(s)).not.toContain('<table class="ve-matrix">')
  })

  it('SECURITY: escapes every cell, including the heading row', () => {
    // The values reach the document through string interpolation rather than
    // through renderItem, so this table has its own escaping to get wrong.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.skill_categories = [makeSkillCategory({ id: 'c1', name: { en: '<img src=x onerror=alert(1)>' } })]
    s.skills.push(makeSkill({
      id: 'evil', name: { en: '<script>alert(1)</script>' }, category_id: 'c1',
      total_duration_in_years: 3, proficiency: 2,
    }))
    const out = html(s)
    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&lt;img')
  })

  it('agrees cell for cell with the DOCX and PDF adapters', () => {
    // One descriptor, every adapter (§7.7). This is the assertion that notices
    // when one of the four grows or loses a column — the same check the DOCX
    // and PDF pair already carry, now extended to the preview.
    const store = matrixStore(true)
    const view = matrixView()
    expect(cells(buildViewHtml(store, view, 'en'))).toEqual([
      'Skill', 'Category', 'Experience', 'Proficiency', 'Last used',
      'TypeScript', 'Languages', '8 yrs', '4/5', '',
    ])
  })
})

/**
 * The preview header's photo and logo layout.
 *
 * `photoBesideName` was entirely uncovered, and the three placements it chooses
 * between produce visibly different documents: the "…_of_name" pair sits the
 * photo beside the NAME AND TITLE only, with contact details on their own
 * full-width row below, while every other placement keeps the whole identity
 * block together.
 */
describe('buildViewHtml — header photo and logo placement', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='

  const store = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({
      full_name: 'Kari Nordmann', title: { en: 'Architect' },
      phone: '+47 900 00 000', profile_photo: PNG, company_logo: PNG, ...over,
    })
    return s
  }
  /**
   * The rendered markup with the <style> block removed.
   *
   * Every class asserted below is also a CSS selector in the always-emitted
   * stylesheet, so a whole-document search finds the rule and proves nothing
   * about what was rendered.
   */
  const out = (header: Record<string, unknown>, s = store()) =>
    buildViewHtml(s, makeView({ sections: buildViewSections(), header: withHeaderDefaults(header as never) }), 'en')
      .replace(/<style[\s\S]*?<\/style>/g, '')

  /** Where the photo sits relative to the identity block, structurally. */
  const photoRow = (html: string) => /<div class="ve-nametitle-row">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[0] ?? ''

  it('puts the photo in its own name+title row for the …_of_name placements', () => {
    for (const placement of ['left_of_name', 'right_of_name']) {
      const html = out({ photo_placement: placement })
      expect(html, placement).toContain('ve-nametitle-row')
      // The contact block sits OUTSIDE that row — that is the whole difference.
      expect(photoRow(html), placement).not.toContain('ve-header-contact')
      expect(html, placement).toContain('ve-header-contact')
    }
  })

  it('keeps the identity block whole for the ordinary placements', () => {
    for (const placement of ['left', 'right', 'below']) {
      const html = out({ photo_placement: placement })
      expect(html, placement).not.toContain('ve-nametitle-row')
      expect(html, placement).toContain('ve-header-contact')
    }
  })

  it('puts the photo AFTER the identity for "below" and before it otherwise', () => {
    const below = out({ photo_placement: 'below' })
    expect(below.indexOf('ve-photo ')).toBeGreaterThan(below.indexOf('ve-identity'))
    const left = out({ photo_placement: 'left' })
    expect(left.indexOf('ve-photo ')).toBeLessThan(left.indexOf('ve-identity'))
  })

  it('renders no photo when the placement is none', () => {
    expect(out({ photo_placement: 'none' })).not.toContain('<img class="ve-photo')
  })

  it('SECURITY: refuses a photo that is not a raster data URL', () => {
    // isDataImage is the guard; an http(s) URL or an SVG payload must not reach
    // the document even with a placement asking for one.
    for (const bad of ['https://evil.test/x.png', 'data:image/svg+xml,<svg onload=alert(1)>']) {
      const html = out({ photo_placement: 'left' }, store({ profile_photo: bad }))
      expect(html, bad).not.toContain('<img class="ve-photo')
    }
  })

  it('prefers the view’s photo override over the resume photo', () => {
    const s = store({ profile_photo: null })
    expect(out({ photo_placement: 'left', photo_override: PNG }, s)).toContain('<img class="ve-photo')
  })

  it('places the logo banner by its own setting, and hides it when none', () => {
    expect(out({ logo_placement: 'center' })).toContain('ve-logo-center')
    expect(out({ logo_placement: 'right' })).toContain('ve-logo-right')
    expect(out({ logo_placement: 'none' })).not.toContain('ve-logo-banner')
  })

  it('SECURITY: refuses a logo that is not a raster data URL', () => {
    const s = store({ company_logo: 'https://evil.test/logo.png' })
    expect(out({ logo_placement: 'center' }, s)).not.toContain('ve-logo-banner')
  })

  it('honours the header’s font-size overrides for the name and title', () => {
    const html = out({
      photo_placement: 'none',
      name_style: { size_pt: 33, font: 'body' },
      title_style: { size_pt: 21, font: 'body' },
    })
    expect(html).toContain('font-size:33pt')
    expect(html).toContain('font-size:21pt')
  })

  it('omits the title element entirely when nothing supplies one', () => {
    const s = store({ title: {} })
    expect(out({ photo_placement: 'none' }, s)).not.toContain('ve-header-title')
  })
})

/**
 * The one-line summary's joiners.
 *
 * Every joiner here is a different punctuation mark chosen for a reason, and
 * they all render, so a swap between them is invisible to a test that only
 * checks the words came out. The rule that earns the code is `titleFirst`:
 * it keys off what actually RENDERED first, not the configured slot order, so
 * a section with no dates still reads "Norwegian — Native" rather than
 * "· Native" under a date-first layout.
 */
describe('buildViewHtml — the inline summary joiners', () => {
  const summaryHtml = (store: ResumeStore, key: string, style: Record<string, unknown> = {}) =>
    buildViewHtml(store, makeView({
      sections: [{ key, detail: 'summary', sort_order: 0, style } as never],
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')

  const workStore = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, role_title: { en: 'Architect' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 }, ...over,
    })]
    return s
  }

  it('joins the two date parts with a DASH, not a middot', () => {
    // Within the date slot the parts read as a range; a middot there says
    // "two separate dates", which is a different claim.
    const html = summaryHtml(workStore(), 'work_experiences')
    expect(html).toMatch(/2020[^<]*–[^<]*2021/)
  })

  it('joins distinct non-date parts with a middot', () => {
    const html = summaryHtml(workStore(), 'work_experiences')
    expect(html).toContain(' · ')
  })

  it('uses an em-dash after a leading TITLE, and a middot otherwise', () => {
    // The classic "Title — meta" look, but ONLY when the title actually leads.
    // The default layout is date-title-org, so the dash appears under a
    // title-leading layout and a middot under the default.
    const titleFirst = summaryHtml(workStore(), 'work_experiences', { summary_layout: 'title-org-date' })
    expect(titleFirst).toContain('</strong> — ')

    const dateFirst = summaryHtml(workStore(), 'work_experiences')
    expect(dateFirst).not.toContain('</strong> — ')
    expect(dateFirst).toContain('</span> · <strong>')
  })

  it('does NOT open with a joiner when the title does not lead', () => {
    // A date-first layout on a section that has no dates would otherwise start
    // the line with a bare separator.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: { en: 'Native' } })]
    const html = summaryHtml(s, 'spoken_languages', { summary_layout: 'date-title-org' })
    const line = /<div class="ve-item ve-item-line">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
    expect(line.trimStart().startsWith('·')).toBe(false)
    expect(line.trimStart().startsWith('—')).toBe(false)
    expect(line).toContain('Norwegian')
    expect(line).toContain('Native')
  })

  it('wraps the TITLE slot in <strong> and the others in a meta span', () => {
    // For Employment the title slot is the ROLE; the employer is the org slot.
    const html = summaryHtml(workStore(), 'work_experiences')
    expect(html).toContain('<strong>Architect</strong>')
    expect(html).toContain('<span class="ve-meta-inline">Acme</span>')
  })

  it('renders nothing for an item with neither parts nor a short description', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: {}, role_title: {}, short_description: {},
      start: null as never, end: null as never,
    })]
    // The descriptor supplies a fallback title, so the line is not empty — but
    // it must not be a bare joiner either.
    const line = /<div class="ve-item ve-item-line">([\s\S]*?)<\/div>/.exec(summaryHtml(s, 'work_experiences'))?.[1] ?? ''
    expect(line.trim().startsWith('·')).toBe(false)
  })

  it('never renders a doubled or trailing separator', () => {
    // The parts themselves are pre-filtered upstream — summaryOf only pushes a
    // part when its value is non-empty — so this is a property of the finished
    // line rather than a test of the join. It is still what a reader would
    // notice: "Acme ·  · 2020", or a line ending in a bare middot.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: { en: 'Native' } })]
    const line = /<div class="ve-item ve-item-line">([\s\S]*?)<\/div>/.exec(summaryHtml(s, 'spoken_languages'))?.[1] ?? ''
    expect(line).toContain('Native')
    expect(line.trimEnd().endsWith('·')).toBe(false)

    expect(summaryHtml(workStore({ role_title: {} }), 'work_experiences')).not.toContain(' ·  · ')
  })
})

describe('buildViewHtml — the footer', () => {
  const out = (footer: Record<string, unknown>) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    return buildViewHtml(s, makeView({
      sections: buildViewSections(), footer: withFooterDefaults(footer as never),
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')
  }

  it('renders for a separator alone, even with no text', () => {
    // The separator IS the footer in that case — a closing rule with nothing
    // under it is a deliberate look.
    expect(out({ separator: 'line', copyright: 'none' })).toContain('<footer')
  })

  it('renders for text alone, with no separator', () => {
    expect(out({ separator: 'none', copyright: 'person' })).toContain('<footer')
  })

  it('renders nothing when there is neither', () => {
    expect(out({ separator: 'none', copyright: 'none' })).not.toContain('<footer')
  })

  it('carries the separator style as a class', () => {
    expect(out({ separator: 'dashed', copyright: 'none' })).toContain('ve-footer-dashed')
  })

  it('SECURITY: escapes the finished footer line, not its parts', () => {
    // The placement joins with our own separators, so escaping the parts first
    // would double-escape and escaping never would let a note through.
    const html = out({ separator: 'line', copyright: 'custom', copyright_custom: { en: '<script>alert(1)</script>' } })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

/**
 * The full-item layouts.
 *
 * `date_position` chooses between four arrangements of the same three pieces,
 * and every one of them renders — so a layout collapsing into another is
 * invisible to any assertion that the content came out. The two axes are
 * independent: whether the DATE leads the meta line, and whether the meta line
 * leads the TITLE.
 */
describe('buildViewHtml — full-item layouts', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, role_title: { en: 'Architect' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
      // Plain, not markup: renderRichHtml needs a DOM and this suite is node.
      long_description: { en: 'Did the work.' },
    })]
    return s
  }
  const render = (style: Record<string, unknown> = {}) =>
    buildViewHtml(store(), makeView({
      sections: [{ key: 'work_experiences', detail: 'full', sort_order: 0, style } as never],
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')

  const item = (html: string) => /<div class="ve-item[^"]*">([\s\S]*?)<\/div>\s*<\/section>/.exec(html)?.[1] ?? html

  it('puts the title before the meta line by default', () => {
    const body = item(render({ date_position: 'title-org-date' }))
    expect(body.indexOf('<h3>')).toBeLessThan(body.indexOf('ve-meta'))
  })

  it('puts the meta line ABOVE the title for the lead-* layouts', () => {
    for (const layout of ['lead-org-date', 'lead-date-org']) {
      const body = item(render({ date_position: layout }))
      expect(body.indexOf('ve-meta'), layout).toBeLessThan(body.indexOf('<h3>'))
    }
  })

  it('puts the date first in the meta line for the *-date-org layouts', () => {
    for (const layout of ['title-date-org', 'lead-date-org']) {
      const meta = /<div class="ve-meta">([^<]*)<\/div>/.exec(render({ date_position: layout }))?.[1] ?? ''
      // In FULL detail the EMPLOYER is the heading and the role sits in the
      // meta line — the reverse of the summary path, where the role is the
      // title slot.
      expect(meta, layout).toMatch(/^\s*Jan 2020/)
      expect(meta, layout).toContain('Architect')
    }
  })

  it('puts the date last for the *-org-date layouts', () => {
    for (const layout of ['title-org-date', 'lead-org-date']) {
      const meta = /<div class="ve-meta">([^<]*)<\/div>/.exec(render({ date_position: layout }))?.[1] ?? ''
      expect(meta, layout).toMatch(/2021\s*$/)
      expect(meta, layout).toMatch(/^\s*Architect/)
    }
  })

  it('the two axes are independent — lead-date-org does BOTH', () => {
    // The one combination that catches a layout collapsing into its neighbour.
    const html = render({ date_position: 'lead-date-org' })
    const body = item(html)
    expect(body.indexOf('ve-meta')).toBeLessThan(body.indexOf('<h3>'))
    expect(/<div class="ve-meta">([^<]*)<\/div>/.exec(html)![1]).toMatch(/^\s*Jan 2020/)
  })

  it('omits the meta line entirely when there is nothing for it', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, role_title: {},
      start: null as never, end: null as never,
    })]
    const html = buildViewHtml(s, makeView({
      sections: [{ key: 'work_experiences', detail: 'full', sort_order: 0 } as never],
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')
    expect(html).not.toContain('<div class="ve-meta">')
  })

  it('drops an empty meta part rather than joining around it', () => {
    // A hidden date must not leave "Acme · " behind.
    const meta = /<div class="ve-meta">([^<]*)<\/div>/.exec(render({ hide_dates: true }))?.[1] ?? ''
    expect(meta.trim()).toBe('Architect')
  })

  it('wraps the item in the bullet layout only when bullets are on', () => {
    // Off by default, so the plain .ve-item markup stays unchanged.
    expect(render({ item_bullets: true })).toContain('ve-bulleted')
    expect(render({ item_bullets: true })).toContain('ve-bullet"')
    expect(render({})).not.toContain('ve-bulleted')
  })
})

describe('buildViewHtml — the inline and quote item layouts', () => {
  const strip = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, '')

  it('renders a language as one inline line, meta after an em-dash', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: { en: 'Native' } })]
    const html = strip(buildViewHtml(s, makeView({
      sections: [{ key: 'spoken_languages', detail: 'full', sort_order: 0 } as never],
    }), 'en'))
    expect(html).toContain('ve-inline')
    expect(html).toContain('<strong>Norwegian</strong> — Native')
  })

  it('omits the em-dash when a language has no level', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: {} })]
    const html = strip(buildViewHtml(s, makeView({
      sections: [{ key: 'spoken_languages', detail: 'full', sort_order: 0 } as never],
    }), 'en'))
    expect(html).toContain('<strong>Norwegian</strong></div>')
  })

  it('renders a recommendation as a quote with its attribution', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.recommendations = [makeRecommendation({
      id: 'r1', recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' },
      text: { en: 'Excellent to work with.' },
    })]
    const html = strip(buildViewHtml(s, makeView({
      sections: [{ key: 'recommendations', detail: 'full', sort_order: 0 } as never],
    }), 'en'))
    expect(html).toContain('ve-rec-quote')
    expect(html).toContain('Excellent to work with.')
    expect(html).toContain('— Jane Boss')
    expect(html).toContain('CTO')
  })

  it('omits the attribution meta span when there is none', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.recommendations = [makeRecommendation({
      id: 'r1', recommender_name: 'Jane Boss', recommender_title: {}, relationship: {},
      text: { en: 'Great.' },
    })]
    const html = strip(buildViewHtml(s, makeView({
      sections: [{ key: 'recommendations', detail: 'full', sort_order: 0 } as never],
    }), 'en'))
    expect(html).toContain('— Jane Boss')
    expect(html).not.toContain('<span class="ve-meta-inline">')
  })
})

/**
 * The render geometry, in numbers.
 *
 * Every gap below is derived from ONE token (itemGapPx, 14px at the default
 * "normal" density) by a documented relation: a section heading gets two gaps
 * above it, a tabulated row gap is half an item gap with a 2px floor, and its
 * divider padding is half of that with a 1px floor. Asserting only that "some
 * number came out" lets any of those relations invert unnoticed — and the
 * result is a document whose spacing no longer reads as a hierarchy.
 */
describe('buildViewHtml — the spacing arithmetic', () => {
  const styleBlock = (style: Record<string, unknown> = {}, sectionStyle: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, role_title: { en: 'Architect' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
    })]
    const html = buildViewHtml(s, makeView({
      style: style as never,
      sections: [{ key: 'work_experiences', detail: 'summary', sort_order: 0, style: sectionStyle } as never],
    }), 'en')
    return /<style[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
  }

  it('gives a section heading TWO item gaps above it', () => {
    // 14px at the default density: the space above a heading has to read as
    // bigger than the space between two items under it.
    expect(styleBlock()).toContain('margin: 28px 0')
  })

  it('gives a hidden heading the same top margin the h2 would have carried', () => {
    expect(styleBlock()).toContain('.ve-section-noheading { margin-top: 28px; }')
  })

  it('makes a tabulated row gap HALF an item gap', () => {
    // The base rule, not a per-section override: the grid's own default.
    expect(styleBlock()).toContain('column-gap: 12px; row-gap: 7px;')
  })

  it('pads a tabulated divider row by half the row gap', () => {
    const css = styleBlock({}, { item_divider: true, tabulate: true })
    expect(css).toMatch(/\.ve-sec-work_experiences \.ve-tab-grid \{ row-gap: 7px; \}/)
    expect(css).toMatch(/\.ve-sec-work_experiences \.ve-tab-row \{[^}]*padding-bottom: 4px/)
  })

  it('writes an explicit "none" border when dividers are off, never undefined', () => {
    const css = styleBlock({}, { item_divider: false })
    expect(css).toMatch(/\.ve-sec-work_experiences \.ve-item \{[^}]*border-bottom: none/)
    expect(css).not.toContain('undefined')
  })

  it('emits only CSS into the style block, never stray prose', () => {
    // The per-section rules are accumulated into a list and inlined verbatim. A
    // line that is not a declaration or a selector is a parse error, and CSS
    // recovery discards through the NEXT closing brace — so one stray line
    // silently takes a whole rule with it.
    const lines = styleBlock({}, { item_divider: true }).split(String.fromCharCode(10))
    expect(lines.filter((l) => /^\s*[A-Za-z][A-Za-z ]*$/.test(l))).toEqual([])
  })

  it('sizes the header title one point above the small text size', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann', title: { en: 'Architect' } })
    const html = buildViewHtml(s, makeView({ sections: buildViewSections() }), 'en')
    const tokens = deriveTokens(withDefaults(undefined))
    const size = /class="ve-header-title"[^>]*font-size:(\d+(?:\.\d+)?)pt/.exec(html)?.[1]
      ?? /font-size:(\d+(?:\.\d+)?)pt;"[^>]*class="ve-header-title"/.exec(html)?.[1]
    expect(Number(size)).toBe(tokens.smallFontSizePt + 1)
  })

})

/**
 * The tabulated grid's date columns.
 *
 * The separator column exists so range markers line up down the grid, which
 * means it must appear exactly when a start column is followed by an end column
 * — and be EMPTY on a row that has only one of the two, or the column claims a
 * range the row does not have.
 */
describe('buildViewHtml — the tabulated date separator', () => {
  const tabulated = (works: Array<Record<string, unknown>>) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.work_experiences = works.map((over, i) =>
      makeWork({ id: `w${i}`, employer: { en: `Co${i}` }, role_title: { en: `Role${i}` }, ...over } as never))
    return buildViewHtml(s, makeView({
      sections: [{
        key: 'work_experiences', detail: 'summary', sort_order: 0,
        // Dates LAST, so an adjacent start/end pair is not the first column
        // pair — a separator inserted by position rather than by kind shows up.
        style: { tabulate: true, summary_layout: 'title-org-date' },
      } as never],
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')
  }

  it('inserts the separator column between a start and an end column', () => {
    const html = tabulated([{ start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 } }])
    expect(html).toContain('<span class="ve-tab-sep">\u00b7</span>')
  })

  it('omits the separator column when no row has a start date', () => {
    // Only an end date: there is no range to mark, and a separator column would
    // add a stray middot to every row.
    const html = tabulated([{ start: null, end: { year: 2016, month: 6 } }])
    expect(html).not.toContain('ve-tab-sep')
  })

  it('leaves the separator EMPTY on a row that has only one of the two dates', () => {
    const html = tabulated([
      { start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 } },
      { start: null, end: { year: 2016, month: 6 } },
    ])
    expect(html).toContain('<span class="ve-tab-sep">\u00b7</span>')
    expect(html).toContain('<span class="ve-tab-sep"></span>')
  })

  it('tabulates only a SUMMARY section, never a full one', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' } })]
    const html = buildViewHtml(s, makeView({
      sections: [{ key: 'work_experiences', detail: 'full', sort_order: 0, style: { tabulate: true } } as never],
    }), 'en')
    expect(html).not.toContain('ve-tab-grid"')
  })
})

/**
 * A reference the consultant has NOT cleared for export.
 *
 * `include_in_exports` is a promise made to a named third party, so the
 * descriptor returns null for that item rather than a blank row — and every
 * layer downstream has to cope with a null where a summary was expected.
 */
describe('buildViewHtml — an item the catalog declines to render', () => {
  const withRefs = (flags: boolean[], style: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.references = flags.map((include_in_exports, i) => makeReference({
      id: `r${i}`, name: `Ref ${i}`, company: 'BigCo', include_in_exports,
    }))
    return buildViewHtml(s, makeView({
      sections: [{ key: 'references', detail: 'summary', sort_order: 0, style } as never],
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')
  }

  it('renders the cleared reference and drops the other', () => {
    const html = withRefs([false, true])
    expect(html).toContain('Ref 1')
    expect(html).not.toContain('Ref 0')
  })

  it('omits the whole section when no reference is cleared', () => {
    // An empty <section> still draws its heading and its spacing, so the export
    // would show a References heading with nothing under it.
    expect(withRefs([false, false])).not.toContain('ve-sec-references')
  })

  it('drops it from the tabulated grid too', () => {
    const html = withRefs([false, true], { tabulate: true })
    expect(html).toContain('ve-tab-grid')
    expect(html).toContain('Ref 1')
    expect(html).not.toContain('Ref 0')
  })
})

describe('buildViewHtml — the summary line, in detail', () => {
  const summaryHtml = (store: ResumeStore, key: string, style: Record<string, unknown> = {}) =>
    buildViewHtml(store, makeView({
      sections: [{ key, detail: 'summary', sort_order: 0, style } as never],
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')

  const workStore = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, role_title: { en: 'Architect' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 }, ...over,
    })]
    return s
  }

  it('uses the em-dash ONLY after the leading slot, then middots', () => {
    // Three slots under a title-first layout: "Architect — Acme · 2020 – 2021".
    // Reusing the dash between the second and third slot reads as two separate
    // headings on one line.
    const line = /<div class="ve-item ve-item-line">([\s\S]*?)<\/div>/
      .exec(summaryHtml(workStore(), 'work_experiences', { summary_layout: 'title-org-date' }))?.[1] ?? ''
    expect(line.match(/ \u2014 /g)).toHaveLength(1)
    expect(line.match(/ \u00b7 /g)).toHaveLength(1)
  })

  it('uses a COLON after the leading slot where the section asks for one', () => {
    // The Skills Showcase reads "Cloud: Kubernetes, Terraform" — the category
    // labels the list rather than standing beside it.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.skill_categories = [makeSkillCategory({ id: 'c1', name: { en: 'Cloud' } })]
    s.skills = [makeSkill({ id: 'k8s', name: { en: 'Kubernetes' }, category_id: 'c1', is_highlighted: true })]
    const html = summaryHtml(s, 'technology_categories', { summary_layout: 'title-org-date' })
    expect(html).toContain('</strong>: ')
    expect(html).not.toContain('</strong> \u2014 ')
  })

  it('drops a whitespace-only short description instead of drawing its box', () => {
    for (const line of ['below', 'inline'] as const) {
      const html = summaryHtml(
        workStore({ short_description: { en: '   ' } }), 'work_experiences', { short_desc_line: line })
      expect(html, line).not.toContain('ve-summary-short')
    }
  })

  it('adds no short-description element when the item has none', () => {
    expect(summaryHtml(workStore({ short_description: {} }), 'work_experiences'))
      .not.toContain('ve-summary-short')
  })

  it('trims the short description it does render', () => {
    const html = summaryHtml(workStore({ short_description: { en: '  Ran the platform.  ' } }), 'work_experiences')
    expect(html).toContain('>Ran the platform.<')
  })
})

describe('applyView — the sections it must not touch', () => {
  it('never filters the view list itself', () => {
    // The views array is export CONFIG, not content: filtering it by the very
    // exclusion list it carries would delete the view being rendered.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    const a = makeView({ id: 'v1', name: 'Tender' })
    const b = makeView({ id: 'v2', name: 'Short' })
    s.views = [a, b]
    const out = applyView(s, makeView({ id: 'v1', excluded_item_ids: ['v1', 'v2'] }))
    expect(out.views.map((v) => v.id)).toEqual(['v1', 'v2'])
  })
})

describe('getItemSubtitle', () => {
  it('is empty for a section whose descriptor has no subtitle', () => {
    // The registries carry a title only; calling a missing subtitle would throw
    // in the picker that renders every section's items.
    expect(getItemSubtitle('industries', makeIndustry({ id: 'i1', name: { en: 'Finance' } }), 'en')).toBe('')
  })
})

describe('isDataImage', () => {
  it('accepts the abbreviated jpg spelling as well as jpeg', () => {
    // Both are written by real encoders; rejecting one silently drops the photo
    // from every export with no error anywhere.
    expect(isDataImage('data:image/jpg;base64,AAAA')).toBe(true)
    expect(isDataImage('data:image/jpeg;base64,AAAA')).toBe(true)
  })
})

describe('buildViewHtml — skill tags', () => {
  const projectHtml = (style: Record<string, unknown>, skills: Array<Record<string, unknown>>) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } }), makeSkill({ id: 'k8s', name: { en: 'Kubernetes' } })]
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Acme' },
      skills: skills.map((sk, i) => ({
        id: `ps${i}`, duration_in_years: 0, offset_in_years: 0,
        total_duration_in_years: 0, sort_order: i, ...sk,
      })) as never,
    })]
    return buildViewHtml(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0, style } as never],
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')
  }

  it('renders no tag container at all for an item with no skills', () => {
    // An empty <div class="ve-tags"> still carries the block's margin, leaving a
    // gap under the description that looks like a missing paragraph.
    expect(projectHtml({}, [])).not.toContain('ve-tags')
  })

  it('draws chips by default and an italic list when asked', () => {
    const chips = projectHtml({}, [
      { skill_id: 'go', name: { en: 'Go' } }, { skill_id: 'k8s', name: { en: 'Kubernetes' } },
    ])
    expect(chips).toContain('<span class="ve-tag">Go</span>')
    expect(chips).not.toContain('ve-tags-inline')

    const inline = projectHtml({ tag_style: 'inline' }, [
      { skill_id: 'go', name: { en: 'Go' } }, { skill_id: 'k8s', name: { en: 'Kubernetes' } },
    ])
    // LABELLED, unlike the chips: an inline list is a run of words like the one
    // every other export writes, and there the label is what says these are
    // skills rather than, say, employers. A chip shows that by its shape.
    expect(inline).toContain('<div class="ve-tags-inline">Skills: Go, Kubernetes</div>')
    expect(inline).not.toContain('<span class="ve-tag">')
  })
})

describe('buildViewHtml — a profile in summary detail shows the SHORT prose', () => {
  it('renders summary_short in summary detail and the long summary in full', () => {
    // Profiles always render as prose (alwaysFull), so the detail level chooses
    // WHICH prose. Losing that distinction puts the whole long profile into a
    // view the user set to summary.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.key_qualifications = [{
      id: 'kq1', resume_id: 'r1', label: {}, tag_line: { en: 'Architect' },
      summary: { en: 'The long profile.' }, summary_short: { en: 'The short line.' },
      key_points: [], competency_ids: [], sort_order: 0,
      starred: false, disabled: false, internal_notes: null,
    } as never]
    const render = (detail: string) => buildViewHtml(s, makeView({
      sections: [{ key: 'key_qualifications', detail, sort_order: 0 } as never],
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')

    expect(render('summary')).toContain('The short line.')
    expect(render('summary')).not.toContain('The long profile.')
    expect(render('full')).toContain('The long profile.')
  })
})

describe('buildViewHtml — a section the catalog has no summary renderer for', () => {
  it('renders nothing, rather than crashing, when Industries is set to summary detail', () => {
    // Industries counts as an exportable section (it owns a store array), but
    // its catalog descriptor is title-only — no summary() and no full(). The
    // view editor will happily offer "Summary" for it, so the render path has
    // to tolerate a descriptor that declines: the alternative is a thrown
    // TypeError that blanks the whole preview and every export built from it.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.industries = [makeIndustry({ id: 'i1', name: { en: 'Finance' } })]
    const html = buildViewHtml(s, makeView({
      sections: [{ key: 'industries', detail: 'summary', sort_order: 0 } as never],
    }), 'en').replace(/<style[\s\S]*?<\/style>/g, '')
    expect(html).not.toContain('<section')
    expect(html).not.toContain('Finance')
  })
})

describe('applyView — a profile with no competency bundle', () => {
  it('shows no competencies at all when the selected profile lists none', () => {
    // Competencies are scoped strictly to the profile's bundle. A profile
    // saved before bundles existed (or one whose list is empty) must show
    // NOTHING — falling back to "every competency in the library" would put
    // another profile's strengths under this one's heading.
    const s = emptyStore()
    s.key_qualifications = [makeKQ({ id: 'kq1', competency_ids: undefined as never })]
    s.key_competencies = [
      makeKeyCompetency({ id: 'c1', title: { en: 'Leadership' } }),
      makeKeyCompetency({ id: 'c2', title: { en: 'Architecture' } }),
    ]
    expect(applyView(s, makeView({})).key_competencies).toEqual([])
  })
})
