/**
 * Near-duplicate prose across items.
 *
 * A CV recycled across engagements ends up saying the same sentence in three
 * places, and a reader notices the copying before the content. Two structural
 * shapes of that are found here: a SENTENCE repeated (verbatim or
 * near-verbatim) across different items, and two whole FIELDS that are
 * substantially the same text.
 *
 * Pure, offline, structural (drift.ts's spirit): signals, never verdicts —
 * repetition can be deliberate (a signature line), so findings snooze via
 * `Resume.attention_dismissals` on freshness.ts's pattern. A summary restating
 * its OWN item's long description is by design (that's what a summary is), so
 * same-item comparisons are never made. The `locale` parameter only picks the
 * language for item labels; the scan itself covers every locale present.
 */

import type { LocalizedString, ResumeStore } from '../types'
import { resolve } from './locales'
import { richToPlain } from './richText'

export interface RedundancyLoc {
  section: string
  itemId: string
  itemLabel: string
  fieldLabel: string
}

export interface RedundancyFinding {
  a: RedundancyLoc
  b: RedundancyLoc
  kind: 'sentence' | 'field'
  /**
   * 'sentence': the shared sentence, original casing, trimmed to <= 120 chars
   * with an ellipsis. 'field': e.g. `The two descriptions share 63% of their
   * phrasing.`
   */
  detail: string
  /** The locale the duplicate was found in. */
  locale: string
  /** `dup:<aKey>:<bKey>` with key = `<section>:<itemId>`, pair sorted. */
  dismissKey: string
}

/** A finding the user has dismissed that is still within its snooze window. */
export interface SnoozedDup {
  key: string
  label: string
  /** ISO timestamp when it un-snoozes and may surface again. */
  until: string
}

export interface RedundancyReport {
  findings: RedundancyFinding[]
  snoozed: SnoozedDup[]
  /** Number of (field, locale) texts with any content — the scanned pool. */
  comparedFields: number
}

/**
 * The snooze key for an item pair — sorted, so A↔B and B↔A agree on which
 * dismissal suppresses them.
 */
export function dupDismissKey(aKey: string, bKey: string): string {
  return aKey < bKey ? `dup:${aKey}:${bKey}` : `dup:${bKey}:${aKey}`
}

/** Below this many tokens a sentence is boilerplate-short and repeats honestly. */
const SENTENCE_MIN_TOKENS = 8
/** Token-SET similarity for "the same sentence with a word or two swapped". */
const SENTENCE_NEAR_JACCARD = 0.8
/** A field must be substantial before whole-field similarity means anything. */
const FIELD_MIN_TOKENS = 25
/** Token-trigram similarity for "these two fields are largely the same text". */
const FIELD_TRIGRAM_JACCARD = 0.5
/**
 * The near-match pass is O(n²) over indexed sentences; past this count it is
 * skipped (exact matching still runs) so a huge CV degrades, never hangs.
 */
const NEAR_PASS_SENTENCE_CAP = 2000
/** Longest quoted sentence in a finding's detail, ellipsis included. */
const DETAIL_MAX = 120

interface FieldEntry {
  loc: RedundancyLoc
  /** `<section>:<itemId>` — the unit findings collapse and dismiss by. */
  itemKey: string
  locale: string
  text: string
  tokens: string[]
}

interface SentenceEntry {
  field: FieldEntry
  original: string
  norm: string
  tokenSet: Set<string>
}

interface Hit {
  a: FieldEntry
  b: FieldEntry
  kind: 'sentence' | 'field'
  locale: string
  /** The quoted sentence for a 'sentence' hit; null for 'field'. */
  sentence: string | null
  /** Rounded shared-phrasing percentage for a 'field' hit; 0 otherwise. */
  pct: number
}

/** Lowercase, punctuation stripped, whitespace collapsed — comparison form. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokensOf(text: string): string[] {
  const norm = normalize(text)
  return norm ? norm.split(' ') : []
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * Consecutive token triples. Trigrams (not single tokens) so two fields about
 * the same TOPIC don't read as copies — only shared phrasing overlaps.
 */
function trigrams(tokens: string[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 2 < tokens.length; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`)
  }
  return out
}

/** Quote a sentence in a detail line without letting it become the panel. */
function clip(sentence: string): string {
  if (sentence.length <= DETAIL_MAX) return sentence
  return `${sentence.slice(0, DETAIL_MAX - 1).trimEnd()}…`
}

/**
 * Every prose (field, locale) text in scope, as plain text. Only fields whose
 * repetition would be visible in an export are scanned — the curated prose
 * set, not every string in the store.
 */
function collectFields(store: ResumeStore, labelLocale: string): FieldEntry[] {
  const out: FieldEntry[] = []
  const push = (
    section: string, itemId: string, itemLabel: string, fieldLabel: string,
    ls: LocalizedString | undefined,
  ): void => {
    if (!ls) return
    for (const [loc, raw] of Object.entries(ls)) {
      if (!raw) continue
      const text = richToPlain(raw).trim()
      if (!text) continue
      out.push({
        loc: { section, itemId, itemLabel, fieldLabel },
        itemKey: `${section}:${itemId}`,
        locale: loc,
        text,
        tokens: tokensOf(text),
      })
    }
  }
  for (const kq of store.key_qualifications) {
    if (kq.disabled) continue
    push('key_qualifications', kq.id, resolve(kq.label, labelLocale) || 'Profile', 'Summary', kq.summary)
  }
  for (const kc of store.key_competencies) {
    if (kc.disabled) continue
    push('key_competencies', kc.id, resolve(kc.title, labelLocale) || 'Competency', 'Description', kc.description)
  }
  for (const p of store.projects) {
    if (p.disabled) continue
    const label = resolve(p.customer, labelLocale) || 'Untitled project'
    push('projects', p.id, label, 'Long description', p.long_description)
    for (const h of p.highlights) push('projects', p.id, label, 'Highlight', h)
  }
  for (const w of store.work_experiences) {
    if (w.disabled) continue
    push('work_experiences', w.id, resolve(w.employer, labelLocale) || 'Untitled employer', 'Long description', w.long_description)
  }
  for (const pos of store.positions) {
    if (pos.disabled) continue
    push('positions', pos.id, resolve(pos.name, labelLocale) || 'Untitled role', 'Description', pos.description)
  }
  return out
}

/**
 * Compute the redundancy report. Cross-locale comparisons are never made — a
 * Norwegian sentence agreeing with its own English translation is the app's
 * whole point, not redundancy — so every pass groups by locale first.
 */
export function redundancyReport(
  store: ResumeStore,
  locale: string,
  dismissals: Record<string, string> = {},
  now: Date = new Date(),
): RedundancyReport {
  const fields = collectFields(store, locale)
  const hits: Hit[] = []

  const byLocale = new Map<string, FieldEntry[]>()
  for (const f of fields) {
    const group = byLocale.get(f.locale)
    if (group) group.push(f)
    else byLocale.set(f.locale, [f])
  }

  let indexedTotal = 0
  const sentencesByLocale = new Map<string, SentenceEntry[]>()
  for (const [loc, group] of byLocale) {
    const entries: SentenceEntry[] = []
    for (const field of group) {
      for (const raw of field.text.split(/(?<=[.!?])\s+/)) {
        const original = raw.trim()
        if (!original) continue
        const norm = normalize(original)
        const tokens = norm ? norm.split(' ') : []
        if (tokens.length < SENTENCE_MIN_TOKENS) continue
        entries.push({ field, original, norm, tokenSet: new Set(tokens) })
      }
    }
    indexedTotal += entries.length
    sentencesByLocale.set(loc, entries)
  }

  // The longer original is quoted so the collapse's "longest shared sentence"
  // rule compares what the user would actually see.
  const sentenceHit = (x: SentenceEntry, y: SentenceEntry, loc: string): Hit => ({
    a: x.field, b: y.field, kind: 'sentence', locale: loc,
    sentence: x.original.length >= y.original.length ? x.original : y.original,
    pct: 0,
  })

  for (const [loc, entries] of sentencesByLocale) {
    const byNorm = new Map<string, SentenceEntry[]>()
    for (const e of entries) {
      const group = byNorm.get(e.norm)
      if (group) group.push(e)
      else byNorm.set(e.norm, [e])
    }
    for (const group of byNorm.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (group[i].field.itemKey === group[j].field.itemKey) continue
          hits.push(sentenceHit(group[i], group[j], loc))
        }
      }
    }
    if (indexedTotal > NEAR_PASS_SENTENCE_CAP) continue
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const x = entries[i]
        const y = entries[j]
        // Equal norms were already caught exactly above.
        if (x.field.itemKey === y.field.itemKey || x.norm === y.norm) continue
        if (jaccard(x.tokenSet, y.tokenSet) >= SENTENCE_NEAR_JACCARD) {
          hits.push(sentenceHit(x, y, loc))
        }
      }
    }
  }

  const trigramCache = new Map<FieldEntry, Set<string>>()
  const trigramsOf = (f: FieldEntry): Set<string> => {
    let t = trigramCache.get(f)
    if (!t) {
      t = trigrams(f.tokens)
      trigramCache.set(f, t)
    }
    return t
  }
  for (const [loc, group] of byLocale) {
    const eligible = group.filter((f) => f.tokens.length >= FIELD_MIN_TOKENS)
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        if (eligible[i].itemKey === eligible[j].itemKey) continue
        const jac = jaccard(trigramsOf(eligible[i]), trigramsOf(eligible[j]))
        if (jac >= FIELD_TRIGRAM_JACCARD) {
          hits.push({
            a: eligible[i], b: eligible[j], kind: 'field', locale: loc,
            sentence: null, pct: Math.round(jac * 100),
          })
        }
      }
    }
  }

  // One finding per unordered item pair: 'field' beats 'sentence' (it subsumes
  // any sentence hits between the same two items); among sentence hits the
  // longest quoted sentence is the most recognisable, so it wins.
  const beats = (x: Hit, cur: Hit): boolean => {
    if (x.kind !== cur.kind) return x.kind === 'field'
    if (x.kind === 'field') return x.pct > cur.pct
    return (x.sentence ?? '').length > (cur.sentence ?? '').length
  }
  const best = new Map<string, Hit>()
  for (const hit of hits) {
    const key = dupDismissKey(hit.a.itemKey, hit.b.itemKey)
    const cur = best.get(key)
    if (!cur || beats(hit, cur)) best.set(key, hit)
  }

  const nowMs = now.getTime()
  const findings: RedundancyFinding[] = []
  const snoozed: SnoozedDup[] = []
  for (const [dismissKey, hit] of best) {
    // Normalised a/b order, so the same pair always reads the same way round.
    const [a, b] = hit.a.itemKey <= hit.b.itemKey ? [hit.a, hit.b] : [hit.b, hit.a]
    // Keys are `dup:`-prefixed, so indexing can never hit an inherited
    // Object.prototype member (the lib/lookup.ts hazard) — same as freshness.ts.
    const until = dismissals[dismissKey]
    const t = until ? Date.parse(until) : NaN
    if (!Number.isNaN(t) && t > nowMs) {
      snoozed.push({ key: dismissKey, label: `${a.loc.itemLabel} ↔ ${b.loc.itemLabel}`, until })
      continue
    }
    findings.push({
      a: a.loc,
      b: b.loc,
      kind: hit.kind,
      locale: hit.locale,
      detail: hit.kind === 'field'
        ? `The two descriptions share ${hit.pct}% of their phrasing.`
        : clip(hit.sentence ?? ''),
      dismissKey,
    })
  }

  findings.sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === 'field' ? -1 : 1
    return x.a.itemLabel.localeCompare(y.a.itemLabel)
  })
  snoozed.sort((x, y) => x.label.localeCompare(y.label))

  return { findings, snoozed, comparedFields: fields.length }
}
