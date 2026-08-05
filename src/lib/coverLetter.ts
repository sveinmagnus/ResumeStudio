/**
 * Cover-letter helpers: the AI draft prompt, a shared parts resolver, and the
 * plain-text export. The PDF and DOCX letter exports live in the already-lazy
 * `pdfExporter.ts` / `exporter.ts` chunks (they ride the pdfmake / docx bundles
 * that are only fetched on an export click) and consume `resolveLetterParts`
 * from here, so all four output paths agree on what a letter contains.
 *
 * A cover letter is its own entity that REFERENCES a Resume View (the CV it
 * accompanies). Its letterhead is the resume's own identity + contact, and when
 * a view is referenced its fonts are reused so letter and CV read as one
 * submission. See `types/index.ts → CoverLetter`.
 */

import type { CoverLetter, ResumeStore, ResumeView } from '../types'
import { resolve, bcp47 } from './locales'
import { buildTailorCatalog } from './viewTailor'
import { applyView } from './viewFilter'
import { plainParagraphs } from './richText'

/**
 * Everything an export needs, resolved to one locale and plain strings. Kept in
 * one place so the text / PDF / DOCX builders can't drift on what a letter is.
 * Empty fields are '' (never undefined) so a builder can test truthiness.
 */
export interface LetterParts {
  senderName: string
  /** Email / phone / site lines, in reading order. */
  senderContact: string[]
  /** The place/date line. */
  dateline: string
  /** Addressee block lines: recipient, then company. */
  recipient: string[]
  /** "Application for <role>", localized. */
  subject: string
  greeting: string
  /** Body split on blank lines. */
  paragraphs: string[]
  closing: string
  /** The view whose fonts the letter should borrow, or null for the resume default. */
  view: ResumeView | null
}

/** Localized "Application for <role>" subject-line label. Falls back to English. */
const SUBJECT_PREFIX: Record<string, string> = {
  en: 'Application for', no: 'Søknad på stillingen', se: 'Ansökan om', dk: 'Ansøgning til',
  de: 'Bewerbung um', fr: 'Candidature au poste de', es: 'Solicitud para', it: 'Candidatura per',
  nl: 'Sollicitatie naar', pt: 'Candidatura para', pl: 'Podanie o stanowisko',
  fi: 'Hakemus tehtävään', is: 'Umsókn um', ru: 'Заявление на должность', uk: 'Заява на посаду',
}

function subjectLine(role: string, locale: string): string {
  if (!role) return ''
  const prefix = SUBJECT_PREFIX[locale] || SUBJECT_PREFIX.en
  return `${prefix} ${role}`
}

/**
 * Split plain body text into trimmed paragraphs. EVERY newline is a break —
 * the same rule `plainParagraphs` applies to every other plain-text field, so
 * a letter written with single newlines doesn't quietly come out as one slab
 * while the same text in a CV description comes out as paragraphs.
 */
export function bodyParagraphs(body: string): string[] {
  return plainParagraphs(body)
}

/** Today as a localized "Place, 5 March 2026"-style dateline (date part only when no place). */
export function defaultDateline(locale: string, now: Date = new Date()): string {
  try {
    return now.toLocaleDateString(bcp47(locale), { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/**
 * Resolve a letter to its export-ready parts in `locale`. `view` is looked up
 * from `letter.view_id` for font reuse; a missing/dangling ref just means the
 * resume-default letterhead.
 */
export function resolveLetterParts(
  store: ResumeStore,
  letter: CoverLetter,
  locale: string,
  now: Date = new Date(),
): LetterParts {
  const r = store.resume
  const view = (letter.view_id ? store.views.find((v) => v.id === letter.view_id) : null) ?? null

  const senderContact = [r?.email, r?.phone, r?.website_url]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)

  const recipient = [resolve(letter.recipient, locale), resolve(letter.company, locale)]
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    senderName: (r?.full_name ?? '').trim(),
    senderContact,
    dateline: (letter.place_dated ?? '').trim() || defaultDateline(locale, now),
    recipient,
    subject: subjectLine(resolve(letter.role_applied, locale).trim(), locale),
    greeting: resolve(letter.greeting, locale).trim(),
    paragraphs: bodyParagraphs(resolve(letter.body, locale)),
    closing: resolve(letter.closing, locale).trim(),
    view,
  }
}

/** ATS-friendly plain-text rendering of a letter — dependency-free. */
export function buildCoverLetterText(store: ResumeStore, letter: CoverLetter, locale: string): string {
  const p = resolveLetterParts(store, letter, locale)
  const blocks: string[] = []

  const head = [p.senderName, ...p.senderContact].filter(Boolean)
  if (head.length) blocks.push(head.join('\n'))
  if (p.dateline) blocks.push(p.dateline)
  if (p.recipient.length) blocks.push(p.recipient.join('\n'))
  if (p.subject) blocks.push(p.subject)
  if (p.greeting) blocks.push(p.greeting)
  for (const para of p.paragraphs) blocks.push(para)
  if (p.closing) blocks.push(`${p.closing}\n${p.senderName}`.trim())

  return blocks.join('\n\n') + '\n'
}

// ─── AI draft prompt ──────────────────────────────────────────────────────────

/**
 * The prompt behind the "Draft the letter" AssistRun. Unlike view tailoring
 * (which returns structured JSON), a cover letter is prose — the model's reply
 * IS the body, used verbatim (the caller drops it into `body`). Grounds the
 * model in the posting + the CV content it should draw on: when the letter
 * references a view, the view's FILTERED catalog (so the letter pitches the same
 * story the tailored CV tells); otherwise the whole master CV.
 */
export function buildCoverLetterPrompt(
  store: ResumeStore,
  letter: CoverLetter,
  locale: string,
): string {
  const r = store.resume
  const view = letter.view_id ? store.views.find((v) => v.id === letter.view_id) ?? null : null
  const source = view ? applyView(store, view) : store
  const catalog = buildTailorCatalog(source, locale)

  const company = resolve(letter.company, locale).trim()
  const role = resolve(letter.role_applied, locale).trim()
  const name = (r?.full_name ?? '').trim()
  const title = resolve(r?.title ?? {}, locale).trim()

  const evidence = catalog.sections
    .map((s) => `${s.label}: ${s.items.map((it) => it.title).join('; ')}`)
    .join('\n')
  const skills = catalog.skills.slice(0, 40).join(', ')

  return `You are drafting a cover letter for a consultant applying for a role.
Write it in the language with code "${locale}". Return ONLY the letter body —
the paragraphs a reader would see between the greeting and the sign-off. No
greeting line, no "Dear …", no closing, no signature, no subject line, no
markdown, no preamble. Three to four tight paragraphs.

Ground every claim in the evidence below — do NOT invent employers, clients,
numbers or credentials. If the posting asks for something the evidence doesn't
show, simply don't claim it.

APPLICANT: ${name}${title ? ` (${title})` : ''}
APPLYING TO: ${company || '(unnamed company)'}${role ? ` — ${role}` : ''}

JOB POSTING:
---
${(letter.posting ?? '').trim() || '(no posting text provided — write from the evidence and the role above)'}
---

CV EVIDENCE (titles the applicant can speak to):
${evidence || '(no CV content yet)'}

KEY SKILLS: ${skills || '(none listed)'}

Write the body now, in ${locale}.`
}
