/**
 * Skill-taxonomy suggestions (roadmap F12) — the Quadim Public Skill Library
 * (Apache-2.0, 1,200+ curated skill names) as autocomplete enrichment, so new
 * skills land on canonical names instead of minting near-duplicates
 * ("Løsningarkitekt" vs "Løsningsarkitekt") that merge has to fix later.
 *
 * The name list is a build-time-generated, committed JSON
 * (src/generated/skillTaxonomy.json — see scripts/build-skill-taxonomy.mjs)
 * and is lazy-loaded on first use like the DOCX exporter, so it costs the
 * initial bundle nothing and never touches the network. Library names are
 * English-only by design; a suggested name enters the registry as an `en`
 * value with the normal translation workflow applying.
 *
 * `matchTaxonomy` is PURE for unit tests; `suggestSkillNames` is the async
 * convenience the Autocomplete callsites plug in.
 */

let cached: string[] | null = null

/** Load (and memoize) the taxonomy names. Lazy chunk on first call. */
export async function loadSkillTaxonomy(): Promise<string[]> {
  if (!cached) {
    const mod = await import('../generated/skillTaxonomy.json')
    cached = mod.default as string[]
  }
  return cached
}

/** Test seam: replace/clear the memoized list. */
export function setSkillTaxonomyForTest(names: string[] | null): void {
  cached = names
}

/**
 * PURE: rank taxonomy names against a query — prefix matches first, then
 * substring, keeping input order within each band (the generated list is
 * pre-sorted alphabetically). Names already present (case-insensitively) in
 * `exclude` are dropped so the dropdown never suggests something the registry
 * already has.
 */
export function matchTaxonomy(
  names: string[],
  query: string,
  exclude: Iterable<string> = [],
  limit = 4,
): string[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const excluded = new Set(Array.from(exclude, (n) => n.trim().toLowerCase()))
  const prefix: string[] = []
  const substring: string[] = []
  for (const name of names) {
    const lower = name.toLowerCase()
    if (excluded.has(lower)) continue
    if (lower.startsWith(q)) prefix.push(name)
    else if (lower.includes(q)) substring.push(name)
  }
  return [...prefix, ...substring].slice(0, limit)
}

/**
 * Build a suggester for an Autocomplete: matches the lazy-loaded taxonomy,
 * excluding the (live) registry names from `existingNames()`.
 */
export function suggestSkillNames(
  existingNames: () => string[],
): (query: string) => Promise<string[]> {
  return async (query: string) => {
    if (query.trim().length < 2) return []
    const names = await loadSkillTaxonomy()
    return matchTaxonomy(names, query, existingNames())
  }
}

// ─── Related-skill suggestions (F12 pt3) ──────────────────────────────────────

/** name → related names, from the Quadim relatesTo graph (bidirectional). */
export type SkillRelations = Record<string, string[]>

let cachedRelations: SkillRelations | null = null

/** Load (and memoize) the related-skill graph. Lazy chunk on first call. */
export async function loadSkillRelations(): Promise<SkillRelations> {
  if (!cachedRelations) {
    const mod = await import('../generated/skillRelations.json')
    cachedRelations = mod.default as SkillRelations
  }
  return cachedRelations
}

/** Test seam: replace/clear the memoized relations. */
export function setSkillRelationsForTest(rel: SkillRelations | null): void {
  cachedRelations = rel
}

// ─── Authoritative classifications (F12 pt4) ──────────────────────────────────

/** canonical name → authoritative classification (e.g. "Technical", "Management"). */
export type SkillClassifications = Record<string, string>

let cachedClassifications: SkillClassifications | null = null

/** Load (and memoize) the classification map. Lazy chunk on first call. */
export async function loadSkillClassifications(): Promise<SkillClassifications> {
  if (!cachedClassifications) {
    const mod = await import('../generated/skillClassifications.json')
    cachedClassifications = mod.default as SkillClassifications
  }
  return cachedClassifications
}

/** Test seam: replace/clear the memoized classifications. */
export function setSkillClassificationsForTest(c: SkillClassifications | null): void {
  cachedClassifications = c
}

// ─── Fine-grained domains (auto-categorization) ───────────────────────────────

/** canonical name → fine-grained domain (e.g. "Software Development", "Cloud & Infrastructure"). */
export type SkillDomains = Record<string, string>

let cachedDomains: SkillDomains | null = null

/** Load (and memoize) the domain map. Lazy chunk on first call. */
export async function loadSkillDomains(): Promise<SkillDomains> {
  if (!cachedDomains) {
    const mod = await import('../generated/skillDomains.json')
    cachedDomains = mod.default as SkillDomains
  }
  return cachedDomains
}

/** Test seam: replace/clear the memoized domains. */
export function setSkillDomainsForTest(d: SkillDomains | null): void {
  cachedDomains = d
}

// ─── Semantic token→domain model (auto-categorization "semantic" tier) ────────

/** token → (domain → weight); see lib/skillMatch.ts. */
export type SkillDomainModel = Record<string, Record<string, number>>

let cachedModel: SkillDomainModel | null = null

/** Load (and memoize) the semantic model. Lazy chunk on first call. */
export async function loadSkillDomainModel(): Promise<SkillDomainModel> {
  if (!cachedModel) {
    const mod = await import('../generated/skillDomainModel.json')
    cachedModel = mod.default as SkillDomainModel
  }
  return cachedModel
}

/** Test seam: replace/clear the memoized model. */
export function setSkillDomainModelForTest(m: SkillDomainModel | null): void {
  cachedModel = m
}

export interface RelatedSuggestion {
  name: string
  /** How many of the user's skills point to this one — drives ranking. */
  weight: number
}

/**
 * PURE: given the user's current skill names and the relations graph, suggest
 * related library skills they don't already have. A skill pointed to by more
 * of the user's skills ranks higher (it's central to what they already do);
 * ties break alphabetically. Case-insensitive throughout.
 */
export function relatedSkillSuggestions(
  have: string[],
  relations: SkillRelations,
  limit = 6,
): RelatedSuggestion[] {
  // Case-insensitive lookup of the graph and the user's existing skills.
  const relByLower = new Map<string, string[]>()
  for (const [k, v] of Object.entries(relations)) relByLower.set(k.toLowerCase(), v)
  const haveLower = new Set(have.map((n) => n.trim().toLowerCase()))

  // canonical suggestion name → accumulated weight (skip ones already held).
  const weights = new Map<string, number>()
  for (const name of have) {
    const related = relByLower.get(name.trim().toLowerCase())
    if (!related) continue
    for (const r of related) {
      if (haveLower.has(r.toLowerCase())) continue
      weights.set(r, (weights.get(r) ?? 0) + 1)
    }
  }
  return [...weights.entries()]
    .map(([name, weight]) => ({ name, weight }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, limit)
}
