/**
 * PURE: turn a long prose description into the bullet points the app already
 * has a home for — a project's `highlights`.
 *
 * Only highlights, deliberately: a profile block's `key_points` looks like the
 * obvious second target, but that UI is DEPRECATED — the standalone Key
 * Competencies section owns those (see the note in SimpleEditors and
 * migrate.extractKeyPointsToCompetencies). Wiring an assist into a retired
 * surface would drag it back.
 *
 * This is a RESHAPING task, not a writing one, and the prompt says so in the
 * strongest terms available: every point must be supported by the source text.
 * Summarising discards, which is safe; the failure mode here is invention, and
 * an invented achievement on a CV is one you have to defend in an interview. So
 * the model is told to drop anything it cannot ground, and the output is a
 * review list the user ticks — never a write.
 *
 * Drafts land in the PRIMARY locale only. The source is one locale's prose, so
 * anything else would be a translation the user didn't ask for — the existing
 * Draft-translation path owns that.
 */

import type { LocalizedString } from '../types'
import { richToPlain } from './richText'

export const KEY_POINTS_SCHEMA = 'resumestudio-points/v1'

/** One drafted point. `label` is optional — a highlight is body-only. */
export interface DraftPoint {
  label: string
  body: string
}

export class InvalidKeyPointsError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidKeyPointsError' }
}

/** What the points are for — it changes the shape asked for, not the rules. */
export type PointStyle =
  /** Project highlights: one line each, no label. */
  | 'highlights'
  /** Profile key points: a short label + a sentence. */
  | 'labelled'

/**
 * The prompt. `source` is rich text; it's flattened here so the model never
 * sees markup it might echo back.
 */
export function buildKeyPointsPrompt(source: LocalizedString, locale: string, style: PointStyle): string {
  const text = richToPlain(source[locale] ?? '').trim()

  const shape = style === 'labelled'
    ? '{"$schema":"' + KEY_POINTS_SCHEMA + '","points":[{"label":"Short label","body":"One sentence."}]}'
    : '{"$schema":"' + KEY_POINTS_SCHEMA + '","points":[{"body":"One line."}]}'

  return [
    'Rewrite the description below as a short list of bullet points for a CV.',
    'Rules:',
    '- Use ONLY facts stated in the text. Never add, infer or embellish — an invented',
    '  achievement on a CV has to be defended in an interview.',
    '- If the text does not support a point, leave it out. Fewer, true points is the goal.',
    '- Keep the original wording where you can; this is reshaping, not rewriting.',
    '- 3–6 points, each one line.',
    style === 'labelled'
      ? '- Give each point a 1–3 word label and a single supporting sentence.'
      : '- No labels — just the line.',
    '- Write in the same language as the source text.',
    '',
    `Reply with ONLY this JSON, no prose:\n${shape}`,
    '',
    '--- DESCRIPTION ---',
    text || '(empty)',
  ].join('\n')
}

/** Validate a reply into drafted points, or throw. */
export function validateKeyPoints(json: unknown): DraftPoint[] {
  if (!json || typeof json !== 'object') throw new InvalidKeyPointsError('The reply was not a JSON object.')
  const o = json as Record<string, unknown>
  if (!Array.isArray(o.points)) throw new InvalidKeyPointsError('The reply has no "points" array.')

  const points = o.points
    .map((p): DraftPoint | null => {
      if (typeof p === 'string') return { label: '', body: p.trim() }
      if (!p || typeof p !== 'object') return null
      const r = p as Record<string, unknown>
      const body = typeof r.body === 'string' ? r.body.trim() : ''
      const label = typeof r.label === 'string' ? r.label.trim() : ''
      return body ? { label, body } : null
    })
    .filter((p): p is DraftPoint => !!p)

  if (!points.length) throw new InvalidKeyPointsError('The reply listed no points.')
  return points
}

/**
 * Drafted points → `Project.highlights`. Highlights are localized strings, so
 * a labelled point collapses to "Label: body" rather than losing the label.
 */
export function toHighlights(points: readonly DraftPoint[], locale: string): LocalizedString[] {
  return points.map((p) => ({ [locale]: p.label ? `${p.label}: ${p.body}` : p.body }))
}
