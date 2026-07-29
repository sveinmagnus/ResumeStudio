/**
 * A1 — the whole-CV review. PURE prompt builder; the reply is parsed by the
 * shared `validateFindings`.
 *
 * This is the assist that most needs a capable model and the one that most
 * benefits from it: every other AI feature here looks at ONE field or ONE item,
 * because that's all a small model can hold. A review is the opposite kind of
 * task — it can only find "this project has three paragraphs and that one has
 * four words", "these two descriptions say the same thing in the same words",
 * "you claim Kubernetes in a profile and never once in a project" by holding
 * the whole document at once and comparing its parts.
 *
 * What it must NOT do is write. The prompt says so twice and the shared
 * findings validator has no field for replacement text, because a review that
 * quietly becomes a rewrite is a review nobody checked.
 *
 * The checklist is explicit rather than "review my CV" on purpose: an open
 * request gets generic advice ("add metrics!") that's true of every CV and
 * useful for none. Naming the specific failure modes of THIS document model —
 * uneven detail, unregistered skills, dead time, duplicate phrasing — is what
 * makes the output actionable.
 */

import type { ResumeStore } from '../types'
import { buildCvDigest } from './cvDigest'
import { findingsResponseSpec } from './assistFindings'
import { resolve } from './locales'

/**
 * Skills the registry knows, so the model can spot prose that names others.
 * (Skills have no `disabled` flag — the registry is a shared vocabulary, and
 * an unused entry is pruned rather than soft-deleted.)
 */
function skillList(data: ResumeStore, locale: string): string {
  const names = data.skills.map((s) => resolve(s.name, locale)).filter(Boolean)
  return names.length ? names.join(', ') : '(none yet)'
}

export function buildCvReviewPrompt(data: ResumeStore, locale: string): string {
  return [
    'You are reviewing a consultant\'s master CV. Report problems. Do not rewrite anything.',
    '',
    'Look for, in roughly this order of usefulness:',
    '1. ITEMS WITH NO OUTCOME — a description that says what the work was but',
    '   never what came of it, or what this person specifically did.',
    '2. UNEVEN DETAIL — comparable items described at wildly different lengths.',
    '   Say which ones are thin relative to their neighbours; a four-word project',
    '   next to a four-paragraph one reads as the four-word one not mattering.',
    '3. REPEATED PHRASING — the same sentence patterns or stock phrases',
    '   ("responsible for", "worked closely with") across several items.',
    '4. UNSUPPORTED CLAIMS — a skill or strength asserted in a profile or',
    '   competency that no project, role or education below evidences.',
    '5. SKILLS ONLY IN PROSE — technologies named in a description that are',
    '   missing from the skill registry listed below (so they never reach the',
    '   skill matrix or a filtered view).',
    '6. TIMELINE GAPS — unexplained multi-year gaps between dated items.',
    '7. STRUCTURAL GAPS — something a reader of this CV would expect and not find.',
    '',
    'Judgement rules:',
    '- Report only what you can point at. No generic CV advice.',
    '- Do NOT invent facts, numbers or achievements, and do not ask the person',
    '  to invent them. Where a fact is missing, ASK for it.',
    '- Severity: "high" = a reader would hold it against them; "medium" = a real',
    '  weakness; "low" = polish. Be sparing with "high".',
    '- Ignore spelling and grammar; a separate pass handles wording.',
    '',
    `Skills currently in the registry: ${skillList(data, locale)}`,
    '',
    findingsResponseSpec(),
    '',
    '--- CV ---',
    buildCvDigest(data, { locale, includeShort: false }),
  ].join('\n')
}
