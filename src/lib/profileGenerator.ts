/**
 * D1 — generate positioning **Profiles**, each with its ordered competency
 * bundle, from the whole CV plus a FOCUS BRIEF the user writes.
 *
 * Why the brief is required rather than optional: a profile is a claim about
 * what this person is FOR. The CV can tell a model what someone has done; it
 * cannot tell it which of those things they want to be hired for next, which
 * audience is reading, or which half of a career they are deliberately moving
 * away from. Asked without a brief, a model averages the CV — and the average
 * of a varied consulting career is a profile that says "experienced IT
 * professional", which is the exact thing the Profiles feature exists to
 * replace. So the brief is the input; the CV is the evidence.
 *
 * The bundle is the other half. A profile in this app OWNS an ordered list of
 * competency ids (shape v12, CLAUDE.md §4), and a view presents exactly that
 * bundle — so a generated profile with no bundle is half a feature. The model
 * picks from the EXISTING competency library first (reuse is the point of a
 * shared library) and may propose new ones only for a strength the library
 * genuinely lacks.
 *
 * Grounding rules, as everywhere: the summary may only claim what the CV
 * evidences. A profile is the most invention-prone thing in the app — it's
 * pure prose about a person, with no field to check it against — so the model
 * is asked to name the items it drew each claim from, and those references are
 * shown in the preview.
 */

import { uuidv4 } from './uuid'
import type { KeyCompetency, KeyQualification, ResumeStore } from '../types'
import { buildCvDigest } from './cvDigest'
import { resolve } from './locales'
import { richToPlain } from './richText'

export const PROFILE_SCHEMA = 'resumestudio-profiles/v1'

/** One competency the model wants in a bundle: either existing, or new. */
export interface BundleEntry {
  /** Set when it resolved to a competency already in the library. */
  id: string | null
  title: string
  description: string
  /** True when this is a proposal to create a new competency. */
  isNew: boolean
}

export interface DraftProfile {
  key: string
  tagLine: string
  summary: string
  summaryShort: string
  /** Why this angle, in the model's words — preview only, never stored. */
  rationale: string
  /** Item titles the summary draws on — the grounding check, preview only. */
  evidence: string[]
  bundle: BundleEntry[]
}

export interface ProfileDraftResult {
  profiles: DraftProfile[]
  dropped: string[]
}

export class InvalidProfileDraftError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidProfileDraftError' }
}

const MAX_PROFILES = 6
const MAX_BUNDLE = 12

/** How many profiles to ask for. More than a handful stops being a choice. */
export const DEFAULT_PROFILE_COUNT = 3

export interface ProfileFocus {
  /** The user's brief: target role, audience, angle, what to play down. */
  brief: string
  /** How many alternative profiles to draft. */
  count?: number
}

/** The competency library, as ids the model may reference. */
function competencyCatalog(data: ResumeStore, locale: string): string {
  const rows = data.key_competencies
    .filter((c) => !c.disabled)
    .map((c) => {
      const title = resolve(c.title, locale)
      const desc = richToPlain(resolve(c.description, locale) ?? '').replace(/\s+/g, ' ').trim()
      return `- id: ${c.id}\n  title: ${title}${desc ? `\n  description: ${desc.slice(0, 300)}` : ''}`
    })
  return rows.length ? rows.join('\n') : '(the library is empty — propose new ones)'
}

export function buildProfilePrompt(
  data: ResumeStore,
  locale: string,
  focus: ProfileFocus,
): string {
  const count = Math.min(Math.max(focus.count ?? DEFAULT_PROFILE_COUNT, 1), MAX_PROFILES)
  const brief = focus.brief.trim()

  return [
    'You are writing the opening PROFILE of a consultant\'s CV — the few lines a',
    'reader sees first, which say what this person is for.',
    '',
    'THE BRIEF FROM THE PERSON (this decides the angle; the CV below is only the',
    'evidence you may draw on):',
    brief || '(no brief given — infer the strongest single angle from the CV)',
    '',
    `Draft ${count} ALTERNATIVE profiles serving that brief — genuinely different`,
    'angles, not three rewordings of one. Each needs:',
    '- "tag_line": the headline identity, e.g. "Cloud architect, public sector".',
    '  A few words. This doubles as the resume title, so it must stand alone.',
    '- "summary": the full profile paragraph. 3–6 sentences.',
    '- "summary_short": one or two sentences, for compact layouts.',
    '- "rationale": one line on who this angle is aimed at and why.',
    '- "evidence": the titles of the CV items your claims rest on.',
    '- "bundle": the ordered competencies this profile should present.',
    '',
    'ABOUT THE BUNDLE — this is not a list of skills, it is the 4–8 headline',
    'strengths shown beside this profile, strongest first:',
    '- PREFER competencies already in the library below; give their id verbatim.',
    '- Propose a new one (id: null, with a title and description) ONLY where the',
    '  brief needs a strength the library genuinely lacks.',
    '- Order matters: the first is the one a reader must remember.',
    '',
    'GROUNDING — the rule that makes this usable:',
    '- Every claim must be supported by the CV below. Do not state years of',
    '  experience, seniority, team sizes, industries or outcomes that are not',
    '  evidenced there.',
    '- Do not describe them as "passionate", "results-driven" or "dynamic".',
    '  Say what they have done and can do.',
    '- Emphasis is yours to choose; facts are not. Leaving something out to serve',
    '  the brief is fine. Adding something is not.',
    `- Write in the same language as the CV text below.`,
    '',
    'Reply with ONLY this JSON, no prose before or after:',
    `{"$schema":"${PROFILE_SCHEMA}","profiles":[`,
    '  {"tag_line":"...","summary":"...","summary_short":"...",',
    '   "rationale":"...","evidence":["item title","item title"],',
    '   "bundle":[{"id":"existing-competency-id","title":"","description":""},',
    '             {"id":null,"title":"A new strength","description":"One or two sentences."}]}',
    ']}',
    '',
    '--- COMPETENCY LIBRARY ---',
    competencyCatalog(data, locale),
    '',
    '--- CV ---',
    buildCvDigest(data, { locale, includeShort: false }),
  ].join('\n')
}

function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

/** Validate a reply into draft profiles, resolving bundle ids against the library. */
export function validateProfileDraft(
  json: unknown,
  data: ResumeStore,
  locale: string,
): ProfileDraftResult {
  if (!json || typeof json !== 'object') {
    throw new InvalidProfileDraftError('The reply was not a JSON object.')
  }
  const raw = (json as Record<string, unknown>).profiles
  if (!Array.isArray(raw)) {
    throw new InvalidProfileDraftError('The reply had no "profiles" array.')
  }

  const known = new Map<string, KeyCompetency>()
  for (const c of data.key_competencies) if (!c.disabled) known.set(c.id, c)

  const profiles: DraftProfile[] = []
  const dropped: string[] = []

  for (const [i, entry] of raw.slice(0, MAX_PROFILES).entries()) {
    if (!entry || typeof entry !== 'object') { dropped.push(`Profile ${i + 1} was not an object.`); continue }
    const p = entry as Record<string, unknown>

    const tagLine = str(p.tag_line, 200)
    const summary = str(p.summary, 3000)
    if (!tagLine && !summary) { dropped.push(`Profile ${i + 1} had no tag line or summary.`); continue }

    const bundle: BundleEntry[] = []
    const seen = new Set<string>()
    const rawBundle = Array.isArray(p.bundle) ? p.bundle.slice(0, MAX_BUNDLE) : []
    for (const b of rawBundle) {
      if (!b || typeof b !== 'object') continue
      const e = b as Record<string, unknown>
      const id = str(e.id, 80)
      const existing = id ? known.get(id) : undefined
      if (id && !existing) {
        // An id that doesn't resolve is a hallucination, not a new competency:
        // a genuine proposal comes back with id null. Dropping it beats
        // creating a duplicate of something already in the library.
        dropped.push(`Profile ${i + 1} referenced a competency that isn't in the library.`)
        continue
      }
      if (existing) {
        if (seen.has(existing.id)) continue
        seen.add(existing.id)
        bundle.push({
          id: existing.id,
          title: resolve(existing.title, locale),
          description: richToPlain(resolve(existing.description, locale) ?? '').trim(),
          isNew: false,
        })
        continue
      }
      const title = str(e.title, 200)
      if (!title) continue
      bundle.push({ id: null, title, description: str(e.description, 1000), isNew: true })
    }

    profiles.push({
      key: `profile:${i}`,
      tagLine,
      summary,
      summaryShort: str(p.summary_short, 800),
      rationale: str(p.rationale, 400),
      evidence: Array.isArray(p.evidence)
        ? p.evidence.map((x) => str(x, 160)).filter(Boolean).slice(0, 12)
        : [],
      bundle,
    })
  }

  if (!profiles.length && !dropped.length) dropped.push('The reply contained no usable profiles.')
  return { profiles, dropped }
}

/**
 * Add ONE drafted profile (and any new competencies it needs) to the store,
 * returning a NEW store for `replaceData` — one undo step.
 *
 * Adds, never replaces: existing profiles are untouched, and the new one lands
 * disabled=false but NOT starred. A view picks the first non-disabled profile
 * (`selectedViewProfile`), so a generated profile inserted at the TOP would
 * silently change what every existing view presents. It goes last instead, and
 * the user promotes it when they mean to.
 */
export function applyProfileDraft(
  data: ResumeStore,
  draft: DraftProfile,
  locale: string,
): ResumeStore {
  const competencies = [...data.key_competencies]
  const resumeId = data.resume?.id ?? competencies[0]?.resume_id ?? ''
  const competencyIds: string[] = []

  for (const entry of draft.bundle) {
    if (entry.id) { competencyIds.push(entry.id); continue }
    const created: KeyCompetency = {
      id: uuidv4(),
      resume_id: resumeId,
      title: { [locale]: entry.title },
      description: { [locale]: entry.description || entry.title },
      sort_order: competencies.length,
      starred: false,
      disabled: false,
    }
    competencies.push(created)
    competencyIds.push(created.id)
  }

  const profile: KeyQualification = {
    id: uuidv4(),
    resume_id: resumeId,
    label: {},
    tag_line: { [locale]: draft.tagLine },
    summary: { [locale]: draft.summary },
    ...(draft.summaryShort ? { summary_short: { [locale]: draft.summaryShort } } : {}),
    key_points: [],
    
    competency_ids: competencyIds,
    sort_order: data.key_qualifications.length,
    starred: false,
    disabled: false,
    internal_notes: null,
  }

  return {
    ...data,
    key_competencies: competencies,
    key_qualifications: [...data.key_qualifications, profile],
  }
}
