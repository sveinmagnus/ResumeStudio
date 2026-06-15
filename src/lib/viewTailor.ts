/**
 * Resume Studio — BYO-LLM view tailoring (roadmap F2)
 *
 * The other end of the pipeline from `aiImport.ts`: instead of importing a CV,
 * tailor a Resume View to a job posting. Same bring-your-own-LLM discipline —
 * no server call, no API key:
 *
 *   1. `buildTailorPrompt(store, posting, locale)` bundles the posting with a
 *      compact catalog of the master CV (section keys, item ids + titles,
 *      starred flags, the skill registry) and the `resumestudio-tailor/v1`
 *      response schema.
 *   2. The user runs the prompt in any LLM and pastes the JSON back.
 *   3. `validateTailorResponse(json)` — structural validation with
 *      field-pathed issues (same discipline as `validateAIImport`).
 *   4. `applyTailorResponse(store, parsed, locale)` builds a ready-to-add
 *      ResumeView, dropping hallucinated item ids / unknown section keys and
 *      reporting them so the preview can show what was ignored.
 *
 * SECURITY: every response value is untrusted. We only ever store plain
 * strings (view name, localized introduction) and enum-checked detail levels;
 * nothing here builds HTML. The render boundary still escapes everything.
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  ResumeStore, ResumeView, SectionDetail, ViewSection,
} from '../types'
import { SECTIONS } from './sections'
import { buildViewSections, isExportableSection, getItemTitle } from './viewFilter'
import { DEFAULT_VIEW_STYLE } from './viewStyle'
import { DEFAULT_VIEW_HEADER, DEFAULT_VIEW_FOOTER, defaultHeaderFields } from './viewHeader'
import { resolve } from './locales'

export const TAILOR_SCHEMA = 'resumestudio-tailor/v1'

// ─── The response shape the LLM must produce ─────────────────────────────────

export interface TailorV1 {
  $schema: string
  /** Suggested name for the view, e.g. "Senior Platform Engineer — Posten". */
  view_name?: string
  /** Drafted introduction paragraph, in the locale the prompt asked for. */
  introduction?: string
  /** Proposed detail per section key: 'off' | 'summary' | 'full'. Omitted keys keep defaults. */
  section_detail?: Record<string, string>
  /** Item ids (from the catalog) to exclude as irrelevant to the posting. */
  exclude_item_ids?: string[]
  /** Requirements in the posting the CV shows no evidence for. */
  gaps?: string[]
}

// ─── Catalog (what the LLM gets to reason over) ──────────────────────────────

interface CatalogItem {
  id: string
  title: string
  starred?: true
}

interface CatalogSection {
  key: string
  label: string
  items: CatalogItem[]
}

/**
 * A compact, id-bearing inventory of the master CV. Titles come from the
 * section catalog (same titles the View editor shows); content bodies are
 * deliberately omitted — titles + skills are enough signal to curate with, and
 * the prompt stays small enough for any model.
 */
export function buildTailorCatalog(store: ResumeStore, locale: string): {
  sections: CatalogSection[]
  skills: string[]
} {
  const sections = SECTIONS
    .filter(isExportableSection)
    // promoted_projects mirrors starred projects — listing it would duplicate ids.
    .filter((s) => !s.virtual)
    .map((s) => {
      const items = (store[s.storeKey!] as unknown as Array<Record<string, unknown>>)
        .filter((it) => !it.disabled)
        .map((it): CatalogItem => ({
          id: String(it.id),
          title: getItemTitle(s.key, it, locale),
          ...(it.starred ? { starred: true as const } : {}),
        }))
      return { key: s.key, label: s.label, items }
    })
    .filter((s) => s.items.length > 0)
  const skills = store.skills.map((sk) => resolve(sk.name, locale)).filter(Boolean)
  return { sections, skills }
}

/** Section keys the response may set detail for (includes the synthetic promoted_projects). */
export function tailorableSectionKeys(): string[] {
  return SECTIONS.filter(isExportableSection).map((s) => s.key)
}

/**
 * The full prompt the user copies into their LLM: posting + catalog + response
 * schema + rules. Returns plain text (markdown-ish) — never rendered as HTML.
 */
export function buildTailorPrompt(store: ResumeStore, posting: string, locale: string): string {
  const catalog = buildTailorCatalog(store, locale)
  const keys = tailorableSectionKeys().join(', ')
  return `You are helping a consultant tailor their CV to a specific job posting / tender.

Below you get (A) the posting, and (B) a catalog of the consultant's master CV:
every section with its items (id + title; starred = the consultant's own
highlights) plus their full skill registry.

Decide which content best targets the posting:
- a detail level per section: "off" (hide), "summary" (one-liners), "full"
- which individual items to exclude as irrelevant (by their exact "id")
- a short introduction paragraph (3–5 sentences) pitching the consultant FOR
  THIS POSTING, written in the language with code "${locale}"
- a list of gaps: requirements in the posting the catalog shows no evidence for

Rules:
- Respond with ONLY a JSON object — no prose, no markdown fences.
- Use exactly this schema (omit a field to leave it unchanged):
{
  "$schema": "${TAILOR_SCHEMA}",
  "view_name": "string — short name for this tailored CV variant",
  "introduction": "string — the drafted introduction in ${locale}",
  "section_detail": { "<section key>": "off" | "summary" | "full" },
  "exclude_item_ids": ["<item id>", "..."],
  "gaps": ["<requirement with no CV evidence>", "..."]
}
- Valid section keys: ${keys}
- Only use item ids that appear in the catalog. Never invent ids.
- Keep starred items unless they are clearly irrelevant to the posting.
- Do not invent experience: gaps belong in "gaps", not in the introduction.

(A) JOB POSTING:
---
${posting.trim()}
---

(B) CANDIDATE CATALOG (JSON):
${JSON.stringify(catalog, null, 1)}
`
}

// ─── Detection + validation ──────────────────────────────────────────────────

export interface TailorIssue {
  /** Dotted path to the offending field, e.g. `section_detail.projects`. */
  path: string
  reason: string
}

/** Thrown when a tailor response is structurally unusable. Carries every issue found. */
export class InvalidTailorResponseError extends Error {
  constructor(public issues: TailorIssue[]) {
    super(
      issues.length === 1
        ? `${issues[0].path}: ${issues[0].reason}`
        : `Found ${issues.length} problems in the tailoring response.`,
    )
    this.name = 'InvalidTailorResponseError'
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

const DETAILS = new Set<string>(['off', 'summary', 'full'])

/** Lenient detector for routing pasted JSON: any `resumestudio-tailor/` schema. */
export function isTailorFormat(json: unknown): json is TailorV1 {
  if (!isPlainObject(json)) return false
  const schema = json['$schema']
  return typeof schema === 'string' && schema.startsWith('resumestudio-tailor/')
}

/**
 * Structurally validate parsed JSON as a tailor response. Throws
 * `InvalidTailorResponseError` with every issue when unusable. Unknown section
 * keys / item ids are NOT errors here — `applyTailorResponse` drops and
 * reports them (a model that half-hallucinates is still mostly useful).
 */
export function validateTailorResponse(json: unknown): TailorV1 {
  const issues: TailorIssue[] = []
  if (!isPlainObject(json)) {
    throw new InvalidTailorResponseError([{ path: '(root)', reason: 'expected a JSON object' }])
  }
  const schema = json['$schema']
  if (typeof schema !== 'string' || !schema.startsWith('resumestudio-tailor/')) {
    issues.push({ path: '$schema', reason: `expected "${TAILOR_SCHEMA}", got ${JSON.stringify(schema)}` })
  }
  for (const field of ['view_name', 'introduction'] as const) {
    const v = json[field]
    if (v != null && typeof v !== 'string' && typeof v !== 'number') {
      issues.push({ path: field, reason: 'expected a string' })
    }
  }
  const sd = json['section_detail']
  if (sd != null) {
    if (!isPlainObject(sd)) {
      issues.push({ path: 'section_detail', reason: 'expected an object of section→detail' })
    } else {
      for (const [key, val] of Object.entries(sd)) {
        if (typeof val !== 'string' || !DETAILS.has(val)) {
          issues.push({
            path: `section_detail.${key}`,
            reason: `expected "off" | "summary" | "full", got ${JSON.stringify(val)}`,
          })
        }
      }
    }
  }
  for (const field of ['exclude_item_ids', 'gaps'] as const) {
    const v = json[field]
    if (v == null) continue
    if (!Array.isArray(v)) {
      issues.push({ path: field, reason: 'expected an array of strings' })
    } else {
      v.forEach((entry, i) => {
        if (typeof entry !== 'string' && typeof entry !== 'number') {
          issues.push({ path: `${field}[${i}]`, reason: 'expected a string' })
        }
      })
    }
  }
  if (issues.length) throw new InvalidTailorResponseError(issues)
  return json as unknown as TailorV1
}

// ─── Application ──────────────────────────────────────────────────────────────

export interface TailorResult {
  /** A ready-to-add view. Not yet in the store — the caller decides. */
  view: ResumeView
  gaps: string[]
  /** Excluded ids that don't exist in the store (hallucinated) — dropped. */
  unknownItemIds: string[]
  /** section_detail keys that aren't exportable sections — ignored. */
  unknownSections: string[]
  /** Titles of the items that will be excluded, for the preview diff. */
  excludedTitles: string[]
}

/**
 * Build a new ResumeView from a validated tailor response. Total function —
 * unknown ids/sections are reported, never fatal.
 */
export function applyTailorResponse(store: ResumeStore, input: TailorV1, locale: string): TailorResult {
  const validKeys = new Set(tailorableSectionKeys())
  const unknownSections: string[] = []
  const detailFor = new Map<string, SectionDetail>()
  for (const [key, val] of Object.entries(input.section_detail ?? {})) {
    if (!validKeys.has(key)) { unknownSections.push(key); continue }
    detailFor.set(key, val as SectionDetail)
  }
  const sections: ViewSection[] = buildViewSections().map((s) =>
    detailFor.has(s.key) ? { ...s, detail: detailFor.get(s.key)! } : s,
  )

  // Map every known (enabled or not) item id to its section so we can both
  // filter hallucinated ids and show excluded titles in the preview.
  const itemById = new Map<string, { sectionKey: string; item: Record<string, unknown> }>()
  for (const s of SECTIONS.filter(isExportableSection).filter((s) => !s.virtual)) {
    for (const it of store[s.storeKey!] as unknown as Array<Record<string, unknown>>) {
      itemById.set(String(it.id), { sectionKey: s.key, item: it })
    }
  }
  const excluded: string[] = []
  const excludedTitles: string[] = []
  const unknownItemIds: string[] = []
  for (const raw of input.exclude_item_ids ?? []) {
    const id = String(raw)
    const hit = itemById.get(id)
    if (!hit) { unknownItemIds.push(id); continue }
    excluded.push(id)
    excludedTitles.push(getItemTitle(hit.sectionKey, hit.item, locale))
  }

  const introText = typeof input.introduction === 'string' ? input.introduction.trim() : ''
  const now = new Date().toISOString()
  const view: ResumeView = {
    id: uuidv4(),
    name: (typeof input.view_name === 'string' && input.view_name.trim()) || 'Tailored view',
    introduction: introText ? { [locale]: introText } : {},
    sections,
    excluded_item_ids: excluded,
    include_photo: false,
    starred_only: false,
    page_limit: null,
    template_id: null,
    export_locale: null,
    style: { ...DEFAULT_VIEW_STYLE },
    header: { ...DEFAULT_VIEW_HEADER, fields: defaultHeaderFields() },
    footer: { ...DEFAULT_VIEW_FOOTER, copyright_custom: {}, note: {} },
    last_exported_at: null,
    created_at: now,
    updated_at: now,
  }
  return {
    view,
    gaps: (input.gaps ?? []).map(String).filter(Boolean),
    unknownItemIds,
    unknownSections,
    excludedTitles,
  }
}
