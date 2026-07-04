/**
 * PURE: import skill normalization (roadmap F12 point 2).
 *
 * Free-text skill names from an import (CVpartner / AI / LinkedIn / Europass)
 * land on the Quadim library's canonical spelling when they match it — so
 * "typescript", "TypeScript" and "TYPESCRIPT" all become the one canonical
 * "TypeScript", aligned with what the autocomplete suggests, instead of
 * minting case-variant near-duplicates that merge has to clean up later.
 *
 * Conservative by design: this only adopts the library's *casing/spacing* for
 * a name that already matches case-insensitively. It NEVER fuzzy-matches a
 * typo onto a different skill, and NEVER touches a name absent from the
 * library — so a Norwegian or niche skill is left exactly as imported. The
 * library is English-only; a coincidental match just fixes casing, which is
 * correct for technology proper nouns regardless of locale.
 *
 * Applied to the free-text importers only — NOT to backup restores, which
 * carry intentional existing names that must round-trip unchanged.
 */

import type { ResumeStore, LocalizedString } from '../types'

/** Build a lowercased-name → canonical-spelling lookup from the slim taxonomy list. */
export function buildCanonicalMap(taxonomy: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of taxonomy) {
    const name = raw.trim()
    const key = name.toLowerCase()
    if (key && !map.has(key)) map.set(key, name)
  }
  return map
}

/** Trim + collapse internal whitespace (imports carry padded/odd spacing). */
const cleanWhitespace = (s: string): string => s.trim().replace(/\s+/g, ' ')

/**
 * Canonicalize one free-text skill name against the library map. Returns the
 * library's canonical spelling on a case-insensitive match, else the cleaned
 * input unchanged.
 */
export function canonicalizeName(raw: string, map: Map<string, string>): string {
  const cleaned = cleanWhitespace(raw)
  if (!cleaned) return cleaned
  return map.get(cleaned.toLowerCase()) ?? cleaned
}

function canonicalizeLocalized(
  ls: LocalizedString,
  map: Map<string, string>,
): { value: LocalizedString; changed: boolean } {
  let changed = false
  const out: LocalizedString = {}
  for (const [loc, v] of Object.entries(ls)) {
    const c = canonicalizeName(v, map)
    if (c !== v) changed = true
    out[loc] = c
  }
  return { value: out, changed }
}

export interface NormalizeResult {
  store: ResumeStore
  /** How many registry skills had a name canonicalized — for a future import summary. */
  changed: number
}

/** Build a lowercased-name lookup for the classification map (F12 pt4). */
function lowerLookup(map: Record<string, string> | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (map) for (const [k, v] of Object.entries(map)) out.set(k.trim().toLowerCase(), v)
  return out
}

/**
 * Rewrite a freshly-imported store's skill names to canonical library
 * spellings, and (when `classifications` is supplied) stamp each matching
 * skill's authoritative library classification (F12 pt4). Pure — returns a new
 * store; the input is untouched.
 *
 * The registry (`skills`) is the source of truth; `ProjectSkill.name` is a
 * denormalized copy, so after canonicalizing a registry entry we rebuild
 * every copy that references it. An orphan project skill (no `skill_id`) is
 * canonicalized directly.
 */
export function normalizeImportedSkills(
  store: ResumeStore,
  taxonomy: string[],
  classifications?: Record<string, string>,
): NormalizeResult {
  const map = buildCanonicalMap(taxonomy)
  if (map.size === 0) return { store, changed: 0 }
  const classMap = lowerLookup(classifications)

  let changed = 0
  const canonicalById = new Map<string, LocalizedString>()
  const skills = store.skills.map((s) => {
    const r = canonicalizeLocalized(s.name, map)
    // Stamp classification from the (canonicalized) name when not already set.
    let classification = s.classification
    if (!classification && classMap.size) {
      for (const v of Object.values(r.value)) {
        const c = classMap.get(v.trim().toLowerCase())
        if (c) { classification = c; break }
      }
    }
    const classChanged = classification !== s.classification
    if (!r.changed && !classChanged) return s
    if (r.changed) { changed++; canonicalById.set(s.id, r.value) }
    return {
      ...s,
      ...(r.changed ? { name: r.value } : {}),
      ...(classChanged ? { classification } : {}),
    }
  })

  // Rebuild denormalized name copies: use the canonicalized registry name for
  // a linked skill, else canonicalize the orphan copy's own name in place.
  const fixCopies = <T extends { skill_id: string; name: LocalizedString }>(arr: T[]): T[] =>
    arr.map((item) => {
      const canon = item.skill_id ? canonicalById.get(item.skill_id) : undefined
      if (canon) return { ...item, name: canon }
      const r = canonicalizeLocalized(item.name, map)
      return r.changed ? { ...item, name: r.value } : item
    })

  const projects = store.projects.map((p) => ({ ...p, skills: fixCopies(p.skills) }))

  return { store: { ...store, skills, projects }, changed }
}
