/**
 * View header & footer configuration — defaults and pure builders.
 *
 * The editor stores a ViewHeaderConfig / ViewFooterConfig on each ResumeView.
 * Both render paths (HTML/PDF via viewFilter, DOCX via exporter) consume the
 * output of the builders here so the header layout logic lives in one tested
 * place rather than being duplicated across renderers.
 *
 * Pure module — no React, no DOM.
 */

import type {
  ResumeStore, Resume, LocalizedString,
  ViewHeaderConfig, ViewFooterConfig, HeaderField, HeaderFieldKey,
  HeaderTextStyle, PhotoPlacement, ProfileImageShape, LogoPlacement,
  FooterSeparator, CopyrightHolder, FooterNotePlacement,
} from '../types'
import { resolve } from './locales'

// ─── Boundary validators ──────────────────────────────────────────────────────
// View config can arrive from an untrusted backup / snapshot import, not just
// the editor UI. These values are interpolated into HTML (class names, inline
// `style=` attributes) by the renderers, so out-of-enum / wrong-typed values
// must be coerced here at the boundary — otherwise a crafted import could break
// out of an attribute, and a non-numeric size_pt would inject into a style.

const PHOTO_PLACEMENTS = new Set<PhotoPlacement>(['none', 'left', 'right', 'above', 'below', 'left_of_name', 'right_of_name'])
const PROFILE_IMAGE_SHAPES = new Set<ProfileImageShape>(['square', 'rounded', 'circle'])
const LOGO_PLACEMENTS = new Set<LogoPlacement>(['none', 'left', 'center', 'right'])
const TEXT_FONTS = new Set<HeaderTextStyle['font']>(['condensed', 'sans', 'serif', 'body'])

function safePhotoPlacement(v: unknown): PhotoPlacement {
  return PHOTO_PLACEMENTS.has(v as PhotoPlacement) ? (v as PhotoPlacement) : 'none'
}
export function safeProfileImageShape(v: unknown): ProfileImageShape {
  return PROFILE_IMAGE_SHAPES.has(v as ProfileImageShape) ? (v as ProfileImageShape) : 'square'
}
function safeLogoPlacement(v: unknown): LogoPlacement {
  return LOGO_PLACEMENTS.has(v as LogoPlacement) ? (v as LogoPlacement) : 'none'
}
function safeTextStyle(v: Partial<HeaderTextStyle> | undefined, fallback: HeaderTextStyle): HeaderTextStyle {
  const font = v && TEXT_FONTS.has(v.font as HeaderTextStyle['font']) ? (v.font as HeaderTextStyle['font']) : fallback.font
  const size = v && typeof v.size_pt === 'number' && Number.isFinite(v.size_pt)
    ? Math.min(200, Math.max(4, v.size_pt))
    : null
  return { size_pt: size, font }
}

const FOOTER_SEPARATORS = new Set<FooterSeparator>(['none', 'line', 'double', 'dotted', 'dashed', 'thick'])
const COPYRIGHT_HOLDERS = new Set<CopyrightHolder>(['none', 'person', 'company', 'custom'])

function safeFooterSeparator(v: unknown): FooterSeparator {
  return FOOTER_SEPARATORS.has(v as FooterSeparator) ? (v as FooterSeparator) : 'none'
}
function safeCopyrightHolder(v: unknown): CopyrightHolder {
  return COPYRIGHT_HOLDERS.has(v as CopyrightHolder) ? (v as CopyrightHolder) : 'none'
}
const NOTE_PLACEMENTS = new Set<FooterNotePlacement>(['after', 'before', 'above', 'below'])
/** Untrusted-import surface: anything unrecognised falls back to the original
 *  behaviour (note after the copyright, same line). */
function safeNotePlacement(v: unknown): FooterNotePlacement {
  return NOTE_PLACEMENTS.has(v as FooterNotePlacement) ? (v as FooterNotePlacement) : 'after'
}

// ─── Defaults ───────────────────────────────────────────────────────────────

/**
 * Default descriptor labels per field — one per LOCALE_LABELS code (pinned by
 * tests). These render at the TOP of every export, so an untranslated one is
 * the most visible chrome on the page. Users can still edit them per view, per
 * locale; `headerFieldLabel` explains how an edit interacts with these.
 *
 * The trailing space is part of the value: a label is concatenated straight
 * onto its value ("Phone: " + "+47…"). A blank label renders the value alone.
 */
const DEFAULT_FIELD_LABELS: Record<HeaderFieldKey, LocalizedString> = {
  phone: {
    en: 'Phone: ', no: 'Telefon: ', se: 'Telefon: ', dk: 'Telefon: ',
    de: 'Telefon: ', fr: 'Téléphone : ', es: 'Teléfono: ', it: 'Telefono: ',
    nl: 'Telefoon: ', pt: 'Telefone: ', pl: 'Telefon: ',
    fi: 'Puhelin: ', is: 'Sími: ', ru: 'Телефон: ', uk: 'Телефон: ',
  },
  email: {
    en: 'Email: ', no: 'Epost: ', se: 'E-post: ', dk: 'E-mail: ',
    de: 'E-Mail: ', fr: 'E-mail : ', es: 'Correo: ', it: 'E-mail: ',
    nl: 'E-mail: ', pt: 'E-mail: ', pl: 'E-mail: ',
    fi: 'Sähköposti: ', is: 'Netfang: ', ru: 'Эл. почта: ', uk: 'Ел. пошта: ',
  },
  location: {
    en: 'Location: ', no: 'Lokasjon: ', se: 'Ort: ', dk: 'Lokation: ',
    de: 'Standort: ', fr: 'Lieu : ', es: 'Ubicación: ', it: 'Località: ',
    nl: 'Locatie: ', pt: 'Localização: ', pl: 'Lokalizacja: ',
    fi: 'Sijainti: ', is: 'Staðsetning: ', ru: 'Местоположение: ', uk: 'Місцезнаходження: ',
  },
  nationality: {
    en: 'Nationality: ', no: 'Nasjonalitet: ', se: 'Nationalitet: ', dk: 'Nationalitet: ',
    de: 'Staatsangehörigkeit: ', fr: 'Nationalité : ', es: 'Nacionalidad: ', it: 'Nazionalità: ',
    nl: 'Nationaliteit: ', pt: 'Nacionalidade: ', pl: 'Narodowość: ',
    fi: 'Kansalaisuus: ', is: 'Þjóðerni: ', ru: 'Гражданство: ', uk: 'Громадянство: ',
  },
  // Languages that would inflect this by gender take the neutral noun phrase
  // ("Date of birth") rather than a participle — the resume has no gender field.
  date_of_birth: {
    en: 'Born: ', no: 'Født: ', se: 'Född: ', dk: 'Født: ',
    de: 'Geboren: ', fr: 'Date de naissance : ', es: 'Fecha de nacimiento: ', it: 'Data di nascita: ',
    nl: 'Geboren: ', pt: 'Data de nascimento: ', pl: 'Data urodzenia: ',
    fi: 'Syntynyt: ', is: 'Fæðingardagur: ', ru: 'Дата рождения: ', uk: 'Дата народження: ',
  },
  // Brand names — identical everywhere, but spelled out per locale so the
  // coverage test stays honest rather than special-casing them.
  linkedin: {
    en: 'LinkedIn: ', no: 'LinkedIn: ', se: 'LinkedIn: ', dk: 'LinkedIn: ',
    de: 'LinkedIn: ', fr: 'LinkedIn: ', es: 'LinkedIn: ', it: 'LinkedIn: ',
    nl: 'LinkedIn: ', pt: 'LinkedIn: ', pl: 'LinkedIn: ',
    fi: 'LinkedIn: ', is: 'LinkedIn: ', ru: 'LinkedIn: ', uk: 'LinkedIn: ',
  },
  website: {
    en: 'Web: ', no: 'Web: ', se: 'Webb: ', dk: 'Web: ',
    de: 'Web: ', fr: 'Site web : ', es: 'Web: ', it: 'Sito web: ',
    nl: 'Website: ', pt: 'Site: ', pl: 'Strona: ',
    fi: 'Verkkosivu: ', is: 'Vefur: ', ru: 'Сайт: ', uk: 'Сайт: ',
  },
  twitter: {
    en: 'Twitter: ', no: 'Twitter: ', se: 'Twitter: ', dk: 'Twitter: ',
    de: 'Twitter: ', fr: 'Twitter: ', es: 'Twitter: ', it: 'Twitter: ',
    nl: 'Twitter: ', pt: 'Twitter: ', pl: 'Twitter: ',
    fi: 'Twitter: ', is: 'Twitter: ', ru: 'Twitter: ', uk: 'Twitter: ',
  },
  languages: {
    en: 'Languages: ', no: 'Språk: ', se: 'Språk: ', dk: 'Sprog: ',
    de: 'Sprachen: ', fr: 'Langues : ', es: 'Idiomas: ', it: 'Lingue: ',
    nl: 'Talen: ', pt: 'Idiomas: ', pl: 'Języki: ',
    fi: 'Kielet: ', is: 'Tungumál: ', ru: 'Языки: ', uk: 'Мови: ',
  },
}

/** The default label set for a field key ({} for an unrecognised key). */
export function defaultFieldLabels(key: HeaderFieldKey): LocalizedString {
  return { ...(DEFAULT_FIELD_LABELS[key] ?? {}) }
}

/**
 * The label a header field renders in `locale`, layering the user's stored
 * labels over the defaults.
 *
 * The layering matters for views SAVED BEFORE the defaults covered every
 * locale: their `label` holds only en/no, so resolving it alone would fall back
 * to English on a German export forever — a stale copy of the defaults frozen
 * into every existing view. Merging means a stored label wins for the locales
 * it actually fills, and the rest come from the current defaults.
 *
 * Consequence worth knowing: customising the English label no longer bleeds
 * into other languages (it used to arrive there via English fallback). That is
 * the app's per-locale model — set the label in each language you export.
 *
 * A PRESENT key is an opinion and is returned verbatim, including an empty one
 * — blanking a label ("just print the number") is a real thing users do, and it
 * must not fall through to a default. Only an ABSENT key takes the default.
 * This is why the merge can't simply be `resolve({...defaults, ...label})`:
 * `resolve` treats '' as missing and would answer with some other language's
 * label, which is how a blanked English label used to render as Norwegian.
 */
export function headerFieldLabel(field: HeaderField, locale: string): string {
  const stored: LocalizedString = field.label ?? {}
  if (locale in stored) return stored[locale]
  return resolve({ ...defaultFieldLabels(field.key), ...stored }, locale)
}

/** Field display order + default visibility / line-grouping. */
const DEFAULT_FIELD_SPEC: Array<{ key: HeaderFieldKey; show: boolean; same_line: boolean }> = [
  { key: 'phone',         show: true,  same_line: false },
  { key: 'email',         show: true,  same_line: true  },
  { key: 'location',      show: true,  same_line: false },
  { key: 'languages',     show: true,  same_line: false },
  { key: 'nationality',   show: false, same_line: false },
  { key: 'date_of_birth', show: false, same_line: false },
  { key: 'linkedin',      show: false, same_line: false },
  { key: 'website',       show: false, same_line: true  },
  { key: 'twitter',       show: false, same_line: true  },
]

export function defaultHeaderFields(): HeaderField[] {
  return DEFAULT_FIELD_SPEC.map((spec, i) => ({
    key: spec.key,
    show: spec.show,
    label: defaultFieldLabels(spec.key),
    same_line: spec.same_line,
    sort_order: i,
  }))
}

export const DEFAULT_VIEW_HEADER: ViewHeaderConfig = {
  fields: defaultHeaderFields(),
  separator: ' | ',
  name_style: { size_pt: null, font: 'condensed' },
  title_style: { size_pt: null, font: 'body' },
  photo_placement: 'none',
  photo_override: null,
  photo_shape: 'square',
  logo_placement: 'none',
  logo_override: null,
}

export const DEFAULT_VIEW_FOOTER: ViewFooterConfig = {
  separator: 'none',
  copyright: 'none',
  copyright_custom: {},
  note: {},
  note_placement: 'after',
}

/**
 * Merge a possibly-undefined / partial header with defaults. Older serialized
 * views (backups, snapshots) may lack `header` entirely; this is the boundary
 * that guarantees renderers always see a populated config.
 */
export function withHeaderDefaults(header: Partial<ViewHeaderConfig> | undefined): ViewHeaderConfig {
  if (!header) return { ...DEFAULT_VIEW_HEADER, fields: defaultHeaderFields() }
  return {
    fields: header.fields && header.fields.length ? header.fields : defaultHeaderFields(),
    separator: typeof header.separator === 'string' ? header.separator : DEFAULT_VIEW_HEADER.separator,
    name_style: safeTextStyle(header.name_style, DEFAULT_VIEW_HEADER.name_style),
    title_style: safeTextStyle(header.title_style, DEFAULT_VIEW_HEADER.title_style),
    title_override: header.title_override,
    photo_placement: safePhotoPlacement(header.photo_placement),
    photo_override: header.photo_override ?? null,
    photo_shape: safeProfileImageShape(header.photo_shape),
    logo_placement: safeLogoPlacement(header.logo_placement),
    logo_override: header.logo_override ?? null,
  }
}

export function withFooterDefaults(footer: Partial<ViewFooterConfig> | undefined): ViewFooterConfig {
  if (!footer) return { ...DEFAULT_VIEW_FOOTER, copyright_custom: {}, note: {} }
  return {
    separator: safeFooterSeparator(footer.separator),
    copyright: safeCopyrightHolder(footer.copyright),
    copyright_custom: footer.copyright_custom ?? {},
    note: footer.note ?? {},
    note_placement: safeNotePlacement(footer.note_placement),
  }
}

/**
 * The footer's text as ordered LINES, placing the note per
 * `footer.note_placement`. Shared by every render path (HTML / DOCX / PDF) so
 * a note can't sit above the copyright in one export and beside it in another.
 *
 *  - after / before → one line, the two joined with a middot
 *  - above / below  → two lines, in that order
 *
 * Either part being empty collapses to just the other; both empty → `[]`.
 */
export function footerLines(
  footer: ViewFooterConfig, copyright: string, note: string,
): string[] {
  const c = copyright.trim()
  const n = note.trim()
  if (!c) return n ? [n] : []
  if (!n) return [c]
  switch (safeNotePlacement(footer.note_placement)) {
    case 'before': return [`${n}  ·  ${c}`]
    case 'above':  return [n, c]
    case 'below':  return [c, n]
    default:       return [`${c}  ·  ${n}`]
  }
}

// ─── Languages summary ────────────────────────────────────────────────────────

/**
 * Build a one-line summary of spoken languages, e.g.
 * "Norsk (morsmål), Engelsk (flytende), Tysk (grunnleggende)".
 * Disabled languages are skipped; items are taken in sort_order.
 */
export function buildLanguageSummary(store: ResumeStore, locale: string): string {
  const langs = [...store.spoken_languages]
    .filter((l) => !l.disabled)
    .sort((a, b) => a.sort_order - b.sort_order)
  return langs
    .map((l) => {
      const name = resolve(l.name, locale)
      const level = resolve(l.level, locale)
      if (!name) return ''
      return level ? `${name} (${level})` : name
    })
    .filter(Boolean)
    .join(', ')
}

// ─── Header line builder ────────────────────────────────────────────────────

/** Resolve the raw value for a single header field key. */
export function resolveHeaderFieldValue(
  key: HeaderFieldKey,
  resume: Resume,
  store: ResumeStore,
  locale: string,
): string {
  switch (key) {
    case 'phone':         return resume.phone ?? ''
    case 'email':         return resume.email ?? ''
    case 'location':      return resolve(resume.place_of_residence, locale)
    case 'nationality':   return resolve(resume.nationality, locale)
    case 'date_of_birth': return resume.date_of_birth ?? ''
    case 'linkedin':      return resume.linkedin_url ?? ''
    case 'website':       return resume.website_url ?? ''
    case 'twitter':       return resume.twitter ?? ''
    case 'languages':     return buildLanguageSummary(store, locale)
    default:              return ''
  }
}

export interface HeaderSegment {
  /** Resolved descriptor prefix (may be empty). */
  label: string
  /** Resolved field value (guaranteed non-empty — empty fields are dropped). */
  value: string
}

/** A header line is a list of segments rendered on one line, joined by the separator. */
export type HeaderLine = HeaderSegment[]

/**
 * Produce the ordered list of header lines for a view. Fields that are hidden
 * or resolve to an empty value are dropped. A field with `same_line: true`
 * appends to the previous line; otherwise it starts a new line. The first
 * surviving field always starts a new line.
 */
export function buildHeaderLines(
  header: ViewHeaderConfig,
  resume: Resume,
  store: ResumeStore,
  locale: string,
): HeaderLine[] {
  const ordered = [...header.fields].sort((a, b) => a.sort_order - b.sort_order)
  const lines: HeaderLine[] = []
  for (const field of ordered) {
    if (!field.show) continue
    const value = resolveHeaderFieldValue(field.key, resume, store, locale)
    if (!value) continue
    const segment: HeaderSegment = { label: headerFieldLabel(field, locale), value }
    if (field.same_line && lines.length > 0) {
      lines[lines.length - 1].push(segment)
    } else {
      lines.push([segment])
    }
  }
  return lines
}

// ─── Footer ─────────────────────────────────────────────────────────────────

/**
 * Build the footer copyright line text (without the leading separator). The
 * holder is the resume's name, the company name, or a per-view custom string.
 * Returns '' when copyright is disabled or the resolved holder name is empty.
 */
export function buildCopyrightLine(
  footer: ViewFooterConfig,
  resume: Resume,
  year: number,
  locale: string,
): string {
  let name: string
  switch (footer.copyright) {
    case 'person':  name = resume.full_name ?? ''; break
    case 'company': name = resume.company_name ?? ''; break
    case 'custom':  name = resolve(footer.copyright_custom, locale); break
    default:        return ''
  }
  if (!name.trim()) return ''
  return `© ${year} ${name.trim()}`
}
