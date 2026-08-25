/**
 * Claim–evidence gap detection.
 *
 * `experience.ts` derives numbers FROM the CV's structure. This module walks
 * the other way: it finds the CLAIMS the structure doesn't back — a top-rated
 * skill no dated project uses, a showcased skill nothing shows in use, a
 * role's stored years with no assignment behind them, a bundled competency no
 * project or employment ever mentions.
 *
 * Pure, offline, structural (drift.ts's spirit): every finding is a SIGNAL a
 * human should look at, never a verdict — an unbacked claim can be entirely
 * true (pre-CV experience, engagements the CV doesn't itemise), which is why
 * each one snoozes via `Resume.attention_dismissals` on freshness.ts's
 * pattern. `now` is injected so open-ended date ranges and snooze expiry are
 * deterministic under test.
 */

import type { LocalizedString, ResumeStore } from '../types'
import { resolve } from './locales'
import { richToPlain } from './richText'
import { fmtYearsMonths, roleExperience, skillExperience } from './experience'

export type ClaimKind = 'proficiency' | 'showcase' | 'role_years' | 'competency'

export interface ClaimFinding {
  kind: ClaimKind
  severity: 'high' | 'low'
  /** Editor section for navigation: 'skills' | 'roles' | 'key_competencies'. */
  section: string
  itemId: string
  itemLabel: string
  /** One human-readable sentence naming the gap. */
  detail: string
  /** `claim:<kind>:<itemId>` — snoozed via `Resume.attention_dismissals`. */
  dismissKey: string
}

/** A finding the user has dismissed that is still within its snooze window. */
export interface SnoozedClaim {
  key: string
  label: string
  /** ISO timestamp when it un-snoozes and may surface again. */
  until: string
}

export interface ClaimReport {
  findings: ClaimFinding[]
  snoozed: SnoozedClaim[]
  /** Skills + non-disabled roles + bundled competencies examined. */
  checked: number
}

/** The snooze key for a claim finding — see ClaimFinding.dismissKey. */
export function claimDismissKey(kind: ClaimKind, itemId: string): string {
  return `claim:${kind}:${itemId}`
}

/** A rating this high is a strong public claim; 0 means "unrated" (CVpartner). */
const PROFICIENCY_CLAIM_MIN = 4
/** Under a year across a single project is thin backing for a top rating. */
const THIN_MONTHS = 12
/** A stored role total this large deserves at least one dated assignment. */
const ROLE_YEARS_CLAIM_MIN = 3
/** Title tokens shorter than this are too generic to count as a mention. */
const TOKEN_MIN_LENGTH = 4

/**
 * Function words that would let any prose "mention" a competency. The length
 * floor already drops the 2–3 letter ones; they are listed anyway so the
 * intent survives a threshold change.
 */
const STOPWORDS = new Set([
  'with', 'from', 'into', 'over', 'that', 'this', 'and', 'the', 'for',
  'som', 'med', 'og', 'av', 'til', 'den', 'det', 'innen', 'samt',
])

/**
 * The searchable words of a competency title, across ALL its locales — a
 * mention in either language column counts as evidence.
 */
function titleTokens(title: LocalizedString): string[] {
  const out = new Set<string>()
  for (const value of Object.values(title)) {
    if (!value) continue
    for (const raw of value.toLowerCase().split(/[^\p{L}]+/u)) {
      if (raw.length >= TOKEN_MIN_LENGTH && !STOPWORDS.has(raw)) out.add(raw)
    }
  }
  return [...out]
}

/**
 * Everything the CV says it DID, as one lowercase haystack: project prose,
 * employment prose, other-role prose, in every locale. Values go through
 * `richToPlain` (identity for plain text) so a `<strong>` tag can never fake a
 * "strong" mention — only rendered text is evidence.
 */
function evidenceCorpus(store: ResumeStore): string {
  const parts: string[] = []
  const push = (ls: LocalizedString | undefined): void => {
    if (!ls) return
    for (const value of Object.values(ls)) {
      if (value) parts.push(richToPlain(value))
    }
  }
  for (const p of store.projects) {
    if (p.disabled) continue
    push(p.description)
    push(p.long_description)
    for (const h of p.highlights) push(h)
  }
  for (const w of store.work_experiences) {
    if (w.disabled) continue
    push(w.description)
    push(w.long_description)
  }
  for (const pos of store.positions) {
    if (pos.disabled) continue
    push(pos.description)
  }
  return parts.join('\n').toLowerCase()
}

/**
 * Compute the claim–evidence report. `locale` picks the language for item
 * labels; `now` is injected for deterministic open ranges and snooze checks.
 * At most one finding per item; a snoozed finding still claims its item's slot
 * (a suppressed rule must not surface a weaker one in its place).
 */
export function claimEvidenceReport(
  store: ResumeStore,
  locale: string,
  dismissals: Record<string, string> = {},
  now: Date = new Date(),
): ClaimReport {
  const nowMs = now.getTime()
  const findings: ClaimFinding[] = []
  const snoozed: SnoozedClaim[] = []
  let checked = 0

  // Keys are `claim:`-prefixed, so indexing can never hit an inherited
  // Object.prototype member (the lib/lookup.ts hazard) — same as freshness.ts.
  const snoozeExpiry = (key: string): string | null => {
    const until = dismissals[key]
    if (!until) return null
    const t = Date.parse(until)
    return !Number.isNaN(t) && t > nowMs ? until : null
  }

  const add = (
    kind: ClaimKind, severity: 'high' | 'low',
    section: string, itemId: string, itemLabel: string, detail: string,
  ): void => {
    const dismissKey = claimDismissKey(kind, itemId)
    const until = snoozeExpiry(dismissKey)
    if (until) {
      snoozed.push({ key: dismissKey, label: itemLabel, until })
      return
    }
    findings.push({ kind, severity, section, itemId, itemLabel, detail, dismissKey })
  }

  for (const skill of store.skills) {
    checked++
    const label = resolve(skill.name, locale) || 'Skill'
    const linkedProjects = store.projects.filter(
      (p) => !p.disabled && p.skills.some((ps) => ps.skill_id === skill.id),
    ).length
    if (skill.proficiency >= PROFICIENCY_CLAIM_MIN) {
      const exp = skillExperience(store, skill, now)
      // usesFallback = only a legacy imported number backs it; computed 0 =
      // nothing at all does. Either way, no dated project uses the skill.
      if (exp.usesFallback || exp.computedMonths === 0) {
        let detail = `Rated ${skill.proficiency}/5 — no dated project uses this skill.`
        if (exp.adjustmentMonths !== 0) {
          // A deliberate pre-CV credit should read as deliberate, not as a gap.
          const sign = exp.adjustmentMonths < 0 ? '-' : ''
          detail += ` (a manual adjustment of ${sign}${fmtYearsMonths(Math.abs(exp.adjustmentMonths))} is set)`
        }
        add('proficiency', 'high', 'skills', skill.id, label, detail)
        continue
      }
      if (exp.computedMonths < THIN_MONTHS && linkedProjects <= 1) {
        // Real calendar evidence exists (so the count is exactly one project),
        // it's just thin for a top rating.
        const m = exp.computedMonths
        add('proficiency', 'low', 'skills', skill.id, label,
          `Rated ${skill.proficiency}/5 — ${m} month${m === 1 ? '' : 's'} across 1 project.`)
        continue
      }
    }
    // Any project LINK is a showcase's evidence — dates don't matter here.
    if (skill.is_highlighted && linkedProjects === 0) {
      add('showcase', 'low', 'skills', skill.id, label,
        'Showcased, but no project shows it in use.')
    }
  }

  for (const role of store.roles) {
    if (role.disabled) continue
    checked++
    if (role.years_of_experience < ROLE_YEARS_CLAIM_MIN) continue
    if (!roleExperience(store, role, now).usesFallback) continue
    add('role_years', 'low', 'roles', role.id, resolve(role.name, locale) || 'Role',
      `Claims ~${role.years_of_experience} years — no dated project, employment or other role links it.`)
  }

  // Only competencies a view can actually present (bundled on a live profile)
  // make a claim worth checking; the rest of the library is drafts.
  const bundled = new Set<string>()
  for (const kq of store.key_qualifications) {
    if (kq.disabled) continue
    for (const cid of kq.competency_ids) bundled.add(cid)
  }
  const inBundle = store.key_competencies.filter((c) => !c.disabled && bundled.has(c.id))
  const corpus = inBundle.length ? evidenceCorpus(store) : ''
  for (const comp of inBundle) {
    checked++
    const tokens = titleTokens(comp.title)
    // A title of pure function words can't be searched for — skip, don't flag.
    if (!tokens.length) continue
    // Substring, not word, matching — "skyarkitektur" should be found inside
    // "skyarkitekturen" (compounding is the norm in half the offered locales).
    if (tokens.some((t) => corpus.includes(t))) continue
    const label = resolve(comp.title, locale) || 'Competency'
    add('competency', 'low', 'key_competencies', comp.id, label,
      `No project or employment mentions "${label}".`)
  }

  findings.sort((x, y) => {
    if (x.severity !== y.severity) return x.severity === 'high' ? -1 : 1
    if (x.section !== y.section) return x.section.localeCompare(y.section)
    return x.itemLabel.localeCompare(y.itemLabel)
  })
  snoozed.sort((a, b) => a.label.localeCompare(b.label))

  return { findings, snoozed, checked }
}
