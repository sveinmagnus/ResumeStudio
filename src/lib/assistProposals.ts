/**
 * PURE: the shape every WRITING assist speaks — proposed replacement text for a
 * specific field of a specific item, reviewed one by one and applied as a batch.
 *
 * The counterpart to `assistFindings.ts`: findings say what's wrong, proposals
 * say what to write instead. They stay separate types because they carry
 * different risk. A finding is advice you can ignore; a proposal REPLACES text
 * you wrote, so it is held to the writing coach's standard:
 *
 *  - **Only prose fields.** A proposal naming `customer` or `employer` is
 *    dropped, not applied. Rewriting an identity field isn't a style
 *    improvement, it's a factual error with a plausible tone.
 *  - **The original is carried alongside.** The panel shows before and after;
 *    a proposal you can't compare is one you can't review, and "looks better"
 *    is not the same as "still true".
 *  - **Nothing is applied until ticked**, and the whole accepted batch goes
 *    through `replaceData` as ONE undo step (see CLAUDE.md §7) — a 40-field
 *    style pass that needs 40 undos is a trap.
 *  - **Stale proposals are dropped at apply time**, not just at parse time: the
 *    user can keep editing while the panel is open, and silently overwriting an
 *    edit they made after the run is the one unrecoverable outcome here.
 */

import type { ResumeStore, LocalizedString } from '../types'
import { fieldOf, isAdvisorSection, itemsOf } from './cvFields'
import { itemLabel as labelOf } from './cvDigest'
import { richToPlain } from './richText'

export const PROPOSALS_SCHEMA = 'resumestudio-edits/v1'

export interface Proposal {
  /** Stable key for the list — ours, never the model's. */
  key: string
  section: string
  itemId: string
  /** A prose field key that exists on this section. */
  field: string
  fieldLabel: string
  itemLabel: string
  /** The locale slot this rewrites — always the one the run was given. */
  locale: string
  /** Flattened current text, for the before/after view. */
  current: string
  /** The model's replacement. Plain text; never markup. */
  proposed: string
  /** One line on what changed and why. */
  why: string
}

export interface ProposalsResult {
  proposals: Proposal[]
  dropped: string[]
}

export class InvalidProposalsError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidProposalsError' }
}

const MAX_PROPOSALS = 80
/** Longest replacement we'll accept — past this the model is writing an essay. */
const MAX_PROPOSED_CHARS = 4000

/** The response contract to paste into a prompt. One definition for all callers. */
export function proposalsResponseSpec(): string {
  return [
    'Reply with ONLY this JSON, no prose before or after:',
    `{"$schema":"${PROPOSALS_SCHEMA}","edits":[`,
    '  {"section":"the section key exactly as given above",',
    '   "item_id":"the id exactly as given above",',
    '   "field":"the field key exactly as given above",',
    '   "proposed":"the rewritten text",',
    '   "why":"one short line on what you changed"}',
    ']}',
    '',
    'Rules:',
    '- Use ONLY section keys, item ids and field keys that appear above.',
    '- Include an entry ONLY for text you actually changed. Unchanged is not an edit.',
    '- Plain text only: no markdown, no HTML, no bullet characters.',
    '- An empty edits list is a valid answer when the writing is already consistent.',
  ].join('\n')
}

function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

/** Flattened text of one locale slot — what the before/after compares. */
function currentText(item: Record<string, unknown>, field: string, locale: string): string {
  const ls = item[field]
  if (!ls || typeof ls !== 'object') return ''
  return richToPlain((ls as LocalizedString)[locale] ?? '').trim()
}

/**
 * Validate a model reply into proposals, resolving every reference against the
 * live store and dropping anything unresolvable, non-prose, or a no-op.
 */
export function validateProposals(json: unknown, data: ResumeStore, locale: string): ProposalsResult {
  if (!json || typeof json !== 'object') {
    throw new InvalidProposalsError('The reply was not a JSON object.')
  }
  const raw = (json as Record<string, unknown>).edits
  if (!Array.isArray(raw)) {
    throw new InvalidProposalsError('The reply had no "edits" array.')
  }

  const proposals: Proposal[] = []
  const dropped: string[] = []
  const itemCache = new Map<string, Map<string, Record<string, unknown>>>()

  for (const [i, entry] of raw.slice(0, MAX_PROPOSALS).entries()) {
    if (!entry || typeof entry !== 'object') { dropped.push(`Edit ${i + 1} was not an object.`); continue }
    const e = entry as Record<string, unknown>

    const section = str(e.section, 60)
    if (!isAdvisorSection(section, data)) {
      dropped.push(`Edit ${i + 1} named an unknown section ("${section || '—'}").`)
      continue
    }
    if (!itemCache.has(section)) {
      const map = new Map<string, Record<string, unknown>>()
      for (const it of itemsOf(data, section)) {
        if (typeof it.id === 'string') map.set(it.id, it)
      }
      itemCache.set(section, map)
    }
    const item = itemCache.get(section)!.get(str(e.item_id, 80))
    if (!item) {
      dropped.push(`Edit ${i + 1} pointed at an item that isn't in ${section}.`)
      continue
    }

    const fieldKey = str(e.field, 60)
    const field = fieldOf(section, fieldKey)
    if (!field) {
      dropped.push(`Edit ${i + 1} named an unknown field ("${fieldKey || '—'}").`)
      continue
    }
    // The guard that matters: a rewritten employer name reads perfectly and is
    // a lie. List fields (highlights) need their own op and aren't handled here.
    if (!field.prose || field.list) {
      dropped.push(`Edit ${i + 1} tried to rewrite "${field.label}", which is not free prose.`)
      continue
    }

    const proposed = str(e.proposed, MAX_PROPOSED_CHARS)
    if (!proposed) { dropped.push(`Edit ${i + 1} had no replacement text.`); continue }

    const current = currentText(item, fieldKey, locale)
    // A proposal identical to the current text is not an edit.
    if (current === proposed) continue

    proposals.push({
      key: `${section}:${item.id as string}:${fieldKey}`,
      section,
      itemId: item.id as string,
      field: fieldKey,
      fieldLabel: field.label,
      itemLabel: labelOf(section, item, locale),
      locale,
      current,
      proposed,
      why: str(e.why, 200),
    })
  }

  return { proposals, dropped }
}

/**
 * Apply accepted proposals, returning a NEW store for `replaceData`.
 *
 * Re-checks each proposal against the store it's about to write to: `current`
 * was captured when the run returned, and the user may have edited the field
 * since (the panel is non-blocking by design). A changed field means the
 * proposal was written against text that no longer exists, so it is skipped and
 * reported rather than applied over the newer edit.
 */
export function applyProposals(
  data: ResumeStore,
  accepted: readonly Proposal[],
): { data: ResumeStore; applied: number; skipped: Proposal[] } {
  if (!accepted.length) return { data, applied: 0, skipped: [] }

  const next = { ...data } as unknown as Record<string, unknown>
  const skipped: Proposal[] = []
  let applied = 0

  // Group by section so each array is copied once, not once per proposal.
  const bySection = new Map<string, Proposal[]>()
  for (const p of accepted) {
    const list = bySection.get(p.section) ?? []
    list.push(p)
    bySection.set(p.section, list)
  }

  for (const [section, list] of bySection) {
    const arr = next[section]
    if (!Array.isArray(arr)) { skipped.push(...list); continue }
    const copy = [...(arr as Array<Record<string, unknown>>)]

    for (const p of list) {
      const idx = copy.findIndex((it) => it.id === p.itemId)
      if (idx === -1) { skipped.push(p); continue }
      const item = copy[idx]
      if (currentText(item, p.field, p.locale) !== p.current) { skipped.push(p); continue }
      const ls = (item[p.field] ?? {}) as LocalizedString
      copy[idx] = { ...item, [p.field]: { ...ls, [p.locale]: p.proposed } }
      applied++
    }
    next[section] = copy
  }

  return { data: next as unknown as ResumeStore, applied, skipped }
}
