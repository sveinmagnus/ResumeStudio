/**
 * A deliberately BIG resume, for the checks that only mean anything at scale.
 *
 * Every other fixture in the suite is minimal on purpose — one project, one
 * locale — which is right for asserting behaviour and useless for asserting
 * weight. The numbers this file produces are the evidence
 * `plans/open-items.md` names as the trigger for the content-addressed asset
 * table: "the picker actually warns on real data". Until something measures a
 * realistic CV, that trigger can only fire in production, on someone's real
 * data, which is the worst place to discover it.
 *
 * Shaped after a senior consultant's actual CV rather than a stress test:
 * a couple of decades of projects, each with real prose in two languages, the
 * registries that accumulate alongside them, and a profile photo.
 */
import {
  emptyStore, makeResume, makeProject, makeWork, makeEducation, makeSkill,
  makeSkillCategory, makeRole, makeIndustry, makeKQ, makeKeyCompetency,
  makeCourse, makeCertification, makeReference,
  makeProjectSkill, makeProjectRole, makeProjectIndustry,
} from '../fixtures'
import type { LocalizedString, ResumeStore } from '../../src/types'

/** All 15 offered locales, so the multi-language claim is measured, not assumed. */
export const ALL_LOCALES = [
  'en', 'no', 'se', 'dk', 'fi', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'cs', 'uk', 'ru',
]

/** ~90 words of plausible project prose — the field that dominates a real CV. */
const PARAGRAPH =
  'Led the design and delivery of a distributed integration platform serving ' +
  'several million requests per day, replacing a batch pipeline that had ' +
  'become the main constraint on release cadence. Responsible for the ' +
  'architecture, the migration plan and the operational handover, working ' +
  'directly with the client architecture group. Introduced contract testing ' +
  'across team boundaries, which cut cross-team integration defects ' +
  'substantially and made independent deploys routine rather than exceptional.'

/** A localized value filled in `locales`, with a locale marker so drift is visible. */
export function localized(text: string, locales: string[]): LocalizedString {
  return Object.fromEntries(locales.map((l) => [l, `[${l}] ${text}`]))
}

/**
 * A base64 PNG of roughly `kb` kilobytes.
 *
 * Images are the whole reason payload weight is a question: they ride inside
 * the resume JSON, so every debounced auto-save re-sends them and the offline
 * record mirrors them into localStorage. The bytes need not decode — nothing
 * here renders them; what matters is that they weigh what a real photo weighs.
 */
export function fakeImage(kb: number): string {
  return `data:image/png;base64,${'A'.repeat(Math.round((kb * 1024 * 4) / 3))}`
}

export interface LargeStoreOptions {
  projects?: number
  locales?: string[]
  /** Profile photo size in kB. 0 omits images entirely. */
  photoKb?: number
}

/**
 * Default shape: 50 projects across 15 locales with a 300 kB photo — the
 * scenario the user asked to be measured.
 */
export function makeLargeStore(opts: LargeStoreOptions = {}): ResumeStore {
  const { projects = 50, locales = ALL_LOCALES, photoKb = 300 } = opts

  const categories = ['Backend', 'Frontend', 'Cloud', 'Data', 'Security'].map((name, i) =>
    makeSkillCategory({ id: `sc${i}`, name: localized(name, locales) }),
  )
  // A registry that grew with the projects, which is what makes cross-resume
  // registry sync and the skill matrix non-trivial at this size.
  const skills = Array.from({ length: 120 }, (_, i) =>
    makeSkill({
      id: `s${i}`,
      name: localized(`Skill ${i}`, locales),
      category_id: categories[i % categories.length].id,
    }),
  )
  const roles = Array.from({ length: 20 }, (_, i) =>
    makeRole({ id: `r${i}`, name: localized(`Role ${i}`, locales) }),
  )
  const industries = Array.from({ length: 15 }, (_, i) =>
    makeIndustry({ id: `in${i}`, name: localized(`Industry ${i}`, locales) }),
  )

  return {
    ...emptyStore(),
    resume: makeResume({
      full_name: 'Kari Nordmann',
      supported_locales: locales,
      ...(photoKb > 0 ? { profile_photo: fakeImage(photoKb), company_logo: fakeImage(40) } : {}),
    }),
    key_qualifications: [makeKQ({ id: 'kq1', competency_ids: ['kc0', 'kc1', 'kc2'] })],
    key_competencies: Array.from({ length: 8 }, (_, i) =>
      makeKeyCompetency({
        id: `kc${i}`,
        title: localized(`Competency ${i}`, locales),
        description: localized(PARAGRAPH, locales),
      }),
    ),
    projects: Array.from({ length: projects }, (_, i) =>
      makeProject({
        id: `p${i}`,
        customer: localized(`Customer ${i}`, locales),
        description: localized(PARAGRAPH, locales),
        skills: skills.slice(i % 40, (i % 40) + 8).map((s) => makeProjectSkill({ skill_id: s.id, name: s.name })),
        roles: roles.slice(i % 10, (i % 10) + 2).map((r) => makeProjectRole({ role_id: r.id, name: r.name })),
        industries: [makeProjectIndustry({
          industry_id: industries[i % industries.length].id,
          name: industries[i % industries.length].name,
        })],
      }),
    ),
    work_experiences: Array.from({ length: 8 }, (_, i) =>
      makeWork({ id: `w${i}`, description: localized(PARAGRAPH, locales) }),
    ),
    educations: Array.from({ length: 3 }, (_, i) => makeEducation({ id: `e${i}` })),
    courses: Array.from({ length: 25 }, (_, i) => makeCourse({ id: `co${i}` })),
    certifications: Array.from({ length: 10 }, (_, i) => makeCertification({ id: `ce${i}` })),
    references: Array.from({ length: 5 }, (_, i) => makeReference({ id: `rf${i}` })),
    skills,
    skill_categories: categories,
    roles,
    industries,
  }
}

/** UTF-8 byte length of the store as it rides on the wire and into localStorage. */
export function storeBytes(store: ResumeStore): number {
  return new TextEncoder().encode(JSON.stringify(store)).length
}
