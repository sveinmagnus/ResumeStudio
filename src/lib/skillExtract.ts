/**
 * PURE: propose the skills a project's prose demonstrates, and resolve each
 * proposal against the SHARED skill registry.
 *
 * Why the resolving matters more than the extracting: the Skill Matrix and every
 * skill-filtered view are only as good as the project→skill links, and linking
 * by hand is the chore nobody does. But a model asked for "skills" will happily
 * answer "React.js" when the registry already says "React" — and a registry that
 * grows a near-duplicate for every project is worse than no suggestions at all.
 * So every proposal is interned against what the resume ALREADY has (`skillKey`,
 * built on skillMatch's `normalizeKey`), and only genuinely-new names are
 * offered as registry additions.
 *
 * The model never writes to the store: `extractionResult` is a proposal the user
 * ticks. Existing-registry hits are pre-ticked (linking an existing skill is
 * cheap and reversible); NEW registry entries are not (growing the shared
 * registry deserves a deliberate click).
 */

import type { LocalizedString, Project, Skill } from '../types'
import { resolve } from './locales'
import { normalizeKey } from './skillMatch'
import { richToPlain } from './richText'

export const SKILL_EXTRACT_SCHEMA = 'resumestudio-skills/v1'

export interface SkillExtractV1 {
  $schema: string
  skills: string[]
}

export class InvalidSkillExtractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSkillExtractError'
  }
}

/**
 * The prompt. Deliberately narrow: one project, name the technologies/methods it
 * evidences, nothing else. A small local model can do this; it could not curate
 * a whole CV.
 *
 * `known` seeds the registry's existing vocabulary so the model reaches for
 * "React" rather than "React.js" in the first place — interning catches the rest,
 * but agreeing up front produces fewer novel-looking duplicates to review.
 */
export function buildSkillExtractPrompt(project: Project, locale: string, known: readonly string[] = []): string {
  const title = resolve(project.customer, locale) || resolve(project.description, locale) || 'this project'
  const body = [
    resolve(project.description, locale),
    richToPlain(resolve(project.long_description, locale)),
    ...project.highlights.map((h) => resolve(h, locale)),
  ].filter(Boolean).join('\n')

  const vocab = known.length
    ? `\nPrefer these exact names where they fit (they already exist in this CV):\n${known.slice(0, 120).join(', ')}\n`
    : ''

  return [
    'List the technologies, tools, languages, platforms and methods that the project description below',
    'gives concrete evidence for. Rules:',
    '- Only what the text actually supports. Do NOT infer or pad — a wrong skill on a CV has to be defended in an interview.',
    '- Each entry is a short proper name ("TypeScript", "Kubernetes", "Scrum"), not a phrase.',
    '- No duplicates, no soft skills, no company or client names.',
    vocab,
    `Reply with ONLY this JSON, no prose:\n{"$schema":"${SKILL_EXTRACT_SCHEMA}","skills":["…"]}`,
    '',
    `PROJECT: ${title}`,
    body || '(no description)',
  ].filter(Boolean).join('\n')
}

/** Validate a reply into the schema, or throw. */
export function validateSkillExtract(json: unknown): SkillExtractV1 {
  if (!json || typeof json !== 'object') throw new InvalidSkillExtractError('The reply was not a JSON object.')
  const o = json as Record<string, unknown>
  if (!Array.isArray(o.skills)) throw new InvalidSkillExtractError('The reply has no "skills" array.')
  const skills = o.skills
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!skills.length) throw new InvalidSkillExtractError('The reply listed no skills.')
  return { $schema: String(o.$schema ?? SKILL_EXTRACT_SCHEMA), skills }
}

/** One proposal, resolved against the registry. */
export interface SkillSuggestion {
  /** The name to show — the REGISTRY's spelling when matched, else the model's. */
  label: string
  /** Set when this resolves to an existing registry Skill. */
  skillId: string | null
  /** True when the project already links this skill (shown, but not offered). */
  alreadyLinked: boolean
}

export interface ExtractionResult {
  /** Matched an existing registry skill, not yet linked → pre-ticked. */
  existing: SkillSuggestion[]
  /** Not in the registry → a NEW registry entry, so unticked by default. */
  novel: SkillSuggestion[]
  /** Already on the project — surfaced so the list explains itself, never re-added. */
  alreadyLinked: SkillSuggestion[]
}

/**
 * The key a suggestion is interned on: `normalizeKey` (case, punctuation,
 * accents, version tokens) plus ONE alias rule — a trailing "js" token is
 * dropped, so React.js ≡ React and Node ≡ Node.js whichever spelling each side
 * happens to use. Applied to both the registry and the model's names.
 *
 * Deliberately no fuzzy/subset matching beyond that. It is tempting to collapse
 * names that share a head, but "Spring Boot" is not "Spring" and "Java" is not
 * "JavaScript" — merging those would corrupt the registry far worse than an
 * occasional duplicate suggestion, which the user simply doesn't tick. Anything
 * this rule misses surfaces as a NEW entry (unticked), which fails safe.
 */
export function skillKey(name: string): string {
  const parts = normalizeKey(name).split(' ').filter(Boolean)
  if (parts.length > 1 && parts[parts.length - 1] === 'js') parts.pop()
  return parts.join(' ')
}

/** Index the registry by match key, across every locale a skill is named in. */
function registryIndex(skills: readonly Skill[]): Map<string, Skill> {
  const idx = new Map<string, Skill>()
  for (const s of skills) {
    for (const name of Object.values(s.name as LocalizedString)) {
      const key = skillKey(name ?? '')
      // First writer wins: the registry's own order decides ties.
      if (key && !idx.has(key)) idx.set(key, s)
    }
  }
  return idx
}

/**
 * Resolve the model's names against the registry and the project's existing
 * links. Dedupes on the same normalized key the app matches on elsewhere, so
 * "React.js" and "react" collapse onto the registry's "React".
 */
export function resolveSuggestions(
  names: readonly string[],
  project: Project,
  registry: readonly Skill[],
  locale: string,
): ExtractionResult {
  const idx = registryIndex(registry)
  const linked = new Set(
    project.skills
      .map((ps) => registry.find((s) => s.id === ps.skill_id))
      .filter((s): s is Skill => !!s)
      .flatMap((s) => Object.values(s.name as LocalizedString).map((n) => skillKey(n ?? '')))
      .filter(Boolean),
  )

  const out: ExtractionResult = { existing: [], novel: [], alreadyLinked: [] }
  const seen = new Set<string>()

  for (const raw of names) {
    const key = skillKey(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const hit = idx.get(key)
    if (linked.has(key)) {
      out.alreadyLinked.push({ label: hit ? resolve(hit.name, locale) : raw, skillId: hit?.id ?? null, alreadyLinked: true })
    } else if (hit) {
      // Show the REGISTRY's spelling — that's the name the CV will render.
      out.existing.push({ label: resolve(hit.name, locale), skillId: hit.id, alreadyLinked: false })
    } else {
      out.novel.push({ label: raw, skillId: null, alreadyLinked: false })
    }
  }
  return out
}

/** The registry names to seed the prompt with (deduped, primary-locale spelling). */
export function registryVocabulary(registry: readonly Skill[], locale: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of registry) {
    const name = resolve(s.name, locale).trim()
    const key = skillKey(name)
    if (!name || !key || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}
