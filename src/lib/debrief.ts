/**
 * PURE: the project debrief interview — capture what an engagement produced
 * while the consultant still remembers it.
 *
 * The app's quiet failure mode is a CV that is *stored* but not *maintained*:
 * a project ends, nobody writes down what it achieved, and eight months later
 * the details are gone. The debrief turns that into a five-minute ritual: the
 * app asks a handful of pointed questions, the consultant answers in plain
 * prose, and a model reshapes the ANSWERS into the fields the CV already has —
 * highlights, skill links, a short description.
 *
 * Two deliberate boundaries:
 *  - The QUESTIONS need no model. They are derived structurally from what the
 *    project lacks (no highlights → ask for outcomes; no skills → ask what was
 *    used), so the interview works on an install with no AI at all — the
 *    answers can go through the BYO copy-prompt/paste-JSON path.
 *  - The model reshapes, never invents (the keyPoints rule): every draft must
 *    be grounded in the answers or the existing description, and everything is
 *    a review list the user ticks — nothing writes without confirmation.
 */

import type { LocalizedString, Project, ResumeStore, Skill, ProjectSkill, YearMonth } from '../types'
import { resolve } from './locales'
import { richToPlain } from './richText'
import { uuidv4 } from './uuid'

export const DEBRIEF_SCHEMA = 'resumestudio-debrief/v1'

// ─── The interview questions ─────────────────────────────────────────────────

export interface DebriefQuestion {
  id: string
  text: string
  /** Why the question is worth answering — shown as the field hint. */
  hint: string
}

/**
 * The questions this project deserves, derived from what it lacks. Always asks
 * about outcomes and difficulty (the two things that fade fastest from memory);
 * the rest only when the corresponding field is thin.
 */
export function debriefQuestions(project: Project, locale: string): DebriefQuestion[] {
  const out: DebriefQuestion[] = [
    {
      id: 'outcome',
      text: 'What changed for the customer because of this work?',
      hint: 'Numbers make it defensible — percentages, time saved, users reached, money.',
    },
    {
      id: 'hard',
      text: 'What was the hardest problem, and how did you solve it?',
      hint: 'The concrete approach is what an interviewer will ask about.',
    },
  ]

  const skillNames = project.skills
    .map((ps) => resolve(ps.name, locale))
    .filter(Boolean)
  out.push({
    id: 'skills',
    text: skillNames.length
      ? `Besides ${skillNames.slice(0, 8).join(', ')} — which technologies or methods did you use?`
      : 'Which technologies, tools or methods did you use?',
    hint: 'Anything not yet linked to the project. Names, not sentences, are fine.',
  })

  if (project.highlights.length < 3) {
    out.push({
      id: 'highlights',
      text: 'Which two or three results are worth a bullet of their own?',
      hint: 'These become the project highlights a reader skims first.',
    })
  }

  if (richToPlain(resolve(project.long_description, locale)).length < 200) {
    out.push({
      id: 'summary',
      text: 'How would you describe the engagement to a colleague — the problem, your approach, the result?',
      hint: 'A few sentences. This feeds the description.',
    })
  }

  if (project.end === null) {
    out.push({
      id: 'wrap',
      text: 'Has the engagement ended? If not, what is left to do?',
      hint: 'If it has, set the end date on the card too.',
    })
  }

  return out
}

// ─── The prompt & the reply contract ─────────────────────────────────────────

/**
 * The prompt: project context + the consultant's own answers + the reshaping
 * rules. Sent to the configured model, or copied into any external one — the
 * contract is the JSON shape, not the transport.
 */
export function buildDebriefPrompt(
  project: Project,
  locale: string,
  questions: readonly DebriefQuestion[],
  answers: Readonly<Record<string, string>>,
): string {
  const title = resolve(project.customer, locale) || resolve(project.description, locale) || 'this project'
  const linked = project.skills.map((ps) => resolve(ps.name, locale)).filter(Boolean)

  const qa = questions
    .map((q) => ({ q, a: (answers[q.id] ?? '').trim() }))
    .filter((x) => x.a)
    .map((x) => `Q: ${x.q.text}\nA: ${x.a}`)
    .join('\n\n')

  const context = [
    `PROJECT: ${title}`,
    resolve(project.description, locale),
    richToPlain(resolve(project.long_description, locale)),
    ...project.highlights.map((h) => `- ${resolve(h, locale)}`),
  ].filter(Boolean).join('\n')

  return [
    'A consultant has just answered debrief questions about a finished project.',
    'Turn their ANSWERS into CV material. Rules:',
    '- Use ONLY facts stated in the answers or the existing project text below. Never add,',
    '  infer or embellish — an invented achievement on a CV has to be defended in an interview.',
    '- If the answers do not support an item, leave it out. Fewer, true items is the goal.',
    '- "highlights": 2–5 one-line CV bullets, each grounded in an answer. Do not repeat',
    '  an existing highlight.',
    '- "skills": short proper names of technologies/tools/methods the ANSWERS mention',
    linked.length
      ? `  (skip these, they are already linked: ${linked.slice(0, 40).join(', ')}).`
      : '  (none are linked yet).',
    '- "short_description": ONE concise line describing the engagement — only when the',
    '  answers genuinely support one; otherwise omit the field.',
    '- Write in the same language as the answers.',
    '',
    `Reply with ONLY this JSON, no prose:\n{"$schema":"${DEBRIEF_SCHEMA}","highlights":["…"],"skills":["…"],"short_description":"…"}`,
    '',
    '--- PROJECT (existing content) ---',
    context,
    '',
    '--- DEBRIEF ANSWERS ---',
    qa || '(no answers)',
  ].join('\n')
}

export class InvalidDebriefError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidDebriefError' }
}

export interface DebriefDraft {
  highlights: string[]
  skills: string[]
  short_description: string | null
}

/** Validate a reply into a draft, or throw. Tolerant: absent arrays read as empty. */
export function validateDebrief(json: unknown): DebriefDraft {
  if (!json || typeof json !== 'object') throw new InvalidDebriefError('The reply was not a JSON object.')
  const o = json as Record<string, unknown>
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : []
  const highlights = strings(o.highlights)
  const skills = strings(o.skills)
  const short = typeof o.short_description === 'string' ? o.short_description.trim() : ''
  if (!highlights.length && !skills.length && !short) {
    throw new InvalidDebriefError('The reply contained no highlights, skills or short description.')
  }
  return { highlights, skills, short_description: short || null }
}

// ─── Applying the ticked draft ───────────────────────────────────────────────

/** What the user ticked in the review list — the only thing that is written. */
export interface DebriefApplyPick {
  /** Highlight texts to APPEND (in `locale`). */
  highlights: string[]
  /** Existing registry skills to link to the project. */
  linkSkillIds: string[]
  /** Genuinely new skills to create in the registry and link. */
  newSkills: string[]
  /** Replacement one-liner for `locale`'s short description, or null to leave it. */
  shortDescription: string | null
}

/**
 * Apply a ticked debrief in ONE new store (the caller hands it to
 * `replaceData`, so the whole batch is a single undo step). Also stamps
 * `debriefed_at`, which is what retires the Overview nudge.
 */
export function applyDebrief(
  store: ResumeStore,
  projectId: string,
  pick: DebriefApplyPick,
  locale: string,
  now: Date = new Date(),
  idGen: () => string = uuidv4,
): ResumeStore {
  const project = store.projects.find((p) => p.id === projectId)
  if (!project) return store

  const createdSkills: Skill[] = pick.newSkills.map((name) => ({
    id: idGen(),
    resume_id: store.resume?.id ?? project.resume_id,
    name: { [locale]: name },
    total_duration_in_years: 0,
    proficiency: 0,
    is_highlighted: false,
    created_at: now.toISOString(),
  }))

  const alreadyLinked = new Set(project.skills.map((ps) => ps.skill_id))
  const toLink: Array<{ id: string; name: LocalizedString }> = [
    ...pick.linkSkillIds
      .filter((id) => !alreadyLinked.has(id))
      .map((id) => store.skills.find((s) => s.id === id))
      .filter((s): s is Skill => !!s)
      .map((s) => ({ id: s.id, name: s.name })),
    ...createdSkills.map((s) => ({ id: s.id, name: s.name })),
  ]
  const newLinks: ProjectSkill[] = toLink.map((s, i) => ({
    id: idGen(),
    skill_id: s.id,
    name: s.name,
    duration_in_years: 0,
    offset_in_years: 0,
    total_duration_in_years: 0,
    sort_order: project.skills.length + i,
  }))

  const nextProject: Project = {
    ...project,
    highlights: [
      ...project.highlights,
      ...pick.highlights.map((h): LocalizedString => ({ [locale]: h })),
    ],
    skills: [...project.skills, ...newLinks],
    ...(pick.shortDescription
      ? { short_description: { ...(project.short_description ?? {}), [locale]: pick.shortDescription } }
      : {}),
    debriefed_at: now.toISOString(),
  }

  return {
    ...store,
    skills: createdSkills.length ? [...store.skills, ...createdSkills] : store.skills,
    projects: store.projects.map((p) => (p.id === projectId ? nextProject : p)),
  }
}

// ─── The "recently finished" nudge ───────────────────────────────────────────

export interface DebriefCandidate {
  id: string
  label: string
  end: YearMonth
  /** Key to pass to the store's dismissAttention(). */
  dismissKey: string
}

/** How far back a finished project still deserves the nudge. */
export const DEBRIEF_WINDOW_MONTHS = 6

const ymIdx = (ym: YearMonth): number => ym.year * 12 + ((ym.month ?? 12) - 1)

/**
 * Projects that finished recently and have not been debriefed since they
 * ended — the memory-is-still-fresh window. A debrief stamped after the end
 * month counts as done; a dismissal (snoozed via `attention_dismissals`)
 * silences the nudge like any other attention row.
 */
export function debriefCandidates(
  store: ResumeStore,
  now: Date = new Date(),
  dismissals: Readonly<Record<string, string>> = {},
  locale = 'en',
): DebriefCandidate[] {
  const nowIdx = now.getFullYear() * 12 + now.getMonth()
  const nowMs = now.getTime()
  const out: DebriefCandidate[] = []
  for (const p of store.projects) {
    if (p.disabled || !p.end) continue
    const endIdx = ymIdx(p.end)
    if (endIdx > nowIdx || nowIdx - endIdx > DEBRIEF_WINDOW_MONTHS) continue
    if (p.debriefed_at) {
      const t = Date.parse(p.debriefed_at)
      // Debriefed after the end month began = this ending was captured.
      if (!Number.isNaN(t) && new Date(t).getFullYear() * 12 + new Date(t).getMonth() >= endIdx) continue
    }
    const key = `debrief:${p.id}`
    const until = dismissals[key]
    if (until) {
      const t = Date.parse(until)
      if (!Number.isNaN(t) && t > nowMs) continue
    }
    out.push({
      id: p.id,
      label: resolve(p.customer, locale) || resolve(p.description, locale) || 'Untitled project',
      end: p.end,
      dismissKey: key,
    })
  }
  // Most recently finished first — the freshest memory leads.
  return out.sort((a, b) => ymIdx(b.end) - ymIdx(a.end))
}
