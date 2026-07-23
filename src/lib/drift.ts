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

interface NumberToken {
  /** Canonical numeric value: separators dropped, leading zeros stripped. */
  value: string
  /**
   * "Salient" = reliably written as a numeral in every language, so its
   * presence on only ONE side is a real omission rather than a notation
   * choice: a percentage, a decimal/grouped value, or a 3+ digit number
   * (counts, years, amounts). A bare 1–2 digit integer is NOT salient — it's
   * exactly what one language spells out as a word ("six" ⇄ "6").
   */
  salient: boolean
}

/**
 * Every maximal run of digits in the text as a {@link NumberToken}, normalized
 * so formatting alone isn't drift: thousands separators and decimal
 * commas/points are dropped to a canonical form, and leading zeros are
 * stripped. "1,000" and "1.000" and "1000" all read as `1000`; "40%"
 * contributes a salient `40`.
 */
function extractNumberTokens(text: string): NumberToken[] {
  const plain = richToPlain(text)
  const out: NumberToken[] = []
  const re = /\d[\d.,]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(plain)) !== null) {
    const raw = m[0]
    const value = raw.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '')
    if (!value) continue
    const grouped = /\d[.,]\d/.test(raw)               // 1,000 / 3.5 — decimal or grouped
    const percent = /^\s*%/.test(plain.slice(m.index + raw.length))
    const salient = value.length >= 3 || grouped || percent
    out.push({ value, salient })
  }
  return out
}

/**
 * Every number in the text as a canonical multiset (sorted array) so
 * "3 and 3" ≠ "3". Kept for callers/tests that only need the values.
 */
export function extractNumbers(text: string): string[] {
  return extractNumberTokens(text).map((t) => t.value).sort()
}

/**
 * The multiset difference between two texts' numbers: values present in `a` but
 * not `b` (`onlyA`) and vice versa (`onlyB`). Multiset-aware, so `[3,3]` vs
 * `[3]` reports one extra `3`. Empty-and-empty means the numbers match.
 *
 * When numbers are left over on BOTH sides the values genuinely DIFFER (5 ⇄ 3,
 * 40% ⇄ 30%) — a real discrepancy, reported in full. When they're left over on
 * ONLY ONE side, that's the ambiguous "a number here, nothing there" case which
 * is usually just notation — the other language spelled it as a word ("six") or
 * it was part of a name ("S3") — so only SALIENT one-sided numbers (percentages,
 * decimals, 3+ digit values / years) are reported. This is what stops "6" ⇄
 * "seks" and "6." ⇄ "sixth" from being flagged.
 */
export function numberDiff(a: string, b: string): { onlyA: string[]; onlyB: string[] } {
  const ta = extractNumberTokens(a)
  const tb = extractNumberTokens(b)
  const count = (xs: NumberToken[]) => xs.reduce((m, x) => m.set(x.value, (m.get(x.value) ?? 0) + 1), new Map<string, number>())
  const ca = count(ta)
  const cb = count(tb)
  const onlyA: string[] = []
  const onlyB: string[] = []
  for (const [v, n] of ca) { const extra = n - (cb.get(v) ?? 0); for (let i = 0; i < extra; i++) onlyA.push(v) }
  for (const [v, n] of cb) { const extra = n - (ca.get(v) ?? 0); for (let i = 0; i < extra; i++) onlyB.push(v) }

  // Both sides have leftovers → the numbers differ → report everything.
  if (onlyA.length && onlyB.length) return { onlyA: onlyA.sort(), onlyB: onlyB.sort() }

  // One-sided → keep only salient values (a bare small integer is likely just
  // spelled out as a word on the other side, not real drift).
  const salientA = new Set(ta.filter((t) => t.salient).map((t) => t.value))
  const salientB = new Set(tb.filter((t) => t.salient).map((t) => t.value))
  return {
    onlyA: onlyA.filter((v) => salientA.has(v)).sort(),
    onlyB: onlyB.filter((v) => salientB.has(v)).sort(),
  }
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
    // Length disparity only signals staleness in PROSE. On short structured
    // fields (school, degree, title, names) a big word-count gap is normal
    // cross-language variation — Norwegian "Sivilingeniør" (1 word) ⇄ "Master
    // of Science in Engineering" (6) is a 6× ratio but not drift — so skip them.
    const ratio = f.prose ? lengthDrift(va, vb) : null
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
