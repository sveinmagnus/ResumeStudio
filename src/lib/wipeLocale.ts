/**
 * Delete every value attached to a given locale from a ResumeStore.
 *
 * Pure function. Walks the resume in one pass — for every LocalizedString
 * value (top-level, nested in arrays, nested in arrays of arrays), drop the
 * entry for the wiped locale. Also removes the locale from
 * `resume.supported_locales`.
 *
 * The use case: a CVpartner import often pulls in `int`/`en` content even
 * when the consultant only ever wrote in Norwegian. The completeness drill-
 * down then shows every field as 99% missing in the unused locale.
 * Wipe-language gives the user a single button to clean up that ghost
 * language entirely.
 *
 * Does NOT mutate the input.
 */

import type {
  ResumeStore, LocalizedString, Resume,
  KeyQualification, KeyCompetency, Recommendation, Project, WorkExperience,
  Education, Course, Certification, SpokenLanguage, TechnologyCategory,
  Position, Presentation, HonorAward, Publication, Reference, Skill, Role,
  KeyPoint, ProjectRole, ProjectSkill, CategorySkill, ResumeView,
} from '../types'

export function wipeLocale(store: ResumeStore, locale: string): ResumeStore {
  const ls = (v: LocalizedString | undefined): LocalizedString => {
    if (!v) return {}
    if (!(locale in v)) return v
    const next = { ...v }
    delete next[locale]
    return next
  }

  const next: ResumeStore = {
    resume: store.resume ? wipeResume(store.resume, locale, ls) : null,
    skills: store.skills.map((s): Skill => ({
      ...s,
      name: ls(s.name),
      default_category: s.default_category ? ls(s.default_category) : null,
    })),
    roles: store.roles.map((r): Role => ({ ...r, name: ls(r.name) })),
    key_qualifications: store.key_qualifications.map((kq): KeyQualification => ({
      ...kq,
      label: ls(kq.label),
      tag_line: ls(kq.tag_line),
      summary: ls(kq.summary),
      key_points: kq.key_points.map((kp): KeyPoint => ({
        ...kp,
        name: ls(kp.name),
        long_description: ls(kp.long_description),
      })),
    })),
    key_competencies: store.key_competencies.map((k): KeyCompetency => ({
      ...k,
      title: ls(k.title),
      description: ls(k.description),
    })),
    recommendations: store.recommendations.map((r): Recommendation => ({
      ...r,
      relationship: ls(r.relationship),
      text: ls(r.text),
    })),
    projects: store.projects.map((p): Project => ({
      ...p,
      customer: ls(p.customer),
      customer_anonymized: ls(p.customer_anonymized),
      industry: ls(p.industry),
      description: ls(p.description),
      long_description: ls(p.long_description),
      highlights: p.highlights.map((h) => ls(h)),
      roles: p.roles.map((r): ProjectRole => ({ ...r, name: ls(r.name) })),
      skills: p.skills.map((s): ProjectSkill => ({ ...s, name: ls(s.name) })),
    })),
    work_experiences: store.work_experiences.map((w): WorkExperience => ({
      ...w,
      employer: ls(w.employer),
      role_title: ls(w.role_title),
      description: ls(w.description),
      long_description: ls(w.long_description),
    })),
    educations: store.educations.map((e): Education => ({
      ...e,
      school: ls(e.school),
      degree: ls(e.degree),
      description: ls(e.description),
    })),
    courses: store.courses.map((c): Course => ({
      ...c,
      name: ls(c.name),
      program: ls(c.program),
      description: ls(c.description),
    })),
    certifications: store.certifications.map((c): Certification => ({
      ...c,
      name: ls(c.name),
      organiser: ls(c.organiser),
      description: ls(c.description),
    })),
    spoken_languages: store.spoken_languages.map((l): SpokenLanguage => ({
      ...l,
      name: ls(l.name),
      level: ls(l.level),
    })),
    technology_categories: store.technology_categories.map((tc): TechnologyCategory => ({
      ...tc,
      name: ls(tc.name),
      skills: tc.skills.map((s): CategorySkill => ({ ...s, name: ls(s.name) })),
    })),
    positions: store.positions.map((p): Position => ({
      ...p,
      name: ls(p.name),
      organisation: ls(p.organisation),
      description: ls(p.description),
    })),
    presentations: store.presentations.map((p): Presentation => ({
      ...p,
      title: ls(p.title),
      event: ls(p.event),
      description: ls(p.description),
    })),
    honor_awards: store.honor_awards.map((a): HonorAward => ({
      ...a,
      name: ls(a.name),
      issuer: ls(a.issuer),
      for_work: ls(a.for_work),
      description: ls(a.description),
    })),
    publications: store.publications.map((p): Publication => ({
      ...p,
      title: ls(p.title),
      publisher: ls(p.publisher),
      abstract: ls(p.abstract),
    })),
    references: store.references.map((r): Reference => ({
      ...r,
      relationship: ls(r.relationship),
    })),
    views: store.views.map((v): ResumeView => ({
      ...v,
      introduction: ls(v.introduction),
    })),
  }
  return next
}

function wipeResume(
  r: Resume,
  locale: string,
  ls: (v: LocalizedString | undefined) => LocalizedString,
): Resume {
  // Drop the wiped locale from supported_locales, but never leave the list
  // empty — fall back to 'en' (the resolution chain assumes at least one
  // supported locale exists).
  const filtered = r.supported_locales.filter((l) => l !== locale)
  return {
    ...r,
    title: ls(r.title),
    nationality: ls(r.nationality),
    place_of_residence: ls(r.place_of_residence),
    supported_locales: filtered.length ? filtered : ['en'],
    updated_at: new Date().toISOString(),
  }
}
