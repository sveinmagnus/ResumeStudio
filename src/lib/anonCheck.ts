/**
 * PURE: find real organisation names that survive into an ANONYMISED view.
 *
 * `force_anonymized` swaps STRUCTURED fields — a project renders
 * `customer_anonymized`, references render initials. It cannot do anything about
 * prose: "Led the Acme migration" sitting in a long description ships the client's
 * name to the very agency the alias exists to hide it from. That's a real gap
 * with real consequences, and deterministic code can't fix it — but it CAN find
 * most of it.
 *
 * Two passes, cheapest and most certain first:
 *
 *  1. KNOWN names (`findKnownLeaks`). The store already holds every real
 *     customer, employer, school and reference company — the alias is defined
 *     against them. So scanning the rendered view for those exact strings costs
 *     nothing, sends nothing anywhere, invents nothing, and catches the common
 *     case outright. This is the pass that matters; it needs no model at all.
 *
 *  2. UNKNOWN names (`buildAnonCheckPrompt`) — an org the store never recorded:
 *     a nickname, an abbreviation, a client named only in passing. Only a model
 *     can spot those, so this pass is opt-in. It is also the assist that ships
 *     the most sensitive text in the app, which is exactly why it never runs on
 *     its own.
 *
 * Advisory only. This reports; it never edits the user's prose.
 */

import type { ResumeStore, ResumeView, LocalizedString } from '../types'
import { resolve } from './locales'
import { buildViewText } from './viewText'

export const ANON_CHECK_SCHEMA = 'resumestudio-anon/v1'

export interface AnonFinding {
  /** The leaked name as it appears. */
  text: string
  /** Where we know it from ('Customer', 'Employer', …), or '' for a model find. */
  origin: string
  /** 'known' = matched a name in the store; 'model' = the LLM flagged it. */
  source: 'known' | 'model'
  /** A little of the surrounding text, so the user can find it. */
  context: string
}

/** Names too short/generic to match on without drowning the user in noise. */
const MIN_NAME_LEN = 3

/**
 * The names an anonymised view is supposed to HIDE.
 *
 * Only project customers and reference identities — because that is precisely
 * what `force_anonymized` swaps (viewFilter: projects render
 * `customer_anonymized`, references render initials). Employers and schools are
 * NOT anonymised and render in full by design, so matching them would flag
 * "BigCorp appears in your CV" — which is true, intended, and pure noise. A
 * check that cries wolf about every employer is a check nobody reads.
 */
export function knownNames(store: ResumeStore, locale: string): Array<{ name: string; origin: string }> {
  const out: Array<{ name: string; origin: string }> = []
  const push = (v: string | LocalizedString | null | undefined, origin: string) => {
    const s = (typeof v === 'string' ? v : resolve(v ?? {}, locale)).trim()
    if (s.length >= MIN_NAME_LEN) out.push({ name: s, origin })
  }

  for (const p of store.projects) push(p.customer, 'Customer')
  for (const r of store.references) {
    push(r.company, 'Reference company')
    push(r.name, 'Reference name')
  }

  // Longest first: "Acme Corporation" should be reported over "Acme".
  return out.sort((a, b) => b.name.length - a.name.length)
}

/** Escape a literal for use in a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A window of text around `index`, for locating the leak. */
function contextAt(text: string, index: number, len: number): string {
  const from = Math.max(0, index - 40)
  const to = Math.min(text.length, index + len + 40)
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`
}

/**
 * PASS 1 — no model, no network, no false positives.
 *
 * Renders the view exactly as it will export and looks for names the store knows
 * are real. Whole-word matching (case-insensitive) so "Acme" doesn't fire on
 * "acmeism"; overlapping hits are reported once, longest name winning.
 */
export function findKnownLeaks(store: ResumeStore, view: ResumeView, locale: string): AnonFinding[] {
  if (!view.force_anonymized) return []
  const text = buildViewText(store, view, locale)
  const findings: AnonFinding[] = []
  const claimed: Array<[number, number]> = []

  for (const { name, origin } of knownNames(store, locale)) {
    const re = new RegExp(`(?<![\\p{L}\\d])${escapeRe(name)}(?![\\p{L}\\d])`, 'giu')
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0
      const end = start + name.length
      // A longer name already covered this span — don't report the substring too.
      if (claimed.some(([s, e]) => start < e && end > s)) continue
      claimed.push([start, end])
      findings.push({ text: name, origin, source: 'known', context: contextAt(text, start, name.length) })
    }
  }
  return findings
}

/**
 * PASS 2 — the prompt for organisation names the store never recorded.
 *
 * The rendered view is the input, so this ships the CV's prose to the model.
 * Callers must gate it behind AssistRun (which states where that goes) and never
 * run it implicitly.
 */
export function buildAnonCheckPrompt(store: ResumeStore, view: ResumeView, locale: string): string {
  const text = buildViewText(store, view, locale)
  return [
    'The CV below has been anonymised: client and employer names should NOT appear.',
    'List any remaining company, client, organisation or brand names you can see in it.',
    'Rules:',
    '- Only real organisation names. Ignore technologies, products and tools (React, AWS, SAP…),',
    '  job titles, place names, and the CV owner\'s own name.',
    '- Quote each name exactly as it appears.',
    '- If there are none, return an empty list.',
    '',
    `Reply with ONLY this JSON, no prose:\n{"$schema":"${ANON_CHECK_SCHEMA}","names":["…"]}`,
    '',
    '--- CV ---',
    text,
  ].join('\n')
}

export class InvalidAnonCheckError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidAnonCheckError' }
}

/** Validate a pass-2 reply. An empty list is a valid, meaningful answer. */
export function validateAnonCheck(json: unknown): string[] {
  if (!json || typeof json !== 'object') throw new InvalidAnonCheckError('The reply was not a JSON object.')
  const o = json as Record<string, unknown>
  if (!Array.isArray(o.names)) throw new InvalidAnonCheckError('The reply has no "names" array.')
  return o.names.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter(Boolean)
}

/**
 * Turn pass-2 names into findings, dropping anything pass 1 already reported
 * (the model re-finding a known name is not a second problem) and anything that
 * isn't actually in the text (models do hallucinate a plausible client name).
 */
export function modelFindings(
  names: readonly string[],
  store: ResumeStore,
  view: ResumeView,
  locale: string,
  known: readonly AnonFinding[],
): AnonFinding[] {
  const text = buildViewText(store, view, locale)
  const seen = new Set(known.map((f) => f.text.toLowerCase()))
  const out: AnonFinding[] = []

  for (const raw of names) {
    const name = raw.trim()
    const key = name.toLowerCase()
    if (name.length < MIN_NAME_LEN || seen.has(key)) continue
    const idx = text.toLowerCase().indexOf(key)
    // Not present → the model invented it. Reporting a phantom leak would send
    // the user hunting for text that isn't there.
    if (idx === -1) continue
    seen.add(key)
    out.push({ text: name, origin: '', source: 'model', context: contextAt(text, idx, name.length) })
  }
  return out
}
