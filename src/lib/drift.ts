/**
 * Cross-language drift detection.
 *
 * Completeness answers "is this field translated at all?". Drift answers the
 * next question, the one the app's whole promise rests on: for a field that IS
 * filled in in both languages, have the two versions drifted apart — did
 * someone revise the English and forget the Norwegian?
 *
 * Pure logic, structural only. It flags SIGNALS a human should look at, never
 * "this translation is wrong" — the app has no bilingual judgment. Two
 * heuristics, chosen for signal-to-noise:
 *
 *   - **numbers** (high confidence): the set of numbers in the two versions
 *     differs. "5 years" ⇄ "3 år", a dropped "40%", a wrong year — these are
 *     real content bugs a reader would notice, and digits survive translation,
 *     so a mismatch is rarely a false positive.
 *   - **length** (low confidence): one version is far longer than the other,
 *     which often means one was expanded and the other wasn't. Languages differ
 *     in verbosity, so the threshold is generous and the finding is advisory.
 *
 * A future semantic pass (LLM via AssistRun) would slot in as a third signal;
 * these two need no backend and ship value offline. Walks the SAME curated
 * field set as completeness (`collectTrackedFields`), so both stay in sync.
 */

import type { ResumeStore } from '../types'
import { richToPlain } from './richText'
import { collectTrackedFields, type MissingField } from './completeness'

export type DriftKind = 'numbers' | 'length'

export interface DriftFinding {
  /** Reuses the completeness locator (section, itemId, labels) for navigation. */
  meta: MissingField
  kind: DriftKind
  /**
   * 'high' — likely a real content error (numbers disagree).
   * 'low'  — worth a glance (lengths diverge a lot).
   */
  severity: 'high' | 'low'
  /** One-line, human-readable explanation for the drill-down. */
  detail: string
}

export interface DriftReport {
  /** The two locales compared, echoed back for the UI header. */
  a: string
  b: string
  /** Fields with content in BOTH locales — the pool drift was checked against. */
  comparedFields: number
  findings: DriftFinding[]
}

/**
 * Every maximal run of digits in the text, normalized so formatting alone
 * isn't drift: thousands separators and decimal commas/points are dropped to a
 * canonical form, and leading zeros are stripped. "1,000" and "1.000" and
 * "1000" all read as `1000`; "40%" contributes `40`. Returned as a multiset
 * (sorted array) so "3 and 3" ≠ "3".
 */
export function extractNumbers(text: string): string[] {
  const plain = richToPlain(text)
  // Grab number-ish tokens including internal separators, then canonicalize.
  const tokens = plain.match(/\d[\d.,]*/g) ?? []
  return tokens
    .map((t) => t.replace(/[.,]/g, ''))       // 1,000 / 1.000 → 1000
    .map((t) => t.replace(/^0+(?=\d)/, ''))    // 007 → 7 (keep a lone 0)
    .filter(Boolean)
    .sort()
}

/**
 * The multiset difference between two number lists: values present in `a` but
 * not `b` (`onlyA`) and vice versa (`onlyB`). Multiset-aware, so `[3,3]` vs
 * `[3]` reports one extra `3`. Empty-and-empty means the numbers match.
 */
export function numberDiff(a: string, b: string): { onlyA: string[]; onlyB: string[] } {
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())
  const ca = count(extractNumbers(a))
  const cb = count(extractNumbers(b))
  const onlyA: string[] = []
  const onlyB: string[] = []
  for (const [v, n] of ca) { const extra = n - (cb.get(v) ?? 0); for (let i = 0; i < extra; i++) onlyA.push(v) }
  for (const [v, n] of cb) { const extra = n - (ca.get(v) ?? 0); for (let i = 0; i < extra; i++) onlyB.push(v) }
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort() }
}

/** Word count of the plain-text form — a fairer length proxy across languages than characters. */
export function wordCount(text: string): number {
  const plain = richToPlain(text).trim()
  return plain ? plain.split(/\s+/).length : 0
}

/**
 * Length drift: the longer side is ≥ LENGTH_RATIO times the shorter, AND the
 * LONGER side is substantial (≥ LENGTH_MIN_WORDS). Gating on the longer side is
 * the point — the signal we're after is "one language grew and the other
 * didn't" (13 words ⇄ 2), so requiring the *short* side to be long would hide
 * exactly the stub-translation case. The floor still spares title-like fields
 * ("Lead Architect" ⇄ "Ledende arkitekt" — neither side is 6 words) and the
 * `lo === 0` case never reaches here (callers require both sides non-empty).
 * Returns the ratio when it qualifies, else null.
 */
const LENGTH_RATIO = 2
const LENGTH_MIN_WORDS = 6
function lengthDrift(a: string, b: string): number | null {
  const wa = wordCount(a)
  const wb = wordCount(b)
  const lo = Math.min(wa, wb)
  const hi = Math.max(wa, wb)
  if (hi < LENGTH_MIN_WORDS || lo === 0) return null
  const ratio = hi / lo
  return ratio >= LENGTH_RATIO ? ratio : null
}

/**
 * Compare every tracked field that has content in BOTH `a` and `b`, returning
 * the drift signals found. High-severity (numbers) first, then by section, so
 * the most actionable rows lead. A field can contribute at most one finding
 * (numbers takes precedence over length — the stronger signal wins).
 */
export function computeDrift(data: ResumeStore, a: string, b: string): DriftReport {
  const findings: DriftFinding[] = []
  let comparedFields = 0

  if (a === b) return { a, b, comparedFields: 0, findings: [] }

  for (const f of collectTrackedFields(data)) {
    const va = f.ls[a]
    const vb = f.ls[b]
    // Drift needs both sides present — a one-sided field is completeness's job.
    if (!va || !richToPlain(va).trim() || !vb || !richToPlain(vb).trim()) continue
    comparedFields++

    const { onlyA, onlyB } = numberDiff(va, vb)
    if (onlyA.length || onlyB.length) {
      findings.push({
        meta: f.meta,
        kind: 'numbers',
        severity: 'high',
        // Describe the DIFFERENCE, not both full lists — a timeline field with
        // 20 years otherwise dumps an unreadable wall. "2027 in one, not the
        // other" is what the user needs to act on.
        detail: numberDetail(onlyA, onlyB, a, b),
      })
      continue
    }
    const ratio = lengthDrift(va, vb)
    if (ratio != null) {
      findings.push({
        meta: f.meta,
        kind: 'length',
        severity: 'low',
        detail: `One language is ${ratio.toFixed(1)}× longer than the other — one side may be out of date.`,
      })
    }
  }

  findings.sort((x, y) => {
    if (x.severity !== y.severity) return x.severity === 'high' ? -1 : 1
    return x.meta.section.localeCompare(y.meta.section)
  })

  return { a, b, comparedFields, findings }
}

/**
 * Human phrasing for a number difference, naming the locales and capping the
 * list so a many-number field stays readable. `onlyA`/`onlyB` are the numbers
 * unique to each side.
 */
function numberDetail(onlyA: string[], onlyB: string[], a: string, b: string): string {
  const cap = (xs: string[]) => {
    const shown = xs.slice(0, 4).join(', ')
    return xs.length > 4 ? `${shown}, +${xs.length - 4} more` : shown
  }
  const A = a.toUpperCase()
  const B = b.toUpperCase()
  const parts: string[] = []
  if (onlyA.length) parts.push(`${cap(onlyA)} only in ${A}`)
  if (onlyB.length) parts.push(`${cap(onlyB)} only in ${B}`)
  return `Numbers differ — ${parts.join('; ')}.`
}
