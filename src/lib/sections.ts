import type { SectionKey, LocalizedString } from '../types'

export interface SectionDef {
  key: string
  label: string
  storeKey?: SectionKey
  icon: string  // lucide icon name
  group: 'profile' | 'experience' | 'credentials' | 'extras' | 'registry' | 'export'
  /**
   * Hide from the sidebar nav but keep in SECTIONS so other consumers
   * (view export, completeness coverage, importer) still see it. Used by the
   * synthetic/virtual sections (promoted_projects, technology_categories,
   * skill_matrix) that are export-only, not editable pages.
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
  // Profile and Key competencies are two separate sidebar sections (each owns
  // its own store array, its own editor page, and its own per-view config).
  // The sidebar label for the profile section is "Profile"; its EXPORT heading
  // stays "Professional summary" (SECTION_HEADINGS) so client-facing documents
  // are unchanged — the two intentionally differ here.
  { key: 'key_qualifications', label: 'Profiles', storeKey: 'key_qualifications', icon: 'FileText', group: 'profile' },
  { key: 'key_competencies', label: 'Key competencies', storeKey: 'key_competencies', icon: 'ListChecks', group: 'profile' },

  { key: 'projects', label: 'Projects', storeKey: 'projects', icon: 'Briefcase', group: 'experience' },
  // View-only: renders the starred subset of `projects` as a "Promoted Projects" section.
  { key: 'promoted_projects', label: 'Promoted Projects', storeKey: 'projects', icon: 'Star', group: 'experience', hidden: true, virtual: true },
  { key: 'work_experiences', label: 'Employment', storeKey: 'work_experiences', icon: 'Building2', group: 'experience' },
  { key: 'positions', label: 'Other roles', storeKey: 'positions', icon: 'Users', group: 'experience' },

  { key: 'educations', label: 'Education', storeKey: 'educations', icon: 'GraduationCap', group: 'credentials' },
  { key: 'courses', label: 'Courses', storeKey: 'courses', icon: 'BookOpen', group: 'credentials' },
  { key: 'certifications', label: 'Certifications', storeKey: 'certifications', icon: 'Award', group: 'credentials' },

  // View-only: renders every highlighted skill grouped by its linked skill
  // category (a projection of the Skill Registry — see lib/showcase.ts).
  { key: 'technology_categories', label: 'Skills Showcase', storeKey: 'skills', icon: 'Layers', group: 'extras', hidden: true, virtual: true },
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
  { key: 'industries', label: 'Industry Registry', storeKey: 'industries', icon: 'Building2', group: 'registry' },

  { key: 'views', label: 'Resume Views', storeKey: 'views', icon: 'LayoutList', group: 'export' },
  { key: 'cover_letters', label: 'Cover Letters', storeKey: 'cover_letters', icon: 'Mail', group: 'export' },
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

/**
 * A couple of section keys are *aliases* of a visible page. The only remaining
 * one is the legacy combined 'profile_competencies' key (the profile + key
 * competencies sections used to share one page); old deep links and snapshots
 * still target it, so chrome and the sidebar's active highlight normalise it to
 * the Profile section through this.
 */
/**
 * The canonical display title for a section key — the SINGLE source used by the
 * sidebar, the view-config section list, and the export headings, so a rename
 * happens in one place and can't drift between them. Falls back to the key.
 */
export function sectionLabel(key: string): string {
  return SECTIONS.find((s) => s.key === key)?.label ?? key
}

/**
 * Localized DEFAULT export heading per section, so a Norwegian resume gets
 * Norwegian section headings without the user hand-typing each one. `en` matches
 * the English `SECTIONS.label` so English output is unchanged. A view's custom
 * per-section `heading_text` still overrides these.
 *
 * Every LOCALE_LABELS code is translated here — tests pin that, so adding a
 * locale fails the suite until its headings land. Headings use each language's
 * CV convention rather than a literal translation of the English: `de` says
 * "Profil" where English says "Professional summary" because that is what a
 * German CV calls that block. `recommendations` (written endorsements) and
 * `references` (contactable referees) are distinct sections and must stay
 * distinct in every language.
 */
export const SECTION_HEADINGS: Record<string, LocalizedString> = {
  key_qualifications: {
    en: 'Professional summary', no: 'Sammendrag', se: 'Sammanfattning', dk: 'Resumé',
    de: 'Profil', fr: 'Profil professionnel', es: 'Perfil profesional', it: 'Profilo professionale',
    nl: 'Professioneel profiel', pt: 'Perfil profissional', pl: 'Podsumowanie zawodowe',
    fi: 'Ammatillinen profiili', is: 'Samantekt', ru: 'Профиль', uk: 'Профіль',
  },
  key_competencies: {
    en: 'Key competencies', no: 'Nøkkelkompetanse', se: 'Nyckelkompetenser', dk: 'Nøglekompetencer',
    de: 'Kernkompetenzen', fr: 'Compétences clés', es: 'Competencias clave', it: 'Competenze chiave',
    nl: 'Kerncompetenties', pt: 'Competências principais', pl: 'Kluczowe kompetencje',
    fi: 'Ydinosaaminen', is: 'Lykilhæfni', ru: 'Ключевые компетенции', uk: 'Ключові компетенції',
  },
  projects: {
    en: 'Projects', no: 'Prosjekter', se: 'Projekt', dk: 'Projekter',
    de: 'Projekte', fr: 'Projets', es: 'Proyectos', it: 'Progetti',
    nl: 'Projecten', pt: 'Projetos', pl: 'Projekty',
    fi: 'Projektit', is: 'Verkefni', ru: 'Проекты', uk: 'Проєкти',
  },
  promoted_projects: {
    en: 'Promoted Projects', no: 'Utvalgte prosjekter', se: 'Utvalda projekt', dk: 'Udvalgte projekter',
    de: 'Ausgewählte Projekte', fr: 'Projets sélectionnés', es: 'Proyectos destacados', it: 'Progetti in evidenza',
    nl: 'Uitgelichte projecten', pt: 'Projetos em destaque', pl: 'Wybrane projekty',
    fi: 'Valitut projektit', is: 'Valin verkefni', ru: 'Избранные проекты', uk: 'Вибрані проєкти',
  },
  work_experiences: {
    en: 'Employment', no: 'Arbeidserfaring', se: 'Arbetslivserfarenhet', dk: 'Erhvervserfaring',
    de: 'Berufserfahrung', fr: 'Expérience professionnelle', es: 'Experiencia laboral', it: 'Esperienza professionale',
    nl: 'Werkervaring', pt: 'Experiência profissional', pl: 'Doświadczenie zawodowe',
    fi: 'Työkokemus', is: 'Starfsreynsla', ru: 'Опыт работы', uk: 'Досвід роботи',
  },
  positions: {
    en: 'Other roles', no: 'Andre verv', se: 'Andra uppdrag', dk: 'Andre hverv',
    de: 'Weitere Funktionen', fr: 'Autres fonctions', es: 'Otros cargos', it: 'Altri incarichi',
    nl: 'Overige functies', pt: 'Outros cargos', pl: 'Inne funkcje',
    fi: 'Muut luottamustoimet', is: 'Önnur hlutverk', ru: 'Другие роли', uk: 'Інші ролі',
  },
  educations: {
    en: 'Education', no: 'Utdanning', se: 'Utbildning', dk: 'Uddannelse',
    de: 'Ausbildung', fr: 'Formation', es: 'Formación', it: 'Formazione',
    nl: 'Opleiding', pt: 'Formação', pl: 'Wykształcenie',
    fi: 'Koulutus', is: 'Menntun', ru: 'Образование', uk: 'Освіта',
  },
  courses: {
    en: 'Courses', no: 'Kurs', se: 'Kurser', dk: 'Kurser',
    de: 'Kurse', fr: 'Cours', es: 'Cursos', it: 'Corsi',
    nl: 'Cursussen', pt: 'Cursos', pl: 'Kursy',
    fi: 'Kurssit', is: 'Námskeið', ru: 'Курсы', uk: 'Курси',
  },
  certifications: {
    en: 'Certifications', no: 'Sertifiseringer', se: 'Certifieringar', dk: 'Certificeringer',
    de: 'Zertifizierungen', fr: 'Certifications', es: 'Certificaciones', it: 'Certificazioni',
    nl: 'Certificeringen', pt: 'Certificações', pl: 'Certyfikaty',
    fi: 'Sertifioinnit', is: 'Vottanir', ru: 'Сертификаты', uk: 'Сертифікати',
  },
  technology_categories: {
    en: 'Skills Showcase', no: 'Ferdigheter', se: 'Färdigheter', dk: 'Kompetencer',
    de: 'Fähigkeiten', fr: 'Compétences', es: 'Habilidades', it: 'Competenze',
    nl: 'Vaardigheden', pt: 'Competências', pl: 'Umiejętności',
    fi: 'Osaaminen', is: 'Hæfni', ru: 'Навыки', uk: 'Навички',
  },
  spoken_languages: {
    en: 'Languages', no: 'Språk', se: 'Språk', dk: 'Sprog',
    de: 'Sprachen', fr: 'Langues', es: 'Idiomas', it: 'Lingue',
    nl: 'Talen', pt: 'Idiomas', pl: 'Języki',
    fi: 'Kielitaito', is: 'Tungumál', ru: 'Языки', uk: 'Мови',
  },
  presentations: {
    en: 'Presentations', no: 'Presentasjoner', se: 'Presentationer', dk: 'Præsentationer',
    de: 'Vorträge', fr: 'Présentations', es: 'Presentaciones', it: 'Presentazioni',
    nl: 'Presentaties', pt: 'Apresentações', pl: 'Prezentacje',
    fi: 'Esitykset', is: 'Erindi', ru: 'Доклады', uk: 'Доповіді',
  },
  publications: {
    en: 'Publications', no: 'Publikasjoner', se: 'Publikationer', dk: 'Publikationer',
    de: 'Publikationen', fr: 'Publications', es: 'Publicaciones', it: 'Pubblicazioni',
    nl: 'Publicaties', pt: 'Publicações', pl: 'Publikacje',
    fi: 'Julkaisut', is: 'Útgefið efni', ru: 'Публикации', uk: 'Публікації',
  },
  honor_awards: {
    en: 'Awards', no: 'Utmerkelser', se: 'Utmärkelser', dk: 'Priser',
    de: 'Auszeichnungen', fr: 'Distinctions', es: 'Premios', it: 'Riconoscimenti',
    nl: 'Onderscheidingen', pt: 'Prémios', pl: 'Wyróżnienia',
    fi: 'Palkinnot', is: 'Viðurkenningar', ru: 'Награды', uk: 'Нагороди',
  },
  recommendations: {
    en: 'Recommendations', no: 'Anbefalinger', se: 'Rekommendationer', dk: 'Anbefalinger',
    de: 'Empfehlungen', fr: 'Recommandations', es: 'Recomendaciones', it: 'Raccomandazioni',
    nl: 'Aanbevelingen', pt: 'Recomendações', pl: 'Rekomendacje',
    fi: 'Suositukset', is: 'Meðmæli', ru: 'Рекомендации', uk: 'Рекомендації',
  },
  references: {
    en: 'References', no: 'Referanser', se: 'Referenser', dk: 'Referencer',
    de: 'Referenzen', fr: 'Références', es: 'Referencias', it: 'Referenze',
    nl: 'Referenties', pt: 'Referências', pl: 'Referencje',
    fi: 'Suosittelijat', is: 'Umsagnaraðilar', ru: 'Рекомендатели', uk: 'Рекомендодавці',
  },
  skill_matrix: {
    en: 'Skill Matrix', no: 'Kompetansematrise', se: 'Kompetensmatris', dk: 'Kompetencematrix',
    de: 'Kompetenzmatrix', fr: 'Matrice de compétences', es: 'Matriz de competencias', it: 'Matrice delle competenze',
    nl: 'Competentiematrix', pt: 'Matriz de competências', pl: 'Macierz kompetencji',
    fi: 'Osaamismatriisi', is: 'Hæfnitafla', ru: 'Матрица навыков', uk: 'Матриця навичок',
  },
  // `industries` renders as an export section too (only views/skills/roles are
  // excluded). `en` matches the label so English exports are unchanged; every
  // other language names the concept ("Industries") rather than the registry.
  industries: {
    en: 'Industry Registry', no: 'Bransjer', se: 'Branscher', dk: 'Brancher',
    de: 'Branchen', fr: 'Secteurs', es: 'Sectores', it: 'Settori',
    nl: 'Branches', pt: 'Setores', pl: 'Branże',
    fi: 'Toimialat', is: 'Atvinnugreinar', ru: 'Отрасли', uk: 'Галузі',
  },
}

/**
 * The default export heading for a section in a given locale: the localized
 * heading if we have one (falling back to English), else the section label.
 */
export function localizedSectionHeading(key: string, locale: string): string {
  const t = SECTION_HEADINGS[key]
  if (t) return t[locale]?.trim() || t.en || sectionLabel(key)
  return sectionLabel(key)
}

export function canonicalSectionKey(key: string): string {
  // Back-compat: the profile + competencies sections used to share a combined
  // 'profile_competencies' page. That key no longer exists as a section, so old
  // deep links / snapshots that reference it land on the Profile section.
  if (key === 'profile_competencies') return 'key_qualifications'
  // The Skills Showcase is now edited on the Skill Registry page (a category +
  // highlight is all it takes to appear there) — old deep links and the
  // Overview stat pill land there.
  if (key === 'technology_categories') return 'skills'
  return key
}
