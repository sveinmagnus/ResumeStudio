/**
 * Resume Studio — Europass XML export (the round-trip half of importerEuropass).
 *
 * Emits the classic `SkillsPassport` schema (Europass CV 3.x), which is what EU
 * and Norwegian public tenders ask for when they ask for "a Europass CV", and
 * what `importFromEuropassXml` reads. The two are deliberately a mirror pair:
 * `tests/exporterEuropass.test.ts` round-trips a store out and back in, which is
 * a far stronger check than asserting element names.
 *
 * SECURITY — why this does not build XML by hand. Every other render path here
 * is safe by construction rather than by discipline: DOCX goes through `docx`
 * (which XML-escapes TextRuns), PDF through a pdfmake object tree, and the HTML
 * path pays for its string concatenation with the escape-at-render rules in the
 * security skill. Hand-rolling XML strings would opt this path into that same
 * tax — one un-escaped `${}` and a customer name containing `&` or `</` corrupts
 * the document or injects elements. So the tree is built with DOM APIs and
 * handed to XMLSerializer: text nodes and attributes are escaped by the
 * serializer, structurally, with no rule for a future editor to remember.
 * Keep it that way — do not "simplify" this into a template literal.
 *
 * SCOPE — Europass models identity, work experience, education and language
 * skills, and that is exactly what this exports. It does NOT invent homes for
 * the sections Europass has no concept of (projects, courses, certifications,
 * publications…). Mapping a project onto <WorkExperience> would misrepresent it
 * as employment AND break the round-trip by duplicating entries on re-import.
 * Callers surface this: see the Export menu's Europass note.
 */

import type {
  ResumeStore, ResumeView, SpokenLanguage, WorkExperience, Education,
  LocalizedString, YearMonth, CefrCategory,
} from '../types'
import { resolve } from './locales'
import { richToPlain } from './richText'
import { applyView } from './viewFilter'
import { sortItems } from './sectionSort'

/** Europass proficiency element names, in the schema's own order. */
const CEFR_ELEMENT: Record<CefrCategory, string> = {
  listening: 'Listening',
  reading: 'Reading',
  spoken_interaction: 'SpokenInteraction',
  spoken_production: 'SpokenProduction',
  writing: 'Writing',
}

/**
 * Europass writes months as `--06` (an XML Schema gMonth fragment), which is
 * what `parseEuropassDate` strips back to 6 on the way in.
 */
function gMonth(month: number): string {
  return `--${String(month).padStart(2, '0')}`
}

/** A small DOM builder — `el('Foo', { attr }, 'text' | [children])`. */
function makeBuilder(doc: XMLDocument) {
  function el(
    name: string,
    attrs: Record<string, string> = {},
    content?: string | Element[],
  ): Element {
    const node = doc.createElement(name)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    if (typeof content === 'string') node.textContent = content
    else if (Array.isArray(content)) for (const c of content) node.appendChild(c)
    return node
  }
  return el
}

/** `<Period><From year="2018" month="--06"/><To .../></Period>`, or null. */
function periodEl(
  el: ReturnType<typeof makeBuilder>,
  start: YearMonth | null,
  end: YearMonth | null,
  ongoing: boolean,
): Element | null {
  if (!start && !end && !ongoing) return null
  const kids: Element[] = []
  const dateAttrs = (d: YearMonth) => {
    const a: Record<string, string> = { year: String(d.year) }
    if (d.month != null) a.month = gMonth(d.month)
    return a
  }
  if (start) kids.push(el('From', dateAttrs(start)))
  if (end) kids.push(el('To', dateAttrs(end)))
  // Europass marks an open-ended period with <Current>true</Current> rather
  // than an absent To, and the importer keys `end: null` off exactly that.
  if (ongoing) kids.push(el('Current', {}, 'true'))
  return kids.length ? el('Period', {}, kids) : null
}

function workEl(
  el: ReturnType<typeof makeBuilder>, w: WorkExperience, locale: string,
): Element {
  const kids: Element[] = []
  const period = periodEl(el, w.start, w.end, w.end === null && !!w.start)
  if (period) kids.push(period)

  const title = resolve(w.role_title, locale)
  if (title) kids.push(el('Position', {}, [el('Label', {}, title)]))

  // Europass has one free-text field per entry; prefer the long description and
  // fall back to the short one, flattened (the schema carries no markup).
  const activities = richToPlain(resolve(w.long_description, locale)).trim()
    || richToPlain(resolve(w.description, locale)).trim()
  if (activities) kids.push(el('Activities', {}, activities))

  const employer = resolve(w.employer, locale)
  if (employer || w.company_url) {
    const eKids: Element[] = []
    if (employer) eKids.push(el('Name', {}, employer))
    if (w.company_url) {
      eKids.push(el('ContactInfo', {}, [
        el('Website', {}, [el('Contact', {}, w.company_url)]),
      ]))
    }
    kids.push(el('Employer', {}, eKids))
  }
  return el('WorkExperience', {}, kids)
}

function educationEl(
  el: ReturnType<typeof makeBuilder>, e: Education, locale: string,
): Element {
  const kids: Element[] = []
  const period = periodEl(el, e.start, e.end, false)
  if (period) kids.push(period)

  const degree = resolve(e.degree, locale)
  if (degree) kids.push(el('Title', {}, degree))

  const activities = richToPlain(resolve(e.description, locale)).trim()
  if (activities) kids.push(el('Activities', {}, activities))

  const school = resolve(e.school, locale)
  if (school) kids.push(el('Organisation', {}, [el('Name', {}, school)]))
  return el('Education', {}, kids)
}

/**
 * A language is a mother tongue when it says so in the level field. Europass
 * splits the two into different lists with different shapes, and we have no
 * dedicated flag — so we read the same signal the importer writes ("Native").
 */
function isMotherTongue(l: SpokenLanguage, locale: string): boolean {
  const lvl = resolve(l.level, locale).trim().toLowerCase()
  return lvl === 'native' || lvl === 'morsmål' || lvl === 'mother tongue'
}

function foreignLanguageEl(
  el: ReturnType<typeof makeBuilder>, l: SpokenLanguage, locale: string,
): Element {
  const kids: Element[] = [
    el('Description', {}, [el('Label', {}, resolve(l.name, locale))]),
  ]
  // Prefer the structured CEFR self-assessment; it is the whole point of the
  // Europass language passport. Fall back to the free-text level so a language
  // captured before CEFR existed still says something.
  const cefr = l.cefr ?? {}
  const levels = (Object.entries(CEFR_ELEMENT) as Array<[CefrCategory, string]>)
    .filter(([key]) => cefr[key])
    .map(([key, element]) => el(element, {}, cefr[key]!))
  if (levels.length) {
    kids.push(el('ProficiencyLevel', {}, levels))
  } else {
    const free = resolve(l.level, locale).trim()
    if (free) kids.push(el('ProficiencyLevel', {}, [el('Listening', {}, free)]))
  }
  return el('ForeignLanguage', {}, kids)
}

/**
 * Render a Resume View as a Europass `SkillsPassport` XML document.
 *
 * Consumes the filtered store from `applyView`, like every other export path:
 * a section switched off, an excluded item or a starred-only view means the
 * same thing here as it does in the PDF.
 */
export function exportEuropassXml(
  store: ResumeStore, view: ResumeView, locale: string,
): string {
  const filtered = applyView(store, view)
  const r = filtered.resume
  const doc = document.implementation.createDocument(null, 'SkillsPassport', null)
  const el = makeBuilder(doc)

  /**
   * Order a section's items by the view's own sort setting (absent = the
   * resume's arranged order), matching the other export paths. The cast is the
   * house pattern: `Sortable` carries an index signature that a declared
   * interface doesn't structurally satisfy.
   */
  const sortBy = <T extends { id: string; sort_order: number }>(key: string, items: T[]): T[] =>
    sortItems(key, items as Array<{ id: string; sort_order: number }>, view.sections.find((s) => s.key === key)?.sort ?? 'custom', locale) as T[]
  const root = doc.documentElement
  root.setAttribute('locale', locale)
  root.appendChild(el('Locale', {}, locale))

  const learner = el('LearnerInfo')

  // ── Identification ────────────────────────────────────────────────────────
  if (r) {
    const ident: Element[] = []
    const name = (r.full_name ?? '').trim()
    if (name) {
      // Europass wants the name split. We store one field, so treat the last
      // whitespace-separated word as the surname — right for the overwhelming
      // majority of names, and the importer rejoins them with a space either way.
      const parts = name.split(/\s+/)
      const surname = parts.length > 1 ? parts.pop()! : ''
      ident.push(el('PersonName', {}, [
        el('FirstName', {}, parts.join(' ')),
        ...(surname ? [el('Surname', {}, surname)] : []),
      ]))
    }

    const contact: Element[] = []
    if (r.email) contact.push(el('Email', {}, [el('Contact', {}, r.email)]))
    if (r.phone) contact.push(el('Telephone', {}, [el('Contact', {}, r.phone)]))
    const municipality = resolve(r.place_of_residence, locale)
    if (municipality) {
      contact.push(el('Address', {}, [
        el('Contact', {}, [el('Municipality', {}, municipality)]),
      ]))
    }
    if (r.website_url) contact.push(el('Website', {}, [el('Contact', {}, r.website_url)]))
    if (contact.length) ident.push(el('ContactInfo', {}, contact))

    const nationality = resolve(r.nationality, locale)
    if (nationality) {
      ident.push(el('Demographics', {}, [
        el('Nationality', {}, [el('Label', {}, nationality)]),
      ]))
    }
    if (ident.length) learner.appendChild(el('Identification', {}, ident))

    const title = resolve(r.title, locale)
    if (title) {
      learner.appendChild(el('Headline', {}, [
        el('Description', {}, [el('Label', {}, title)]),
      ]))
    }
  }

  // ── Work experience ───────────────────────────────────────────────────────
  // Honour the view's per-section sort, like the PDF/DOCX/text paths do — a
  // view set to oldest-first should hand Europass the same order.
  const works = sortBy('work_experiences', filtered.work_experiences)
  if (works.length) {
    learner.appendChild(el('WorkExperienceList', {}, works.map((w) => workEl(el, w, locale))))
  }

  // ── Education ─────────────────────────────────────────────────────────────
  const educations = sortBy('educations', filtered.educations)
  if (educations.length) {
    learner.appendChild(el('EducationList', {}, educations.map((e) => educationEl(el, e, locale))))
  }

  // ── Language skills ───────────────────────────────────────────────────────
  const langs = filtered.spoken_languages.filter((l) => !l.disabled && resolve(l.name, locale).trim())
  const mother = langs.filter((l) => isMotherTongue(l, locale))
  const foreign = langs.filter((l) => !isMotherTongue(l, locale))
  if (mother.length || foreign.length) {
    const linguistic: Element[] = []
    if (mother.length) {
      linguistic.push(el('MotherTongueList', {}, mother.map((l) =>
        el('MotherTongue', {}, [
          el('Description', {}, [el('Label', {}, resolve(l.name, locale))]),
        ]),
      )))
    }
    if (foreign.length) {
      linguistic.push(el('ForeignLanguageList', {}, foreign.map((l) => foreignLanguageEl(el, l, locale))))
    }
    learner.appendChild(el('Skills', {}, [el('Linguistic', {}, linguistic)]))
  }

  root.appendChild(learner)
  // The serializer owns escaping — see the security note at the top.
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(doc)}`
}
