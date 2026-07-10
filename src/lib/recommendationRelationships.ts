/**
 * PURE: the curated list of recommender-relationship options for the
 * Recommendations editor. The relationship describes how the recommender knows
 * the consultant, phrased from the CONSULTANT's perspective ("Was my manager").
 *
 * Each option carries a localized label set so the dropdown can render in the
 * user's current editing language and — because picking an option stamps the
 * full label set onto the stored `LocalizedString` — every export locale gets
 * the right translation with no per-language typing. Locales beyond the ones
 * listed fall back to English through `resolve()`.
 *
 * The stored value stays a plain `LocalizedString` (no schema change): a picked
 * option is just its label set, and `matchRelationshipKey()` reverse-maps a
 * stored value back to its option so the dropdown re-selects it on reload.
 */

import type { LocalizedString } from '../types'

export interface RelationshipOption {
  /** Stable identifier — persisted nowhere; used only for the <option> value. */
  key: string
  /** Localized labels (en/no/se/dk authored; others fall back to en). */
  labels: LocalizedString
}

// Ordered in display clusters: hierarchy → mentoring → teams/peers →
// business/external → education → personal. Every directional relationship has
// both directions (manager/reported-to-me, senior/junior, mentor/mentee,
// client/supplier, teacher/student).
//
// A stored pick stamps EVERY locale label (see `relationshipLabels`), and a
// value is matched back to its option if ANY locale label still matches
// (`matchRelationshipKey`). The English label is therefore the stable anchor:
// keep every `en` string frozen and you can refine the no/se/dk wording freely
// without orphaning saved picks into free-text. Rewording an `en` label (or
// adding a genuinely new relationship) should instead be a NEW option.
export const RELATIONSHIP_OPTIONS: RelationshipOption[] = [
  // Hierarchy
  { key: 'manager',          labels: { en: 'Was my manager',                       no: 'Var min leder',                     se: 'Var min chef',                          dk: 'Var min leder' } },
  { key: 'reported_to_me',   labels: { en: 'Reported to me',                       no: 'Rapporterte til meg',               se: 'Rapporterade till mig',                 dk: 'Rapporterede til mig' } },
  { key: 'senior_colleague', labels: { en: 'Was a senior colleague',               no: 'Var en seniorkollega',              se: 'Var en seniorkollega',                  dk: 'Var en seniorkollega' } },
  { key: 'junior_colleague', labels: { en: 'Was a junior colleague',               no: 'Var en juniorkollega',              se: 'Var en juniorkollega',                  dk: 'Var en juniorkollega' } },
  // Mentoring
  { key: 'mentor',           labels: { en: 'Was my mentor',                        no: 'Var min mentor',                    se: 'Var min mentor',                        dk: 'Var min mentor' } },
  { key: 'mentee',           labels: { en: 'Was my mentee',                        no: 'Var min adept',                     se: 'Var min adept',                         dk: 'Var min protegé' } },
  // Teams / peers
  { key: 'same_team',        labels: { en: 'Worked in the same team',              no: 'Jobbet i samme team',               se: 'Arbetade i samma team',                 dk: 'Arbejdede i samme team' } },
  { key: 'same_group',       labels: { en: 'Worked in the same group',             no: 'Jobbet i samme gruppe',             se: 'Arbetade i samma grupp',                dk: 'Arbejdede i samme gruppe' } },
  { key: 'different_team',   labels: { en: 'Worked in a different team',           no: 'Jobbet i et annet team',            se: 'Arbetade i ett annat team',             dk: 'Arbejdede i et andet team' } },
  { key: 'executive_team',   labels: { en: 'Was on the same executive team / board', no: 'Satt i samme ledergruppe/styre',  se: 'Satt i samma ledningsgrupp/styrelse',   dk: 'Sad i samme ledelsesgruppe/bestyrelse' } },
  // Business / external
  { key: 'client',           labels: { en: 'Was my client',                        no: 'Var min kunde',                     se: 'Var min kund',                          dk: 'Var min kunde' } },
  { key: 'service_provider', labels: { en: 'Was a supplier / service provider to me', no: 'Var min leverandør',             se: 'Var min leverantör',                    dk: 'Var min leverandør' } },
  { key: 'business_partner', labels: { en: 'Was my business partner',              no: 'Var min forretningspartner',        se: 'Var min affärspartner',                 dk: 'Var min forretningspartner' } },
  // Education
  { key: 'teacher',          labels: { en: 'Was my teacher or professor',          no: 'Var min lærer eller foreleser',     se: 'Var min lärare eller föreläsare',       dk: 'Var min lærer eller underviser' } },
  { key: 'student',          labels: { en: 'Was my student',                       no: 'Var min student',                   se: 'Var min student',                       dk: 'Var min studerende' } },
  { key: 'studied_together', labels: { en: 'Studied or taught together',           no: 'Studerte eller underviste sammen',  se: 'Studerade eller undervisade tillsammans', dk: 'Studerede eller underviste sammen' } },
  // Personal
  { key: 'friend',           labels: { en: 'A friend',                             no: 'Var en venn',                       se: 'Var en vän',                            dk: 'Var en ven' } },
]

const OPTION_BY_KEY = new Map(RELATIONSHIP_OPTIONS.map((o) => [o.key, o]))

/** The localized label set for a key, or `{}` for an unknown key. */
export function relationshipLabels(key: string): LocalizedString {
  return { ...(OPTION_BY_KEY.get(key)?.labels ?? {}) }
}

/**
 * Reverse-map a stored relationship value back to its option key so the
 * dropdown re-selects it. Matches when ANY non-empty locale value equals an
 * option's label in that same locale (case-insensitive, trimmed). Returns null
 * for free-text / legacy values that match no option.
 */
export function matchRelationshipKey(relationship: LocalizedString | undefined): string | null {
  if (!relationship) return null
  const norm = (s: string) => s.trim().toLowerCase()
  const entries = Object.entries(relationship).filter(([, v]) => (v ?? '').trim())
  if (entries.length === 0) return null
  for (const opt of RELATIONSHIP_OPTIONS) {
    for (const [locale, value] of entries) {
      const label = opt.labels[locale]
      if (label && norm(label) === norm(value)) return opt.key
    }
  }
  return null
}
