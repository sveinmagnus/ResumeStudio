import type {
  ResumeStore, ResumeView, Project, WorkExperience, Education,
  Course, Certification, Skill, Role, KeyQualification, SpokenLanguage,
  TechnologyCategory, Position, Presentation, Publication, HonorAward,
  Reference, Resume,
} from '../src/types'

export function emptyStore(): ResumeStore {
  return {
    resume: makeResume(),
    skills: [], roles: [], key_qualifications: [], projects: [],
    work_experiences: [], educations: [], courses: [], certifications: [],
    spoken_languages: [], technology_categories: [], positions: [],
    presentations: [], honor_awards: [], publications: [], references: [],
    views: [],
  }
}

let _seq = 0
const id = () => `id-${++_seq}`

export function makeResume(over: Partial<Resume> = {}): Resume {
  return {
    id: 'resume-1',
    full_name: 'Test Person',
    email: 'test@example.com',
    phone: null,
    title: { en: 'Consultant', no: 'Konsulent' },
    nationality: {},
    place_of_residence: {},
    date_of_birth: null,
    twitter: null,
    linkedin_url: null,
    website_url: null,
    profile_image_url: null,
    default_locale: 'en',
    supported_locales: ['en', 'no'],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...over,
  }
}

export function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: id(),
    resume_id: 'resume-1',
    work_experience_id: null,
    customer: { en: 'Acme', no: 'Acme' },
    customer_anonymized: {},
    use_anonymized: false,
    industry: { en: 'Finance' },
    description: { en: 'Short desc' },
    long_description: { en: 'Long desc' },
    highlights: [],
    roles: [],
    skills: [],
    start: { year: 2022, month: 1 },
    end: { year: 2023, month: 6 },
    percent_allocated: null,
    team_size: null,
    location_country_code: null,
    external_url: null,
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    internal_notes: null,
    ...over,
  }
}

export function makeWork(over: Partial<WorkExperience> = {}): WorkExperience {
  return {
    id: id(),
    resume_id: 'resume-1',
    employer: { en: 'BigCo' },
    role_title: { en: 'Engineer' },
    description: {},
    long_description: {},
    employment_type: null,
    company_size: null,
    company_url: null,
    start: { year: 2020, month: 1 },
    end: null,
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    internal_notes: null,
    ...over,
  }
}

export function makeEducation(over: Partial<Education> = {}): Education {
  return {
    id: id(),
    resume_id: 'resume-1',
    school: { en: 'University' },
    degree: { en: 'BSc' },
    description: {},
    grade: null,
    exchange: false,
    start: { year: 2015, month: 8 },
    end: { year: 2018, month: 5 },
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    ...over,
  }
}

export function makeCourse(over: Partial<Course> = {}): Course {
  return {
    id: id(),
    resume_id: 'resume-1',
    name: { en: 'A Course' },
    program: {},
    description: {},
    completed: null,
    skill_ids: [],
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    ...over,
  }
}

export function makeCertification(over: Partial<Certification> = {}): Certification {
  return {
    id: id(),
    resume_id: 'resume-1',
    name: { en: 'A Cert' },
    organiser: {},
    description: {},
    issued: null,
    expires: null,
    credential_url: null,
    skill_ids: [],
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    ...over,
  }
}

export function makeSkill(over: Partial<Skill> = {}): Skill {
  return {
    id: id(),
    resume_id: 'resume-1',
    name: { en: 'TypeScript' },
    default_category: null,
    skill_type: 'technical',
    total_duration_in_years: 0,
    proficiency: 0,
    is_highlighted: false,
    created_at: '2024-01-01T00:00:00Z',
    ...over,
  }
}

export function makeRole(over: Partial<Role> = {}): Role {
  return {
    id: id(),
    resume_id: 'resume-1',
    name: { en: 'Developer' },
    years_of_experience: 0,
    years_of_experience_offset: 0,
    starred: false,
    sort_order: 0,
    disabled: false,
    ...over,
  }
}

export function makeKQ(over: Partial<KeyQualification> = {}): KeyQualification {
  return {
    id: id(),
    resume_id: 'resume-1',
    label: { en: 'Profile' },
    tag_line: {},
    summary: { en: 'Summary here' },
    key_points: [],
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    internal_notes: null,
    ...over,
  }
}

export function makeSpokenLanguage(over: Partial<SpokenLanguage> = {}): SpokenLanguage {
  return {
    id: id(),
    resume_id: 'resume-1',
    name: { en: 'English' },
    level: { en: 'Native' },
    sort_order: 0,
    disabled: false,
    ...over,
  }
}

export function makeTechCategory(over: Partial<TechnologyCategory> = {}): TechnologyCategory {
  return {
    id: id(),
    resume_id: 'resume-1',
    name: { en: 'Languages' },
    skills: [],
    sort_order: 0,
    disabled: false,
    ...over,
  }
}

export function makePosition(over: Partial<Position> = {}): Position {
  return {
    id: id(),
    resume_id: 'resume-1',
    name: { en: 'Board Member' },
    organisation: { en: 'Org' },
    description: {},
    start: null,
    end: null,
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    ...over,
  }
}

export function makePresentation(over: Partial<Presentation> = {}): Presentation {
  return {
    id: id(),
    resume_id: 'resume-1',
    title: { en: 'A Talk' },
    event: { en: 'Conf' },
    description: {},
    url: null,
    date: null,
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    ...over,
  }
}

export function makePublication(over: Partial<Publication> = {}): Publication {
  return {
    id: id(),
    resume_id: 'resume-1',
    title: { en: 'A Paper' },
    publisher: { en: 'ACM' },
    co_authors: [],
    abstract: {},
    url: null,
    date: null,
    publication_type: 'article',
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    internal_notes: null,
    ...over,
  }
}

export function makeAward(over: Partial<HonorAward> = {}): HonorAward {
  return {
    id: id(),
    resume_id: 'resume-1',
    name: { en: 'Hackathon Win' },
    issuer: { en: 'TechCo' },
    for_work: {},
    description: {},
    date: null,
    skill_tags: [],
    sort_order: 0,
    disabled: false,
    ...over,
  }
}

export function makeReference(over: Partial<Reference> = {}): Reference {
  return {
    id: id(),
    resume_id: 'resume-1',
    name: 'Jane Doe',
    title: 'Engineering Manager',
    company: 'BigCo',
    relationship: { en: 'Former manager' },
    email: null,
    phone: null,
    linkedin_url: null,
    project_id: null,
    work_experience_id: null,
    include_in_exports: false,
    internal_notes: null,
    ...over,
  }
}

export function makeView(over: Partial<ResumeView> = {}): ResumeView {
  return {
    id: id(),
    name: 'Default View',
    introduction: {},
    sections: [],
    excluded_item_ids: [],
    include_photo: false,
    starred_only: false,
    page_limit: null,
    template_id: null,
    last_exported_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...over,
  }
}
