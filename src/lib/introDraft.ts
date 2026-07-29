/**
 * D2 — draft a Resume View's INTRODUCTION for a stated audience.
 *
 * The scope here is narrower than "section intros" sounds, and deliberately so:
 * the data model has exactly one user-authored intro, `ResumeView.introduction`.
 * The `SectionIntro` component is app chrome (static English copy explaining an
 * editor screen), and `ViewSection` carries styling and sort, not prose. Adding
 * a per-section intro field would be a shape change and a new thing to render
 * in four export adapters — a different piece of work, not a free rider on this
 * one.
 *
 * What makes this worth a high-end model is that a good intro is written
 * against the SPECIFIC set of items the view includes, not against the master
 * CV: a view that dropped the public-sector projects should not open by talking
 * about public sector work. So the prompt is built from `applyView`'s filtered
 * store — the same content the export will contain — plus the audience the user
 * names.
 *
 * The reply is prose, returned verbatim (like the cover-letter body, unlike
 * every JSON assist here): there is exactly one field to fill, so a schema
 * would be ceremony around a single string.
 */

import type { ResumeStore, ResumeView } from '../types'
import { buildCvDigest } from './cvDigest'
import { applyView, selectedViewProfile } from './viewFilter'
import { resolve } from './locales'
import { richToPlain } from './richText'

/** Longest intro we'll accept back — past this it isn't an introduction. */
const MAX_INTRO_CHARS = 1800

export interface IntroFocus {
  /** Who is reading, and what they're being asked to conclude. */
  audience: string
  /** Roughly how long: a single line, or a short paragraph. */
  length: 'line' | 'paragraph'
}

export const DEFAULT_INTRO_FOCUS: IntroFocus = { audience: '', length: 'paragraph' }

/**
 * The prompt. Uses the view's FILTERED content so the intro can only promise
 * what the document goes on to deliver.
 */
export function buildIntroPrompt(
  data: ResumeStore,
  view: ResumeView,
  locale: string,
  focus: IntroFocus,
): string {
  const filtered = applyView(data, view)
  const profile = selectedViewProfile(filtered, view)
  const tagLine = profile ? resolve(profile.tag_line, locale) : ''
  const profileText = profile
    ? richToPlain(resolve(profile.summary, locale) ?? '').replace(/\s+/g, ' ').trim().slice(0, 800)
    : ''

  return [
    'Write the INTRODUCTION that opens one tailored version of a consultant\'s CV.',
    'It is the first thing the reader sees, above the profile.',
    '',
    `Reader / purpose: ${focus.audience.trim() || '(not stated — write for a general professional reader)'}`,
    focus.length === 'line'
      ? 'Length: ONE sentence. It has to work as a standalone line.'
      : 'Length: one short paragraph, 2–4 sentences.',
    '',
    'What it must do:',
    '- Say what this person is for, in this reader\'s terms.',
    '- Point at the strongest evidence BELOW, and only what is below: this',
    '  document is a filtered selection, so anything you promise that the',
    '  reader then cannot find reads as padding.',
    '- Sound like the person, not like a recruiter. No "results-driven",',
    '  "passionate", "proven track record", "dynamic professional".',
    '',
    'What it must not do:',
    '- Invent facts, numbers, years of experience, seniority or outcomes.',
    '- Repeat the profile paragraph below in different words — the reader sees',
    '  both, one after the other.',
    '- Address anyone by name or open like a letter. This is not a cover letter.',
    '',
    `Write in the same language as the content below.`,
    'Reply with the introduction text ONLY — no heading, no quotes, no commentary.',
    '',
    ...(tagLine ? [`--- PROFILE TAG LINE ---`, tagLine, ''] : []),
    ...(profileText ? ['--- PROFILE (do not restate) ---', profileText, ''] : []),
    '--- WHAT THIS VERSION CONTAINS ---',
    buildCvDigest(filtered, { locale, maxFieldChars: 500, includeShort: false }),
  ].join('\n')
}

/**
 * Tidy a prose reply into an intro: strip fences, a wrapping pair of quotes and
 * any "Here's the introduction:" preamble models add regardless of
 * instructions. Paragraph breaks are PRESERVED (unlike `tidyLine`) — the
 * introduction is allowed to be more than one line.
 */
export function tidyIntro(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
  // A leading label line ("Introduction:", "Here is the introduction:").
  s = s.replace(/^(?:here(?:'s| is)[^\n:]*|introduction)\s*:\s*/i, '').trim()
  // Wrapping quotes, only when they wrap the WHOLE thing.
  if (/^["“][\s\S]*["”]$/.test(s)) s = s.slice(1, -1).trim()
  return s.slice(0, MAX_INTRO_CHARS)
}
