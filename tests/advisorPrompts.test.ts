/**
 * Prompt builders for the advisors that had no coverage at all: A3 (semantic
 * cross-language drift) and D3 (per-section gaps).
 *
 * A prompt builder looks untestable — it's a string — but the properties that
 * matter here are structural and have each been a bug in something adjacent:
 * the CV content must actually be IN the prompt, the digest must come from the
 * raw locale slots rather than the resolve() fallback chain, and the response
 * spec has to be present or the reply won't parse.
 */

import { describe, it, expect } from 'vitest'
import { buildSemanticDriftPrompt } from '../src/lib/semanticDrift'
import { buildSectionAdvicePrompt, hasAdvisableContent } from '../src/lib/sectionAdvice'
import { emptyStore, makeProject, makeCourse } from './fixtures'
import type { ResumeStore } from '../src/types'

function bilingualStore(): ResumeStore {
  return {
    ...emptyStore(),
    projects: [makeProject({
      customer: { en: 'Acme', no: 'Acme' },
      long_description: {
        en: 'Migrated the billing platform to Kubernetes.',
        no: 'Migrerte faktureringsplattformen.',
      },
    })],
  }
}

describe('buildSemanticDriftPrompt (A3)', () => {
  it('carries both language columns into the prompt', () => {
    const p = buildSemanticDriftPrompt(bilingualStore(), 'en', 'no')
    expect(p).toContain('Migrated the billing platform to Kubernetes.')
    expect(p).toContain('Migrerte faktureringsplattformen.')
  })

  it('names both languages by their own name, not just the code', () => {
    const p = buildSemanticDriftPrompt(bilingualStore(), 'en', 'no')
    expect(p).toMatch(/English \(en\)/)
    expect(p).toMatch(/Norsk \(no\)|Norwegian \(no\)/)
  })

  it('falls back to the bare code for a language it cannot name', () => {
    const p = buildSemanticDriftPrompt(bilingualStore(), 'en', 'zz')
    expect(p).toContain('(zz)')
  })

  it('asks for the shared findings shape so the reply parses', () => {
    const p = buildSemanticDriftPrompt(bilingualStore(), 'en', 'no')
    expect(p).toContain('findings')
  })

  it('does NOT fill an empty column from the other language', () => {
    // The whole point of the pass: resolve()'s fallback chain would show the
    // English text in the Norwegian column and report perfect agreement.
    const s = emptyStore()
    s.projects = [makeProject({
      customer: { en: 'Acme' },
      long_description: { en: 'Only written in English.' },
    })]
    const p = buildSemanticDriftPrompt(s, 'en', 'no')
    // The English appears once (its own column), not twice (both columns).
    expect(p.split('Only written in English.').length - 1).toBe(1)
  })

  it('can be narrowed to named sections', () => {
    const s = bilingualStore()
    s.courses = [makeCourse({
      name: { en: 'Kubernetes Deep Dive' },
      description: { en: 'Three days on operators.', no: 'Tre dager om operatorer.' },
    })]
    const all = buildSemanticDriftPrompt(s, 'en', 'no')
    const narrowed = buildSemanticDriftPrompt(s, 'en', 'no', ['projects'])
    expect(all).toContain('Three days on operators.')
    expect(narrowed).not.toContain('Three days on operators.')
  })
})

describe('buildSectionAdvicePrompt (D3)', () => {
  it('names the section in human terms and by key', () => {
    const s = bilingualStore()
    const p = buildSectionAdvicePrompt(s, 'projects', 'en')
    expect(p).toContain('Projects')     // the label a person reads
    expect(p).toContain('"projects"')   // the key the reply must use
  })

  it('includes only the section it is about', () => {
    const s = bilingualStore()
    s.courses = [makeCourse({ name: { en: 'Kubernetes Deep Dive' } })]
    const p = buildSectionAdvicePrompt(s, 'courses', 'en')
    expect(p).toContain('Kubernetes Deep Dive')
    expect(p).not.toContain('Migrated the billing platform')
  })

  it('tells the model to ask rather than invent', () => {
    const p = buildSectionAdvicePrompt(bilingualStore(), 'projects', 'en')
    expect(p).toMatch(/"ask"/)
    expect(p).toMatch(/Do not assume facts/i)
    expect(p).toMatch(/Do not write replacement text/i)
  })
})

describe('hasAdvisableContent', () => {
  it('is false for an empty section — the question answers itself', () => {
    expect(hasAdvisableContent(emptyStore(), 'projects')).toBe(false)
  })

  it('is true once the section has an item', () => {
    expect(hasAdvisableContent(bilingualStore(), 'projects')).toBe(true)
  })

  it('is false for a section key that does not exist', () => {
    expect(hasAdvisableContent(bilingualStore(), 'not_a_section')).toBe(false)
  })
})
