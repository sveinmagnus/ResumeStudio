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
        roles: [{ id: 'pr1', role_id: 'r1', name: L, sort_order: 0, disabled: false }],
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

/**
 * The wipe removes a language and NOTHING else.
 *
 * Searching for the wiped locale proves it left, but not that everything else
 * stayed: `wipeLocale` rebuilds every row by hand, so a mapper that returns the
 * wrong object drops the row's dates, ids and links while passing a search for
 * the removed language — it removed rather too much.
 *
 * So this compares the whole store against an INDEPENDENT strip: a generic
 * recursive walk that deletes the locale key wherever it appears and copies
 * everything else. The two must agree exactly.
 */
describe('wipeLocale — removes the language and keeps the rest', () => {
  /** Recursively copy, dropping `locale` from every map of strings. */
  function stripLocale<T>(node: T, locale: string): T {
    if (Array.isArray(node)) return node.map((n) => stripLocale(n, locale)) as unknown as T
    if (!node || typeof node !== 'object') return node
    const rec = node as Record<string, unknown>
    const values = Object.values(rec)
    const looksLocalized = values.length > 0 && values.every((v) => typeof v === 'string')
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rec)) {
      if (looksLocalized && k === locale) continue
      out[k] = stripLocale(v, locale)
    }
    return out as T
  }

  /**
   * An absent localized field and an empty one mean the same thing here: the
   * wipe normalises `undefined` to `{}` as it rebuilds each row, and that is not
   * what these assertions are about.
   */
  function dropEmptyMaps<T>(node: T): T {
    if (Array.isArray(node)) return node.map(dropEmptyMaps) as unknown as T
    if (!node || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
      out[k] = dropEmptyMaps(v)
    }
    return out as T
  }

  /**
   * Ignore the two things the wipe legitimately rewrites (the timestamp and the
   * supported-locale list, both asserted separately above) and the header field
   * LABELS, which are app-seeded chrome rather than the user's text.
   */
  const comparable = (s: ResumeStore) => dropEmptyMaps({
    ...s,
    resume: { ...s.resume!, updated_at: '', supported_locales: [] },
    views: s.views.map((v) => ({ ...v, header: null })),
  })

  const withLetters = (): ResumeStore => {
    const L = { en: 'x', no: 'y' }
    const base = {
      ...emptyStore(),
      resume: makeResume({ full_name: 'Kari', title: L, place_of_residence: L, nationality: L }),
      skills: [makeSkill({ id: 's1', name: L })],
      skill_categories: [makeSkillCategory({ id: 'sc1', name: L })],
      key_competencies: [makeKeyCompetency({ id: 'kc1', title: L, description: L, short_description: L })],
      recommendations: [makeRecommendation({ id: 'rec1', recommender_title: L, relationship: L, text: L })],
      courses: [makeCourse({ id: 'c1', name: L, program: L, description: L })],
      certifications: [makeCertification({ id: 'cert1', name: L, organiser: L, description: L })],
      projects: [makeProject({
        id: 'p1', customer: L, description: L, long_description: L,
        highlights: [L, L],
        industries: [{ id: 'pi1', industry_id: 'i1', name: L, sort_order: 0 }],
        roles: [{ id: 'pr1', role_id: 'r1', name: L, sort_order: 0, disabled: false }],
        skills: [{
          id: 'ps1', skill_id: 's1', name: L,
          duration_in_years: 2, offset_in_years: 0, total_duration_in_years: 2, sort_order: 0,
        }],
      })],
      views: [makeView({ id: 'v1', introduction: L })],
    } as ResumeStore
    base.cover_letters = [{
      id: 'cl1', resume_id: base.resume!.id, name: 'Application', view_id: 'v1',
      company: L, recipient: L, role_applied: L, greeting: L, body: L, closing: L,
      posting: '', sender_name: '', dateline: null, sort_order: 0, starred: false, disabled: false,
    } as never]
    return base
  }

  it('matches an independent strip of the same store, field for field', () => {
    const store = withLetters()
    expect(comparable(wipeLocale(store, 'no'))).toEqual(comparable(stripLocale(store, 'no')))
  })

  it('keeps every row it rewrote — same ids, same numbers, same links', () => {
    // The failure this catches: a section mapper that returns an empty object.
    // The language is gone from it, and so is the row.
    const out = wipeLocale(withLetters(), 'no')
    expect(out.key_competencies[0].id).toBe('kc1')
    expect(out.recommendations[0].id).toBe('rec1')
    expect(out.courses[0].id).toBe('c1')
    expect(out.certifications[0].id).toBe('cert1')
    expect(out.skill_categories![0].id).toBe('sc1')
    expect(out.cover_letters![0]).toMatchObject({ id: 'cl1', view_id: 'v1' })
    expect(out.projects[0].industries[0]).toMatchObject({ id: 'pi1', industry_id: 'i1' })
    expect(out.projects[0].skills[0]).toMatchObject({ skill_id: 's1', duration_in_years: 2 })
  })

  it('wipes a store that predates skill categories and cover letters', () => {
    // Both arrays are optional on older data; the wipe must not invent rows for
    // them either.
    const store = { ...emptyStore() } as ResumeStore
    delete (store as { skill_categories?: unknown }).skill_categories
    delete (store as { cover_letters?: unknown }).cover_letters
    const out = wipeLocale(store, 'no')
    expect(out.skill_categories).toEqual([])
    expect(out.cover_letters).toEqual([])
  })

  it('strips the locale from a cover letter\u2019s every written field', () => {
    const out = wipeLocale(withLetters(), 'no')
    const letter = out.cover_letters![0]
    for (const field of ['company', 'recipient', 'role_applied', 'greeting', 'body', 'closing'] as const) {
      expect(letter[field], field).toEqual({ en: 'x' })
    }
  })
})
