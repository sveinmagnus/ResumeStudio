/**
 * B1 — the job fit report: requirement by requirement, what this CV actually
 * evidences, what it doesn't, and what it nearly does.
 *
 * Distinct from `viewTailor.ts`, which answers a different question. Tailoring
 * SELECTS: given a posting, which of my items belong in the version I send?
 * That presumes the decision to apply is already made. This runs before that:
 * can I credibly answer this posting at all, and where will I be pressed?
 *
 * The output is deliberately a table and not a view, and not a score. A single
 * "78% match" number is the thing every job board already produces and nobody
 * can act on; a line-by-line list of "they asked for X — your Cartavio project
 * evidences it / nothing here shows it / you mention Docker and Helm, which is
 * adjacent but you never say Kubernetes" is a to-do list.
 *
 * The third status is the one worth having. `evidenced` and `missing` a careful
 * reader can work out themselves. **`adjacent`** — the requirement is arguably
 * met by something in the CV that doesn't use the posting's words — is where a
 * model reading the whole document earns its keep, and it is also the class of
 * gap the user can close honestly by editing their own text.
 *
 * Anti-invention: every `evidenced`/`adjacent` row must name the CV items it
 * rests on, and those references are resolved against the store. A row that
 * points nowhere is downgraded rather than believed — see `validateJobFit`.
 */

import type { ResumeStore } from '../types'
import { buildCvDigest, itemLabel as labelOf } from './cvDigest'
import { isAdvisorSection, itemsOf } from './cvFields'
import { resolve } from './locales'

export const JOB_FIT_SCHEMA = 'resumestudio-fit/v1'

/** How well the CV answers one requirement. */
export type FitStatus = 'evidenced' | 'adjacent' | 'missing'

const STATUSES: readonly FitStatus[] = ['evidenced', 'adjacent', 'missing']

/** How central a requirement is to the posting. */
export type FitWeight = 'essential' | 'desirable'

export interface FitEvidence {
  section: string
  itemId: string
  itemLabel: string
  /** Why this item supports the requirement, in the model's words. */
  note: string
}

export interface FitRequirement {
  key: string
  /** The requirement as the posting states it. */
  requirement: string
  weight: FitWeight
  status: FitStatus
  evidence: FitEvidence[]
  /**
   * What to do about it: the honest edit that would close an `adjacent` gap, or
   * what a `missing` one will cost. Empty for a clean `evidenced` row.
   */
  suggestion: string
}

export interface JobFitResult {
  /** Two or three sentences: would this application be credible, and where is it thin? */
  verdict: string
  requirements: FitRequirement[]
  dropped: string[]
}

export class InvalidJobFitError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidJobFitError' }
}

const MAX_REQUIREMENTS = 40
/** Longest posting we'll send. Past this it's a brochure, not a spec. */
export const MAX_POSTING_CHARS = 20_000

/** True when there's a posting worth analysing (the Run button needs this). */
export function hasPosting(posting: string): boolean {
  return posting.trim().length > 40
}

export function buildJobFitPrompt(data: ResumeStore, locale: string, posting: string): string {
  const skills = data.skills.map((s) => resolve(s.name, locale)).filter(Boolean)

  return [
    'You are advising a consultant on whether they can credibly answer a job',
    'posting, and where they will be pressed if they apply.',
    '',
    'Work through the posting and pull out every REQUIREMENT it states — skills,',
    'domains, seniority, certifications, languages, ways of working. Judge each',
    'one against the CV below and give it a status:',
    '',
    '- "evidenced": the CV clearly shows it. Name the items that show it.',
    '- "adjacent": the CV shows something that arguably covers it but never uses',
    '  the posting\'s words for it, or shows a near neighbour (they ask for',
    '  Kubernetes; the CV describes Docker and Helm). Name what you found and',
    '  say what honest edit would make it explicit. THIS IS THE MOST USEFUL',
    '  STATUS — look hard for these before calling anything missing.',
    '- "missing": nothing in the CV supports it. Say what that will cost in an',
    '  interview, and do NOT suggest they claim it anyway.',
    '',
    'Also mark each requirement "essential" or "desirable" as the posting frames',
    'it — a missing desirable is not the same problem as a missing essential.',
    '',
    'Then write a "verdict": two or three sentences a friend would say. Is this',
    'worth applying for? Where is it thin? Be direct. If the honest answer is',
    'that the CV does not answer this posting, say so — telling someone to apply',
    'for a role they cannot speak to wastes a week of their life.',
    '',
    'Rules:',
    '- Evidence must be real: use ONLY the section keys and item ids given below.',
    '  If you cannot point at an item, the requirement is not evidenced.',
    '- Do not invent experience, and never suggest wording that would claim it.',
    '- One entry per requirement. Do not split a single requirement into five.',
    '',
    'Reply with ONLY this JSON, no prose before or after:',
    `{"$schema":"${JOB_FIT_SCHEMA}",`,
    ' "verdict":"two or three sentences",',
    ' "requirements":[',
    '   {"requirement":"as the posting states it",',
    '    "weight":"essential|desirable",',
    '    "status":"evidenced|adjacent|missing",',
    '    "evidence":[{"section":"section key","item_id":"item id","note":"why this supports it"}],',
    '    "suggestion":"the honest edit that would close the gap, or what it costs"}',
    ' ]}',
    '',
    `SKILLS REGISTRY: ${skills.length ? skills.join(', ') : '(empty)'}`,
    '',
    '--- JOB POSTING ---',
    posting.trim().slice(0, MAX_POSTING_CHARS),
    '',
    '--- CV ---',
    buildCvDigest(data, { locale, includeShort: false }),
  ].join('\n')
}

function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

/**
 * Validate a reply into a fit report, resolving every evidence reference.
 *
 * A row claiming `evidenced` with no resolvable evidence is DOWNGRADED to
 * `adjacent` rather than dropped: the model saw something, we just can't prove
 * what, and silently deleting the row would leave a requirement unaccounted for
 * in a report whose whole value is completeness. Downgrading keeps it visible
 * and stops it counting as proof.
 */
export function validateJobFit(json: unknown, data: ResumeStore, locale: string): JobFitResult {
  if (!json || typeof json !== 'object') {
    throw new InvalidJobFitError('The reply was not a JSON object.')
  }
  const o = json as Record<string, unknown>
  const raw = o.requirements
  if (!Array.isArray(raw)) {
    throw new InvalidJobFitError('The reply had no "requirements" array.')
  }

  const requirements: FitRequirement[] = []
  const dropped: string[] = []
  const cache = new Map<string, Map<string, Record<string, unknown>>>()

  const lookup = (section: string, id: string): Record<string, unknown> | undefined => {
    if (!isAdvisorSection(section, data)) return undefined
    if (!cache.has(section)) {
      const map = new Map<string, Record<string, unknown>>()
      for (const it of itemsOf(data, section)) {
        if (typeof it.id === 'string') map.set(it.id, it)
      }
      cache.set(section, map)
    }
    return cache.get(section)!.get(id)
  }

  for (const [i, entry] of raw.slice(0, MAX_REQUIREMENTS).entries()) {
    if (!entry || typeof entry !== 'object') { dropped.push(`Requirement ${i + 1} was not an object.`); continue }
    const e = entry as Record<string, unknown>

    const requirement = str(e.requirement, 300)
    if (!requirement) { dropped.push(`Requirement ${i + 1} had no text.`); continue }

    const evidence: FitEvidence[] = []
    for (const ev of Array.isArray(e.evidence) ? e.evidence : []) {
      if (!ev || typeof ev !== 'object') continue
      const r = ev as Record<string, unknown>
      const section = str(r.section, 60)
      const itemId = str(r.item_id, 80)
      const item = lookup(section, itemId)
      if (!item) {
        dropped.push(`"${requirement.slice(0, 40)}…" cited an item that isn't in the CV.`)
        continue
      }
      evidence.push({
        section, itemId,
        itemLabel: labelOf(section, item, locale),
        note: str(r.note, 400),
      })
    }

    let status: FitStatus = STATUSES.includes(e.status as FitStatus)
      ? (e.status as FitStatus)
      : 'missing'
    // Claimed proof we couldn't resolve isn't proof.
    if (status === 'evidenced' && evidence.length === 0) status = 'adjacent'

    requirements.push({
      key: `req:${i}`,
      requirement,
      weight: e.weight === 'desirable' ? 'desirable' : 'essential',
      status,
      evidence,
      suggestion: str(e.suggestion, 600),
    })
  }

  // Essentials first, and within those the gaps first: the report should open
  // on what would sink the application, not on what is already fine.
  const STATUS_ORDER: Record<FitStatus, number> = { missing: 0, adjacent: 1, evidenced: 2 }
  const rank = (r: FitRequirement) =>
    (r.weight === 'essential' ? 0 : 10) + STATUS_ORDER[r.status]
  requirements.sort((a, b) => rank(a) - rank(b))

  return { verdict: str(o.verdict, 1200), requirements, dropped }
}

/** Counts for the summary line, so the panel needn't re-derive them. */
export function fitTally(result: JobFitResult): Record<FitStatus, number> {
  const tally: Record<FitStatus, number> = { evidenced: 0, adjacent: 0, missing: 0 }
  for (const r of result.requirements) tally[r.status]++
  return tally
}
