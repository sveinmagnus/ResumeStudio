/**
 * PURE: when a view runs over its page limit, propose what to CUT.
 *
 * Strictly advisory, and strictly subtractive. The obvious "help me fit this"
 * feature is to have a model shorten the prose — and that is precisely the
 * failure mode this app refuses: rewriting a CV to fit invents claims the user
 * then has to defend. So the model is only ever asked WHICH ITEMS to drop, never
 * to touch a word of the content. Applying a suggestion routes through the
 * view's existing `excluded_item_ids`, which is the same reversible, per-view
 * mechanism the item checkboxes already use — the master CV is untouched.
 *
 * The input is the item catalog (ids + titles), not the rendered prose: choosing
 * what to cut needs to know what's there and how relevant it is, not the full
 * text of every description. That keeps the prompt small enough for a local
 * model and sends less of the CV.
 */

import type { ResumeStore, ResumeView } from '../types'
import { buildTailorCatalog } from './viewTailor'

export const PAGE_FIT_SCHEMA = 'resumestudio-fit/v1'

export interface FitSuggestion {
  /** Catalog id of the item to drop. */
  itemId: string
  /** The item's title, for the review list. */
  title: string
  /** The section it belongs to. */
  section: string
  /** The model's one-line reason. */
  why: string
}

export class InvalidPageFitError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidPageFitError' }
}

/**
 * The prompt. `over` is how many pages too long the view currently is, so the
 * model can size its answer rather than cutting everything it dislikes.
 */
export function buildPageFitPrompt(
  store: ResumeStore, view: ResumeView, locale: string, pages: number, limit: number,
): string {
  const { sections } = buildTailorCatalog(store, locale)
  const over = Math.max(1, Math.round(pages - limit))

  return [
    `This CV renders as ${pages.toFixed(1)} pages but must fit ${limit}. Suggest which ITEMS to leave out.`,
    'Rules:',
    `- Suggest roughly enough to save ${over} page${over === 1 ? '' : 's'} — not the whole CV.`,
    '- Prefer the oldest, least relevant and most repetitive items. Keep anything starred.',
    '- Do NOT suggest rewriting or shortening any text. Only whole items to drop.',
    '- Use the exact "id" values given below.',
    '- One short reason each.',
    '',
    `Reply with ONLY this JSON, no prose:\n{"$schema":"${PAGE_FIT_SCHEMA}","cut":[{"id":"…","why":"…"}]}`,
    '',
    '--- ITEMS ---',
    JSON.stringify(sections),
  ].join('\n')
}

/**
 * Validate a reply and resolve each id against the catalog.
 *
 * An id the catalog doesn't contain is DROPPED, not surfaced: a model that
 * invents an id would otherwise produce a suggestion that silently does nothing
 * when applied, which is worse than not offering it. Items already excluded are
 * dropped too — proposing a cut that's already made is noise.
 */
export function validatePageFit(
  json: unknown, store: ResumeStore, view: ResumeView, locale: string,
): FitSuggestion[] {
  if (!json || typeof json !== 'object') throw new InvalidPageFitError('The reply was not a JSON object.')
  const o = json as Record<string, unknown>
  if (!Array.isArray(o.cut)) throw new InvalidPageFitError('The reply has no "cut" array.')

  const { sections } = buildTailorCatalog(store, locale)
  const byId = new Map<string, { title: string; section: string }>()
  for (const s of sections) {
    for (const it of s.items) byId.set(it.id, { title: it.title, section: s.label })
  }

  const already = new Set(view.excluded_item_ids)
  const seen = new Set<string>()
  const out: FitSuggestion[] = []

  for (const raw of o.cut) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    if (!id || seen.has(id) || already.has(id)) continue
    const hit = byId.get(id)
    if (!hit) continue // invented id → a suggestion that would do nothing
    seen.add(id)
    out.push({
      itemId: id,
      title: hit.title,
      section: hit.section,
      why: typeof r.why === 'string' ? r.why.trim() : '',
    })
  }
  return out
}

/**
 * Apply the chosen cuts: add them to the view's exclusions. Reversible, scoped
 * to this view, and identical to unticking the items by hand.
 */
export function applyCuts(view: ResumeView, itemIds: readonly string[]): string[] {
  const next = new Set(view.excluded_item_ids)
  for (const id of itemIds) next.add(id)
  return [...next]
}
