/**
 * D3 — "what's missing" for ONE section. PURE prompt builder; the reply is
 * parsed by the shared `validateFindings`.
 *
 * The writing coach asks what's missing from one description. This asks the
 * same question one level up: a reader arriving at your Projects section has
 * expectations of the section as a whole — coverage, recency, range, ordering —
 * that no single item can satisfy or fail on its own.
 *
 * It is scoped to one section rather than the whole CV because that is where it
 * gets used: you are standing in Courses, wondering whether it's worth keeping.
 * The whole-CV review (A1) is the cross-section pass; running both is not
 * redundant, they're asking different questions of different amounts of text.
 *
 * Advisory, like every findings pass. The output is mostly `ask` lines — the
 * things missing from a section are usually facts only the person has.
 */

import type { ResumeStore } from '../types'
import { buildCvDigest } from './cvDigest'
import { findingsResponseSpec } from './assistFindings'
import { itemsOf } from './cvFields'
import { sectionLabel } from './sections'

/** True when a section has enough content for the question to make sense. */
export function hasAdvisableContent(data: ResumeStore, section: string): boolean {
  return itemsOf(data, section).length > 0
}

export function buildSectionAdvicePrompt(
  data: ResumeStore,
  section: string,
  locale: string,
): string {
  const label = sectionLabel(section)
  return [
    `You are looking at ONE section of a consultant's CV: "${label}".`,
    'Say what a reader would expect to find here and does not.',
    '',
    'Consider:',
    '- COVERAGE: what kind of entry is conspicuously absent, given what IS here?',
    '- DEPTH: which entries say too little to be worth a reader\'s time?',
    '- RECENCY: is the newest material old enough to raise a question?',
    '- RANGE: does the section make the same point several times over?',
    '- ORDER: would a reader\'s eye land on the wrong entry first?',
    `- FIT: is anything here that does not belong in "${label}"?`,
    '',
    'Rules:',
    '- Judge only from what is below. Do not assume facts about this person.',
    '- Where the gap is a fact only they can supply, put the question in "ask".',
    '  Most findings from this pass will be asks — that is the expected shape.',
    '- Do not write replacement text for any entry.',
    `- Use section "${section}" for every finding. Use item_id when a finding is`,
    '  about one entry, and null when it is about the section as a whole.',
    '- If the section is in good shape, return an empty list and say nothing more.',
    '',
    findingsResponseSpec(),
    '',
    `--- ${label} ---`,
    buildCvDigest(data, { locale, sections: [section] }),
  ].join('\n')
}
