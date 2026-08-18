/**
 * Resume Studio — the view's section plan, shared by every render path.
 *
 * A ResumeView stores a sparse `sections[]`: only what the user has touched,
 * in their chosen order. Turning that into "which sections render, in what
 * order, with which items" is the same job for all four adapters — HTML
 * (`viewFilter.buildViewHtml`), DOCX (`exporter`), PDF (`pdfExporter`) and ATS
 * text/Markdown (`viewText`) — and it was written out identically in each,
 * plus a fifth partial copy in the view editor.
 *
 * CLAUDE.md §7.7 says one descriptor feeds ALL render adapters. That held for
 * an item's CONTENT (lib/sectionCatalog) but not for the plan around it:
 * adding a synthetic section meant editing four files in lockstep, and the
 * three `key === '…'` special-cases were spelled out 28 times across 8 files.
 * This module is the missing half.
 *
 * Nothing here renders — it answers two questions and leaves markup to the
 * adapters:
 *   planViewSections(view)                    — which sections, in what order
 *   sectionItems(store, view, filtered, s, l) — which items, already sorted
 *
 * It also owns the section-level vocabulary the plan is built from
 * (`isExportableSection`, `defaultViewDetail`, `renderKeyFor`, the view's
 * section-list builders). `viewFilter` re-exports those so existing imports —
 * and the many tests that use them — keep working unchanged.
 */

import type {
  ResumeStore, ResumeView, ViewSection, SectionDetail, SectionStyle, SortMode,
} from '../types'
import type { SectionDef } from './sections'
import { SECTIONS } from './sections'
import { showcaseGroups } from './showcase'
import { sortItems } from './sectionSort'
import { lookup } from './lookup'

// ─── Which sections can appear in a view ─────────────────────────────────────

/**
 * Sections that are NOT resume content and must never appear in a view's
 * section list: the registries (skills/roles), which are structural data
 * referenced by other sections rather than a section of their own, and the
 * document-builder sections (views, cover_letters) — a cover letter
 * accompanies a CV, it isn't part of one.
 */
const NON_EXPORT_KEYS = new Set(['views', 'skills', 'roles', 'cover_letters'])

export function isExportableSection(s: { key: string; storeKey?: unknown }): boolean {
  return !!s.storeKey && !NON_EXPORT_KEYS.has(s.key)
}

/**
 * Default detail for a section a view doesn't explicitly list. Most default to
 * 'full'; the synthetic sections (`promoted_projects`, `skill_matrix`) default
 * to 'off' so neither existing nor new views change until the user opts in.
 */
export function defaultViewDetail(key: string): SectionDetail {
  return key === 'promoted_projects' || key === 'skill_matrix' ? 'off' : 'full'
}

/**
 * Synthetic sections borrow another section's catalog descriptor rather than
 * owning one. This map is the ONE place those keys are enumerated — adding a
 * synthetic section means adding a line here, not an `if` in four renderers.
 */
const RENDER_KEY: Record<string, string> = {
  // The starred subset of projects: same items, same descriptor.
  promoted_projects: 'projects',
  // The Skill Matrix is toggled by CATEGORY in the view editor, so its item
  // titles resolve through the category descriptor, not per-skill.
  skill_matrix: 'technology_categories',
}

/** The catalog key a section renders through (identity for a normal section). */
export function renderKeyFor(key: string): string {
  return lookup(RENDER_KEY, key, key)
}

// ─── The view's stored section list ──────────────────────────────────────────

/** Build the default ViewSection[] for a new view — exportables in master order. */
export function buildViewSections(): ViewSection[] {
  return SECTIONS
    .filter(isExportableSection)
    .map((s, i) => ({ key: s.key, detail: defaultViewDetail(s.key), sort_order: i }))
}

/**
 * Ensure a view's section list covers every exportable section. A view created
 * before a section existed won't list it; this fills the gaps — preserving the
 * user's order and appending new sections at the end with their default detail
 * — so the view editor can configure them. Pure; returns a new array.
 */
export function normalizeViewSections(stored: ViewSection[]): ViewSection[] {
  const present = new Set(stored.map((s) => s.key))
  const ordered = [...stored].sort((a, b) => a.sort_order - b.sort_order)
  const missing = SECTIONS
    .filter(isExportableSection)
    .filter((s) => !present.has(s.key))
    .map((s) => ({ key: s.key, detail: defaultViewDetail(s.key), sort_order: 0 }))
  return [...ordered, ...missing].map((s, i) => ({ ...s, sort_order: i }))
}

/** Reorder sections within a view, swapping the target up or down. */
export function reorderViewSections(sections: ViewSection[], key: string, dir: 'up' | 'down'): ViewSection[] {
  const sorted = [...sections].sort((a, b) => a.sort_order - b.sort_order)
  const idx = sorted.findIndex((s) => s.key === key)
  const swap = dir === 'up' ? idx - 1 : idx + 1
  if (idx === -1 || swap < 0 || swap >= sorted.length) return sections
  ;[sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]]
  return sorted.map((s, i) => ({ ...s, sort_order: i }))
}

// ─── Synthetic section sources ───────────────────────────────────────────────

/**
 * Source items for the synthetic "Promoted Projects" section: the starred,
 * enabled, non-excluded projects. Independent of the regular Projects
 * section's detail, so a view can show Projects='off' + Promoted='full' for a
 * clean promoted-only CV.
 */
export function promotedProjectItems(store: ResumeStore, view: ResumeView): unknown[] {
  const excluded = new Set(view.excluded_item_ids)
  const items = store.projects.filter(
    (p) => !p.disabled && !excluded.has(p.id) && p.starred,
  )
  // These derive from the RAW store, bypassing applyView, so the view-wide
  // anonymization has to be applied here too.
  return view.force_anonymized ? items.map((p) => ({ ...p, use_anonymized: true })) : items
}

// ─── The plan ────────────────────────────────────────────────────────────────

/** A section the view will render, with its config resolved. */
export interface PlannedSection extends SectionDef {
  /** Resolved detail — never 'off' (those are filtered out of the plan). */
  detail: SectionDetail
  /** Per-section style overrides, if the user set any. */
  sectionStyle: SectionStyle | undefined
  /** Per-section sort override → view-wide sort → the resume's arranged order. */
  sort: SortMode
  /** Position in the view's order. */
  sort_order: number
}

/**
 * The sections a view renders, in order, with detail/style/sort resolved.
 *
 * A section the view has never seen (added after the view was created) falls
 * back to `defaultViewDetail`, so an old view still picks up new sections.
 * Sections set to 'off' are dropped — every caller filtered them immediately.
 */
export function planViewSections(view: ResumeView): PlannedSection[] {
  return SECTIONS
    .filter(isExportableSection)
    .map((s): PlannedSection => {
      const vs = view.sections.find((v) => v.key === s.key)
      return {
        ...s,
        // 999: an unlisted section sorts after everything the user ordered.
        sort_order: vs?.sort_order ?? 999,
        detail: vs?.detail ?? defaultViewDetail(s.key),
        sectionStyle: vs?.style as SectionStyle | undefined,
        sort: vs?.sort ?? view.style?.sort ?? 'custom',
      }
    })
    .filter((s) => s.detail !== 'off')
    .sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * The items a planned section renders, already in the view's chosen order.
 *
 * `filtered` is the `applyView` result (disabled/excluded already dropped).
 * The synthetics derive from the RAW `store` instead, because they compute
 * their own membership. An empty result means the adapter should skip the
 * section entirely, heading included.
 *
 * `skill_matrix` is deliberately NOT handled here: it renders rows from
 * `skillMatrixRows`, not catalog items, and each adapter builds a real table
 * from them. Callers handle it before reaching this function.
 */
export function sectionItems(
  store: ResumeStore,
  view: ResumeView,
  filtered: ResumeStore,
  section: PlannedSection,
  locale: string,
): unknown[] {
  if (section.key === 'promoted_projects') {
    return sortItems(
      renderKeyFor(section.key),
      promotedProjectItems(store, view) as Array<{ id: string; sort_order: number }>,
      section.sort,
      locale,
    )
  }
  // The Skills Showcase arrives pre-grouped by category — that IS its order.
  if (section.key === 'technology_categories') {
    return showcaseGroups(store, view, locale)
  }
  if (!section.storeKey) return []
  return sortItems(
    renderKeyFor(section.key),
    filtered[section.storeKey] as unknown as Array<{ id: string; sort_order: number }>,
    section.sort,
    locale,
  )
}
