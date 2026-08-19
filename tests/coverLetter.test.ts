import { describe, it, expect } from 'vitest'
import {
  bodyParagraphs, resolveLetterParts, buildCoverLetterText, buildCoverLetterPrompt,
  defaultDateline,
} from '../src/lib/coverLetter'
import { LOCALE_CODES } from '../src/lib/locales'
import { emptyStore, makeResume, makeCoverLetter, makeView, makeProject, makeSkill } from './fixtures'
import type { ResumeStore } from '../src/types'

function storeWith(over: Partial<ResumeStore> = {}): ResumeStore {
  return { ...emptyStore(), resume: makeResume({ full_name: 'Ada Lovelace', email: 'ada@x.io', phone: '+47 900' }), ...over }
}

describe('bodyParagraphs()', () => {
  it('breaks on every newline, blank line or not', () => {
    // Same rule as every other plain-text field (plainParagraphs): the user
    // cannot see whether a stored value holds one newline or two, so both
    // have to mean the same thing.
    expect(bodyParagraphs('One\nline.\n\nSecond para.')).toEqual(['One', 'line.', 'Second para.'])
  })
  it('drops empty paragraphs', () => {
    expect(bodyParagraphs('\n\nOnly one\n\n\n')).toEqual(['Only one'])
  })
})

describe('resolveLetterParts()', () => {
  it('pulls the letterhead from the resume and localizes the letter fields', () => {
    const letter = makeCoverLetter({
      company: { en: 'Equinor' }, recipient: { en: 'Hiring Manager' },
      role_applied: { en: 'Architect' }, greeting: { en: 'Dear Manager,' },
      body: { en: 'Para one.\n\nPara two.' }, closing: { en: 'Sincerely,' },
      place_dated: 'Oslo, 1 Jan 2026',
    })
    const p = resolveLetterParts(storeWith(), letter, 'en')
    expect(p.senderName).toBe('Ada Lovelace')
    expect(p.senderContact).toEqual(['ada@x.io', '+47 900'])
    expect(p.recipient).toEqual(['Hiring Manager', 'Equinor'])
    expect(p.subject).toBe('Application for Architect')
    expect(p.greeting).toBe('Dear Manager,')
    expect(p.paragraphs).toEqual(['Para one.', 'Para two.'])
    expect(p.dateline).toBe('Oslo, 1 Jan 2026')
  })

  it('generates a dateline when none is set', () => {
    const p = resolveLetterParts(storeWith(), makeCoverLetter(), 'en', new Date('2026-07-17T00:00:00Z'))
    expect(p.dateline).toMatch(/2026/)
  })

  it('resolves the linked view for font reuse; a dangling id is just null', () => {
    const view = makeView({ id: 'v1', name: 'Consultant CV' })
    const store = storeWith({ views: [view] })
    expect(resolveLetterParts(store, makeCoverLetter({ view_id: 'v1' }), 'en').view?.id).toBe('v1')
    expect(resolveLetterParts(store, makeCoverLetter({ view_id: 'gone' }), 'en').view).toBeNull()
  })

  it('localizes the subject prefix per language', () => {
    const letter = makeCoverLetter({ role_applied: { en: 'Architect', no: 'Arkitekt' } })
    expect(resolveLetterParts(storeWith(), letter, 'no').subject).toBe('Søknad på stillingen Arkitekt')
  })

  it('has a subject prefix for every offered locale, each in its own language', () => {
    // The subject line is EXPORT chrome — it lands in the .pdf, the .docx and
    // the .txt — so it is under the same locale-coverage contract as every
    // heading (CLAUDE.md §12). It lives in a private map this suite is the
    // only reader of, and `resolve` never throws, so an untranslated locale
    // would ship a Norwegian letter headed in English.
    const letter = makeCoverLetter({ role_applied: { en: 'Architect' } })
    const prefixes = new Map<string, string>()
    for (const code of LOCALE_CODES) {
      const subject = resolveLetterParts(storeWith(), letter, code).subject
      expect(subject.endsWith(' Architect'), code).toBe(true)
      const prefix = subject.slice(0, -' Architect'.length)
      expect(prefix.trim(), code).not.toBe('')
      prefixes.set(code, prefix)
    }
    // Only the four languages that genuinely share a word may share one.
    const english = prefixes.get('en')!
    const alsoEnglish = [...prefixes].filter(([code, p]) => code !== 'en' && p === english)
    expect(alsoEnglish, 'locales falling back to the English prefix').toEqual([])
  })

  it('writes no subject line at all when no role is named', () => {
    expect(resolveLetterParts(storeWith(), makeCoverLetter({ role_applied: {} }), 'no').subject).toBe('')
  })

  it('trims every field it lifts, and drops the ones left empty', () => {
    // Padding survives a copy-paste from a job ad and would otherwise be baked
    // into a letterhead that is supposed to look typeset.
    const store = storeWith({
      resume: makeResume({
        full_name: '  Ada Lovelace  ', email: '  ada@x.io  ', phone: '   ', website_url: '',
      }),
    })
    const letter = makeCoverLetter({
      company: { en: '  Equinor  ' }, recipient: { en: '   ' },
      role_applied: { en: '  Architect  ' }, greeting: { en: '  Dear Manager,  ' },
      closing: { en: '  Sincerely,  ' }, place_dated: '   ',
    })
    const p = resolveLetterParts(store, letter, 'en', new Date('2026-07-17T00:00:00Z'))

    expect(p.senderName).toBe('Ada Lovelace')
    expect(p.senderContact).toEqual(['ada@x.io'])   // blank phone/website omitted, not blank lines
    expect(p.recipient).toEqual(['Equinor'])        // no recipient name — the company stands alone
    expect(p.subject).toBe('Application for Architect')
    expect(p.greeting).toBe('Dear Manager,')
    expect(p.closing).toBe('Sincerely,')
    // A whitespace-only dateline is no dateline, so the generated one stands in.
    expect(p.dateline).toMatch(/2026/)
  })

  it('works from a store with no resume record at all', () => {
    // Every letterhead field is optional chaining for this case; without it the
    // cover-letter editor throws instead of rendering an empty letterhead.
    const store = { ...storeWith(), resume: undefined } as unknown as ResumeStore
    const p = resolveLetterParts(store, makeCoverLetter(), 'en')
    expect(p.senderName).toBe('')
    expect(p.senderContact).toEqual([])
  })
})

describe('buildCoverLetterText()', () => {
  it('assembles a readable plain-text letter, signed with the sender name', () => {
    const letter = makeCoverLetter({
      company: { en: 'Equinor' }, recipient: { en: 'Hiring Manager' },
      role_applied: { en: 'Architect' }, greeting: { en: 'Dear Manager,' },
      body: { en: 'I would be a great fit.\n\nI have delivered platforms.' },
      closing: { en: 'Sincerely,' }, place_dated: 'Oslo, 1 Jan 2026',
    })
    const txt = buildCoverLetterText(storeWith(), letter, 'en')
    expect(txt).toContain('Ada Lovelace')
    expect(txt).toContain('Application for Architect')
    expect(txt).toContain('Dear Manager,')
    expect(txt).toContain('I would be a great fit.')
    // Signed off with closing + name.
    expect(txt.trimEnd().endsWith('Sincerely,\nAda Lovelace')).toBe(true)
  })

  it('omits blocks that are empty rather than leaving gaps', () => {
    const txt = buildCoverLetterText(storeWith(), makeCoverLetter({ body: { en: 'Just a body.' } }), 'en')
    expect(txt).toContain('Just a body.')
    expect(txt).not.toContain('Application for') // no role → no subject line
  })
})

describe('buildCoverLetterPrompt()', () => {
  it('grounds the prompt in the posting, company/role, and CV evidence', () => {
    const store = storeWith({ projects: [makeProject({ customer: { en: 'NorBAN' } })] })
    const letter = makeCoverLetter({
      company: { en: 'Equinor' }, role_applied: { en: 'Lead Architect' },
      posting: 'We need a lead architect with cloud experience.',
    })
    const prompt = buildCoverLetterPrompt(store, letter, 'en')
    expect(prompt).toContain('Equinor')
    expect(prompt).toContain('Lead Architect')
    expect(prompt).toContain('cloud experience')
    expect(prompt).toContain('Ada Lovelace')
    // Instructs body-only prose in the target locale.
    expect(prompt).toMatch(/ONLY the letter body/i)
    expect(prompt).toContain('"en"')
  })

  it('narrows the evidence to the linked view when one is set', () => {
    // A view that excludes the project should not surface it as evidence.
    const project = makeProject({ id: 'p1', customer: { en: 'SecretClient' } })
    const view = makeView({ id: 'v1', excluded_item_ids: ['p1'], sections: [] })
    const store = storeWith({ projects: [project], views: [view] })
    const letter = makeCoverLetter({ view_id: 'v1', posting: 'x' })
    expect(buildCoverLetterPrompt(store, letter, 'en')).not.toContain('SecretClient')
  })

  it('tolerates a letter with no posting text', () => {
    expect(() => buildCoverLetterPrompt(storeWith(), makeCoverLetter(), 'en')).not.toThrow()
  })
})

/**
 * The plain-text letter's block assembly.
 *
 * Every block is individually gated, and each gate has to be right in BOTH
 * directions: a missing one drops content from the letter, an inverted one
 * prints an empty block or a stray separator. Nothing exercised the omissions.
 */
describe('buildCoverLetterText — which blocks appear', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({
      full_name: 'Kari Nordmann', email: 'kari@example.com', phone: '+47 900 00 000',
    })
    return s
  }
  const full = (over = {}) => makeCoverLetter({
    company: { en: 'Equinor ASA' }, recipient: { en: 'Hiring Manager' },
    role_applied: { en: 'Lead Architect' }, greeting: { en: 'Dear Hiring Manager,' },
    body: { en: 'First paragraph.\n\nSecond paragraph.' }, closing: { en: 'Yours sincerely,' },
    place_dated: 'Oslo, 1 March 2026', ...over,
  })
  const text = (letter = full(), s = store()) => buildCoverLetterText(s, letter, 'en')

  it('lays the blocks out in reading order, separated by blank lines', () => {
    const blocks = text().trimEnd().split('\n\n')
    expect(blocks).toEqual([
      'Kari Nordmann\nkari@example.com\n+47 900 00 000',
      'Oslo, 1 March 2026',
      'Hiring Manager\nEquinor ASA',
      'Application for Lead Architect',
      'Dear Hiring Manager,',
      'First paragraph.',
      'Second paragraph.',
      'Yours sincerely,\nKari Nordmann',
    ])
  })

  it('signs off with the name under the closing', () => {
    // Two appearances on purpose — letterhead and signature — so a test that
    // only finds the name present passes with the signature gone.
    expect(text().trimEnd().split('\n\n').pop()).toBe('Yours sincerely,\nKari Nordmann')
  })

  it('omits a block the letter does not fill, leaving no blank one behind', () => {
    const s = store()
    s.resume = makeResume({ full_name: '', email: '', phone: '', website_url: '' })
    const out = buildCoverLetterText(s, makeCoverLetter({ place_dated: 'Oslo' }), 'en')
    expect(out.trimEnd()).toBe('Oslo')
    expect(out).not.toContain('\n\n\n')
  })

  it('drops the head block entirely when there is no name or contact', () => {
    const s = store()
    s.resume = makeResume({ full_name: '', email: '', phone: '', website_url: '' })
    expect(buildCoverLetterText(s, full(), 'en').split('\n')[0]).toBe('Oslo, 1 March 2026')
  })

  it('ends with exactly one newline', () => {
    // A text export is fed to an ATS; trailing blank lines are noise.
    const out = text()
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })

  it('generates a dateline when the letter has none', () => {
    const out = text(full({ place_dated: null }))
    expect(out.split('\n\n')[1]).toMatch(/\d{4}/)
  })
})


/**
 * The letter prompt's inputs.
 *
 * Everything the model knows about the letter comes from here, and each slot has
 * an explicit "(none)" fallback rather than being left blank — a blank slot is
 * where a model invents a company, a job title, or a body of experience.
 */
describe('buildCoverLetterPrompt — its inputs', () => {
  const store = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann', title: { en: 'Architect' }, ...over })
    return s
  }
  const letter = (over: Record<string, unknown> = {}) => makeCoverLetter(over as never)

  it('states the company and role, trimmed', () => {
    const p = buildCoverLetterPrompt(store(), letter({
      company: { en: '  Equinor  ' }, role_applied: { en: '  Lead Architect  ' },
    }), 'en')
    expect(p).toContain('Equinor')
    expect(p).toContain('Lead Architect')
    expect(p).not.toContain('  Equinor')
  })

  it('states the applicant name and title, trimmed', () => {
    const p = buildCoverLetterPrompt(store({ full_name: '  Kari Nordmann  ' }), letter(), 'en')
    expect(p).toContain('Kari Nordmann')
    expect(p).not.toContain('  Kari Nordmann')
  })

  it('says so explicitly when there is no posting text', () => {
    // A blank slot invites the model to imagine the advert.
    expect(buildCoverLetterPrompt(store(), letter({ posting: '' }), 'en'))
      .toMatch(/no posting text/i)
    expect(buildCoverLetterPrompt(store(), letter({ posting: '   ' }), 'en'))
      .toMatch(/no posting text/i)
  })

  it('carries real posting text through instead of the placeholder', () => {
    const p = buildCoverLetterPrompt(store(), letter({ posting: 'We need a platform lead.' }), 'en')
    expect(p).toContain('We need a platform lead.')
    expect(p).not.toMatch(/no posting text/i)
  })

  it('says so when the CV has no content to draw on', () => {
    expect(buildCoverLetterPrompt(store(), letter(), 'en')).toMatch(/no CV content/i)
  })

  it('says so when no skills are listed', () => {
    expect(buildCoverLetterPrompt(store(), letter(), 'en')).toMatch(/none listed/i)
  })

  it('lists the registry skills when there are some', () => {
    const s = store()
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
    const p = buildCoverLetterPrompt(s, letter(), 'en')
    expect(p).toContain('Go')
    expect(p).not.toMatch(/none listed/i)
  })

  it('survives a store with no resume at all', () => {
    const s = { ...emptyStore(), resume: null }
    expect(() => buildCoverLetterPrompt(s, letter(), 'en')).not.toThrow()
  })

  it('survives a resume with no title', () => {
    const s = store({ title: {} })
    expect(() => buildCoverLetterPrompt(s, letter(), 'en')).not.toThrow()
  })
})

describe('buildCoverLetterText — the closing block', () => {
  it('puts the sender name under the closing, as one block', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann', email: '', phone: '', website_url: '' })
    const out = buildCoverLetterText(s, makeCoverLetter({
      closing: { en: 'Yours sincerely,' }, place_dated: 'Oslo',
    } as never), 'en')
    expect(out).toContain('Yours sincerely,\nKari Nordmann')
  })

  it('emits the closing alone when there is no sender name', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: '', email: '', phone: '', website_url: '' })
    const out = buildCoverLetterText(s, makeCoverLetter({
      closing: { en: 'Yours sincerely,' }, place_dated: 'Oslo',
    } as never), 'en')
    expect(out.trimEnd().endsWith('Yours sincerely,')).toBe(true)
  })

  it('omits the dateline block when the letter has none and none is generated', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari', email: '', phone: '', website_url: '' })
    const out = buildCoverLetterText(s, makeCoverLetter({ place_dated: 'Oslo' } as never), 'en')
    expect(out).toContain('Oslo')
  })
})

describe('defaultDateline — the date a letter is dated', () => {
  it('writes the month in words, not a numeric date', () => {
    // A letter is a formal document; "13/08/2026" reads as a form field, and the
    // numeric order is ambiguous across the locales this app supports.
    const out = defaultDateline('en', new Date(Date.UTC(2026, 7, 13)))
    expect(out).toMatch(/August/)
    expect(out).toContain('2026')
  })

  it('falls back to a plain ISO date when the locale tag is unusable', () => {
    // Intl throws on a malformed tag; a letter with no date at all would be the
    // alternative.
    const out = defaultDateline('not a locale', new Date(Date.UTC(2026, 7, 13)))
    expect(out).toBe('2026-08-13')
  })
})

describe('buildCoverLetterText — the sign-off, exactly', () => {
  it('leaves no trailing blank line when there is no sender name', () => {
    // The closing and the name are ONE block; with no name the block must not
    // keep the newline that separated them, or the letter ends on an empty line.
    const s = emptyStore()
    s.resume = makeResume({ full_name: '', email: '', phone: '', website_url: '' })
    const out = buildCoverLetterText(s, makeCoverLetter({
      closing: { en: 'Yours sincerely,' }, place_dated: 'Oslo',
    } as never), 'en')
    expect(out.endsWith('Yours sincerely,' + String.fromCharCode(10))).toBe(true)
  })
})

describe('buildCoverLetterPrompt — the evidence block', () => {
  const store = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann', title: { en: 'Architect' }, ...over })
    return s
  }

  it('lists the CV items it wants the letter to draw on, under their section label', () => {
    // The letter is only as concrete as the evidence it was given; an empty
    // evidence block leaves the model inventing achievements.
    const s = store()
    s.projects = [makeProject({ id: 'p1', customer: { en: 'NorBAN' }, description: { en: 'Payments platform' } })]
    const p = buildCoverLetterPrompt(s, makeCoverLetter(), 'en')
    expect(p).toMatch(/Projects: [^\n]*NorBAN/)
  })

  it('states the role applied for, trimmed', () => {
    const p = buildCoverLetterPrompt(
      store(), makeCoverLetter({ role_applied: { en: '  Lead Architect  ' } } as never), 'en')
    expect(p).toContain('Lead Architect')
    expect(p).not.toContain('  Lead Architect')
  })

  it('draws on the WHOLE CV when the letter’s view id no longer resolves', () => {
    // A deleted view leaves its id behind. Falling back to "whatever view is
    // first" would pitch the letter from a story the user did not choose.
    const s = store()
    s.projects = [makeProject({ id: 'p1', customer: { en: 'NorBAN' } })]
    s.views = [makeView({ id: 'v1', excluded_item_ids: ['p1'], sections: [] })]
    const p = buildCoverLetterPrompt(s, makeCoverLetter({ view_id: 'gone' } as never), 'en')
    expect(p).toContain('NorBAN')
  })

  it('states the applicant title, trimmed', () => {
    expect(buildCoverLetterPrompt(store(), makeCoverLetter(), 'en')).toContain('Architect')
    expect(buildCoverLetterPrompt(store({ title: { en: '  Architect  ' } }), makeCoverLetter(), 'en'))
      .not.toContain('  Architect')
  })

  it('caps the skill list rather than pasting a whole registry', () => {
    const s = store()
    s.skills = Array.from({ length: 45 }, (_, i) => makeSkill({ id: `s${i}`, name: { en: `Skill${i}` } }))
    const p = buildCoverLetterPrompt(s, makeCoverLetter(), 'en')
    expect(p).toContain('Skill39')
    expect(p).not.toContain('Skill40')
  })
})
