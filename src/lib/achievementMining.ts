/**
 * A4 — achievement mining: find outcomes already buried in long prose and
 * propose promoting them to the places a reader actually looks.
 *
 * `keyPoints.ts` does this for ONE project on demand. The reason to do it
 * CV-wide is that the buried-achievement problem is a triage problem: a
 * consultant with forty projects will never open forty cards to check, and the
 * three descriptions that contain a real outcome in their fourth sentence are
 * exactly the ones whose highlights are empty. Only a pass over everything can
 * tell you which three.
 *
 * Strictly EXTRACTION, never invention — the same rule as keyPoints, and the
 * stakes are higher here because the output looks like a claim about the person:
 * every proposed line must be traceable to a sentence in the source, and the
 * model is asked to quote that sentence so the reviewer can check it without
 * hunting. A proposal whose evidence doesn't appear in the source is a
 * fabrication with a citation, which is worse than one without.
 *
 * Two destinations, because the CV has two homes for an achievement:
 *  - `highlight` — a bullet on the project/role it came from.
 *  - `competency` — a headline strength for the shared Key Competencies
 *    library, when the same capability shows up across SEVERAL items.
 */

import { v4 as uuidv4 } from 'uuid'
import type { KeyCompetency, LocalizedString, ResumeStore } from '../types'
import { buildCvDigest, itemLabel as labelOf } from './cvDigest'
import { isAdvisorSection, itemsOf } from './cvFields'

export const MINING_SCHEMA = 'resumestudio-achievements/v1'

export type AchievementTarget = 'highlight' | 'competency'

export interface Achievement {
  key: string
  target: AchievementTarget
  /** Where it goes (highlight) or where it came from (competency). */
  section: string
  itemId: string
  itemLabel: string
  /** The proposed line — a highlight bullet, or a competency title. */
  text: string
  /** For a competency, the longer description. Empty for a highlight. */
  detail: string
  /** The sentence from the source this is drawn from — the check on invention. */
  evidence: string
  /**
   * The same text in other locales, keyed by locale code — filled by the panel
   * from the translation path before applying.
   *
   * A CV maintained in two languages must stay maintained in two languages: an
   * accepted highlight that lands only in the primary column silently makes the
   * secondary version of the CV say less, and the gap is invisible until an
   * export goes out. So the panel translates first and the write fills both
   * columns at once. Absent = primary only (nothing configured to translate
   * with), which is honest rather than broken.
   */
  translations?: Record<string, { text: string; detail: string }>
}

export interface MiningResult {
  achievements: Achievement[]
  dropped: string[]
}

export class InvalidMiningError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidMiningError' }
}

const MAX_ACHIEVEMENTS = 40

/** Sections that own achievements worth mining — the ones describing WORK. */
export const MINING_SECTIONS: readonly string[] = ['projects', 'work_experiences', 'positions']

export function buildMiningPrompt(data: ResumeStore, locale: string): string {
  return [
    'You are looking through a consultant\'s CV for achievements that are already',
    'written down but buried inside long descriptions, where a reader skimming',
    'will miss them.',
    '',
    'An achievement worth surfacing is a RESULT or a distinctive RESPONSIBILITY:',
    'something delivered, a scale handled, a problem solved, a team led, a',
    'decision owned. "Worked on the platform" is not one. "Took the platform',
    'from weekly to daily releases" is.',
    '',
    'Propose two kinds of promotion:',
    '- "highlight": a single line to add as a bullet on the item it came from.',
    '  Keep it under ~20 words. Do not repeat something already in that item\'s',
    '  highlights list.',
    '- "competency": a headline strength for the CV\'s shared competency library,',
    'when the SAME capability is demonstrated across several items. Give it a',
    '  short title and a one- or two-sentence description. Name the item it is',
    '  most clearly evidenced by.',
    '',
    'THE RULE THAT MATTERS: every proposal must be supported by text that is',
    'already in the description. Copy the supporting sentence verbatim into',
    '"evidence". If you cannot quote it, do not propose it. Do not add numbers,',
    'scales, technologies or outcomes that are not written down. Do not restate',
    'a description\'s opening line as an achievement.',
    '',
    'Write in the same language as the source text.',
    '',
    'Reply with ONLY this JSON, no prose before or after:',
    `{"$schema":"${MINING_SCHEMA}","achievements":[`,
    '  {"target":"highlight|competency",',
    '   "section":"the section key exactly as given below",',
    '   "item_id":"the id exactly as given below",',
    '   "text":"the highlight line, or the competency title",',
    '   "detail":"competency only: one or two sentences. Empty for a highlight.",',
    '   "evidence":"the sentence from the description that supports this"}',
    ']}',
    '',
    'An empty list is a valid answer when everything is already surfaced.',
    '',
    '--- CV ---',
    buildCvDigest(data, { locale, sections: MINING_SECTIONS, includeShort: false }),
  ].join('\n')
}

function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

/**
 * Validate a reply into achievements. Unknown references are dropped with a
 * note, as everywhere else; so is any proposal with no evidence quote, since
 * the quote is the only thing separating extraction from invention.
 */
export function validateMining(json: unknown, data: ResumeStore, locale: string): MiningResult {
  if (!json || typeof json !== 'object') {
    throw new InvalidMiningError('The reply was not a JSON object.')
  }
  const raw = (json as Record<string, unknown>).achievements
  if (!Array.isArray(raw)) {
    throw new InvalidMiningError('The reply had no "achievements" array.')
  }

  const achievements: Achievement[] = []
  const dropped: string[] = []
  const cache = new Map<string, Map<string, Record<string, unknown>>>()

  for (const [i, entry] of raw.slice(0, MAX_ACHIEVEMENTS).entries()) {
    if (!entry || typeof entry !== 'object') { dropped.push(`Entry ${i + 1} was not an object.`); continue }
    const e = entry as Record<string, unknown>

    const section = str(e.section, 60)
    if (!isAdvisorSection(section, data)) {
      dropped.push(`Entry ${i + 1} named an unknown section ("${section || '—'}").`)
      continue
    }
    if (!cache.has(section)) {
      const map = new Map<string, Record<string, unknown>>()
      for (const it of itemsOf(data, section)) {
        if (typeof it.id === 'string') map.set(it.id, it)
      }
      cache.set(section, map)
    }
    const item = cache.get(section)!.get(str(e.item_id, 80))
    if (!item) { dropped.push(`Entry ${i + 1} pointed at an item that isn't in ${section}.`); continue }

    const text = str(e.text, 300)
    if (!text) { dropped.push(`Entry ${i + 1} had no text.`); continue }

    // No quote, no proposal. This is the whole anti-invention contract.
    const evidence = str(e.evidence, 600)
    if (!evidence) {
      dropped.push(`Entry ${i + 1} ("${text.slice(0, 40)}…") quoted no supporting text.`)
      continue
    }

    const target: AchievementTarget = e.target === 'competency' ? 'competency' : 'highlight'
    // A highlight can only land on a section that HAS highlights.
    if (target === 'highlight' && !Array.isArray(item.highlights)) {
      dropped.push(`Entry ${i + 1} proposed a highlight for ${section}, which has no highlights.`)
      continue
    }

    achievements.push({
      key: `${section}:${item.id as string}:${target}:${i}`,
      target,
      section,
      itemId: item.id as string,
      itemLabel: labelOf(section, item, locale),
      text,
      detail: target === 'competency' ? str(e.detail, 800) : '',
      evidence,
    })
  }

  return { achievements, dropped }
}

/**
 * Apply accepted achievements, returning a NEW store for `replaceData` (one
 * undo step for the batch — see CLAUDE.md §7).
 *
 * Both operations ADD; neither rewrites existing text. That's deliberate: this
 * pass reads prose and proposes a summary of it, so the source must survive for
 * the claim to stay checkable. A highlight that replaced the sentence it came
 * from would destroy its own evidence.
 *
 * New competencies are created **unstarred and at the end** of the library, and
 * are NOT added to any profile's bundle. Bundle membership is the profile's
 * business (shape v12, §4) and joining one silently would change what every
 * view built on that profile exports.
 */
/**
 * One localized value for an achievement: the primary locale plus whatever the
 * panel managed to translate. Empty translations are skipped rather than stored
 * as `''`, which would read as "deliberately blank" everywhere else.
 */
function localized(
  a: Achievement,
  locale: string,
  pick: (t: { text: string; detail: string }) => string,
): LocalizedString {
  const out: LocalizedString = { [locale]: pick({ text: a.text, detail: a.detail }) }
  for (const [code, t] of Object.entries(a.translations ?? {})) {
    const value = pick(t).trim()
    if (code !== locale && value) out[code] = value
  }
  return out
}

export function applyAchievements(
  data: ResumeStore,
  accepted: readonly Achievement[],
  locale: string,
): { data: ResumeStore; highlights: number; competencies: number } {
  if (!accepted.length) return { data, highlights: 0, competencies: 0 }

  const next = { ...data } as unknown as Record<string, unknown>
  let highlights = 0
  let competencies = 0

  // ── Highlights, grouped so each section array is copied once ──
  const bySection = new Map<string, Achievement[]>()
  for (const a of accepted) {
    if (a.target !== 'highlight') continue
    const list = bySection.get(a.section) ?? []
    list.push(a)
    bySection.set(a.section, list)
  }
  for (const [section, list] of bySection) {
    const arr = next[section]
    if (!Array.isArray(arr)) continue
    const copy = [...(arr as Array<Record<string, unknown>>)]
    for (const a of list) {
      const idx = copy.findIndex((it) => it.id === a.itemId)
      if (idx === -1) continue
      const item = copy[idx]
      const existing = Array.isArray(item.highlights) ? (item.highlights as LocalizedString[]) : []
      // Re-running the pass shouldn't stack duplicates of the same line.
      if (existing.some((h) => (h?.[locale] ?? '').trim() === a.text)) continue
      copy[idx] = { ...item, highlights: [...existing, localized(a, locale, (t) => t.text)] }
      highlights++
    }
    next[section] = copy
  }

  // ── New competencies ──
  const newOnes = accepted.filter((a) => a.target === 'competency')
  if (newOnes.length) {
    const existing = [...data.key_competencies]
    const resumeId = existing[0]?.resume_id ?? data.resume?.id ?? ''
    for (const a of newOnes) {
      const competency: KeyCompetency = {
        id: uuidv4(),
        resume_id: resumeId,
        title: localized(a, locale, (t) => t.text),
        description: localized(a, locale, (t) => t.detail || t.text),
        sort_order: existing.length,
        starred: false,
        disabled: false,
      }
      existing.push(competency)
      competencies++
    }
    next.key_competencies = existing
  }

  return { data: next as unknown as ResumeStore, highlights, competencies }
}
