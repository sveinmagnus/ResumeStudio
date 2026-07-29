/**
 * A2 — the consistency & voice pass. PURE prompt builder; the reply is parsed
 * by the shared `validateProposals`.
 *
 * A master CV is written over years, in sittings, sometimes in two languages,
 * sometimes pasted from an old document. The result reads like several people
 * wrote it: "I led the team" in one project, "Responsible for leading the team"
 * in the next, "Ledet teamet" in a third that never got translated back.
 * Nothing in it is WRONG, which is why no other assist catches it — the writing
 * coach works one field at a time and has no idea what the neighbouring field
 * sounds like.
 *
 * This is the only advanced pass that WRITES, so it carries the whole of the
 * writing coach's discipline and one rule of its own:
 *
 *   The scope is HOW it's said, never WHAT is said. Same facts, same claims,
 *   same numbers, same technologies — reordered, de-cluttered, made consistent.
 *   A pass that is allowed to improve the substance is a pass that invents.
 *
 * The dominant style is DERIVED, not imposed: the model is asked to work out
 * which voice the CV already uses most and move the outliers to it. Picking a
 * house style here would mean rewriting a CV that was perfectly consistent in
 * the other direction.
 */

import type { ResumeStore } from '../types'
import { buildCvDigest } from './cvDigest'
import { proposalsResponseSpec } from './assistProposals'
import { CV_SECTIONS, fieldsOf } from './cvFields'

/** The prose fields a rewrite may touch, spelled out so the model can't guess. */
function editableFields(sections: readonly string[]): string {
  return sections
    .map((s) => {
      const keys = fieldsOf(s).filter((f) => f.prose && !f.list).map((f) => f.key)
      return keys.length ? `  ${s}: ${keys.join(', ')}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

export interface VoicePassOptions {
  /** Restrict the pass to these sections (default: all). */
  sections?: readonly string[]
}

export function buildVoicePassPrompt(
  data: ResumeStore,
  locale: string,
  opts: VoicePassOptions = {},
): string {
  const sections = opts.sections?.length ? opts.sections : CV_SECTIONS
  return [
    'You are making one person\'s CV read as though it were written in one sitting.',
    '',
    'FIRST, work out the dominant style already in the text below:',
    '- Person: first person ("I led"), or implied-subject ("Led")?',
    '- Tense for finished work: past or present?',
    '- How are technologies capitalised (e.g. "Javascript" vs "JavaScript")?',
    '- How long is a typical description?',
    'Then move the OUTLIERS to that style. Do not impose a style of your own —',
    'if the CV is consistently written one way, that way is correct.',
    '',
    'Also, in the same pass:',
    '- Cut filler: "responsible for", "successfully", "various", "utilised",',
    '  "worked on", "helped to". Say what was done.',
    '- Lead with the responsibility or outcome, not the background.',
    '- Fix obvious spelling and grammar slips.',
    '- Make repeated stock phrasing across items less repetitive.',
    '',
    'ABSOLUTE LIMITS — a violation makes the whole edit useless:',
    '- Same facts. No new numbers, metrics, team sizes, technologies, dates,',
    '  clients or outcomes. Never upgrade "helped" to "led", or "improved" to a',
    '  percentage. An invented claim has to be defended in an interview.',
    '- Do not remove a fact to make a sentence flow better.',
    '- Same language as the text you are rewriting. Never translate.',
    '- Roughly the same length or shorter.',
    '- Leave a field alone if it is already fine. A short edit list is a good result.',
    '',
    'You may ONLY edit these fields:',
    editableFields(sections),
    '',
    proposalsResponseSpec(),
    '',
    '--- CV ---',
    buildCvDigest(data, { locale, sections, includeShort: true }),
  ].join('\n')
}
