import { describe, it, expect } from 'vitest'
import { wipeLocale } from '../src/lib/wipeLocale'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeKQ, makeRole,
  makeSkill, makeSkillCategory, makePosition, makePresentation,
  makePublication, makeAward, makeReference, makeSpokenLanguage, makeView,
} from './fixtures'

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
