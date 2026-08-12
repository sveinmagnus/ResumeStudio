/**
 * @vitest-environment jsdom
 *
 * jsdom: the prompt flattens the profile's rich text via richToPlain (DOMParser).
 */
import { describe, it, expect } from 'vitest'
import { buildIntroPrompt, DEFAULT_INTRO_FOCUS } from '../src/lib/introDraft'
import { buildViewSections } from '../src/lib/viewFilter'
import { emptyStore, makeKQ, makeProject, makeView } from './fixtures'
import type { ResumeStore } from '../src/types'

describe('buildIntroPrompt — what it puts in front of the model', () => {
  const viewOf = () => makeView({ sections: buildViewSections() })

  const storeWithProfile = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.key_qualifications = [makeKQ({
      id: 'kq1',
      tag_line: { en: 'Platform architect' },
      summary: { en: '<p>Builds   delivery   platforms.</p>' },
      ...over,
    })]
    return s
  }

  const blockAfter = (prompt: string, header: string): string => {
    const lines = prompt.split(String.fromCharCode(10)).map((l) => l.trimEnd())
    return lines[lines.findIndex((l) => l.includes(header)) + 1]
  }

  it('carries the tag line under its own header', () => {
    const prompt = buildIntroPrompt(storeWithProfile(), viewOf(), 'en', DEFAULT_INTRO_FOCUS)
    expect(prompt).toContain('PROFILE TAG LINE')
    expect(blockAfter(prompt, 'PROFILE TAG LINE')).toBe('Platform architect')
  })

  it('flattens the profile text and collapses every run of whitespace', () => {
    // The summary is rich text with layout whitespace in it; a prompt full of
    // ragged spacing spends context and reads as noise.
    const prompt = buildIntroPrompt(storeWithProfile(), viewOf(), 'en', DEFAULT_INTRO_FOCUS)
    expect(blockAfter(prompt, 'do not restate')).toBe('Builds delivery platforms.')
  })

  it('leaves the one-line summaries out of the digest', () => {
    const s = storeWithProfile()
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Client' },
      long_description: { en: 'The long story.' },
      short_description: { en: 'The short line.' },
    })]
    const prompt = buildIntroPrompt(s, viewOf(), 'en', DEFAULT_INTRO_FOCUS)
    expect(prompt).toContain('The long story.')
    expect(prompt).not.toContain('The short line.')
  })

  it('omits each block entirely when the profile has no such text', () => {
    const prompt = buildIntroPrompt(
      storeWithProfile({ tag_line: {}, summary: {} }), viewOf(), 'en', DEFAULT_INTRO_FOCUS,
    )
    expect(prompt).not.toContain('PROFILE TAG LINE')
    expect(prompt).not.toContain('do not restate')
    expect(prompt).not.toContain('Platform architect')
    // Nothing stands in for the omitted blocks: the digest header follows the
    // instructions directly.
    const lines = prompt.split(String.fromCharCode(10)).map((l) => l.trimEnd())
    const digestAt = lines.findIndex((l) => l.includes('WHAT THIS VERSION CONTAINS'))
    expect(lines[digestAt - 1]).toBe('')
    expect(lines[digestAt - 2]).toMatch(/^Reply with the introduction text ONLY/)
  })

  it('states the reader when given one, and says so plainly when not', () => {
    const withAudience = buildIntroPrompt(
      storeWithProfile(), viewOf(), 'en', { audience: '  A public-sector buyer  ', length: 'paragraph' },
    )
    expect(withAudience).toContain('Reader / purpose: A public-sector buyer')

    const blank = buildIntroPrompt(
      storeWithProfile(), viewOf(), 'en', { audience: '   ', length: 'paragraph' },
    )
    expect(blank).toContain('(not stated')
  })

  it('asks for one sentence or a short paragraph, per the chosen length', () => {
    const line = buildIntroPrompt(storeWithProfile(), viewOf(), 'en', { audience: '', length: 'line' })
    expect(line).toMatch(/ONE sentence/)
    const para = buildIntroPrompt(storeWithProfile(), viewOf(), 'en', { audience: '', length: 'paragraph' })
    expect(para).toMatch(/2\u20134 sentences/)
  })

  it('sends the FILTERED document, since anything promised must be findable in it', () => {
    const s = storeWithProfile()
    s.projects = [
      makeProject({ id: 'kept', customer: { en: 'Kept Client' }, long_description: { en: 'Included work.' } }),
      makeProject({ id: 'cut', customer: { en: 'Cut Client' }, long_description: { en: 'Excluded work.' } }),
    ]
    const view = makeView({ sections: buildViewSections(), excluded_item_ids: ['cut'] })
    const prompt = buildIntroPrompt(s, view, 'en', DEFAULT_INTRO_FOCUS)
    expect(prompt).toContain('Kept Client')
    expect(prompt).not.toContain('Cut Client')
  })
})
