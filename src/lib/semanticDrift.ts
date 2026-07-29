/**
 * A3 — the cross-language MEANING check. PURE prompt builder; the reply is
 * parsed by the shared `validateFindings`.
 *
 * `lib/drift.ts` already compares the two language columns structurally: it
 * flags a field whose numbers differ between locales, and one whose lengths
 * diverge sharply. Those are cheap, offline and certain — and they are blind to
 * the failure that actually happens. A Norwegian description that dropped the
 * final sentence of the English one has the same numbers and a similar length.
 * A term translated three different ways across three projects is invisible to
 * both heuristics. The feature map has named a semantic pass as drift's missing
 * third signal since the drift feature shipped; this is it.
 *
 * It reads the raw locale slots via `buildBilingualDigest`, NOT the resolve()
 * fallback chain — resolving would show the English text in the Norwegian
 * column and report perfect agreement, which is exactly backwards.
 *
 * Advisory only. It never proposes a translation: the Draft-translation path
 * owns writing the other column, and a meaning check that silently rewrote the
 * text it was checking would leave nothing to check it against.
 */

import type { ResumeStore } from '../types'
import { buildBilingualDigest } from './cvDigest'
import { findingsResponseSpec } from './assistFindings'
import { LOCALE_LABELS } from './locales'

/** The language's own name, for the prompt. Falls back to the bare code. */
function label(locale: string): string {
  return LOCALE_LABELS[locale]?.name ?? locale
}

export function buildSemanticDriftPrompt(
  data: ResumeStore,
  primary: string,
  secondary: string,
  sections?: readonly string[],
): string {
  const a = label(primary)
  const b = label(secondary)
  return [
    `This CV is maintained in two languages: ${a} (${primary}) and ${b} (${secondary}).`,
    'Each field below is shown in both. Compare them and report where they',
    'DISAGREE. You are checking meaning, not style.',
    '',
    'Report:',
    '1. MISSING CONTENT — something stated in one language and absent from the',
    '   other. A dropped sentence or clause is the most common and most damaging',
    '   case: the two versions then make different claims to different readers.',
    '2. CHANGED MEANING — the two say different things: a different role, scope,',
    '   outcome, technology, or degree of responsibility.',
    '3. WRONG TERM — a translation that is grammatical but wrong in context,',
    '   especially job titles, technical terms and industry words.',
    '4. INCONSISTENT TERMINOLOGY — the same source term translated differently',
    '   in different items. Say which rendering the CV uses most.',
    `5. ONE COLUMN EMPTY — a field written in one language and never in the other.`,
    '',
    'Rules:',
    '- Ignore differences of style, word order or idiom. Two sentences that mean',
    '  the same thing in natural language are NOT a finding.',
    '- Do not supply the translation. Report what differs; the person decides.',
    '- Name which language is missing or wrong in the detail line.',
    '- "high" = the two versions make different factual claims. Be sparing.',
    '- An empty findings list means the two languages agree. That is a real answer.',
    '',
    findingsResponseSpec(),
    '',
    '--- CV (both languages) ---',
    buildBilingualDigest(data, primary, secondary, { sections }),
  ].join('\n')
}
