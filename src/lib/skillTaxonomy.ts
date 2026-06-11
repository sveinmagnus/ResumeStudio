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
