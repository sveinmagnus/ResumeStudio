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
