/**
 * @vitest-environment jsdom
 *
 * jsdom: the letter prompts embed a CV digest, which flattens rich text.
 */
import { describe, it, expect } from 'vitest'
import { buildLetterAnglesPrompt, buildLetterCritiquePrompt } from '../src/lib/letterAdvice'
import { emptyStore, makeProject, makeResume, makeCoverLetter } from './fixtures'
import type { ResumeStore } from '../src/types'

const makeLetter = makeCoverLetter

describe('the letter prompts carry the application, not just the CV', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Ada Lovelace' })
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: { en: '<p>Ran it.</p>' } })]
    return s
  }

  it('names the applicant, the company and the role', () => {
    const prompt = buildLetterCritiquePrompt(store(), makeLetter({
      company: { en: 'Equinor' }, role_applied: { en: 'Platform lead' },
      body: { en: 'The letter body.' },
    }), 'en')
    expect(prompt).toContain('Ada Lovelace')
    expect(prompt).toContain('Equinor')
    expect(prompt).toContain('Platform lead')
    expect(prompt).toContain('The letter body.')
  })

  it('says so plainly when a field the letter needs is empty', () => {
    const s = store()
    s.resume = makeResume({ full_name: '' })
    const prompt = buildLetterAnglesPrompt(s, makeLetter({ company: {}, role_applied: {} }), 'en')
    expect(prompt).toContain('(unnamed)')
    expect(prompt).toContain('(unnamed company)')
  })

  it('says the posting is missing rather than leaving an empty block', () => {
    const prompt = buildLetterAnglesPrompt(store(), makeLetter({ posting: '   ' }), 'en')
    expect(prompt).toMatch(/no posting text/)
  })

  it('asks for at least two angles and never more than the cap', () => {
    const count = (n: number) => {
      const m = /Draft (\d+) GENUINELY DIFFERENT/.exec(buildLetterAnglesPrompt(store(), makeLetter(), 'en', n))
      return Number(m?.[1])
    }
    expect(count(1)).toBe(2)
    expect(count(3)).toBe(3)
    expect(count(99)).toBeLessThan(10)
  })
})

describe('buildLetterCritiquePrompt — a letter with nothing written yet', () => {
  it('does not throw when the letter has no body at all', () => {
    // The panel is reachable before a word is written; reading the body
    // unguarded would break the screen rather than the run.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Ada Lovelace' })
    const letter = makeCoverLetter({ company: { en: 'Acme' } })
    delete (letter as unknown as Record<string, unknown>).body
    expect(() => buildLetterCritiquePrompt(s, letter, 'en')).not.toThrow()
  })

  it('reads the body of the locale being reviewed', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Ada Lovelace' })
    const letter = makeCoverLetter({ body: { en: 'English letter.', no: 'Norsk brev.' } })
    expect(buildLetterCritiquePrompt(s, letter, 'no')).toContain('Norsk brev.')
    expect(buildLetterCritiquePrompt(s, letter, 'no')).not.toContain('English letter.')
  })
})
