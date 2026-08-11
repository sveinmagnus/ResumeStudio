import { describe, it, expect } from 'vitest'
import { wipeLocale } from '../src/lib/wipeLocale'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ, makeRole,
  makeIndustry, makeSkill, makeSkillCategory, makePosition, makePresentation,
  makePublication, makeAward, makeReference, makeSpokenLanguage, makeView,
  makeResume, makeKeyCompetency, makeRecommendation, makeCourse, makeCertification,
} from './fixtures'
import type { ResumeStore } from '../src/types'

describe('wipeLocale', () => {
  it('drops the locale from resume.supported_locales and updates updated_at', () => {
    const store = { ...emptyStore() }
    store.resume!.supported_locales = ['no', 'en', 'se']
    const before = store.resume!.updated_at
    const out = wipeLocale(store, 'en')
    expect(out.resume!.supported_locales).toEqual(['no', 'se'])
    expect(out.resume!.updated_at).not.toBe(before)
  })

  it('falls back to ["en"] if all supported locales are wiped', () => {
    const store = { ...emptyStore() }
    store.resume!.supported_locales = ['no']
    const out = wipeLocale(store, 'no')
    expect(out.resume!.supported_locales).toEqual(['en'])
  })

  it('clears the locale from every LocalizedString on the resume root', () => {
    const store = { ...emptyStore() }
    store.resume!.title = { en: 'Consultant', no: 'Konsulent' }
    store.resume!.nationality = { en: 'Norwegian', no: 'Norsk' }
    store.resume!.place_of_residence = { en: 'Oslo', no: 'Oslo' }
    const out = wipeLocale(store, 'no')
    expect(out.resume!.title).toEqual({ en: 'Consultant' })
    expect(out.resume!.nationality).toEqual({ en: 'Norwegian' })
    expect(out.resume!.place_of_residence).toEqual({ en: 'Oslo' })
  })

  it('clears the locale from project, role, skill, customer + nested rows', () => {
    const store = {
      ...emptyStore(),
      projects: [makeProject({
        customer: { en: 'Acme', no: 'Acme' },
        description: { en: 'short', no: 'kort' },
        long_description: { en: 'long', no: 'lang' },
        highlights: [{ en: 'won', no: 'vant' }],
        roles: [{ id: 'r1', role_id: '', name: { en: 'Dev', no: 'Utvikler' }, sort_order: 0, disabled: false }],
        skills: [{ id: 's1', skill_id: '', name: { en: 'TS', no: 'TS' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
      })],
      skills: [makeSkill({ name: { en: 'TS', no: 'TS' } })],
      roles: [makeRole({ name: { en: 'Dev', no: 'Utvikler' } })],
    }
    const out = wipeLocale(store, 'no')
    const p = out.projects[0]
    expect(p.customer).toEqual({ en: 'Acme' })
    expect(p.long_description).toEqual({ en: 'long' })
    expect(p.highlights[0]).toEqual({ en: 'won' })
    expect(p.roles[0].name).toEqual({ en: 'Dev' })
    expect(p.skills[0].name).toEqual({ en: 'TS' })
    expect(out.skills[0].name).toEqual({ en: 'TS' })
    expect(out.roles[0].name).toEqual({ en: 'Dev' })
  })

  it('walks every section type', () => {
    const store = {
      ...emptyStore(),
      key_qualifications: [makeKQ({
        label: { en: 'Profile', no: 'Profil' },
        summary: { en: 's', no: 'o' },
        key_points: [{ id: 'kp', name: { en: 'A', no: 'B' }, long_description: { en: 'x', no: 'y' }, sort_order: 0, disabled: false }],
      })],
      work_experiences: [makeWork({ long_description: { en: 'l', no: 'L' } })],
      educations: [makeEducation({ description: { en: 'd', no: 'D' } })],
      skill_categories: [makeSkillCategory({ name: { en: 'Cat', no: 'Kat' } })],
      positions: [makePosition({ description: { en: 'P', no: 'P' } })],
      presentations: [makePresentation({ description: { en: 'P', no: 'P' } })],
      publications: [makePublication({ abstract: { en: 'A', no: 'A' } })],
      honor_awards: [makeAward({ description: { en: 'A', no: 'A' } })],
      references: [makeReference({ relationship: { en: 'm', no: 'M' } })],
      spoken_languages: [makeSpokenLanguage({ name: { en: 'En', no: 'No' }, level: { en: 'L', no: 'L' } })],
      views: [makeView({ introduction: { en: 'I', no: 'I' } })],
    }
    const out = wipeLocale(store, 'no')
    expect(out.key_qualifications[0].summary).toEqual({ en: 's' })
    expect(out.key_qualifications[0].key_points[0].name).toEqual({ en: 'A' })
    expect(out.work_experiences[0].long_description).toEqual({ en: 'l' })
    expect(out.educations[0].description).toEqual({ en: 'd' })
    expect(out.skill_categories![0].name).toEqual({ en: 'Cat' })
    expect(out.positions[0].description).toEqual({ en: 'P' })
    expect(out.presentations[0].description).toEqual({ en: 'P' })
    expect(out.publications[0].abstract).toEqual({ en: 'A' })
    expect(out.honor_awards[0].description).toEqual({ en: 'A' })
    expect(out.references[0].relationship).toEqual({ en: 'm' })
    expect(out.spoken_languages[0].name).toEqual({ en: 'En' })
    expect(out.views[0].introduction).toEqual({ en: 'I' })
  })

  it('walks the registries too, including industries', () => {
    // The three registries are separate map() calls; industries is the one no
    // other test names, and a name left behind there re-seeds the wiped
    // language on the next export.
    const store = {
      ...emptyStore(),
      skills: [makeSkill({ name: { en: 'Go', no: 'Go' } })],
      roles: [makeRole({ name: { en: 'Architect', no: 'Arkitekt' } })],
      industries: [makeIndustry({ name: { en: 'Finance', no: 'Finans' } })],
    }
    const out = wipeLocale(store, 'no')
    expect(out.skills[0].name).toEqual({ en: 'Go' })
    expect(out.roles[0].name).toEqual({ en: 'Architect' })
    expect(out.industries[0].name).toEqual({ en: 'Finance' })
  })

  it('leaves a field that never had the locale exactly as it was', () => {
    // Same object back, not a rebuilt copy — a whole-store rewrite would show
    // up as a change on every field the resume has.
    const name = { en: 'Only English' }
    const store = { ...emptyStore(), skills: [makeSkill({ name })] }
    expect(wipeLocale(store, 'no').skills[0].name).toBe(name)
  })

  it('does not mutate the input store', () => {
    const store = {
      ...emptyStore(),
      projects: [makeProject({ customer: { en: 'Acme', no: 'Acme' } })],
    }
    const before = JSON.stringify(store)
    wipeLocale(store, 'no')
    expect(JSON.stringify(store)).toBe(before)
  })
})

/**
 * Nothing is left behind, checked by SEARCHING rather than by listing.
 *
 * wipeLocale enumerates every section and every field by hand, so a section it
 * forgets keeps its text — and the language the user asked to remove is still
 * in the file, still exported, still synced. The existing walk asserts one
 * field per section, which cannot notice a second field on a section that IS
 * listed, nor a section added later.
 *
 * This looks for the locale instead: build a store with the language in every
 * field the fixtures reach, wipe, then recurse over the result and fail on any
 * surviving occurrence. A new section that nobody wires up fails here without
 * anyone remembering to add a case.
 */
describe('wipeLocale — leaves nothing behind', () => {
  /** Every path at which `locale` still appears as a key of a string map. */
  function survivingPaths(node: unknown, locale: string, path = '', out: string[] = []): string[] {
    if (Array.isArray(node)) {
      node.forEach((n, i) => survivingPaths(n, locale, `${path}[${i}]`, out))
      return out
    }
    if (!node || typeof node !== 'object') return out
    const rec = node as Record<string, unknown>
    const values = Object.values(rec)
    const looksLocalized = values.length > 0 && values.every((v) => typeof v === 'string')
    if (looksLocalized && locale in rec) out.push(path || '(root)')
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === 'object' && v !== null) survivingPaths(v, locale, `${path}.${k}`, out)
    }
    return out
  }

  /** A store with 'no' filled in on every section the fixtures cover. */
  function fullStore(): ResumeStore {
    const L = { en: 'x', no: 'y' }
    return {
      ...emptyStore(),
      resume: makeResume({ full_name: 'Kari', title: L, place_of_residence: L, nationality: L }),
      skills: [makeSkill({ id: 's1', name: L })],
      roles: [makeRole({ id: 'r1', name: L })],
      industries: [makeIndustry({ id: 'i1', name: L })],
      skill_categories: [makeSkillCategory({ id: 'sc1', name: L })],
      key_qualifications: [makeKQ({
        id: 'kq1', label: L, tag_line: L, summary: L, summary_short: L,
        key_points: [{ id: 'kp', name: L, long_description: L, sort_order: 0, disabled: false }],
      })],
      key_competencies: [makeKeyCompetency({ id: 'kc1', title: L, description: L, short_description: L })],
      recommendations: [makeRecommendation({ id: 'rec1', recommender_title: L, relationship: L, text: L })],
      projects: [makeProject({
        id: 'p1', customer: L, customer_anonymized: L, description: L,
        long_description: L, short_description: L,
        industries: [{ id: 'pi1', industry_id: 'i1', name: L, sort_order: 0 }],
        roles: [{ id: 'pr1', role_id: 'r1', name: L, sort_order: 0 }],
        skills: [{ id: 'ps1', skill_id: 's1', name: L, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
      })],
      work_experiences: [makeWork({ id: 'w1', employer: L, role_title: L, description: L, long_description: L })],
      educations: [makeEducation({ id: 'e1', school: L, degree: L, description: L })],
      courses: [makeCourse({ id: 'c1', name: L, program: L, description: L })],
      certifications: [makeCertification({ id: 'cert1', name: L, organiser: L, description: L })],
      positions: [makePosition({ id: 'pos1', name: L, organisation: L, description: L })],
      presentations: [makePresentation({ id: 'pres1', title: L, event: L, description: L })],
      publications: [makePublication({ id: 'pub1', title: L, publisher: L, abstract: L })],
      honor_awards: [makeAward({ id: 'a1', name: L, issuer: L, description: L })],
      references: [makeReference({ id: 'ref1', relationship: L })],
      spoken_languages: [makeSpokenLanguage({ id: 'l1', name: L, level: L })],
      views: [makeView({ id: 'v1', introduction: L })],
    } as ResumeStore
  }

  it('removes the locale from EVERY localized field in the store', () => {
    // A view's header FIELD LABELS are excluded deliberately: they are seeded
    // by the app with a translation in every offered locale, not written by
    // the user, and stripping one leaves a header field that renders unlabelled
    // in a language the resume still supports. Everything else must go.
    const paths = survivingPaths(wipeLocale(fullStore(), 'no'), 'no')
      .filter((p) => !/^\.views\[\d+\]\.header\.fields\[\d+\]\.label$/.test(p))
    expect(paths).toEqual([])
  })

  it('is a real check — the same search finds the locale before the wipe', () => {
    // Without this, a search that silently matched nothing would pass above
    // however broken the wipe was.
    expect(survivingPaths(fullStore(), 'no').length).toBeGreaterThan(20)
  })

  it('keeps the other locale everywhere it removed one', () => {
    const out = wipeLocale(fullStore(), 'no')
    expect(survivingPaths(out, 'en').length).toBeGreaterThan(20)
  })
})
