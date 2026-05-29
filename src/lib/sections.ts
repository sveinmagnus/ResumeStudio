import type { ResumeStore } from '../types'

export interface SectionDef {
  key: string
  label: string
  storeKey?: Exclude<keyof ResumeStore, 'resume'>
  icon: string  // lucide icon name
  group: 'profile' | 'experience' | 'credentials' | 'extras' | 'registry' | 'export'
}

export const SECTIONS: SectionDef[] = [
  { key: 'overview', label: 'Overview', icon: 'LayoutDashboard', group: 'profile' },
  { key: 'header', label: 'Personal Details', icon: 'User', group: 'profile' },
  { key: 'key_qualifications', label: 'Profile & Summary', storeKey: 'key_qualifications', icon: 'FileText', group: 'profile' },

  { key: 'projects', label: 'Projects', storeKey: 'projects', icon: 'Briefcase', group: 'experience' },
  { key: 'work_experiences', label: 'Employment', storeKey: 'work_experiences', icon: 'Building2', group: 'experience' },
  { key: 'positions', label: 'Positions & Volunteering', storeKey: 'positions', icon: 'Users', group: 'experience' },

  { key: 'educations', label: 'Education', storeKey: 'educations', icon: 'GraduationCap', group: 'credentials' },
  { key: 'courses', label: 'Courses', storeKey: 'courses', icon: 'BookOpen', group: 'credentials' },
  { key: 'certifications', label: 'Certifications', storeKey: 'certifications', icon: 'Award', group: 'credentials' },

  { key: 'technology_categories', label: 'Skills Showcase', storeKey: 'technology_categories', icon: 'Layers', group: 'extras' },
  { key: 'spoken_languages', label: 'Languages', storeKey: 'spoken_languages', icon: 'Languages', group: 'extras' },
  { key: 'presentations', label: 'Presentations', storeKey: 'presentations', icon: 'Presentation', group: 'extras' },
  { key: 'publications', label: 'Publications', storeKey: 'publications', icon: 'Newspaper', group: 'extras' },
  { key: 'honor_awards', label: 'Awards', storeKey: 'honor_awards', icon: 'Trophy', group: 'extras' },
  { key: 'references', label: 'References', storeKey: 'references', icon: 'Contact', group: 'extras' },

  { key: 'skills', label: 'Skill Registry', storeKey: 'skills', icon: 'Tags', group: 'registry' },
  { key: 'roles', label: 'Role Registry', storeKey: 'roles', icon: 'SquareUser', group: 'registry' },

  { key: 'views', label: 'Resume Views', storeKey: 'views', icon: 'LayoutList', group: 'export' },
]

export const GROUP_LABELS: Record<string, string> = {
  profile: 'Profile',
  experience: 'Experience',
  credentials: 'Education & Credentials',
  extras: 'Additional',
  registry: 'Reusable Registries',
  export: 'Export',
}
