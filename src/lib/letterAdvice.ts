/**
 * B5 — two advanced passes over a cover letter: several ANGLES to choose
 * between, and a CRITIQUE of the one you wrote.
 *
 * The existing draft assist (`buildCoverLetterPrompt`) answers "write me a
 * letter" and returns one. That is the right shape for a small model and the
 * wrong shape for the actual problem: the hard part of a cover letter is not
 * producing paragraphs, it is deciding which of several true stories to tell.
 * A consultant who has done both public-sector integration and startup
 * platform work can open on either, and the choice is worth more than the
 * prose. So the angles pass returns THREE complete letters with the reasoning
 * for each, and the choice stays the user's.
 *
 * The critique pass exists because the letter is the one document here the user
 * usually writes themselves. Everything else in the app can be drafted and
 * reviewed; a letter is written, and then it is sent with no second reader.
 * This is the second reader. It never rewrites — the notes point at what a
 * hiring manager would notice, and the user fixes it in their own voice.
 *
 * Both are grounded the same way the draft is: the posting plus the linked
 * view's filtered evidence, so a letter can't promise what the CV it travels
 * with doesn't show.
 */

import type { CoverLetter, ResumeStore } from '../types'
import { applyView } from './viewFilter'
import { buildCvDigest } from './cvDigest'
import { resolve } from './locales'

export const LETTER_ANGLES_SCHEMA = 'resumestudio-letter-angles/v1'
export const LETTER_CRITIQUE_SCHEMA = 'resumestudio-letter-critique/v1'

export class InvalidLetterAdviceError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidLetterAdviceError' }
}

/** One complete alternative letter, with the reason to pick it. */
export interface LetterAngle {
  key: string
  /** Short name for the approach, e.g. "Lead with the integration record". */
  name: string
  /** Who this lands with and why — the thing being chosen between. */
  rationale: string
  /** The full letter body: paragraphs between greeting and sign-off. */
  body: string
}

export type CritiqueSeverity = 'high' | 'medium' | 'low'
const SEVERITIES: readonly CritiqueSeverity[] = ['high', 'medium', 'low']

/** One thing a reader would notice. Advisory — never a replacement paragraph. */
export interface CritiqueNote {
  key: string
  severity: CritiqueSeverity
  title: string
  detail: string
  /** Optional: a question only the applicant can answer. */
  ask?: string
}

export interface CritiqueResult {
  /** One or two sentences: how does this land as a whole? */
  overall: string
  notes: CritiqueNote[]
}

const MAX_ANGLES = 4
const MAX_NOTES = 20

/** The shared grounding block: who, where they're applying, and the evidence. */
function context(store: ResumeStore, letter: CoverLetter, locale: string): string {
  const view = letter.view_id ? store.views.find((v) => v.id === letter.view_id) ?? null : null
  // The evidence is the CV THIS LETTER TRAVELS WITH, not the master CV: a letter
  // that pitches a project the attached view excluded reads as a different
  // person's application.
  const source = view ? applyView(store, view) : store

  const company = resolve(letter.company, locale).trim()
  const role = resolve(letter.role_applied, locale).trim()
  const name = (store.resume?.full_name ?? '').trim()

  return [
    `APPLICANT: ${name || '(unnamed)'}`,
    `APPLYING TO: ${company || '(unnamed company)'}${role ? ` — ${role}` : ''}`,
    view ? `CV VERSION ATTACHED: "${view.name}" (the evidence below is exactly what it contains)` : 'CV VERSION: the full master CV',
    '',
    '--- JOB POSTING ---',
    (letter.posting ?? '').trim() || '(no posting text was provided — work from the role and evidence)',
    '',
    '--- CV EVIDENCE ---',
    buildCvDigest(source, { locale, maxFieldChars: 400, includeShort: false }),
  ].join('\n')
}

/** True when there's enough to work from (the Run buttons need this). */
export function hasLetterContext(letter: CoverLetter): boolean {
  return ((letter.posting ?? '').trim().length > 40)
    || Object.values(letter.role_applied ?? {}).some((v) => (v ?? '').trim().length > 0)
}

export function buildLetterAnglesPrompt(
  store: ResumeStore,
  letter: CoverLetter,
  locale: string,
  count = 3,
): string {
  const n = Math.min(Math.max(count, 2), MAX_ANGLES)
  return [
    `Draft ${n} GENUINELY DIFFERENT cover letters for the same application.`,
    '',
    'Different means a different story, not different wording: a different',
    'opening claim, a different piece of evidence carrying the weight, a',
    'different reason this person is the answer. If two of them could be edited',
    'into each other, you have written one letter twice.',
    '',
    'For each, give:',
    '- "name": what the approach is, in a few words.',
    '- "rationale": who it lands with and what it risks. This is what the',
    '  applicant is actually choosing between, so be concrete about the',
    '  trade-off — do not write marketing copy for your own draft.',
    '- "body": the complete letter body. The paragraphs between the greeting and',
    '  the sign-off, and nothing else: no "Dear …", no closing, no signature, no',
    '  subject line, no markdown. Three to four tight paragraphs.',
    '',
    'Grounding — the rule that makes these usable:',
    '- Every claim must rest on the evidence below. Do not invent employers,',
    '  clients, numbers, tools or credentials.',
    '- If the posting asks for something the evidence does not show, do not claim',
    '  it. A letter that overstates is found out at interview.',
    '- Do not restate the CV. The reader has it; the letter says why it matters here.',
    `- Write in the language with code "${locale}".`,
    '',
    'Reply with ONLY this JSON, no prose before or after:',
    `{"$schema":"${LETTER_ANGLES_SCHEMA}","angles":[`,
    '  {"name":"...","rationale":"...","body":"paragraph\\n\\nparagraph"}',
    ']}',
    '',
    context(store, letter, locale),
  ].join('\n')
}

export function buildLetterCritiquePrompt(
  store: ResumeStore,
  letter: CoverLetter,
  locale: string,
): string {
  const body = (letter.body?.[locale] ?? '').trim()
  return [
    'Read this cover letter as the person who will decide whether to interview',
    'the applicant, and say what you notice. Be a useful second reader, not a',
    'polite one.',
    '',
    'Look for:',
    '- CLAIMS THE CV DOES NOT SUPPORT. Check every claim against the evidence',
    '  below. This is the most serious problem a letter can have and the one the',
    '  applicant is least able to see.',
    '- REQUIREMENTS FROM THE POSTING THE LETTER NEVER ANSWERS.',
    '- A WEAK OPENING. Does the first sentence say anything only this applicant',
    '  could say, or could it head any letter for any role?',
    '- RESTATING THE CV instead of explaining why it matters here.',
    '- EMPTY PHRASES: "passionate about", "proven track record", "fast-paced',
    '  environment", "I believe I would be a great fit".',
    '- LENGTH AND SHAPE: paragraphs that do no work.',
    '- TONE that does not match the employer the posting describes.',
    '',
    'Rules:',
    '- Do NOT rewrite the letter or supply replacement paragraphs. Say what is',
    '  wrong and why a reader would care; the applicant fixes it in their voice.',
    '- Where the fix needs a fact only they have, put it in "ask".',
    '- "high" = would cost the interview. Be sparing.',
    '- If it is a good letter, say so briefly and return few notes. Padding a',
    '  critique to look thorough wastes the one read they will act on.',
    '',
    'Reply with ONLY this JSON, no prose before or after:',
    `{"$schema":"${LETTER_CRITIQUE_SCHEMA}",`,
    ' "overall":"one or two sentences on how it lands",',
    ' "notes":[{"severity":"high|medium|low","title":"...","detail":"...","ask":"optional"}]}',
    '',
    '--- THE LETTER AS WRITTEN ---',
    body || '(the letter body is empty)',
    '',
    context(store, letter, locale),
  ].join('\n')
}

function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

/** Strip anything that would land a greeting or sign-off in the body field. */
function tidyBody(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
  // A greeting the prompt asked for and the model added anyway.
  s = s.replace(/^(?:dear|hi|hello|hei|kjære)\b[^\n]*\n+/i, '')
  // A sign-off block at the end ("Kind regards,\nName").
  s = s.replace(/\n+(?:kind regards|best regards|sincerely|yours \w+|regards|mvh|med vennlig hilsen)[^\n]*(?:\n[^\n]*)?$/i, '')
  return s.trim()
}

export function validateLetterAngles(json: unknown): LetterAngle[] {
  if (!json || typeof json !== 'object') {
    throw new InvalidLetterAdviceError('The reply was not a JSON object.')
  }
  const raw = (json as Record<string, unknown>).angles
  if (!Array.isArray(raw)) {
    throw new InvalidLetterAdviceError('The reply had no "angles" array.')
  }

  const angles: LetterAngle[] = []
  for (const [i, entry] of raw.slice(0, MAX_ANGLES).entries()) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const body = tidyBody(str(e.body, 6000))
    if (!body) continue
    angles.push({
      key: `angle:${i}`,
      name: str(e.name, 120) || `Option ${i + 1}`,
      rationale: str(e.rationale, 600),
      body,
    })
  }

  if (!angles.length) throw new InvalidLetterAdviceError('The reply contained no usable letters.')
  return angles
}

export function validateLetterCritique(json: unknown): CritiqueResult {
  if (!json || typeof json !== 'object') {
    throw new InvalidLetterAdviceError('The reply was not a JSON object.')
  }
  const o = json as Record<string, unknown>
  const raw = Array.isArray(o.notes) ? o.notes : []

  const notes: CritiqueNote[] = []
  for (const [i, entry] of raw.slice(0, MAX_NOTES).entries()) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const title = str(e.title, 200)
    const detail = str(e.detail, 1000)
    if (!title && !detail) continue
    notes.push({
      key: `note:${i}`,
      severity: SEVERITIES.includes(e.severity as CritiqueSeverity)
        ? (e.severity as CritiqueSeverity)
        : 'medium',
      title: title || detail.slice(0, 80),
      detail,
      ...(str(e.ask, 300) ? { ask: str(e.ask, 300) } : {}),
    })
  }

  notes.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))

  const overall = str(o.overall, 800)
  // "Nothing to flag" is a legitimate, useful answer — but a reply with neither
  // an overall read nor a single note is an empty response, not a clean bill.
  if (!overall && !notes.length) {
    throw new InvalidLetterAdviceError('The reply contained no critique.')
  }
  return { overall, notes }
}
