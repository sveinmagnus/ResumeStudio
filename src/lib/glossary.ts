/**
 * C3 — the bilingual glossary: how THIS person renders THEIR terms.
 *
 * Every Draft press is an independent call with no memory of the last one, so
 * "leveranseansvarlig" comes back *delivery manager* on one project and
 * *delivery lead* on the next. Nothing is wrong; the CV just reads like two
 * translators shared it. (A3, the semantic drift pass, reports exactly this
 * under "inconsistent terminology" — this is the prevention for what that
 * detects.)
 *
 * The design point: the glossary is **harvested, not inferred**. A CV
 * maintained in two languages is already a parallel corpus, and its most
 * reliable parts need no model at all:
 *
 *   Tier 1 — the REGISTRIES. `Skill.name`, `Role.name`, `Industry.name` and
 *            `SkillCategory.name` are LocalizedStrings the user curated
 *            themselves. `{no: "Skydrift", en: "Cloud operations"}` is a
 *            verified term pair that has been sitting in the store unused.
 *   Tier 2 — short IDENTITY fields filled in both locales: role titles,
 *            degrees, course names, tag lines. Noun phrases, so a both-columns
 *            pair IS a term pair. These are exactly `cvFields`' `prose: false`
 *            set.
 *
 * The other half is **`keep`** — names that must survive translation untouched.
 * The store knows every customer, employer, school and issuer, so protecting
 * "Statens vegvesen" from becoming "The State Road Administration" costs one
 * pass over data we already have.
 *
 * Prose fields are deliberately NOT mined: aligning a term inside a paragraph
 * pair needs a model, is noisy, and would put invented pairs into a mechanism
 * whose whole value is that it is certain.
 *
 * Scoping is what makes this cheap. `scopeGlossary` keeps only the entries
 * whose source term actually occurs in the text about to be translated, so a
 * 300-entry glossary becomes three or four lines in a prompt — small enough
 * that the ordinary local model can honour it. This is NOT a high-end feature.
 */

import type { LocalizedString, ResumeStore } from '../types'
import { CV_FIELDS, fieldsOf, itemsOf } from './cvFields'
import { richToPlain } from './richText'

/** One term pair: how `source` is written in the target language. */
export interface GlossaryTerm {
  from: string
  to: string
  /** Where it came from — registry pairs are the most trustworthy. */
  origin: 'registry' | 'field'
}

export interface Glossary {
  terms: GlossaryTerm[]
  /** Names that must pass through untranslated. */
  keep: string[]
}

export const EMPTY_GLOSSARY: Glossary = { terms: [], keep: [] }

/** Longest term we'll treat as a term. Past this it's a sentence. */
const MAX_TERM_CHARS = 60
/** A term shorter than this matches too much ("IT", "AI" are the edge we accept). */
const MIN_TERM_CHARS = 2
/** Hard cap on what we'll build, and on what we'll send. */
const MAX_TERMS = 400
export const MAX_SCOPED_TERMS = 40

function clean(v: string | undefined): string {
  return richToPlain(v ?? '').replace(/\s+/g, ' ').trim()
}

function usable(s: string): boolean {
  return s.length >= MIN_TERM_CHARS && s.length <= MAX_TERM_CHARS && /[\p{L}]/u.test(s)
}

/** Escape for RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whole-term match. `\b` is ASCII-oriented and would both miss and mis-fire on
 * Norwegian — "Skydrift" must not match inside "Skydriften", and "ø" must not
 * read as a word boundary. Unicode lookaround does the right thing.
 */
export function mentions(text: string, term: string): boolean {
  if (!usable(term)) return false
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
  } catch {
    return false
  }
}

/** Add a pair if both sides are usable and they actually differ. */
function addPair(
  into: Map<string, GlossaryTerm>,
  ls: LocalizedString | undefined,
  source: string,
  target: string,
  origin: GlossaryTerm['origin'],
): void {
  if (!ls) return
  const from = clean(ls[source])
  const to = clean(ls[target])
  if (!usable(from) || !usable(to)) return
  // Identical in both languages is not a translation instruction — it belongs
  // in `keep` if anywhere, and as a term pair it would just waste prompt space.
  if (from.toLowerCase() === to.toLowerCase()) return
  const key = from.toLowerCase()
  const existing = into.get(key)
  // A registry pair beats a field pair for the same term: the user curated it.
  if (existing && !(existing.origin === 'field' && origin === 'registry')) return
  into.set(key, { from, to, origin })
}

/**
 * Build the glossary for one language direction. Pure and cheap — derived from
 * the store on each call, so there is nothing to persist, migrate or keep in
 * sync with edits.
 */
export function buildGlossary(store: ResumeStore, source: string, target: string): Glossary {
  if (!source || !target || source === target) return EMPTY_GLOSSARY

  const terms = new Map<string, GlossaryTerm>()

  // ── Tier 1: the registries ──
  for (const s of store.skills) addPair(terms, s.name, source, target, 'registry')
  for (const r of store.roles) addPair(terms, r.name, source, target, 'registry')
  for (const i of store.industries) addPair(terms, i.name, source, target, 'registry')
  for (const c of store.skill_categories ?? []) addPair(terms, c.name, source, target, 'registry')

  // ── Tier 2 + `keep`: short identity fields, both-locale ──
  const keep = new Map<string, string>()
  for (const section of Object.keys(CV_FIELDS)) {
    for (const item of itemsOf(store, section)) {
      for (const f of fieldsOf(section)) {
        if (f.prose || f.list) continue
        const ls = item[f.key] as LocalizedString | undefined
        if (!ls) continue
        addPair(terms, ls, source, target, 'field')

        // An identity value written identically in both columns is a NAME the
        // user chose not to translate — "Statens vegvesen", "NAV", "Cartavio".
        // That is a do-not-translate instruction they already gave us.
        const a = clean(ls[source])
        const b = clean(ls[target])
        if (usable(a) && (a === b || (!b && usable(a)))) keep.set(a.toLowerCase(), a)
      }
    }
  }

  return {
    terms: [...terms.values()].slice(0, MAX_TERMS),
    keep: [...keep.values()].slice(0, MAX_TERMS),
  }
}

/**
 * Narrow a glossary to what the text at hand actually contains.
 *
 * This is the piece that makes the feature usable rather than theoretical: a
 * model given four relevant term mappings honours them; the same model given
 * three hundred ignores all of them and the request costs a fortune. Longer
 * terms first, so "Cloud operations" wins over "Cloud" when both match.
 */
export function scopeGlossary(glossary: Glossary, text: string): Glossary {
  if (!text.trim()) return EMPTY_GLOSSARY
  const byLength = <T extends { length: number }>(a: T, b: T) => b.length - a.length

  const terms = glossary.terms
    .filter((t) => mentions(text, t.from))
    .sort((a, b) => byLength(a.from, b.from))
    .slice(0, MAX_SCOPED_TERMS)

  const keep = glossary.keep
    .filter((k) => mentions(text, k))
    .sort(byLength)
    .slice(0, MAX_SCOPED_TERMS)

  return { terms, keep }
}

/** True when there is anything worth sending. */
export function hasGlossary(g: Glossary): boolean {
  return g.terms.length > 0 || g.keep.length > 0
}

/**
 * The wire shape. Deliberately minimal: the server should receive terms, not a
 * slice of the user's CV, and every field here is already visible in the text
 * being translated anyway.
 */
export interface GlossaryPayload {
  terms: { from: string; to: string }[]
  keep: string[]
}

export function toPayload(g: Glossary): GlossaryPayload | undefined {
  if (!hasGlossary(g)) return undefined
  return { terms: g.terms.map(({ from, to }) => ({ from, to })), keep: g.keep }
}

/** Build + scope in one call — what the translate client actually needs. */
export function glossaryFor(
  store: ResumeStore,
  source: string,
  target: string,
  text: string,
): GlossaryPayload | undefined {
  return toPayload(scopeGlossary(buildGlossary(store, source, target), text))
}
