/**
 * B4 — the ATS / keyword audit: does the document you are about to send contain
 * the words this employer uses?
 *
 * Two passes, cheapest and most certain first — the same shape as
 * `anonCheck.ts`, and for the same reason: most of the answer is a string
 * search, and a string search is free, exact and needs no model.
 *
 *  1. **Literal coverage** (`auditCoverage`, no model, no network). Take the
 *     terms out of the posting, take the view's ACTUAL exported text
 *     (`viewText.buildViewText` — the same bytes a parser receives, not an
 *     approximation), and see which terms are there. This catches the bulk of
 *     it outright.
 *  2. **Equivalence and placement** (`buildAtsPrompt`, opt-in). Only a model can
 *     say that "K8s" is the posting's "Kubernetes", that the Norwegian export's
 *     "sikkerhetsklarering" answers "security clearance", or which existing
 *     sentence already describes the thing and merely doesn't name it.
 *
 * The three-way status is the point, and it exists because a Resume View is a
 * FILTERED subset. A term can be:
 *   present   — in this view's export. Nothing to do.
 *   elsewhere — in the master CV, but the view excluded the item carrying it.
 *               Fixed by re-including the item: no writing at all, which makes
 *               this the most valuable finding the audit can produce.
 *   absent    — nowhere. Usually means you don't have it; see the warning below.
 *
 * WHAT THIS MUST NOT BECOME: a keyword-stuffing tool. An `absent` term is
 * reported as absent and is never proposed as an addition — the model is told
 * in as many words that it may only point at wording for things the CV already
 * evidences. Padding a CV with terms you cannot defend is the failure mode this
 * whole feature could easily become, and it costs the user an interview.
 */

import type { ResumeStore, ResumeView } from '../types'
import { buildViewText } from './viewText'
import { resolve } from './locales'

export const ATS_SCHEMA = 'resumestudio-ats/v1'

/** Where a posting term was found, if anywhere. */
export type TermStatus = 'present' | 'elsewhere' | 'absent'

export interface AtsTerm {
  /** The term as the posting writes it. */
  term: string
  status: TermStatus
  /** True when the term came from the resume's own skill/role registry. */
  known: boolean
}

export interface AtsCoverage {
  terms: AtsTerm[]
  /** Character length of the audited export — context for the reader. */
  documentChars: number
}

/** What the model adds on top of the literal pass. */
export interface AtsEquivalence {
  key: string
  /** The posting's term. */
  term: string
  /**
   * 'covered'  — the document says this in other words; quote is that wording.
   * 'phrasing' — the CV evidences it but the export never names it; a truthful
   *              wording change would close the gap.
   * 'missing'  — genuinely not there. No suggestion is offered.
   */
  verdict: 'covered' | 'phrasing' | 'missing'
  /** The wording in the document this rests on. Required for 'covered'. */
  quote: string
  /** Only for 'phrasing': where a truthful mention would fit. Never for 'missing'. */
  suggestion: string
}

export interface AtsModelResult {
  equivalences: AtsEquivalence[]
  dropped: string[]
}

export class InvalidAtsResponseError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidAtsResponseError' }
}

/** Cap on terms carried through — a posting with 200 "requirements" has none. */
const MAX_TERMS = 60
export const MAX_POSTING_CHARS = 20_000

/**
 * Words that look like terms and aren't. Deliberately short: this is a
 * precision filter for obvious boilerplate, not a stopword list — the model
 * pass and the user's own eye handle the rest, and over-filtering silently
 * loses real requirements.
 */
const BOILERPLATE = new Set([
  'we', 'you', 'our', 'your', 'the', 'and', 'or', 'for', 'with', 'this', 'that',
  'about', 'role', 'job', 'work', 'team', 'company', 'position', 'candidate',
  'apply', 'application', 'experience', 'years', 'skills', 'requirements',
  'responsibilities', 'qualifications', 'offer', 'benefits', 'salary',
  'we are', 'you will', 'you have',
])

/** Escape a term for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whole-term matcher. `\b` is ASCII-oriented, which would break on Norwegian —
 * "Skydrift" inside "Skydriften" must not count, and "ø" must not read as a
 * word boundary. Unicode letter/number lookaround does the right thing for
 * every language the app offers.
 */
function termRegex(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'iu')
}

export function containsTerm(haystack: string, term: string): boolean {
  if (!term.trim()) return false
  try {
    return termRegex(term).test(haystack)
  } catch {
    // A term that won't compile (stray control chars) simply doesn't match.
    return false
  }
}

/**
 * Candidate terms in a posting.
 *
 * Two sources, both deterministic:
 *  - the resume's OWN skill and role registries. Highest precision by far: if
 *    the posting says a word this consultant has already catalogued as a skill,
 *    it is certainly a term worth checking. These are marked `known`.
 *  - capitalised words and short capitalised phrases, which is what technology
 *    and methodology names look like in both English and Norwegian postings.
 *
 * Sentence-initial capitals are the obvious false positive, so a capitalised
 * word that also appears lowercase elsewhere in the posting is dropped.
 */
export function extractPostingTerms(posting: string, store: ResumeStore, locale: string): string[] {
  const text = posting.slice(0, MAX_POSTING_CHARS)
  // Lowercased term → the first spelling seen, which is what gets reported.
  const found = new Map<string, string>()

  const add = (raw: string) => {
    const term = raw.trim().replace(/[.,;:!?()[\]"']+$/g, '').trim()
    if (term.length < 2 || term.length > 60) return
    if (BOILERPLATE.has(term.toLowerCase())) return
    if (/^\d+$/.test(term)) return
    if (!found.has(term.toLowerCase())) found.set(term.toLowerCase(), term)
  }

  // 1. Registry names the posting actually mentions.
  for (const s of store.skills) {
    const name = resolve(s.name, locale)
    if (name && containsTerm(text, name)) add(name)
  }
  for (const r of store.roles) {
    const name = resolve(r.name, locale)
    if (name && containsTerm(text, name)) add(name)
  }

  // 2. Capitalised runs — "Kubernetes", "Azure DevOps", "Statens vegvesen".
  const lowerWords = new Set(
    (text.match(/\p{Ll}[\p{L}\p{N}+#.-]*/gu) ?? []).map((w) => w.toLowerCase()),
  )
  const runRe = /\p{Lu}[\p{L}\p{N}+#.-]*(?:\s\p{Lu}[\p{L}\p{N}+#.-]*){0,2}/gu
  for (let m = runRe.exec(text); m; m = runRe.exec(text)) {
    const run = m[0]
    const single = !run.includes(' ')
    // A capitalised word that also appears lowercase is almost always just the
    // start of a sentence.
    if (single && lowerWords.has(run.toLowerCase())) continue
    // …and so is a single capitalised word right after a full stop. Real
    // requirements ("Knowledge of COBOL is a plus") get their capital from
    // position, not from being a proper noun. Only `.!?` count, deliberately
    // NOT a newline: a bullet list is where requirements actually live, and
    // treating line starts as sentence starts would throw all of them away.
    // Registry terms are collected above and so survive this regardless.
    if (single && /[.!?]\s+$/.test(text.slice(Math.max(0, m.index - 3), m.index))) continue
    add(run)
  }

  return [...found.values()].slice(0, MAX_TERMS)
}

/**
 * The literal pass. `viewTextOut` is the document being sent; `masterText` is
 * the whole CV, which is what separates "you don't have it" from "this view
 * left it out".
 */
export function auditCoverage(
  terms: readonly string[],
  viewTextOut: string,
  masterText: string,
  knownTerms: ReadonlySet<string> = new Set(),
): AtsCoverage {
  const out: AtsTerm[] = terms.map((term) => ({
    term,
    status: containsTerm(viewTextOut, term)
      ? 'present'
      : containsTerm(masterText, term) ? 'elsewhere' : 'absent',
    known: knownTerms.has(term.toLowerCase()),
  }))

  // Gaps first — the report is a to-do list, and 'present' rows are done.
  const ORDER: Record<TermStatus, number> = { elsewhere: 0, absent: 1, present: 2 }
  out.sort((a, b) => ORDER[a.status] - ORDER[b.status])
  return { terms: out, documentChars: viewTextOut.length }
}

/** Everything the panel needs from the free pass, in one call. */
export function runLiteralAudit(
  store: ResumeStore,
  view: ResumeView,
  locale: string,
  posting: string,
): AtsCoverage {
  const terms = extractPostingTerms(posting, store, locale)
  const known = new Set(
    [...store.skills, ...store.roles]
      .map((e) => resolve(e.name, locale).toLowerCase())
      .filter(Boolean),
  )
  // The master text is rendered through the SAME builder with an unfiltered
  // view, so "present here but not there" is a like-for-like comparison rather
  // than a comparison between an export and a JSON dump.
  const wideOpen: ResumeView = { ...view, excluded_item_ids: [], starred_only: false }
  return auditCoverage(terms, buildViewText(store, view, locale), buildViewText(store, wideOpen, locale), known)
}

/**
 * The model pass. Only the terms the literal pass could NOT find are sent —
 * a term already in the document needs no judgement, and leaving them out keeps
 * the prompt small enough for the fast/cheap models this feature should run on.
 */
export function buildAtsPrompt(
  coverage: AtsCoverage,
  viewTextOut: string,
  posting: string,
  locale: string,
): string {
  const gaps = coverage.terms.filter((t) => t.status !== 'present').map((t) => t.term)

  return [
    'A consultant is about to send the CV below in answer to the job posting',
    'below. A literal text search has already found which of the posting\'s terms',
    'appear in the document. Your job is ONLY the ones it could not find.',
    '',
    'For each term, decide:',
    '- "covered": the document already says this, in different words. Quote the',
    '  exact wording from the CV that says it. Include synonyms, abbreviations',
    `  (K8s / Kubernetes, CI/CD / continuous integration) and CROSS-LANGUAGE`,
    `  matches — this CV is written in "${locale}" and the posting may not be, so`,
    '  a term answered in the other language still counts. Quote it.',
    '- "phrasing": the CV clearly shows the underlying experience but never names',
    '  it the way the posting does. Say which existing sentence would carry the',
    '  term truthfully. This is the useful verdict — look for it carefully.',
    '- "missing": the CV does not show this. Say so and stop.',
    '',
    'THE RULE THAT MATTERS MOST:',
    'Never suggest adding a term the CV cannot back. Do not write wording that',
    'would claim experience that is not evidenced below, and do not soften a',
    '"missing" into a "phrasing" to be helpful. A CV padded with keywords the',
    'applicant cannot defend fails at the interview instead of at the filter,',
    'which is worse for them, not better.',
    '',
    'Reply with ONLY this JSON, no prose before or after:',
    `{"$schema":"${ATS_SCHEMA}","equivalences":[`,
    '  {"term":"the posting term, exactly as given below",',
    '   "verdict":"covered|phrasing|missing",',
    '   "quote":"the CV wording this rests on (required for covered)",',
    '   "suggestion":"phrasing only: where a truthful mention fits. Empty otherwise."}',
    ']}',
    '',
    '--- TERMS TO JUDGE ---',
    gaps.length ? gaps.join('\n') : '(none — every term was found literally)',
    '',
    '--- THE JOB POSTING ---',
    posting.trim().slice(0, MAX_POSTING_CHARS),
    '',
    '--- THE DOCUMENT AS IT WILL BE SENT ---',
    viewTextOut,
  ].join('\n')
}

function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

/**
 * Validate the model reply. Two guards worth the code:
 *  - a term we never asked about is dropped (it isn't in the posting, so the
 *    model invented it);
 *  - a "covered" verdict with no quote is downgraded to "phrasing" — the quote
 *    IS the evidence, and an unquoted claim of coverage is exactly the false
 *    reassurance that would let someone send a CV believing it says something
 *    it doesn't.
 */
export function validateAtsResponse(json: unknown, asked: readonly string[]): AtsModelResult {
  if (!json || typeof json !== 'object') {
    throw new InvalidAtsResponseError('The reply was not a JSON object.')
  }
  const raw = (json as Record<string, unknown>).equivalences
  if (!Array.isArray(raw)) {
    throw new InvalidAtsResponseError('The reply had no "equivalences" array.')
  }

  const wanted = new Map(asked.map((t) => [t.toLowerCase(), t]))
  const equivalences: AtsEquivalence[] = []
  const dropped: string[] = []
  const seen = new Set<string>()

  for (const [i, entry] of raw.slice(0, MAX_TERMS).entries()) {
    if (!entry || typeof entry !== 'object') { dropped.push(`Entry ${i + 1} was not an object.`); continue }
    const e = entry as Record<string, unknown>

    const termRaw = str(e.term, 80)
    const term = wanted.get(termRaw.toLowerCase())
    if (!term) {
      dropped.push(`"${termRaw || '—'}" is not one of the terms from the posting.`)
      continue
    }
    if (seen.has(term)) continue
    seen.add(term)

    const quote = str(e.quote, 500)
    let verdict: AtsEquivalence['verdict'] =
      e.verdict === 'covered' || e.verdict === 'phrasing' ? e.verdict : 'missing'
    if (verdict === 'covered' && !quote) verdict = 'phrasing'

    equivalences.push({
      key: `ats:${term}`,
      term,
      verdict,
      quote,
      // A missing term gets no suggestion — that path is how keyword stuffing
      // would get in.
      suggestion: verdict === 'phrasing' ? str(e.suggestion, 600) : '',
    })
  }

  return { equivalences, dropped }
}

/** Counts for the summary line. */
export function coverageTally(coverage: AtsCoverage): Record<TermStatus, number> {
  const tally: Record<TermStatus, number> = { present: 0, elsewhere: 0, absent: 0 }
  for (const t of coverage.terms) tally[t.status]++
  return tally
}
