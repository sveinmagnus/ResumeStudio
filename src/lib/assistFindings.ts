/**
 * PURE: the shape every ADVISORY assist speaks — a list of findings that point
 * at a place in the CV and say what's wrong, without changing anything.
 *
 * Three passes produce these (whole-CV review, cross-language meaning check,
 * "what's missing" per section) and they share one schema, one validator and
 * one panel on purpose: a finding is a finding, and three near-identical shapes
 * would mean three chances for a model reply to be parsed slightly differently.
 *
 * Two rules the validator enforces, both learned elsewhere in this codebase:
 *
 *  - **Unknown references are DROPPED, not fatal.** A model that invents an
 *    item id has still produced nine useful findings; failing the whole run
 *    over the tenth wastes the call and teaches the user the feature is flaky.
 *    Same discipline as `applyTailorResponse`. Drops are reported so the panel
 *    can say so rather than silently shrinking the list.
 *  - **Findings never carry replacement text.** They are advice; the moment one
 *    carries prose the UI wants an Apply button, and an advisory pass has not
 *    been held to the no-invention standard the writing passes are. `ask` is
 *    the escape valve — a QUESTION back to the user, which is the writing
 *    coach's discipline and the only honest way to surface a missing fact.
 */

import type { ResumeStore } from '../types'
import { isAdvisorSection, itemsOf } from './cvFields'
import { itemLabel as labelOf } from './cvDigest'

export const FINDINGS_SCHEMA = 'resumestudio-findings/v1'

export type FindingSeverity = 'high' | 'medium' | 'low'

const SEVERITIES: readonly FindingSeverity[] = ['high', 'medium', 'low']

export interface Finding {
  /** Stable key for the list — assigned by us, never by the model. */
  key: string
  severity: FindingSeverity
  /** Short slug for the kind of problem, e.g. 'missing-outcome'. Display only. */
  kind: string
  /** A section key the store actually has. */
  section: string
  /** An item in that section, or null for a finding about the section itself. */
  itemId: string | null
  /** Resolved at validation time so the panel needn't re-derive it. */
  itemLabel: string
  title: string
  detail: string
  /** A question only the user can answer. Optional — most findings are plain. */
  ask?: string
}

export interface FindingsResult {
  findings: Finding[]
  /** Human-readable notes about what was discarded, for the panel. */
  dropped: string[]
}

export class InvalidFindingsError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidFindingsError' }
}

/** Hard cap — a model that returns 400 findings has not been useful. */
const MAX_FINDINGS = 60

/**
 * The response contract to paste into a prompt. One definition, so all three
 * advisors ask for the identical shape and the validator below can be the only
 * thing that reads it.
 */
export function findingsResponseSpec(): string {
  return [
    'Reply with ONLY this JSON, no prose before or after:',
    `{"$schema":"${FINDINGS_SCHEMA}","findings":[`,
    '  {"severity":"high|medium|low",',
    '   "kind":"a-short-slug",',
    '   "section":"the section key exactly as given above",',
    '   "item_id":"the id exactly as given above, or null for the whole section",',
    '   "title":"one short line naming the problem",',
    '   "detail":"1-3 sentences: what is wrong and why it matters to a reader",',
    '   "ask":"OPTIONAL - a question only the person can answer"}',
    ']}',
    '',
    'Rules:',
    '- Use ONLY section keys and item ids that appear above. Never invent one.',
    '- Do NOT write replacement text. Report the problem; the person fixes it.',
    '- If something is missing that only the person knows, put it in "ask".',
    '- An empty findings list is a valid, useful answer. Do not pad it.',
  ].join('\n')
}

interface RawFinding {
  severity?: unknown
  kind?: unknown
  section?: unknown
  item_id?: unknown
  title?: unknown
  detail?: unknown
  ask?: unknown
}

function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

/**
 * Validate a model reply into findings, resolving every reference against the
 * live store. Throws only when the reply isn't a findings document at all;
 * individual bad findings are dropped with a note.
 */
export function validateFindings(json: unknown, data: ResumeStore, locale = 'en'): FindingsResult {
  if (!json || typeof json !== 'object') {
    throw new InvalidFindingsError('The reply was not a JSON object.')
  }
  const raw = (json as Record<string, unknown>).findings
  if (!Array.isArray(raw)) {
    throw new InvalidFindingsError('The reply had no "findings" array.')
  }

  const findings: Finding[] = []
  const dropped: string[] = []
  // Label lookups are per-section and repeated across findings — build once.
  const labels = new Map<string, Map<string, string>>()

  for (const [i, entry] of raw.slice(0, MAX_FINDINGS).entries()) {
    if (!entry || typeof entry !== 'object') { dropped.push(`Finding ${i + 1} was not an object.`); continue }
    const f = entry as RawFinding

    const title = str(f.title, 200)
    const detail = str(f.detail, 1000)
    if (!title && !detail) { dropped.push(`Finding ${i + 1} had no text.`); continue }

    const section = str(f.section, 60)
    if (!isAdvisorSection(section, data)) {
      dropped.push(`Finding ${i + 1} named an unknown section ("${section || '—'}").`)
      continue
    }

    if (!labels.has(section)) {
      const map = new Map<string, string>()
      for (const it of itemsOf(data, section)) {
        if (typeof it.id === 'string') map.set(it.id, labelOf(section, it, locale))
      }
      labels.set(section, map)
    }
    const known = labels.get(section)!

    // `null`/absent means "about the section as a whole" — a legitimate answer,
    // distinct from an id we couldn't resolve.
    const rawId = f.item_id
    let itemId: string | null = null
    if (typeof rawId === 'string' && rawId.trim() && rawId.trim().toLowerCase() !== 'null') {
      itemId = rawId.trim()
      if (!known.has(itemId)) {
        dropped.push(`Finding ${i + 1} pointed at an item that isn't in ${section}.`)
        continue
      }
    }

    const severity = SEVERITIES.includes(f.severity as FindingSeverity)
      ? (f.severity as FindingSeverity)
      : 'medium'

    findings.push({
      key: `${section}:${itemId ?? 'section'}:${i}`,
      severity,
      kind: str(f.kind, 40) || 'note',
      section,
      itemId,
      itemLabel: itemId ? (known.get(itemId) ?? '') : '',
      title: title || detail.slice(0, 80),
      detail,
      ...(str(f.ask, 300) ? { ask: str(f.ask, 300) } : {}),
    })
  }

  // Most severe first, then by section, so the panel reads as a work list.
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
  return { findings, dropped }
}
