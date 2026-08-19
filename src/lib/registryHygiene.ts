/**
 * C4 — registry hygiene: propose merges the deterministic matcher can't reach,
 * and categories for the uncategorised tail.
 *
 * `lib/skillMatch.ts` already resolves "React.js" to "React" by normalisation,
 * and `autoCategorizeSkills` already fills categories it can match against the
 * Quadim library. What neither can do is judge that "Solution architecture" and
 * "Solutions architect" are the same practice, or that a private tool nobody's
 * taxonomy has heard of belongs under Cloud. That needs a reader.
 *
 * ── THE SAFETY MODEL ────────────────────────────────────────────────────────
 *
 * A registry merge is the most destructive operation in this app. It rewrites
 * every reference across every project, employment and course, refreshes the
 * denormalised name snapshots, and DELETES the absorbed entry. Undo covers it
 * (one `replaceData`), but nobody notices a wrong merge in time to undo it —
 * they notice it three exports later when a skill they use is gone.
 *
 * So this module is built so that nothing can happen implicitly:
 *
 *  - `validateHygiene` produces PROPOSALS ONLY. It never returns a store, and
 *    there is no code path from a model reply to a mutation.
 *  - Every proposal carries the exact consequence, computed from the live store
 *    at validation time: which entry survives, which is deleted, and how many
 *    references will be rewritten (`countRegistryReferences`). That number is
 *    what makes a bad merge visible before it happens.
 *  - Nothing is pre-selected. The panel starts with an empty accept set.
 *  - `applyHygiene` acts on an explicit list and re-verifies every id against
 *    the store it is about to write to, dropping anything that moved.
 *
 * The UI adds the final gate (a confirm naming the counts). Between them the
 * rule is: the model suggests, the user decides, the store changes only on an
 * explicit act.
 */

import type { ResumeStore } from '../types'
import { countRegistryReferences, mergeRegistry, type RegistryKind } from './merge'
import { assignSkillCategory, categoryNameIndex, skillCategoryList } from './skillCategorize'
import { resolve } from './locales'

export const HYGIENE_SCHEMA = 'resumestudio-registry-hygiene/v1'

const KINDS: readonly RegistryKind[] = ['skills', 'roles', 'industries']

/** A proposal to fold one registry entry into another. */
export interface MergeProposal {
  key: string
  kind: RegistryKind
  /** The entry that SURVIVES. */
  keepId: string
  keepName: string
  /** The entry that is DELETED once its references are rewritten. */
  dropId: string
  dropName: string
  /** References that will be rewritten — the size of the blast radius. */
  dropRefs: number
  keepRefs: number
  /** Why the model thinks they're the same thing. */
  reason: string
}

/** A proposal to put an uncategorised skill in a category. */
export interface CategoryProposal {
  key: string
  skillId: string
  skillName: string
  /** An existing category id, or null when proposing a new category by name. */
  categoryId: string | null
  categoryName: string
  isNewCategory: boolean
  reason: string
}

export interface HygieneResult {
  merges: MergeProposal[]
  categories: CategoryProposal[]
  dropped: string[]
}

export class InvalidHygieneError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidHygieneError' }
}

const MAX_PROPOSALS = 60

/** Registry entries as the model sees them: id, name, and how used they are. */
function registryCatalog(store: ResumeStore, locale: string): string {
  const out: string[] = []
  for (const kind of KINDS) {
    const list = store[kind]
    if (!list.length) continue
    out.push(`## ${kind}`)
    for (const e of list) {
      const name = resolve(e.name, locale)
      if (!name) continue
      out.push(`- id: ${e.id} | name: ${name} | used: ${countRegistryReferences(store, kind, e.id)}`)
    }
    out.push('')
  }
  return out.join('\n').trim()
}

/** Skills with no category, plus the categories available to put them in. */
function categoryContext(store: ResumeStore, locale: string): string {
  const cats = skillCategoryList(store)
  const uncategorised = store.skills.filter((s) => !s.category_id)

  const catRows = cats.length
    ? cats.map((c) => `- id: ${c.id} | name: ${resolve(c.name, locale)}`).join('\n')
    : '(no categories yet — propose new ones by name)'

  const skillRows = uncategorised.length
    ? uncategorised.map((s) => {
      const cls = s.classification ? ` | library says: ${s.classification}` : ''
      return `- id: ${s.id} | name: ${resolve(s.name, locale)}${cls}`
    }).join('\n')
    : '(every skill already has a category)'

  return [
    '## existing categories', catRows, '',
    '## skills with no category', skillRows,
  ].join('\n')
}

export function buildHygienePrompt(store: ResumeStore, locale: string): string {
  return [
    'You are tidying the shared registries of a consultant\'s CV. Two jobs.',
    '',
    '### 1. Merges',
    '',
    'Find entries that are THE SAME THING recorded twice — a plural, a different',
    'word order, an abbreviation, a job-title vs practice-name pair',
    '("Solution architecture" / "Solutions architect"), the same tool spelled two',
    'ways. For each, say which name to KEEP and which to absorb.',
    '',
    'Be conservative. These are different things and must NOT be merged:',
    '- A specific technology and the family it belongs to (Spring Boot / Spring,',
    '  PostgreSQL / SQL, React Native / React).',
    '- Two versions of a product where the difference is meaningful.',
    '- A skill and a role that happen to share a word (Java / Java developer).',
    '- Anything you are less than confident about. A missed merge costs nothing;',
    '  a wrong one destroys a distinction the person deliberately made.',
    '',
    'Prefer keeping the more-used entry (the "used" count below), and the more',
    'canonical spelling. Never merge across kinds — a skill only merges into a',
    'skill.',
    '',
    '### 2. Categories',
    '',
    'For each skill with no category, name the category it belongs in. Prefer an',
    'existing category by id. Propose a NEW category (by name, id null) only when',
    'nothing existing fits and the name would be useful for several skills — not',
    'a category of one. Leave a skill out if you genuinely can\'t place it.',
    '',
    'Reply with ONLY this JSON, no prose before or after:',
    `{"$schema":"${HYGIENE_SCHEMA}",`,
    ' "merges":[{"kind":"skills|roles|industries","keep_id":"...","drop_id":"...","reason":"why they are the same"}],',
    ' "categories":[{"skill_id":"...","category_id":"existing id or null","category_name":"name when id is null","reason":"why"}]}',
    '',
    'Both lists may be empty. A tidy registry is a real answer.',
    '',
    '--- REGISTRIES ---',
    registryCatalog(store, locale),
    '',
    '--- CATEGORIES ---',
    categoryContext(store, locale),
  ].join('\n')
}

function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

/**
 * Validate a reply into proposals. Resolves every id against the live store and
 * computes the reference counts the reviewer needs. Returns proposals only —
 * this function cannot change anything.
 */
export function validateHygiene(json: unknown, store: ResumeStore, locale: string): HygieneResult {
  if (!json || typeof json !== 'object') {
    throw new InvalidHygieneError('The reply was not a JSON object.')
  }
  const o = json as Record<string, unknown>
  if (!Array.isArray(o.merges) && !Array.isArray(o.categories)) {
    throw new InvalidHygieneError('The reply had neither a "merges" nor a "categories" array.')
  }

  const dropped: string[] = []
  const merges: MergeProposal[] = []
  const categories: CategoryProposal[] = []

  // ── Merges ──
  const claimed = new Set<string>()
  for (const [i, entry] of (Array.isArray(o.merges) ? o.merges : []).slice(0, MAX_PROPOSALS).entries()) {
    if (!entry || typeof entry !== 'object') { dropped.push(`Merge ${i + 1} was not an object.`); continue }
    const e = entry as Record<string, unknown>

    const kind = str(e.kind, 20) as RegistryKind
    if (!KINDS.includes(kind)) { dropped.push(`Merge ${i + 1} named an unknown registry ("${kind || '—'}").`); continue }

    const list = store[kind]
    const keepId = str(e.keep_id, 80)
    const dropId = str(e.drop_id, 80)
    const keep = list.find((x) => x.id === keepId)
    const drop = list.find((x) => x.id === dropId)
    if (!keep || !drop) { dropped.push(`Merge ${i + 1} referenced an entry that isn't in ${kind}.`); continue }
    if (keepId === dropId) { dropped.push(`Merge ${i + 1} merged an entry into itself.`); continue }

    // One entry can't be absorbed twice, and an entry being absorbed can't also
    // be a keeper — either would apply a merge onto something already deleted.
    if (claimed.has(dropId) || claimed.has(keepId)) {
      dropped.push(`Merge ${i + 1} overlaps another proposed merge — skipped as ambiguous.`)
      continue
    }
    claimed.add(dropId)
    claimed.add(keepId)

    merges.push({
      key: `merge:${kind}:${dropId}`,
      kind,
      keepId, keepName: resolve(keep.name, locale),
      dropId, dropName: resolve(drop.name, locale),
      dropRefs: countRegistryReferences(store, kind, dropId),
      keepRefs: countRegistryReferences(store, kind, keepId),
      reason: str(e.reason, 400),
    })
  }

  // ── Categories ──
  const cats = skillCategoryList(store)
  const byId = new Map(cats.map((c) => [c.id, resolve(c.name, locale)]))
  const seenSkills = new Set<string>()

  for (const [i, entry] of (Array.isArray(o.categories) ? o.categories : []).slice(0, MAX_PROPOSALS).entries()) {
    if (!entry || typeof entry !== 'object') { dropped.push(`Category ${i + 1} was not an object.`); continue }
    const e = entry as Record<string, unknown>

    const skillId = str(e.skill_id, 80)
    const skill = store.skills.find((s) => s.id === skillId)
    if (!skill) { dropped.push(`Category ${i + 1} named a skill that isn't in the registry.`); continue }
    if (seenSkills.has(skillId)) continue
    // Only ever fills a BLANK category. Re-categorising a skill the user placed
    // themselves is an overwrite, and this feature doesn't do those.
    if (skill.category_id) {
      dropped.push(`Category ${i + 1} would have re-categorised "${resolve(skill.name, locale)}", which you already placed.`)
      continue
    }
    seenSkills.add(skillId)

    const catId = str(e.category_id, 80)
    const existing = catId ? byId.get(catId) : undefined
    if (catId && !existing) {
      dropped.push(`Category ${i + 1} referenced a category that doesn't exist.`)
      continue
    }
    const name = existing ?? str(e.category_name, 120)
    if (!name) { dropped.push(`Category ${i + 1} had no category name.`); continue }

    categories.push({
      key: `cat:${skillId}`,
      skillId,
      skillName: resolve(skill.name, locale),
      categoryId: existing ? catId : null,
      categoryName: name,
      isNewCategory: !existing,
      reason: str(e.reason, 300),
    })
  }

  return { merges, categories, dropped }
}

/**
 * Apply exactly the proposals handed in — nothing else. Returns a NEW store for
 * `replaceData` (one undo step), plus what was skipped.
 *
 * Every id is re-checked against the store being written to: the panel is
 * non-blocking, so an entry may have been renamed, merged or deleted since the
 * run. A proposal whose entries no longer both exist is skipped, never guessed
 * at.
 */
export function applyHygiene(
  store: ResumeStore,
  merges: readonly MergeProposal[],
  categories: readonly CategoryProposal[],
  locale: string,
): { data: ResumeStore; merged: number; categorised: number; skipped: string[] } {
  let next = store
  const skipped: string[] = []
  let merged = 0
  let categorised = 0

  for (const m of merges) {
    const list = next[m.kind]
    const keep = list.find((x) => x.id === m.keepId)
    const drop = list.find((x) => x.id === m.dropId)
    if (!keep || !drop) { skipped.push(`${m.dropName} → ${m.keepName} (one of them is no longer there)`); continue }
    const after = mergeRegistry(next, m.kind, m.dropId, m.keepId)
    if (after === next) { skipped.push(`${m.dropName} → ${m.keepName} (merge did not apply)`); continue }
    next = after
    merged++
  }

  for (const c of categories) {
    const skill = next.skills.find((s) => s.id === c.skillId)
    if (!skill) { skipped.push(`${c.skillName} (skill is no longer there)`); continue }
    // Re-check the blank-category rule against the CURRENT store, not the one
    // the proposal was built from.
    if (skill.category_id) { skipped.push(`${c.skillName} (you categorised it in the meantime)`); continue }
    // assignSkillCategory takes an id OR a name, creating the category when the
    // name is new — which is exactly the two cases a proposal carries.
    next = assignSkillCategory(next, c.skillId, c.categoryId ?? c.categoryName, locale)
    categorised++
  }

  return { data: next, merged, categorised, skipped }
}

/** Convenience for the confirm dialog: how much is about to change. */
export function hygieneImpact(
  merges: readonly MergeProposal[],
  categories: readonly CategoryProposal[],
): { entriesDeleted: number; referencesRewritten: number; skillsCategorised: number; newCategories: number } {
  return {
    entriesDeleted: merges.length,
    referencesRewritten: merges.reduce((n, m) => n + m.dropRefs, 0),
    skillsCategorised: categories.length,
    newCategories: new Set(categories.filter((c) => c.isNewCategory).map((c) => c.categoryName.toLowerCase())).size,
  }
}

/** Nothing to tidy = nothing to run. Keeps the button honest on a clean registry. */
export function hasRegistryContent(store: ResumeStore): boolean {
  return store.skills.length + store.roles.length + store.industries.length > 1
}

/** Re-export for the panel's category-name lookups. */
export { categoryNameIndex }
