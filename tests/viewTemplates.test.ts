import { describe, it, expect } from 'vitest'
import { VIEW_TEMPLATES, getTemplate, applyTemplate } from '../src/lib/viewTemplates'
import { withHeaderDefaults } from '../src/lib/viewHeader'
import { makeView } from './fixtures'

describe('VIEW_TEMPLATES', () => {
  it('declares three templates with unique ids', () => {
    expect(VIEW_TEMPLATES.length).toBe(3)
    expect(new Set(VIEW_TEMPLATES.map((t) => t.id)).size).toBe(3)
  })

  it('every template has a complete ViewStyle (no partial seeds)', () => {
    for (const t of VIEW_TEMPLATES) {
      expect(t.style.density).toBeDefined()
      expect(t.style.body_size).toBeDefined()
      expect(t.style.heading_font).toBeDefined()
      expect(t.style.accent_color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(t.style.page_margin).toBeDefined()
      expect(t.style.tag_style).toBeDefined()
    }
  })

  /**
   * A template is only worth offering if it is visibly different from the
   * others. Every part of that difference lives in these three objects, and
   * emptying any one of them still leaves a template that applies cleanly —
   * it just silently stops doing what its name says.
   */
  it('gives each template a header, a footer and section details of its own', () => {
    for (const t of VIEW_TEMPLATES) {
      expect(t.name, t.id).toBeTruthy()
      expect(t.description, t.id).toBeTruthy()
      expect(Object.keys(t.section_detail).length, t.id).toBeGreaterThan(0)
      // header/footer are partial by design, but not empty — they are the
      // difference between "formal" and "compact" at a glance.
      expect(Object.keys({ ...t.header, ...t.footer }).length, t.id).toBeGreaterThan(0)
    }
  })

  it('makes the three templates actually differ from one another', () => {
    const fingerprint = (t: typeof VIEW_TEMPLATES[number]) => JSON.stringify([
      t.style, t.header, t.footer, t.section_detail,
    ])
    expect(new Set(VIEW_TEMPLATES.map(fingerprint)).size).toBe(3)

    // The named contrasts, spot-checked: dense vs generous, and the one-pager
    // that shows no photo at all.
    expect(getTemplate('compact-technical')!.style.density).toBe('compact')
    expect(getTemplate('formal-management')!.style.density).toBe('spacious')
    expect(getTemplate('formal-management')!.style.heading_font).toBe('serif')
    // The one-pager places neither photo nor logo — that is how it fits.
    expect(getTemplate('minimal-one-pager')!.header?.photo_placement).toBe('none')
    expect(getTemplate('minimal-one-pager')!.header?.logo_placement).toBe('none')
  })
})

describe('getTemplate', () => {
  it('finds a template by id and returns null otherwise', () => {
    expect(getTemplate('compact-technical')?.name).toBe('Compact technical')
    expect(getTemplate('nope')).toBeNull()
    expect(getTemplate(null)).toBeNull()
    expect(getTemplate(undefined)).toBeNull()
  })
})

describe('applyTemplate', () => {
  it('returns null for an unknown template id', () => {
    expect(applyTemplate(makeView(), 'unknown')).toBeNull()
  })

  it('seeds style, header tweaks, footer and records template_id', () => {
    const view = makeView()
    const patch = applyTemplate(view, 'formal-management')!
    expect(patch.template_id).toBe('formal-management')
    expect(patch.style?.heading_font).toBe('serif')
    expect(patch.style?.density).toBe('spacious')
    expect(patch.header?.photo_placement).toBe('left')
    expect(patch.header?.photo_shape).toBe('circle')
    expect(patch.footer?.separator).toBe('double')
  })

  it('preserves the view header images and contact fields', () => {
    const view = makeView({
      header: withHeaderDefaults({
        photo_override: 'data:image/png;base64,KEEPME',
        fields: [{ key: 'email', show: true, label: { en: 'E: ' }, same_line: false, sort_order: 0 }],
      }),
    })
    const patch = applyTemplate(view, 'compact-technical')!
    expect(patch.header?.photo_override).toBe('data:image/png;base64,KEEPME')
    expect(patch.header?.fields?.[0]?.key).toBe('email')
  })

  it('seeds listed section details and keeps unlisted ones', () => {
    const view = makeView({
      sections: [
        { key: 'projects', detail: 'full', sort_order: 0 },
        { key: 'recommendations', detail: 'full', sort_order: 1 },
        { key: 'spoken_languages', detail: 'full', sort_order: 2 },
      ],
    })
    const patch = applyTemplate(view, 'minimal-one-pager')!
    const byKey = Object.fromEntries(patch.sections!.map((s) => [s.key, s.detail]))
    expect(byKey.projects).toBe('summary')
    expect(byKey.recommendations).toBe('off')
    // spoken_languages is not listed by the one-pager — keeps its detail.
    expect(byKey.spoken_languages).toBe('full')
  })

  it('does not touch content choices (intro, exclusions, starred_only)', () => {
    const view = makeView({
      introduction: { en: 'Keep me' },
      excluded_item_ids: ['x1'],
      starred_only: true,
    })
    const patch = applyTemplate(view, 'compact-technical')!
    expect(patch.introduction).toBeUndefined()
    expect(patch.excluded_item_ids).toBeUndefined()
    expect(patch.starred_only).toBeUndefined()
  })
})

describe('every template carries a complete look', () => {
  /**
   * A template is applied as one patch, so a missing half leaves the view
   * carrying the previous template's photo or footer — which reads as the
   * template not working rather than as a gap in the data.
   */
  it('gives each template a header and a footer intent', () => {
    for (const t of VIEW_TEMPLATES) {
      expect(t.header, t.id).toBeTruthy()
      expect(Object.keys(t.header ?? {}).length, t.id).toBeGreaterThan(0)
      expect(t.footer, t.id).toBeTruthy()
      expect(Object.keys(t.footer ?? {}).length, t.id).toBeGreaterThan(0)
    }
  })

  it('states a photo placement in every template, so applying one settles it', () => {
    for (const t of VIEW_TEMPLATES) {
      expect(t.header?.photo_placement, t.id).toBeTruthy()
    }
  })

  it('states a footer separator in every template', () => {
    for (const t of VIEW_TEMPLATES) {
      expect(t.footer?.separator, t.id).toBeTruthy()
    }
  })

  it('resolves a template by id, and nothing for an unknown or absent one', () => {
    expect(getTemplate(VIEW_TEMPLATES[0].id)?.id).toBe(VIEW_TEMPLATES[0].id)
    expect(getTemplate('no-such-template')).toBeNull()
    expect(getTemplate(null)).toBeNull()
    expect(getTemplate(undefined)).toBeNull()
    expect(getTemplate('')).toBeNull()
  })
})

/**
 * The presets themselves.
 *
 * Everything above asserts that the three templates are complete and differ
 * from each other, which holds however their values are spelled — so every
 * individual token survived the mutation report. A template IS its values: an
 * emptied `density` seeds a style the renderers resolve by fallback, and an
 * emptied detail seeds a section the view editor cannot show a level for.
 * Pinned as a table, so changing a preset is a deliberate edit here.
 */
describe('what each template actually seeds', () => {
  const byId = (id: string) => VIEW_TEMPLATES.find((t) => t.id === id)!
  const NAVY = '#002E6E'

  it('compact-technical — dense, skill-forward, chips', () => {
    const t = byId('compact-technical')
    expect(t.style).toEqual({
      density: 'compact', body_size: 'small', heading_font: 'sans',
      accent_color: NAVY, page_margin: 'tight', tag_style: 'chips',
    })
    expect(t.header).toEqual({ photo_placement: 'right', photo_shape: 'rounded' })
    expect(t.footer).toEqual({ separator: 'line' })
    expect(t.section_detail).toEqual({
      projects: 'full',
      technology_categories: 'full',
      positions: 'summary',
      presentations: 'summary',
      publications: 'summary',
      honor_awards: 'summary',
    })
  })

  it('formal-management — spacious, serif, inline skills', () => {
    const t = byId('formal-management')
    expect(t.style).toEqual({
      density: 'spacious', body_size: 'normal', heading_font: 'serif',
      accent_color: NAVY, page_margin: 'generous', tag_style: 'inline',
    })
    expect(t.header).toEqual({ photo_placement: 'left', photo_shape: 'circle' })
    expect(t.footer).toEqual({ separator: 'double', copyright: 'person' })
    expect(t.section_detail).toEqual({
      key_qualifications: 'full',
      work_experiences: 'full',
      projects: 'summary',
      technology_categories: 'summary',
      courses: 'summary',
    })
  })

  it('minimal-one-pager — summaries throughout, nothing decorative', () => {
    const t = byId('minimal-one-pager')
    expect(t.style).toEqual({
      density: 'compact', body_size: 'small', heading_font: 'condensed',
      accent_color: NAVY, page_margin: 'tight', tag_style: 'inline',
    })
    expect(t.header).toEqual({ photo_placement: 'none', logo_placement: 'none' })
    expect(t.footer).toEqual({ separator: 'none', copyright: 'none' })
    // The one template that turns sections OFF: fitting a page means dropping
    // things, not only shortening them.
    expect(t.section_detail).toEqual({
      key_qualifications: 'full',
      projects: 'summary',
      work_experiences: 'summary',
      educations: 'summary',
      courses: 'summary',
      certifications: 'summary',
      positions: 'summary',
      presentations: 'summary',
      publications: 'summary',
      honor_awards: 'summary',
      technology_categories: 'summary',
      key_competencies: 'summary',
      recommendations: 'off',
      references: 'off',
    })
  })

  it('names and describes each one, since the picker shows only those', () => {
    for (const t of VIEW_TEMPLATES) {
      expect(t.name.trim(), t.id).not.toBe('')
      expect(t.description.trim(), t.id).not.toBe('')
    }
    expect(new Set(VIEW_TEMPLATES.map((t) => t.name)).size).toBe(VIEW_TEMPLATES.length)
  })

  it('keeps every template on the brand accent', () => {
    for (const t of VIEW_TEMPLATES) expect(t.style.accent_color, t.id).toBe(NAVY)
  })
})
