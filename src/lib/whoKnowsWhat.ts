/**
 * "Who knows what" — a skill × person matrix across every resume in the
 * instance, for the picker (the small-team affordance that was always the point
 * of multi-resume). Pure aggregation so it's testable and UI-agnostic.
 *
 * INTERIM DATA SOURCE: today each resume owns its own skill registry, so this
 * groups skills across resumes by their normalized `skillKey` — the same key the
 * skill-extraction assist interns against, and the same normalization the coming
 * instance-level registry will canonicalize on (see
 * plans/cross-resume-registries.md). When registries become instance-level, the
 * grouping swaps from name-matching to the shared canonical id, but this
 * function's OUTPUT shape (people + rows + holders) — and the UI on top of it —
 * stays. That's why the matrix is built first: same shell, cleaner source later.
 *
 * Proficiency is per-person by nature (Ada's Java is not Bob's), so it stays a
 * per-holder value here and will remain per-resume after the registry split.
 */

import type { ResumeStore } from '../types'
import { resolve } from './locales'
import { skillKey } from './skillExtract'

/** One person's command of a skill. */
export interface SkillHolder {
  resumeId: string
  resumeName: string
  personName: string
  /** 0–5 proficiency as recorded on that resume's skill. */
  proficiency: number
}

export interface SkillMatrixRow {
  /** Normalized grouping key (`skillKey`). */
  key: string
  /** Display name — the most common spelling across holders (ties → first seen). */
  name: string
  /** Everyone who lists the skill, strongest first. */
  holders: SkillHolder[]
}

export interface PersonRef {
  resumeId: string
  resumeName: string
  personName: string
}

export interface WhoKnowsWhat {
  /** Every resume that contributed, in input order — the matrix columns. */
  people: PersonRef[]
  /** Skills across everyone, most widely-held first, then alphabetical. */
  rows: SkillMatrixRow[]
}

interface ResumeInput {
  id: string
  name: string
  data: ResumeStore
}

/** The person label for a resume: the CV's full name, else the resume's title. */
function personName(r: ResumeInput): string {
  return (r.data.resume?.full_name ?? '').trim() || r.name
}

/**
 * Build the skill × person matrix. `locale` picks the display spelling; the
 * grouping is locale-independent (every locale of a skill's name contributes its
 * key, so a NO-only skill still lines up with an EN-only one for the same tech).
 */
export function buildWhoKnowsWhat(resumes: ResumeInput[], locale = 'en'): WhoKnowsWhat {
  const people: PersonRef[] = resumes.map((r) => ({
    resumeId: r.id, resumeName: r.name, personName: personName(r),
  }))

  // key → { holders, and a spelling tally to pick the display name }
  const groups = new Map<string, { holders: SkillHolder[]; names: Map<string, number> }>()

  for (const r of resumes) {
    const who: PersonRef = { resumeId: r.id, resumeName: r.name, personName: personName(r) }
    // A resume could (via bad data) list the same skill twice; keep the first
    // per key per resume so one person never double-counts a skill.
    const seen = new Set<string>()
    for (const skill of r.data.skills ?? []) {
      // Group on any locale's spelling so cross-language duplicates line up.
      const keys = Object.values(skill.name ?? {}).map((n) => skillKey(n ?? '')).filter(Boolean)
      const key = keys[0]
      if (!key || seen.has(key)) continue
      seen.add(key)

      let g = groups.get(key)
      if (!g) { g = { holders: [], names: new Map() }; groups.set(key, g) }
      g.holders.push({
        resumeId: who.resumeId, resumeName: who.resumeName, personName: who.personName,
        proficiency: typeof skill.proficiency === 'number' ? skill.proficiency : 0,
      })
      const display = resolve(skill.name, locale) || Object.values(skill.name ?? {})[0] || key
      g.names.set(display, (g.names.get(display) ?? 0) + 1)
    }
  }

  const rows: SkillMatrixRow[] = [...groups.entries()].map(([key, g]) => {
    // Display name = the most-used spelling; ties resolve to the first inserted.
    let name = key
    let best = -1
    for (const [spelling, count] of g.names) {
      if (count > best) { best = count; name = spelling }
    }
    const holders = [...g.holders].sort((a, b) => b.proficiency - a.proficiency)
    return { key, name, holders }
  })

  // Most widely-held first (the interesting rows for a team), then alphabetical.
  rows.sort((a, b) => b.holders.length - a.holders.length || a.name.localeCompare(b.name))

  return { people, rows }
}
