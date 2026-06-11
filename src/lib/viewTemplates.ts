/**
 * PURE: named export templates (roadmap F1). A template is a *preset that
 * seeds* a view's style / header / footer and per-section detail levels — the
 * user keeps tweaking afterwards, and re-applying a template overwrites those
 * tweaks again. It is NOT a fork of the render logic: both render paths stay
 * untouched and read the same ViewStyle / header / footer the template wrote.
 *
 * `ResumeView.template_id` records the last template applied (purely
 * informational — manual tweaks don't clear it).
 */

import type {
  ResumeView, ViewStyle, ViewHeaderConfig, ViewFooterConfig, SectionDetail,
} from '../types'
import { withHeaderDefaults, withFooterDefaults } from './viewHeader'

export interface ViewTemplate {
  id: string
  name: string
  /** One-line pitch shown under the picker. */
  description: string
  style: ViewStyle
  /**
   * Header tweaks overlaid on the view's existing header — the photo/logo
   * overrides and configured contact fields are deliberately preserved.
   */
  header: Partial<ViewHeaderConfig>
  footer: Partial<ViewFooterConfig>
  /** Per-section detail seeds; unlisted sections keep their current detail. */
  section_detail: Record<string, SectionDetail>
}

const NAVY = '#002E6E' // Cartavio navy — every template stays on brand by default

export const VIEW_TEMPLATES: ViewTemplate[] = [
  {
    id: 'compact-technical',
    name: 'Compact technical',
    description: 'Dense, skill-forward layout for hands-on roles — small type, chip tags, full project detail.',
    style: { density: 'compact', body_size: 'small', heading_font: 'sans', accent_color: NAVY, page_margin: 'tight', tag_style: 'chips' },
    header: { photo_placement: 'right', photo_shape: 'rounded' },
    footer: { separator: 'line' },
    section_detail: {
      projects: 'full',
      technology_categories: 'full',
      positions: 'summary',
      presentations: 'summary',
      publications: 'summary',
      honor_awards: 'summary',
    },
  },
  {
    id: 'formal-management',
    name: 'Formal management',
    description: 'Generous spacing and serif headings for board and management audiences — project summaries, inline skills.',
    style: { density: 'spacious', body_size: 'normal', heading_font: 'serif', accent_color: NAVY, page_margin: 'generous', tag_style: 'inline' },
    header: { photo_placement: 'left', photo_shape: 'circle' },
    footer: { separator: 'double', copyright: 'person' },
    section_detail: {
      key_qualifications: 'full',
      work_experiences: 'full',
      projects: 'summary',
      technology_categories: 'summary',
      courses: 'summary',
    },
  },
  {
    id: 'minimal-one-pager',
    name: 'Minimal one-pager',
    description: 'Everything on one page — summaries throughout, no photo, no logo, no footer.',
    style: { density: 'compact', body_size: 'small', heading_font: 'condensed', accent_color: NAVY, page_margin: 'tight', tag_style: 'inline' },
    header: { photo_placement: 'none', logo_placement: 'none' },
    footer: { separator: 'none', copyright: 'none' },
    section_detail: {
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
    },
  },
]

export function getTemplate(id: string | null | undefined): ViewTemplate | null {
  if (!id) return null
  return VIEW_TEMPLATES.find((t) => t.id === id) ?? null
}

/**
 * Build the ResumeView patch that applies a template. Returns null for an
 * unknown id. Content choices the user made — introduction, excluded items,
 * starred-only, header images and contact fields — are preserved; only the
 * visual preset (style/header tweaks/footer) and section detail levels are
 * (re)seeded.
 */
export function applyTemplate(view: ResumeView, templateId: string): Partial<ResumeView> | null {
  const t = getTemplate(templateId)
  if (!t) return null
  const header = withHeaderDefaults(view.header)
  const footer = withFooterDefaults(view.footer)
  return {
    template_id: t.id,
    style: { ...t.style },
    header: { ...header, ...t.header },
    footer: { ...footer, ...t.footer },
    sections: view.sections.map((s) => {
      const detail = t.section_detail[s.key]
      return detail !== undefined ? { ...s, detail } : s
    }),
  }
}
