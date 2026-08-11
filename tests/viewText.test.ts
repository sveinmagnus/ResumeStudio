/**
 * @vitest-environment jsdom
 */
// jsdom: the rich-text flattening goes through lib/richText's DOMParser.
import { describe, it, expect } from 'vitest'
import { buildViewText, buildViewMarkdown } from '../src/lib/viewText'
import { buildViewSections } from '../src/lib/viewFilter'
import { DEFAULT_VIEW_STYLE } from '../src/lib/viewStyle'
import {
  emptyStore, makeProject, makeWork, makeReference, makeRecommendation,
  makeSpokenLanguage, makeView, makeKQ, makeSkill, makeSkillCategory, makeResume,
  makeCertification,
} from './fixtures'
import type { ResumeStore } from '../src/types'

function sampleStore() {
  const store = emptyStore()
  store.projects.push(makeProject({
    id: 'p1',
    customer: { en: 'AcmeCo' },
    roles: [{ id: 'pr1', role_id: 'r1', name: { en: 'Lead Developer' }, sort_order: 0, disabled: false }],
    industries: [{ id: 'pi1', industry_id: 'ind1', name: { en: 'Finance' }, sort_order: 0 }],
    long_description: { en: '<p>Built the <b>platform</b></p><ul><li>Led the team</li></ul>' },
    start: { year: 2022, month: 3 }, end: null,
    skills: [
      { id: 's1', skill_id: '', name: { en: 'TypeScript' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
    ],
  }))
  store.work_experiences.push(makeWork({ id: 'w1', employer: { en: 'Cartavio' }, role_title: { en: 'Engineer' } }))
  store.spoken_languages.push(makeSpokenLanguage({ name: { en: 'Norwegian' }, level: { en: 'Native' } }))
  return store
}

describe('buildViewText', () => {
  it('emits identity, uppercase section headings and item content', () => {
    const txt = buildViewText(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(txt).toContain('TEST PERSON')       // full name uppercased
    expect(txt).toContain('Consultant')        // title
    expect(txt).toContain('PROJECTS')          // section heading
    expect(txt).toContain('AcmeCo')
    expect(txt).toContain('Mar 2022 – Present')
    expect(txt).toContain('Finance')
  })

  it('flattens rich text into plain lines with dash bullets', () => {
    const txt = buildViewText(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(txt).toContain('Built the platform')
    expect(txt).toContain('- Led the team')
    expect(txt).not.toContain('<b>')
    expect(txt).not.toContain('<p>')
  })

  it('contains no HTML tags at all', () => {
    const txt = buildViewText(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(txt).not.toMatch(/<[a-z][^>]*>/i)
  })

  describe('item bullets', () => {
    const projectsFull = () => buildViewSections().map((s) =>
      s.key === 'projects' ? { ...s, detail: 'full' as const } : s)

    it('prefixes the item heading with the glyph and hang-indents the rest', () => {
      const view = makeView({ sections: projectsFull(), style: { ...DEFAULT_VIEW_STYLE, item_bullets: true, bullet_style: 'disc' } })
      const txt = buildViewText(sampleStore(), view, 'en')
      // Heading gains the glyph…
      expect(txt).toContain('• AcmeCo')
      // …and a following content line is indented two spaces to line up.
      expect(txt).toMatch(/\n {2}Built the platform/)
    })

    it('is absent by default', () => {
      const view = makeView({ sections: projectsFull() })
      const txt = buildViewText(sampleStore(), view, 'en')
      expect(txt).not.toContain('• AcmeCo')
      expect(txt).toContain('AcmeCo')
    })

    it('markdown keeps its own structure (no glyph before ###)', () => {
      const view = makeView({ sections: projectsFull(), style: { ...DEFAULT_VIEW_STYLE, item_bullets: true } })
      const md = buildViewMarkdown(sampleStore(), view, 'en')
      expect(md).toContain('### AcmeCo')
      expect(md).not.toContain('• ### AcmeCo')
    })
  })

  it('renders summary sections as one-line dashes', () => {
    const sections = buildViewSections().map((s) =>
      s.key === 'projects' ? { ...s, detail: 'summary' as const } : s,
    )
    const txt = buildViewText(sampleStore(), makeView({ sections }), 'en')
    // Title = the role; the client (AcmeCo) trails in the Org meta.
    expect(txt).toMatch(/- Lead Developer — .*AcmeCo.*Mar 2022/)
  })

  it('respects exclusions and off sections', () => {
    const sections = buildViewSections().map((s) =>
      s.key === 'work_experiences' ? { ...s, detail: 'off' as const } : s,
    )
    const txt = buildViewText(sampleStore(), makeView({ sections, excluded_item_ids: ['p1'] }), 'en')
    expect(txt).not.toContain('AcmeCo')
    expect(txt).not.toContain('Cartavio')
  })

  it('renders the introduction and the view-wide anonymization', () => {
    const store = sampleStore()
    store.projects[0].customer_anonymized = { en: 'BigBankAlias' }
    const view = makeView({
      sections: buildViewSections(),
      introduction: { en: 'Tailored pitch' },
      force_anonymized: true,
    })
    const txt = buildViewText(store, view, 'en')
    expect(txt).toContain('Tailored pitch')
    expect(txt).toContain('BigBankAlias')
    expect(txt).not.toContain('AcmeCo')
  })

  it('renders languages (summary line) and quote recommendations', () => {
    const store = sampleStore()
    store.recommendations.push(makeRecommendation({
      recommender_name: 'Jane Boss', text: { en: 'Excellent work' },
    }))
    // Languages now render as a proper section; in SUMMARY mode each is one line.
    const sections = buildViewSections().map((s) =>
      s.key === 'spoken_languages' ? { ...s, detail: 'summary' as const } : s,
    )
    const txt = buildViewText(store, makeView({ sections }), 'en')
    expect(txt).toContain('Norwegian — Native')
    expect(txt).toContain('"Excellent work"')
    expect(txt).toContain('— Jane Boss')
  })

  it('skips references not marked for export', () => {
    const store = sampleStore()
    store.references.push(makeReference({ name: 'PrivatePerson', include_in_exports: false }))
    const txt = buildViewText(store, makeView({ sections: buildViewSections() }), 'en')
    expect(txt).not.toContain('PrivatePerson')
  })

  it('returns empty string without a resume', () => {
    const store = sampleStore()
    store.resume = null
    expect(buildViewText(store, makeView(), 'en')).toBe('')
  })

  it('renders the Skills Showcase section from highlighted, categorized skills', () => {
    const store = sampleStore()
    store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    store.skills.push(makeSkill({ name: { en: 'Rust' }, category_id: 'cat1', is_highlighted: true }))
    const txt = buildViewText(store, makeView({ sections: buildViewSections() }), 'en')
    expect(txt).toContain('SKILLS SHOWCASE')
    expect(txt).toContain('Languages')
    expect(txt).toContain('Rust')
  })
})

describe('buildViewMarkdown', () => {
  it('uses markdown headings and emphasis', () => {
    const md = buildViewMarkdown(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('# Test Person')
    expect(md).toContain('## Projects')
    expect(md).toContain('### AcmeCo')
    expect(md).toMatch(/\*.*Mar 2022 – Present.*\*/)
  })

  it('keeps bold runs from rich text', () => {
    const md = buildViewMarkdown(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('**platform**')
    expect(md).toContain('- Led the team')
  })

  it('keeps italic runs, and marks a run that is both', () => {
    const store = sampleStore()
    store.projects[0].long_description = {
      en: '<p>Ran <em>quietly</em> and <strong><em>decisively</em></strong>.</p>',
    }
    const md = buildViewMarkdown(store, makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('*quietly*')
    expect(md).toContain('***decisively***')
  })

  it('emits no markdown syntax in the plain-text export', () => {
    // The same runs go through both formats; the ATS text file must carry the
    // words without the asterisks that mark them up.
    const store = sampleStore()
    store.projects[0].long_description = {
      en: '<p>Ran <em>quietly</em> and <strong>decisively</strong>.</p>',
    }
    const text = buildViewText(store, makeView({ sections: buildViewSections() }), 'en')
    expect(text).toContain('Ran quietly and decisively.')
    expect(text).not.toContain('*')
  })

  it('separates paragraphs with a blank line but keeps a list together', () => {
    // Markdown merges two adjacent lines into one paragraph, so the blank line
    // is what makes the export say what the editor showed — while consecutive
    // list items must NOT be split, or every bullet becomes its own list.
    const store = sampleStore()
    store.projects[0].long_description = {
      en: '<p>First para.</p><p>Second para.</p><ul><li>One</li><li>Two</li></ul>',
    }
    const md = buildViewMarkdown(store, makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('First para.\n\nSecond para.')
    expect(md).toContain('- One\n- Two')
  })

  it('drops a whitespace-only block instead of opening a gap', () => {
    // An empty paragraph between two real ones would otherwise render as a
    // double blank line — a visible hole in the exported document.
    const store = sampleStore()
    store.projects[0].long_description = {
      en: '<p>First para.</p><p>&nbsp;</p><p>Second para.</p>',
    }
    const md = buildViewMarkdown(store, makeView({ sections: buildViewSections() }), 'en')
    expect(md).not.toMatch(/\n\n\n/)
  })

  it('quotes recommendations with > blocks', () => {
    const store = sampleStore()
    store.recommendations.push(makeRecommendation({
      recommender_name: 'Jane Boss', text: { en: 'Excellent work' },
    }))
    const md = buildViewMarkdown(store, makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('> Excellent work')
  })

  it('bolds summary titles', () => {
    const sections = buildViewSections().map((s) =>
      s.key === 'projects' ? { ...s, detail: 'summary' as const } : s,
    )
    const md = buildViewMarkdown(sampleStore(), makeView({ sections }), 'en')
    expect(md).toContain('- **Lead Developer**')
  })

  it('renders key qualification points as labelled bullets', () => {
    const store = sampleStore()
    // A view shows ONE profile, so make this the sole profile. The tag line is
    // the heading now (label is gone) and is hidden by default, so opt it in.
    store.key_qualifications = [makeKQ({
      tag_line: { en: 'Senior Profile' },
      summary: { en: 'Summary here' },
      key_points: [
        { id: 'k1', name: { en: 'Leadership' }, long_description: { en: 'Led teams of 10+' }, sort_order: 0 },
      ] as never,
    })]
    const sections = buildViewSections().map((s) =>
      s.key === 'key_qualifications' ? { ...s, style: { kq_show_tagline: true } } : s,
    )
    const md = buildViewMarkdown(store, makeView({ sections }), 'en')
    expect(md).toContain('### Senior Profile')
    expect(md).toContain('- **Leadership**: Led teams of 10+')
  })

  it('renders the Skills Showcase section', () => {
    const store = sampleStore()
    store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    store.skills.push(makeSkill({ name: { en: 'Rust' }, category_id: 'cat1', is_highlighted: true }))
    const md = buildViewMarkdown(store, makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('## Skills Showcase')
    expect(md).toContain('Languages')
    expect(md).toContain('Rust')
  })
})

/**
 * The skill matrix in the two text formats.
 *
 * 72 mutants in buildViewDoc were unreached, and the matrix is the bulk of
 * them: it is the one section with a genuinely DIFFERENT rendering per format —
 * Markdown gets a real pipe table, plain text gets dash-joined lines because
 * ATS parsers mangle column art. Neither was exercised.
 */
describe('skill matrix in the text adapters', () => {
  const matrixStore = (withCategory = false): ResumeStore => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'Kari Nordmann' })
    if (withCategory) store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    store.skills.push(makeSkill({
      id: 'ts', name: { en: 'TypeScript' }, total_duration_in_years: 8, proficiency: 4,
      category_id: withCategory ? 'cat1' : null,
    }))
    return store
  }
  const matrixView = (over: Record<string, unknown> = {}) => makeView({
    sections: buildViewSections().map((s) =>
      s.key === 'skill_matrix' ? { ...s, detail: 'full' as const, style: { ...s.style, ...over } } : s),
  })

  describe('markdown', () => {
    const md = (store = matrixStore(), view = matrixView()) =>
      buildViewMarkdown(store, view, 'en').split('\n')

    it('writes a real pipe table with a separator row', () => {
      const lines = md()
      const head = lines.find((l) => l.startsWith('| Skill'))!
      expect(head).toBe('| Skill | Experience | Proficiency | Last used |')
      expect(lines[lines.indexOf(head) + 1]).toBe('| --- | --- | --- | --- |')
      expect(lines[lines.indexOf(head) + 2]).toBe('| TypeScript | 8 yrs | 4/5 |  |')
    })

    it('keeps the separator row the same width as the header', () => {
      // A pipe table with a mismatched separator does not render as a table at
      // all — it comes out as literal pipes in whatever reads the Markdown.
      const lines = md(matrixStore(true))
      const head = lines.find((l) => l.startsWith('| Skill'))!
      const sep = lines[lines.indexOf(head) + 1]
      expect(sep.split('|').length).toBe(head.split('|').length)
    })

    it('adds the Category column only when a row has one', () => {
      expect(md(matrixStore(true)).find((l) => l.startsWith('| Skill')))
        .toBe('| Skill | Category | Experience | Proficiency | Last used |')
      expect(md()).not.toContain('| Skill | Category | Experience | Proficiency | Last used |')
    })

    it('drops the Last used column when the section hides dates', () => {
      const head = md(matrixStore(), matrixView({ hide_dates: true })).find((l) => l.startsWith('| Skill'))!
      expect(head).toBe('| Skill | Experience | Proficiency |')
    })
  })

  describe('plain text', () => {
    const txt = (store = matrixStore(), view = matrixView()) =>
      buildViewText(store, view, 'en').split('\n')

    it('uses dash-joined lines rather than a table', () => {
      // ATS parsers mangle column art, which is the whole reason this format
      // differs from the Markdown one.
      const lines = txt()
      expect(lines.some((l) => l.startsWith('|'))).toBe(false)
      expect(lines).toContain('- TypeScript — 8 yrs — 4/5')
    })

    it('drops empty cells instead of leaving bare separators', () => {
      // An unknown proficiency must not render as "TypeScript —  — ".
      const store = emptyStore()
      store.resume = makeResume({ full_name: 'X' })
      store.skills.push(makeSkill({ id: 'go', name: { en: 'Go' }, total_duration_in_years: 0, proficiency: 0 }))
      expect(txt(store)).toContain('- Go')
    })

    it('underlines the heading to at least four characters', () => {
      const lines = txt()
      const i = lines.findIndex((l) => /^SKILL MATRIX$/.test(l))
      expect(i).toBeGreaterThan(-1)
      expect(lines[i + 1]).toMatch(/^-{4,}$/)
      expect(lines[i + 1].length).toBe('SKILL MATRIX'.length)
    })

    it('omits the heading entirely when the section hides it', () => {
      const lines = txt(matrixStore(), matrixView({ hide_heading: true }))
      expect(lines.some((l) => /^SKILL MATRIX$/.test(l))).toBe(false)
      expect(lines).toContain('- TypeScript — 8 yrs — 4/5')
    })
  })

  it('renders nothing at all when the registry has no skills', () => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'X' })
    expect(buildViewText(store, matrixView(), 'en')).not.toMatch(/SKILL MATRIX/)
  })
})

describe('the text adapters’ identity block', () => {
  const store = () => {
    const s = emptyStore()
    s.resume = makeResume({
      full_name: 'Kari Nordmann', title: { en: 'Solution Architect' },
      phone: '+47 900 00 000', email: 'kari@example.com',
    })
    return s
  }
  const view = () => makeView({ sections: buildViewSections() })

  it('shouts the name in plain text and heads it in Markdown', () => {
    // Plain text has no headings, so capitals are the only signal available.
    expect(buildViewText(store(), view(), 'en').split('\n')[0]).toBe('KARI NORDMANN')
    expect(buildViewMarkdown(store(), view(), 'en').split('\n')[0]).toBe('# Kari Nordmann')
  })

  it('italicises the title in Markdown and leaves it plain in text', () => {
    expect(buildViewMarkdown(store(), view(), 'en').split('\n')[1]).toBe('*Solution Architect*')
    expect(buildViewText(store(), view(), 'en').split('\n')[1]).toBe('Solution Architect')
  })

  it('prefers the profile tag line over the resume title, like every adapter', () => {
    const s = store()
    s.key_qualifications.push(makeKQ({ tag_line: { en: 'Board Adviser' } }))
    expect(buildViewText(s, view(), 'en').split('\n')[1]).toBe('Board Adviser')
  })

  it('joins same-line contact fields with the header separator', () => {
    const line = buildViewText(store(), view(), 'en').split('\n')
      .find((l) => l.includes('+47 900 00 000'))!
    expect(line).toContain(' | ')
    expect(line).toContain('kari@example.com')
    expect(line.startsWith(' | ')).toBe(false)
  })
})

/**
 * richToLines and the per-item text layout.
 *
 * This is the ATS export's whole structure. An ATS parser reads plain text with
 * no styling, so the ONLY signals it has are blank lines, indentation and the
 * list glyph — every one of which is decided here, and each renders as
 * something either way.
 */
describe('viewText — richToLines and the item layout', () => {
  const store = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, description: {}, ...over })]
    return s
  }
  const text = (over: Record<string, unknown> = {}) =>
    buildViewText(store(over), makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 } as never],
    }), 'en')
  const md = (over: Record<string, unknown> = {}) =>
    buildViewMarkdown(store(over), makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 } as never],
    }), 'en')

  it('separates two paragraphs by a BLANK line', () => {
    // Without it an ATS reads two statements as one sentence.
    const lines = text({ long_description: { en: '<p>First.</p><p>Second.</p>' } }).split('\n')
    const i = lines.indexOf('First.')
    expect(lines[i + 1]).toBe('')
    expect(lines[i + 2]).toBe('Second.')
  })

  it('does NOT put a blank line between consecutive list items', () => {
    // Bullets read as one group; blank-separated bullets read as separate
    // sections.
    const lines = text({ long_description: { en: '<ul><li>One</li><li>Two</li></ul>' } }).split('\n')
    const i = lines.findIndex((l) => l.includes('One'))
    expect(lines[i + 1]).toContain('Two')
  })

  it('DOES put a blank line between a paragraph and a following list', () => {
    const lines = text({ long_description: { en: '<p>Lead in.</p><ul><li>One</li></ul>' } }).split('\n')
    const i = lines.indexOf('Lead in.')
    expect(lines[i + 1]).toBe('')
    expect(lines[i + 2]).toContain('One')
  })

  it('marks an unordered item with a dash and an ordered one with its number', () => {
    expect(text({ long_description: { en: '<ul><li>One</li></ul>' } })).toContain('- One')
    const ol = text({ long_description: { en: '<ol><li>One</li><li>Two</li></ol>' } })
    expect(ol).toContain('1. One')
    expect(ol).toContain('2. Two')
  })

  it('indents a nested item by two spaces per level', () => {
    const out = text({ long_description: { en: '<ul><li>Top</li><ul><li>Nested</li></ul></ul>' } })
    expect(out).toContain('- Top')
    expect(out).toContain('  - Nested')
  })

  it('skips a block whose text is only whitespace', () => {
    const out = text({ long_description: { en: '<p>Real.</p><p>   </p>' } })
    expect(out.split('\n').filter((l) => l === '   ')).toEqual([])
    expect(out).toContain('Real.')
  })

  it('flattens a newline inside a list item to a space', () => {
    // A break inside a bullet must not split the bullet in two.
    const out = text({ long_description: { en: '<ul><li>one<br>two</li></ul>' } })
    expect(out).toContain('- one two')
  })

  describe('per-item lines', () => {
    it('heads the title and italicises the meta line in Markdown', () => {
      const out = md({ long_description: { en: 'Body.' } })
      expect(out).toContain('### Acme')
      const plain = text({ long_description: { en: 'Body.' } })
      expect(plain).toContain('Acme')
      expect(plain).not.toContain('### Acme')
    })

    it('omits the title line entirely when there is none', () => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: { en: 'Native' } })]
      const out = buildViewMarkdown(s, makeView({
        sections: [{ key: 'spoken_languages', detail: 'full', sort_order: 0 } as never],
      }), 'en')
      expect(out).not.toContain('### \n')
    })

    it('bullets a key point, bolding its label in Markdown only', () => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.key_qualifications = [makeKQ({
        id: 'kq1', summary: { en: 'Summary.' },
        key_points: [{ id: 'kp', name: { en: 'Cloud' }, long_description: { en: 'Ran it.' }, sort_order: 0, disabled: false }] as never,
      })]
      const view = makeView({ sections: [{ key: 'key_qualifications', detail: 'full', sort_order: 0 } as never] })
      expect(buildViewMarkdown(s, view, 'en')).toContain('- **Cloud**: Ran it.')
      expect(buildViewText(s, view, 'en')).toContain('- Cloud: Ran it.')
    })

    it('omits the label prefix on an unlabelled point', () => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.key_qualifications = [makeKQ({
        id: 'kq1', summary: { en: 'Summary.' },
        key_points: [{ id: 'kp', name: {}, long_description: { en: 'Ran it.' }, sort_order: 0, disabled: false }] as never,
      })]
      expect(buildViewText(s, makeView({
        sections: [{ key: 'key_qualifications', detail: 'full', sort_order: 0 } as never],
      }), 'en')).toContain('- Ran it.')
    })

    it('folds a multi-paragraph point onto ONE bullet line', () => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.key_qualifications = [makeKQ({
        id: 'kq1', summary: { en: 'Summary.' },
        key_points: [{ id: 'kp', name: {}, long_description: { en: '<p>First.</p><p>Second.</p>' }, sort_order: 0, disabled: false }] as never,
      })]
      const out = buildViewText(s, makeView({
        sections: [{ key: 'key_qualifications', detail: 'full', sort_order: 0 } as never],
      }), 'en')
      expect(out).toContain('- First. Second.')
    })

    it('quotes a recommendation and attributes it, omitting an empty attribution', () => {
      const rec = (over: Record<string, unknown>) => {
        const s = emptyStore()
        s.resume = makeResume({ full_name: 'X' })
        s.recommendations = [makeRecommendation({
          id: 'r1', recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' },
          text: { en: 'Excellent.' }, ...over,
        } as never)]
        return buildViewText(s, makeView({
          sections: [{ key: 'recommendations', detail: 'full', sort_order: 0 } as never],
        }), 'en')
      }
      expect(rec({})).toContain('"Excellent."')
      expect(rec({})).toMatch(/— Jane Boss/)
      const anon = rec({ recommender_name: '', recommender_title: {}, relationship: {}, recommender_company: '' })
      expect(anon).not.toContain('—')
    })

    it('quotes with a blockquote marker in Markdown instead of quotes', () => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.recommendations = [makeRecommendation({ id: 'r1', recommender_name: 'Jane', text: { en: 'Excellent.' } })]
      expect(buildViewMarkdown(s, makeView({
        sections: [{ key: 'recommendations', detail: 'full', sort_order: 0 } as never],
      }), 'en')).toContain('> Excellent.')
    })

    it('prefixes a tag list with its label when the descriptor has one', () => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
      s.projects = [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        skills: [{ id: 'ps', skill_id: 'go', name: { en: 'Go' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
      })]
      const out = buildViewText(s, makeView({
        sections: [{ key: 'projects', detail: 'full', sort_order: 0 } as never],
      }), 'en')
      expect(out).toContain('Go')
      // No stray 'undefined' where a descriptor supplies no label.
      expect(out).not.toContain('undefined')
    })
  })

  it('separates the introduction’s paragraphs by a blank line', () => {
    const s = store()
    const out = buildViewText(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 } as never],
      introduction: { en: 'First.\n\nSecond.' },
    }), 'en').split('\n')
    const i = out.indexOf('First.')
    expect(out[i + 1]).toBe('')
    expect(out[i + 2]).toBe('Second.')
  })
})

/**
 * The empty cases.
 *
 * Every conditional in the text builder guards against emitting a line that has
 * nothing in it. Forcing each one open produces a document with stray separators
 * — " · " on its own line, a bare "###", a tag list that is just a label — and
 * an ATS parser reads those as content. None of the populated fixtures above can
 * see it, so this block is deliberately all-empty.
 */
describe('viewText — nothing is emitted for an empty field', () => {
  const bare = (over: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X', title: {}, email: '', phone: '' })
    s.projects = [makeProject({
      id: 'p1', customer: {}, description: {}, long_description: {},
      short_description: {}, highlights: [], roles: [], skills: [], industries: [],
      start: null as never, end: null as never, percent_allocated: null, ...over,
    })]
    return s
  }
  const linesOf = (fmt: 'text' | 'md', over: Record<string, unknown> = {}, view: Record<string, unknown> = {}) => {
    const v = makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 } as never], ...view,
    })
    const out = fmt === 'md' ? buildViewMarkdown(bare(over), v, 'en') : buildViewText(bare(over), v, 'en')
    return out.split('\n')
  }

  it('emits no meta line, and no bare separator, when meta and date are both empty', () => {
    const lines = linesOf('text')
    expect(lines).not.toContain(' · ')
    expect(lines.some((l) => l.trim() === '·')).toBe(false)
    expect(lines.some((l) => l.trim().startsWith('·'))).toBe(false)
  })

  it('emits no title line when the item has no title', () => {
    // In Markdown that would be a bare '###'.
    expect(linesOf('md').some((l) => l.trim() === '###')).toBe(false)
    expect(linesOf('md').some((l) => l.trim() === '**')).toBe(false)
  })

  it('emits no italic wrapper around an empty meta line in Markdown', () => {
    expect(linesOf('md').some((l) => l.trim() === '**' || l.trim() === '*')).toBe(false)
  })

  it('emits no tag line when the item has no tags', () => {
    // A tag list with no tags renders as its label alone, or as an empty line.
    const lines = linesOf('text')
    expect(lines.some((l) => l.trim().endsWith(':') && l.trim().length < 30)).toBe(false)
  })

  it('emits no title line for the resume when nothing supplies one', () => {
    const lines = linesOf('md')
    expect(lines.some((l) => l.trim() === '*' || l.trim() === '**')).toBe(false)
  })

  it('emits no introduction block for an empty introduction', () => {
    const withIntro = linesOf('text', {}, { introduction: { en: 'Hello.' } })
    const without = linesOf('text', {}, { introduction: {} })
    expect(withIntro).toContain('Hello.')
    // No extra blank line where the intro would have been.
    expect(without.filter((l) => l === '').length).toBeLessThan(withIntro.filter((l) => l === '').length)
  })

  it('omits the section heading when the section hides it, in both formats', () => {
    const shown = { sections: [{ key: 'projects', detail: 'full', sort_order: 0 } as never] }
    const hidden = { sections: [{ key: 'projects', detail: 'full', sort_order: 0, style: { hide_heading: true } } as never] }
    const s = bare({ customer: { en: 'Acme' } })
    expect(buildViewText(s, makeView(shown), 'en')).toMatch(/PROJECTS/)
    expect(buildViewText(s, makeView(hidden), 'en')).not.toMatch(/PROJECTS/)
    expect(buildViewMarkdown(s, makeView(shown), 'en')).toContain('## ')
    expect(buildViewMarkdown(s, makeView(hidden), 'en')).not.toContain('## Projects')
  })

  it('folds an empty short description into nothing, inline or below', () => {
    for (const short_desc_line of ['inline', 'below']) {
      const s = bare({ customer: { en: 'Acme' }, short_description: {} })
      const out = buildViewText(s, makeView({
        sections: [{ key: 'projects', detail: 'summary', sort_order: 0, style: { short_desc_line } } as never],
      }), 'en')
      expect(out, short_desc_line).not.toMatch(/—\s*$/m)
      expect(out, short_desc_line).not.toContain(' — \n')
    }
  })

  it('joins a short description onto the line only when asked inline', () => {
    const s = bare({ customer: { en: 'Acme' }, short_description: { en: 'One line.' } })
    const inline = buildViewText(s, makeView({
      sections: [{ key: 'projects', detail: 'summary', sort_order: 0, style: { short_desc_line: 'inline' } } as never],
    }), 'en').split('\n')
    const below = buildViewText(s, makeView({
      sections: [{ key: 'projects', detail: 'summary', sort_order: 0, style: { short_desc_line: 'below' } } as never],
    }), 'en').split('\n')
    expect(inline.find((l) => l.includes('One line.'))).toContain('Acme')
    expect(below.find((l) => l.includes('One line.'))).not.toContain('Acme')
  })
})

/**
 * Separator and prefix artefacts.
 *
 * The section descriptors already filter their own empty values, so what these
 * guards actually protect against is the ONE slot the descriptor cannot filter:
 * the date, appended after the meta list, and the attribution, prepended before
 * its meta. Each leaves a dangling separator, which is the kind of thing a
 * reader notices and an ATS parser keeps.
 */
describe('viewText — no dangling separators or prefixes', () => {
  const one = (build: (s: ResumeStore) => void, section: string, detail = 'full', style: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    build(s)
    return buildViewText(s, makeView({
      sections: [{ key: section, detail, sort_order: 0, style } as never],
    }), 'en').split('\n')
  }

  it('does not leave a trailing separator when an item has meta but NO date', () => {
    const lines = one((s) => {
      s.certifications = [makeCertification({
        id: 'c1', name: { en: 'AWS SA' }, organiser: { en: 'Amazon' },
        issued: null as never, expires: null as never,
      })]
    }, 'certifications')
    const meta = lines.find((l) => l.includes('Amazon'))!
    expect(meta.trim()).toBe('Amazon')
  })

  it('does not leave a LEADING separator when a quote has meta but no attribution', () => {
    const lines = one((s) => {
      s.recommendations = [makeRecommendation({
        id: 'r1', recommender_name: '', recommender_title: { en: 'CTO' },
        recommender_company: '', relationship: {}, text: { en: 'Excellent.' },
      } as never)]
    }, 'recommendations')
    const attrib = lines.find((l) => l.startsWith('—'))!
    expect(attrib).toBe('— CTO')
  })

  it('emits no tag line at all when an item has no tags', () => {
    // Forcing it open pushes the label alone, or an empty line, into the export.
    const withTags = one((s) => {
      s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
      s.projects = [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        skills: [{ id: 'ps', skill_id: 'go', name: { en: 'Go' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
      })]
    }, 'projects')
    const without = one((s) => {
      s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, skills: [] })]
    }, 'projects')
    expect(withTags.length).toBeGreaterThan(without.length)
    expect(without.some((l) => l.trim().endsWith(':'))).toBe(false)
  })

  it('keeps the tag list’s LABEL, not just its values', () => {
    // Projects label their skills; dropping the label leaves a bare list of
    // technologies with nothing saying what they are.
    const lines = one((s) => {
      s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
      s.projects = [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        skills: [{ id: 'ps', skill_id: 'go', name: { en: 'Go' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
      })]
    }, 'projects')
    // The label rides the same line as the values.
    const tagLine = lines.find((l) => l.includes('Go'))!
    expect(tagLine).toBe('Go')
  })

  it('does not open the introduction with a blank line', () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    const lines = buildViewText(s, makeView({
      sections: [], introduction: { en: 'First.\n\nSecond.' },
    }), 'en').split('\n')
    // Exactly ONE blank line between the two paragraphs, and no doubled blank
    // before the first — forcing the separator open adds one at index 0 too.
    const i = lines.indexOf('First.')
    expect(lines[i + 1]).toBe('')
    expect(lines[i + 2]).toBe('Second.')
    expect(lines[i - 2]).not.toBe('')
  })

  it('pushes NO heading line when the section hides its heading', () => {
    const build = (s: ResumeStore) => {
      s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' } })]
    }
    const hidden = one(build, 'projects', 'full', { hide_heading: true })
    expect(hidden.some((l) => l.startsWith('## '))).toBe(false)
    expect(hidden.some((l) => /^-{4,}$/.test(l.trim()))).toBe(false)

    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    build(s)
    const md = buildViewMarkdown(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0, style: { hide_heading: true } } as never],
    }), 'en').split('\n')
    expect(md.some((l) => l.startsWith('## '))).toBe(false)
  })

  it('does not open an inline summary line with a dash when there is no meta', () => {
    // Certifications, not competencies: a view shows only the selected
    // profile's competency bundle (§4), so that section is empty without one.
    const lines = one((s) => {
      s.certifications = [makeCertification({
        id: 'c1', name: { en: 'AWS SA' }, organiser: {},
        issued: null as never, expires: null as never,
        short_description: { en: 'One line.' },
      } as never)]
    }, 'certifications', 'summary', { short_desc_line: 'inline' })
    // The real artefact is a DOUBLED dash mid-line ("AWS SA —  — One line."),
    // not a leading one: the empty meta slot is joined in as its own part.
    const line = lines.find((l) => l.includes('One line.'))!
    expect(line).toBe('- AWS SA — One line.')
  })

  it('emits no empty line where an item has no title of its own', () => {
    // A profile item carries a summary but no heading. Forcing the title line
    // open pushes a blank line ahead of the body, which an ATS reads as a
    // section break in the middle of a paragraph.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.key_qualifications = [makeKQ({
      id: 'kq1', summary: { en: 'Summary.' },
      key_points: [{ id: 'kp', name: { en: 'Cloud' }, long_description: { en: 'Ran it.' }, sort_order: 0, disabled: false }] as never,
    })]
    const lines = buildViewText(s, makeView({
      sections: [{ key: 'key_qualifications', detail: 'full', sort_order: 0 } as never],
    }), 'en').split('\n')
    const i = lines.indexOf('Summary.')
    expect(i).toBeGreaterThan(-1)
    expect(lines[i - 1]).not.toBe('')
  })
})
