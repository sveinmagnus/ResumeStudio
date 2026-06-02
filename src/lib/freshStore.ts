/**
 * Empty-store + fresh-store factories.
 *
 * `emptyStore()` returns the canonical "nothing here yet" shape (resume:null,
 * empty arrays). `freshStore()` returns the same shape but with a scaffolded
 * `resume` object — what the user gets when they pick "Start fresh".
 *
 * Both are pure (no IDs, no timestamps captured at module load) so they can be
 * called from anywhere — the store action, the picker create flow, tests.
 */
import { v4 as uuidv4 } from 'uuid'
import type { ResumeStore } from '../types'

export function emptyStore(): ResumeStore {
  return {
    resume: null,
    skills: [], roles: [], key_qualifications: [], projects: [],
    work_experiences: [], educations: [], courses: [], certifications: [],
    spoken_languages: [], technology_categories: [], positions: [],
    presentations: [], honor_awards: [], publications: [], references: [],
    views: [],
  }
}

export function freshStore(): ResumeStore {
  const now = new Date().toISOString()
  return {
    ...emptyStore(),
    resume: {
      id: uuidv4(),
      full_name: '', email: '', phone: null,
      title: {}, nationality: {}, place_of_residence: {},
      date_of_birth: null, twitter: null, linkedin_url: null,
      website_url: null, profile_image_url: null,
      default_locale: 'en', supported_locales: ['en'],
      created_at: now, updated_at: now,
    },
  }
}
