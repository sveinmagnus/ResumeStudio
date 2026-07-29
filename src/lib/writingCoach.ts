/**
 * PURE: the "strengthen this description" assist — a CV writing coach.
 *
 * The obvious way to build this is the wrong way. "Make my description more
 * impressive" is the single most invention-prone thing you can ask a model:
 * the house style of CV prose is quantified achievement, so a model with no
 * numbers to hand will supply them — "reduced latency by 40%", "led a team of
 * six" — and an invented metric on a CV is one you have to defend, under
 * questioning, to someone holding the CV. That's a worse outcome than a flat
 * description.
 *
 * So the task is split in two, and the split is the whole design:
 *
 *   rewrite  — STRICTLY the facts already in the source. Active voice, outcome
 *              first, filler gone. No new facts, no new numbers, no adjectives
 *              the text doesn't earn.
 *   asks     — what would make it stronger but ISN'T in the text, handed back
 *              as questions for the user to answer themselves ("What was the
 *              team size?"). This is the actual coaching: it tells you what a
 *              reader wants to know, and leaves you the only one who can say.
 *
 * The user reviews the rewrite against the original before anything is written
 * (see WritingCoachPanel) — like every assist here, it drafts, it never saves.
 * Drafts stay in ONE locale: rewriting the source locale and leaving the other
 * column stale is honest (the Draft-translation path owns the other column);
 * silently rewriting both would be a translation nobody asked for.
 */

import type { LocalizedString } from '../types'
import { richToPlain } from './richText'

export const WRITING_COACH_SCHEMA = 'resumestudio-rewrite/v1'

export interface CoachResult {
  /** The improved text — same facts, better prose. */
  rewrite: string
  /** Questions whose answers would strengthen it; the user answers, not the model. */
  asks: string[]
}

export class InvalidCoachResponseError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidCoachResponseError' }
}

/** Longest source we'll coach. Past this it's a document, not a description. */
const MAX_SOURCE_CHARS = 6_000

/** True when there's prose worth coaching (the button is disabled otherwise). */
export function hasCoachableSource(source: LocalizedString, locale: string): boolean {
  return richToPlain(source[locale] ?? '').trim().length > 0
}

/**
 * The prompt. `source` is rich text, flattened so the model never sees markup
 * it would echo back into a field that then has to be re-sanitised.
 */
export function buildCoachPrompt(source: LocalizedString, locale: string): string {
  const text = richToPlain(source[locale] ?? '').trim().slice(0, MAX_SOURCE_CHARS)

  return [
    'You are helping a consultant tighten one description on their CV.',
    '',
    'Produce TWO things:',
    '',
    '1. "rewrite" — the same description, written better:',
    '   - Active voice. Say what the person DID, not what "was done".',
    '   - Lead with the outcome or the responsibility, not the background.',
    '   - Cut filler ("responsible for", "various", "successfully", "utilised").',
    '   - Keep it the same rough length or shorter. Keep the person\'s voice.',
    '   - CRITICAL: use ONLY facts that appear in the text below. Do not add',
    '     numbers, metrics, team sizes, technologies, dates or outcomes that',
    '     are not already there. Do not upgrade "helped" into "led", or',
    '     "improved" into a percentage. An invented claim has to be defended',
    '     in an interview — a flat sentence does not.',
    '   - Write in the SAME LANGUAGE as the source text.',
    '',
    '2. "asks" — 0–4 short questions about what is MISSING. These are the',
    '   facts a reader would want that the text does not give: scale, outcome,',
    '   your specific role, the measurable result. Ask for them; never guess',
    '   them. Empty list if the description is already complete.',
    '',
    `Reply with ONLY this JSON, no prose:`,
    `{"$schema":"${WRITING_COACH_SCHEMA}","rewrite":"the improved text","asks":["What was the team size?"]}`,
    '',
    '--- DESCRIPTION ---',
    text || '(empty)',
  ].join('\n')
}

/** Validate a reply into a coach result, or throw. */
export function validateCoachResponse(json: unknown): CoachResult {
  if (!json || typeof json !== 'object') {
    throw new InvalidCoachResponseError('The reply was not a JSON object.')
  }
  const o = json as Record<string, unknown>

  const rewrite = typeof o.rewrite === 'string' ? o.rewrite.trim() : ''
  if (!rewrite) throw new InvalidCoachResponseError('The reply had no "rewrite" text.')

  // `asks` is optional — "nothing missing" is a legitimate answer, and a model
  // that omits the key entirely shouldn't fail the whole run.
  const asks = Array.isArray(o.asks)
    ? o.asks.map((a) => (typeof a === 'string' ? a.trim() : '')).filter(Boolean).slice(0, 6)
    : []

  return { rewrite, asks }
}

/**
 * The other half of the writing assist: draft a description for a field that is
 * EMPTY.
 *
 * Coaching needs prose to work on. An empty field has none, so the model has
 * only the item's identity facts — customer, name, dates, issuer — plus
 * whatever it happens to know about them. That second source is the reason this
 * is a separate function with its own warning rather than a branch inside
 * `buildCoachPrompt`: coaching can only reshape what you wrote, while this can
 * be CONFIDENTLY WRONG about a real organisation, and the two deserve different
 * expectations from the reader.
 *
 * So the prompt is built to fail visibly rather than plausibly:
 *  - it must say what it is unsure of in `asks` rather than smoothing over it;
 *  - it must not invent your role, your outcomes or any number;
 *  - a thing it doesn't recognise gets a short generic draft and an ask, not an
 *    imagined one. An internal project at a client and a course from 2004 have
 *    no public footprint, and that is the common case in a consultant's CV.
 */
export function buildDraftPrompt(
  facts: readonly string[],
  sectionLabel: string,
  locale: string,
): string {
  return [
    `You are drafting a STARTING POINT for one empty "${sectionLabel}" entry on a`,
    "consultant's CV. They will edit it; it does not need to be finished.",
    '',
    "All you have is the entry's identity below, plus whatever you happen to know",
    'about the organisations, products or qualifications it names.',
    '',
    'Produce TWO things:',
    '',
    '1. "rewrite" — 2–4 sentences describing what this entry is about, in the',
    '   third-party-neutral way a CV describes work. Cover what the organisation',
    '   or subject IS and what work of this kind typically involves.',
    '',
    '   THE LINE YOU MUST NOT CROSS: do not state what THIS PERSON did, what they',
    '   achieved, what they were responsible for, how big the team was, or any',
    '   number, date or technology that is not in the facts below. You do not',
    '   know those things. Describe the context; leave their part to them.',
    '',
    '   If you do not recognise what is named, say so plainly in one short',
    '   sentence and keep the draft generic. A confident paragraph about a',
    '   project you have never heard of is worse than no draft: it reads as',
    '   true, and the person may not catch it before it goes out.',
    '',
    '2. "asks" — 2–5 short questions covering exactly what you had to leave out:',
    '   their role, the outcome, the scale, the technologies. These are the',
    '   sentences only they can write.',
    '',
    `   Write both in the language with code "${locale}".`,
    '',
    'Reply with ONLY this JSON, no prose:',
    `{"$schema":"${WRITING_COACH_SCHEMA}","rewrite":"the draft","asks":["What was your role?"]}`,
    '',
    '--- THE ENTRY ---',
    facts.length ? facts.join('\n') : '(nothing filled in yet)',
  ].join('\n')
}

/** True when there's enough identity to draft FROM — a blank card is not. */
export function hasDraftableFacts(facts: readonly string[]): boolean {
  return facts.length > 0
}
