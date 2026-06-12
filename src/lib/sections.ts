import type { SectionKey } from '../types'

export interface SectionDef {
  key: string
  label: string
  storeKey?: SectionKey
  icon: string  // lucide icon name
  group: 'profile' | 'experience' | 'credentials' | 'extras' | 'registry' | 'export'
  /**
   * Hide from the sidebar nav but keep in SECTIONS so other consumers
   * (view export, completeness coverage, importer) still see it.
   * Used by `key_qualifications` which now lives inside the Personal
   * Details Profile sub-tab.
   */
  hidden?: boolean
  /**
   * A view-only synthetic section that does NOT own its own store array — it
   * derives its items from another section's `storeKey` (e.g. promoted_projects
   * renders the starred subset of `projects`). Skipped by applyView and
   * completeness; the renderers special-case it.
   */
  virtual?: boolean
}

export const SECTIONS: SectionDef[] = [
  { key: 'overview', label: 'Overview', icon: 'LayoutDashboard', group: 'profile' },
  { key: 'header', label: 'Personal Details', icon: 'User', group: 'profile' },
  // Kept here (hidden) so views/exports/coverage still discover it.
  { key: 'key_qualifications', label: 'Profile & Summary', storeKey: 'key_qualifications', icon: 'FileText', group: 'profile', hidden: true },
  // Edited under the Personal Details → Key Competencies tab; hidden from the sidebar.
  { key: 'key_competencies', label: 'Key Competencies', storeKey: 'key_competencies', icon: 'ListChecks', group: 'profile', hidden: true },

  { key: 'projects', label: 'Projects', storeKey: 'projects', icon: 'Briefcase', group: 'experience' },
  // View-only: renders the starred subset of `projects` as a "Promoted Projects" section.
  { key: 'promoted_projects', label: 'Promoted Projects', storeKey: 'projects', icon: 'Star', group: 'experience', hidden: true, virtual: true },
  { key: 'work_experiences', label: 'Employment', storeKey: 'work_experiences', icon: 'Building2', group: 'experience' },
  { key: 'positions', label: 'Other roles', storeKey: 'positions', icon: 'Users', group: 'experience' },

  { key: 'educations', label: 'Education', storeKey: 'educations', icon: 'GraduationCap', group: 'credentials' },
  { key: 'courses', label: 'Courses', storeKey: 'courses', icon: 'BookOpen', group: 'credentials' },
  { key: 'certifications', label: 'Certifications', storeKey: 'certifications', icon: 'Award', group: 'credentials' },

  { key: 'technology_categories', label: 'Skills Showcase', storeKey: 'technology_categories', icon: 'Layers', group: 'extras' },
  { key: 'spoken_languages', label: 'Languages', storeKey: 'spoken_languages', icon: 'Languages', group: 'extras' },
  { key: 'presentations', label: 'Presentations', storeKey: 'presentations', icon: 'Presentation', group: 'extras' },
  { key: 'publications', label: 'Publications', storeKey: 'publications', icon: 'Newspaper', group: 'extras' },
  { key: 'honor_awards', label: 'Awards', storeKey: 'honor_awards', icon: 'Trophy', group: 'extras' },
  { key: 'recommendations', label: 'Recommendations', storeKey: 'recommendations', icon: 'Quote', group: 'extras' },
  { key: 'references', label: 'References', storeKey: 'references', icon: 'Contact', group: 'extras' },

  // View-only: renders the skill registry as a competency matrix table (F9).
  { key: 'skill_matrix', label: 'Skill Matrix', storeKey: 'skills', icon: 'Table', group: 'extras', hidden: true, virtual: true },

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

/**
 * Sidebar display order for the groups. Export-first: once a resume exists,
 * extracting a targeted CV (Resume Views) is the most frequent task, so it
 * sits at the top of the nav. Deliberately decoupled from SECTIONS array
 * order — that order feeds the view editor's default section sequence and
 * must stay content-shaped.
 */
export const GROUP_ORDER: Array<SectionDef['group']> = [
  'export', 'profile', 'experience', 'credentials', 'extras', 'registry',
]
