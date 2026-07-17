/**
 * PURE: the Europass / CEFR self-assessment vocabulary — levels, skill
 * categories, and concise level descriptors — plus helpers to summarise a
 * language's per-category levels (deduped) for compact display.
 *
 * The descriptors here are short, factual summaries of the CEFR global scale
 * (Council of Europe) used as editor guidance — not the full copyrighted
 * self-assessment grid.
 *
 * Category and group names carry a full localized label set (every
 * LOCALE_LABELS code, pinned by tests) because they render into EXPORTS via
 * `cefrLines`, where the reader is a client rather than the consultant.
 * Wording follows each language's Europass language-passport convention. The
 * `label` twin on each entry is the English one, and it is what the editor
 * renders — the editor stays English (see lib/exportStrings.ts on that
 * boundary), as do CEFR_LEVEL_DESC's guidance strings, which are editor-only.
 */

import type { CefrLevel, CefrCategory, LocalizedString } from '../types'
import { resolve } from './locales'

export const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

const CATEGORY_ENTRIES: Array<{ key: CefrCategory; labels: LocalizedString }> = [
  {
    key: 'listening',
    labels: {
      en: 'Listening', no: 'Lytting', se: 'Hörförståelse', dk: 'Lytning',
      de: 'Hören', fr: 'Écoute', es: 'Comprensión auditiva', it: 'Ascolto',
      nl: 'Luisteren', pt: 'Compreensão oral', pl: 'Słuchanie',
      fi: 'Kuullun ymmärtäminen', is: 'Hlustun', ru: 'Аудирование', uk: 'Аудіювання',
    },
  },
  {
    key: 'reading',
    labels: {
      en: 'Reading', no: 'Lesing', se: 'Läsförståelse', dk: 'Læsning',
      de: 'Lesen', fr: 'Lecture', es: 'Comprensión lectora', it: 'Lettura',
      nl: 'Lezen', pt: 'Leitura', pl: 'Czytanie',
      fi: 'Luetun ymmärtäminen', is: 'Lestur', ru: 'Чтение', uk: 'Читання',
    },
  },
  {
    key: 'spoken_interaction',
    labels: {
      en: 'Spoken interaction', no: 'Muntlig samhandling', se: 'Muntlig interaktion', dk: 'Mundtlig interaktion',
      de: 'An Gesprächen teilnehmen', fr: 'Interaction orale', es: 'Interacción oral', it: 'Interazione orale',
      nl: 'Deelnemen aan gesprekken', pt: 'Interação oral', pl: 'Interakcja ustna',
      fi: 'Suullinen vuorovaikutus', is: 'Samræður', ru: 'Устное взаимодействие', uk: 'Усна взаємодія',
    },
  },
  {
    key: 'spoken_production',
    labels: {
      en: 'Spoken production', no: 'Muntlig produksjon', se: 'Muntlig produktion', dk: 'Mundtlig produktion',
      de: 'Zusammenhängendes Sprechen', fr: 'Expression orale en continu', es: 'Expresión oral', it: 'Produzione orale',
      nl: 'Zelfstandig spreken', pt: 'Produção oral', pl: 'Produkcja ustna',
      fi: 'Suullinen tuottaminen', is: 'Frásögn', ru: 'Устная речь', uk: 'Усне мовлення',
    },
  },
  {
    key: 'writing',
    labels: {
      en: 'Writing', no: 'Skriving', se: 'Skriftlig färdighet', dk: 'Skrivning',
      de: 'Schreiben', fr: 'Écriture', es: 'Expresión escrita', it: 'Scrittura',
      nl: 'Schrijven', pt: 'Escrita', pl: 'Pisanie',
      fi: 'Kirjoittaminen', is: 'Ritun', ru: 'Письмо', uk: 'Письмо',
    },
  },
]

export const CEFR_CATEGORIES: Array<{ key: CefrCategory; label: string; labels: LocalizedString }> =
  CATEGORY_ENTRIES.map((c) => ({ key: c.key, label: c.labels.en ?? c.key, labels: c.labels }))

/** Short "band + descriptor" guidance per level (CEFR global scale). Editor-only. */
export const CEFR_LEVEL_DESC: Record<CefrLevel, string> = {
  A1: 'Basic user (Breakthrough) — simple phrases for immediate needs.',
  A2: 'Basic user (Waystage) — routine, simple everyday exchanges.',
  B1: 'Independent user (Threshold) — the main points on familiar matters.',
  B2: 'Independent user (Vantage) — fluent, spontaneous interaction.',
  C1: 'Proficient user (Effective operational proficiency) — flexible, complex use.',
  C2: 'Proficient user (Mastery) — effortless, precise and nuanced.',
}

/** The localized name of a CEFR category. */
export function cefrCategoryLabel(key: CefrCategory, locale = 'en'): string {
  const entry = CEFR_CATEGORIES.find((c) => c.key === key)
  return entry ? resolve(entry.labels, locale) : key
}

export type CefrMap = Partial<Record<CefrCategory, CefrLevel>>

/** True when at least one category has a level set. */
export function hasCefr(cefr: CefrMap | undefined): boolean {
  return !!cefr && CEFR_CATEGORIES.some((c) => cefr[c.key])
}

/**
 * Group the set categories by their level, in level order, keeping category
 * order within each group. Used for a deduped compact display, e.g.
 * `[{ level: 'B2', categories: ['Listening','Reading'] }, …]`.
 */
export function cefrGrouped(cefr: CefrMap | undefined): Array<{ level: CefrLevel; categories: string[] }> {
  if (!cefr) return []
  const out: Array<{ level: CefrLevel; categories: string[] }> = []
  for (const level of CEFR_LEVELS) {
    const cats = CEFR_CATEGORIES.filter((c) => cefr[c.key] === level).map((c) => c.label)
    if (cats.length) out.push({ level, categories: cats })
  }
  return out
}

/**
 * Compact one-line summary of the CEFR levels, deduped by level:
 *  - all categories the same level → "B2"
 *  - otherwise → "B2 (Listening, Reading) · C1 (Writing…)"
 */
export function cefrSummary(cefr: CefrMap | undefined): string {
  const groups = cefrGrouped(cefr)
  if (!groups.length) return ''
  const setCount = groups.reduce((n, g) => n + g.categories.length, 0)
  if (groups.length === 1 && setCount === CEFR_CATEGORIES.length) return groups[0].level
  return groups.map((g) => `${g.level} (${g.categories.join(', ')})`).join(' · ')
}

// ─── Europass skill groups ───────────────────────────────────────────────────

/**
 * The three groups the Europass language passport reports under — the five
 * assessed categories rolled up the way the grid presents them. Reading a CV,
 * "Understanding B2 · Spoken B2 · Written C1" is what a person wants; the
 * five-way split is detail for the editor.
 */
const GROUP_ENTRIES: Array<{ labels: LocalizedString; keys: CefrCategory[] }> = [
  {
    keys: ['listening', 'reading'],
    labels: {
      en: 'Understanding', no: 'Forståelse', se: 'Förståelse', dk: 'Forståelse',
      de: 'Verstehen', fr: 'Comprendre', es: 'Comprensión', it: 'Comprensione',
      nl: 'Begrijpen', pt: 'Compreensão', pl: 'Rozumienie',
      fi: 'Ymmärtäminen', is: 'Skilningur', ru: 'Понимание', uk: 'Розуміння',
    },
  },
  {
    keys: ['spoken_interaction', 'spoken_production'],
    labels: {
      en: 'Spoken', no: 'Muntlig', se: 'Muntlig', dk: 'Mundtlig',
      de: 'Sprechen', fr: 'Parler', es: 'Habla', it: 'Parlato',
      nl: 'Spreken', pt: 'Fala', pl: 'Mówienie',
      fi: 'Puhuminen', is: 'Tal', ru: 'Говорение', uk: 'Говоріння',
    },
  },
  {
    // Single-member group, so its category label can never render beside it —
    // that a language names this group the same as its `writing` category
    // (de "Schreiben", ru "Письмо") therefore collides with nothing.
    keys: ['writing'],
    labels: {
      en: 'Written', no: 'Skriftlig', se: 'Skriftlig', dk: 'Skriftlig',
      de: 'Schreiben', fr: 'Écrire', es: 'Escritura', it: 'Scritto',
      nl: 'Schrijven', pt: 'Escrita', pl: 'Pisanie',
      fi: 'Kirjoittaminen', is: 'Ritun', ru: 'Письмо', uk: 'Письмо',
    },
  },
]

export const CEFR_GROUPS: Array<{ label: string; labels: LocalizedString; keys: CefrCategory[] }> =
  GROUP_ENTRIES.map((g) => ({ label: g.labels.en ?? '', labels: g.labels, keys: g.keys }))

/**
 * The Europass levels as display LINES, grouped by understanding / spoken /
 * written:
 *
 *  - nothing set                    → `[]`
 *  - every set category at one level → `['B2']` — a single value needs no
 *    labels, and reads as one line wherever it lands
 *  - groups differ                   → one line each, e.g.
 *    `['Understanding: B2', 'Spoken: B2', 'Written: C1']`
 *  - a group's own categories differ → that group spells them out, e.g.
 *    `'Understanding: B1 (Listening) · B2 (Reading)'`
 *
 * A group with nothing set is omitted rather than shown blank.
 *
 * `locale` names the groups and categories — this renders into exports, so it
 * follows the view's locale rather than defaulting to the editing language.
 * The levels themselves (A1–C2) are a CEFR-standard code and never translate.
 */
export function cefrLines(cefr: CefrMap | undefined, locale = 'en'): string[] {
  if (!hasCefr(cefr)) return []
  const set = cefr as CefrMap

  // One level across every category that's set → no labels needed.
  const levels = new Set(CEFR_CATEGORIES.map((c) => set[c.key]).filter(Boolean))
  if (levels.size === 1) return [[...levels][0] as string]

  const lines: string[] = []
  for (const group of CEFR_GROUPS) {
    const members = group.keys.filter((k) => set[k])
    if (!members.length) continue
    const groupLevels = new Set(members.map((k) => set[k]))
    const value = groupLevels.size === 1
      ? (set[members[0]] as string)
      // Within-group disagreement (e.g. reads better than they listen) —
      // spell out which category sits where rather than picking a winner.
      : CEFR_LEVELS
        .map((lvl) => {
          const cats = members.filter((k) => set[k] === lvl).map((k) => cefrCategoryLabel(k, locale))
          return cats.length ? `${lvl} (${cats.join(', ')})` : ''
        })
        .filter(Boolean)
        .join(' · ')
    lines.push(`${resolve(group.labels, locale)}: ${value}`)
  }
  return lines
}
