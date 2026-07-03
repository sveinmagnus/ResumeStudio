/**
 * PURE: layered skill-name → library-domain matcher for auto-categorization.
 *
 * Exact name matching alone only catches skills spelled exactly like one of the
 * ~1,090 domained library entries. This widens the net with four tiers of
 * decreasing confidence, all offline and deterministic:
 *
 *   'exact'    — normalized match (case/spacing/punctuation-insensitive, version
 *                suffixes stripped): "React.js", "Node JS", "Java 8" all land.
 *   'token'    — a multi-word library name whose tokens are all present in the
 *                query: "Amazon Web Services (AWS)" → "Amazon Web Services".
 *   'fuzzy'    — bounded edit distance for typos/variants ("Kubernets").
 *   'semantic' — a compact token→domain model (generated/skillDomainModel.json):
 *                place a skill by its WORDS when nothing else matches
 *                ("Cloud Security Engineer" → the domain cloud+security point at),
 *                gated by a score threshold + margin so it stays conservative.
 *
 * 'exact'/'token' are high-confidence; 'fuzzy'/'semantic' are "inferred" and the
 * UI flags them for review. `matchSkillDomain` tries them in order and returns
 * the first hit, or null.
 */

/** Tokens that carry no domain signal — dropped before token/semantic matching. */
const STOP = new Set([
  'and', 'or', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'a', 'an', 'at',
  'by', 'as', 'is', 'be', 'using', 'based', 'via', 'from', 'into', 'per',
])

/**
 * Normalize a name to a match key: lowercase, strip diacritics, punctuation →
 * space, and drop pure-numeric / version tokens ("18", "v2.0"). Keeps stopwords
 * (exact keys stay faithful); tokenize() drops them for the token/semantic tiers.
 */
export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !/^\d+$/.test(t) && !/^v\d[\d.]*$/.test(t))
    .join(' ')
}

/** Significant tokens (normalized, stopwords + 1-char tokens removed). */
export function tokenize(s: string): string[] {
  return normalizeKey(s).split(' ').filter((t) => t.length >= 2 && !STOP.has(t))
}

export type MatchTier = 'exact' | 'token' | 'fuzzy' | 'semantic' | 'graph'
export interface DomainMatch { domain: string; tier: MatchTier }

/** Generated token→(domain→weight) bag-of-words model. */
export type SkillDomainModel = Record<string, Record<string, number>>

export interface DomainIndex {
  /** normalized library name → domain (exact tier). */
  byKey: Map<string, string>
  /** per-entry token sets for the token/fuzzy tiers. */
  entries: { key: string; tokens: Set<string>; domain: string }[]
}

/** Build the reusable index from the name→domain map (do this once per run). */
export function buildDomainIndex(domains: Record<string, string>): DomainIndex {
  const byKey = new Map<string, string>()
  const entries: DomainIndex['entries'] = []
  for (const [name, domain] of Object.entries(domains)) {
    const key = normalizeKey(name)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, domain)
    entries.push({ key, tokens: new Set(tokenize(name)), domain })
  }
  return { byKey, entries }
}

/** Bounded Levenshtein: returns the edit distance, or `max + 1` if it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev = new Array(b.length + 1)
  const cur = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]
  }
  return prev[b.length]
}

/** Tier 'token': the most specific multi-word library name fully contained in the query. */
function matchToken(queryTokens: Set<string>, index: DomainIndex): string | null {
  let best: string | null = null
  let bestSize = 1 // require ≥ 2 library tokens to avoid single-generic-word matches
  for (const e of index.entries) {
    if (e.tokens.size <= bestSize) continue
    let all = true
    for (const t of e.tokens) if (!queryTokens.has(t)) { all = false; break }
    if (all) { best = e.domain; bestSize = e.tokens.size }
  }
  return best
}

/** Tier 'fuzzy': nearest library key within a length-scaled edit budget (typos). */
function matchFuzzy(key: string, index: DomainIndex): string | null {
  if (key.length < 5) return null // too short to fuzzy-match safely
  const budget = key.length <= 6 ? 1 : key.length <= 12 ? 2 : 3
  let best: string | null = null
  let bestDist = budget + 1
  for (const e of index.entries) {
    if (e.key === key) continue
    const d = editDistance(key, e.key, bestDist - 1)
    if (d >= 1 && d < bestDist) { bestDist = d; best = e.domain; if (d === 1) break }
  }
  return best
}

/** Tier 'semantic': sum token→domain weights; assign the top domain past a margin. */
export function matchSemantic(
  queryTokens: string[],
  model: SkillDomainModel,
  minScore = 2.5,
  margin = 1.3,
): string | null {
  const totals = new Map<string, number>()
  for (const t of queryTokens) {
    const row = model[t]
    if (!row) continue
    for (const [domain, w] of Object.entries(row)) {
      totals.set(domain, (totals.get(domain) ?? 0) + w)
    }
  }
  if (totals.size === 0) return null
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const [topDomain, top] = sorted[0]
  const second = sorted[1]?.[1] ?? 0
  if (top < minScore) return null
  if (second > 0 && top < margin * second) return null // too ambiguous
  return topDomain
}

export interface MatchOptions {
  model?: SkillDomainModel
  fuzzy?: boolean
  semantic?: boolean
}

/**
 * Match one skill name to a domain, trying exact → token → fuzzy → semantic.
 * Returns the first hit with its tier, or null when nothing is confident enough.
 */
export function matchSkillDomain(
  name: string,
  index: DomainIndex,
  opts: MatchOptions = {},
): DomainMatch | null {
  const key = normalizeKey(name)
  if (!key) return null

  // Exact, with a "js" suffix fallback so "React.js"/"Vue.js" reach "React"/"Vue".
  const exact = index.byKey.get(key)
    ?? (key.endsWith(' js') ? index.byKey.get(key.slice(0, -3)) : undefined)
  if (exact) return { domain: exact, tier: 'exact' }

  const tokens = tokenize(name)
  const tokenHit = matchToken(new Set(tokens), index)
  if (tokenHit) return { domain: tokenHit, tier: 'token' }

  if (opts.fuzzy !== false) {
    const fuzzy = matchFuzzy(key, index)
    if (fuzzy) return { domain: fuzzy, tier: 'fuzzy' }
  }

  if (opts.semantic !== false && opts.model) {
    const sem = matchSemantic(tokens, opts.model)
    if (sem) return { domain: sem, tier: 'semantic' }
  }

  return null
}

/**
 * Tiers whose result should be surfaced as "inferred" (worth a review). Only
 * 'exact' (normalized) is fully reliable; 'token' can grab a generic sub-phrase
 * ("Amazon Web Services" → the library's "Web Services"), and fuzzy/semantic/
 * graph are heuristics — so all four are flagged for the user to glance over.
 */
export const INFERRED_TIERS: ReadonlySet<MatchTier> = new Set<MatchTier>(['token', 'fuzzy', 'semantic', 'graph'])
