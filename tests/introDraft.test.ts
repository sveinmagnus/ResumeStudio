/**
 * @vitest-environment jsdom
 *
 * jsdom: the prompt flattens the profile's rich text via richToPlain (DOMParser).
 */
import { describe, it, expect } from 'vitest'
import { buildIntroPrompt, tidyIntro, DEFAULT_INTRO_FOCUS } from '../src/lib/introDraft'
import { buildViewSections } from '../src/lib/viewFilter'
import { emptyStore, makeKQ, makeProject, makeView, makeResume } from './fixtures'
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

describe('tidyIntro — unwrapping what the model actually returns', () => {
  it('strips a fence and the blank line it leaves behind', () => {
    const nl = String.fromCharCode(10)
    expect(tidyIntro(`\`\`\`${nl}The introduction.${nl}\`\`\``)).toBe('The introduction.')
    expect(tidyIntro(`\`\`\`markdown${nl}The introduction.${nl}\`\`\``)).toBe('The introduction.')
  })

  it('strips a leading label line, however it is worded', () => {
    for (const prefix of ['Introduction:', "Here's the introduction:", 'Here is your introduction:']) {
      expect(tidyIntro(`${prefix} The introduction.`), prefix).toBe('The introduction.')
    }
  })

  it('leaves the padding off the result in every case', () => {
    // The value is written straight into the view's intro field, where a
    // leading space shows up as an indent in the export.
    expect(tidyIntro('   The introduction.   ')).toBe('The introduction.')
    const nl = String.fromCharCode(10)
    expect(tidyIntro(`\`\`\`${nl}   The introduction.   ${nl}\`\`\``)).toBe('The introduction.')
    expect(tidyIntro('Introduction:    The introduction.  ')).toBe('The introduction.')
  })

  it('keeps a colon that belongs to the sentence', () => {
    expect(tidyIntro('My focus: public sector platforms.')).toBe('My focus: public sector platforms.')
  })

  it('unwraps quotes only when they wrap the whole thing', () => {
    expect(tidyIntro('"The introduction."')).toBe('The introduction.')
    expect(tidyIntro('He said "hello" to the room.')).toBe('He said "hello" to the room.')
  })
})

describe('buildIntroPrompt — the profile text it quotes', () => {
  it('flattens the profile to one line, collapsing runs of space', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.key_qualifications = [makeKQ({
      id: 'kq1', tag_line: { en: 'Architect' },
      summary: { en: 'First  line.   Second line.  ' },
    })]
    const prompt = buildIntroPrompt(s, makeView({ sections: buildViewSections() }), 'en', DEFAULT_INTRO_FOCUS)
    expect(prompt).toContain('First line. Second line.')
    expect(prompt).not.toContain('First  line.')
  })
})

/**
 * `tidyIntro` cleans up what a model actually returns. Every rule here exists
 * because a model did the thing: fenced the answer, prefixed it with a label,
 * or wrapped it in quotes. Whatever survives lands straight in the view's
 * introduction field, so a leftover fence marker ships in the export.
 */
describe('tidyIntro — the packaging a model wraps its answer in', () => {
  const NL = String.fromCharCode(10)

  it('strips a fence and the whitespace it leaves behind', () => {
    expect(tidyIntro('```' + NL + 'The introduction.' + NL + '```')).toBe('The introduction.')
    expect(tidyIntro('```markdown' + NL + 'The introduction.' + NL + '```')).toBe('The introduction.')
  })

  it('strips a leading label with or without a space after the colon', () => {
    // Both spacings occur; requiring the space leaves "Introduction:" in the
    // field, which then prints in the export.
    expect(tidyIntro('Introduction: The text.')).toBe('The text.')
    expect(tidyIntro('Introduction:The text.')).toBe('The text.')
    expect(tidyIntro("Here's the introduction: The text.")).toBe('The text.')
    expect(tidyIntro('Here is what I wrote: The text.')).toBe('The text.')
  })

  it('strips a label with a space BEFORE the colon too', () => {
    // "Introduction : text" comes back from models that pad punctuation; the
    // label is still a label.
    expect(tidyIntro('Introduction : The text.')).toBe('The text.')
  })

  it('leaves a colon that is part of the sentence alone', () => {
    // "Specialist in one thing: delivery" is the introduction, not a label.
    expect(tidyIntro('Specialist in one thing: delivery.')).toBe('Specialist in one thing: delivery.')
  })

  it('trims what is left after each strip', () => {
    expect(tidyIntro('   Introduction:   The text.   ')).toBe('The text.')
  })

  it('unwraps quotes only when they wrap the WHOLE thing', () => {
    expect(tidyIntro('"The introduction."')).toBe('The introduction.')
    expect(tidyIntro('He said "hello" to them.')).toBe('He said "hello" to them.')
  })

  it('keeps the paragraph breaks inside the introduction', () => {
    // Unlike a one-line summary, an introduction may be several paragraphs.
    expect(tidyIntro(`First.${NL}${NL}Second.`)).toBe(`First.${NL}${NL}Second.`)
  })
})

describe('buildIntroPrompt — the profile text it quotes', () => {
  it('flattens the profile summary to one trimmed line', () => {
    // It is quoted into a labelled block; leading whitespace or an embedded
    // newline turns one field into what reads as two.
    const NL = String.fromCharCode(10)
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.key_qualifications = [makeKQ({
      id: 'kq1', tag_line: { en: 'Architect' },
      summary: { en: `  <p>First   line.</p><p>Second line.</p>  ` },
    } as never)]
    const prompt = buildIntroPrompt(s, makeView({ sections: buildViewSections() }), 'en', DEFAULT_INTRO_FOCUS)
    expect(prompt).toContain('First line. Second line.')
    expect(prompt).not.toContain('  First')
    expect(prompt).not.toContain(`${NL}Second line.`)
  })
})
