import { describe, it, expect } from 'vitest'
import {
  applyView, buildViewSections, reorderViewSections,
  getItemTitle, getItemSubtitle, buildViewHtml,
} from '../src/lib/viewFilter'
import { SECTIONS } from '../src/lib/sections'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ,
  makeView, makeReference, makeSpokenLanguage,
} from './fixtures'

// ─── buildViewSections ────────────────────────────────────────────────────────

describe('buildViewSections()', () => {
  it('produces one entry per exportable section (excludes views + registries)', () => {
    const sections = buildViewSections()
    const exportable = SECTIONS.filter(
      (s) => s.storeKey && !['views', 'skills', 'roles'].includes(s.key)
    )
    expect(sections).toHaveLength(exportable.length)
    expect(sections.every((s) => s.detail === 'full')).toBe(true)
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
})
