/**
 * @vitest-environment jsdom
 *
 * jsdom: the scanned prose goes through richToPlain, which parses markup via
 * DOMParser.
 */
import { describe, it, expect } from 'vitest'
import { redundancyReport, dupDismissKey } from '../src/lib/redundancy'
import {
  emptyStore, makeProject, makeWork, makeKQ, makeKeyCompetency, makePosition,
} from './fixtures'
import type { ResumeStore } from '../src/types'

// Fixed "now" so snooze checks are deterministic.
const NOW = new Date('2026-06-15T00:00:00Z')

const report = (store: ResumeStore, dismissals?: Record<string, string>, now: Date = NOW) =>
  redundancyReport(store, 'en', dismissals, now)

// 12 tokens — comfortably over the 8-token sentence floor.
const SHARED = 'Designed and delivered a scalable event driven integration platform for the customer.'

/** A project and an employment sharing SHARED inside longer texts. */
const sharedPair = (): ResumeStore => {
  const s = emptyStore()
  s.projects = [makeProject({
    id: 'p1', customer: { en: 'Acme' },
    long_description: { en: `Intro line first. ${SHARED}` },
  })]
  s.work_experiences = [makeWork({
    id: 'w1', employer: { en: 'BigCo' },
    long_description: { en: `${SHARED} More text after.` },
  })]
  return s
}

describe('redundancyReport — exact sentence duplicates', () => {
  it('flags the same sentence appearing in two different items, quoting it', () => {
    const r = report(sharedPair())
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]
    expect(f.kind).toBe('sentence')
    expect(f.locale).toBe('en')
    expect(f.detail).toBe(SHARED)
    expect(f.a).toEqual({ section: 'projects', itemId: 'p1', itemLabel: 'Acme', fieldLabel: 'Long description' })
    expect(f.b).toMatchObject({ section: 'work_experiences', itemId: 'w1', itemLabel: 'BigCo' })
    expect(f.dismissKey).toBe('dup:projects:p1:work_experiences:w1')
  })

  it('never compares fields of the SAME item — a summary restating itself is by design', () => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: SHARED }, highlights: [{ en: SHARED }] })]
    const r = report(s)
    expect(r.findings).toEqual([])
    expect(r.comparedFields).toBe(2)
  })

  it('ignores short sentences — boilerplate repeats honestly', () => {
    const SHORT = 'Delivered the platform on time.'
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: SHORT } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: SHORT } })]
    expect(report(s).findings).toEqual([])
  })

  it('matches despite punctuation and casing differences, quoting an original', () => {
    const a = 'Delivered the platform, on time and under budget, for the client.'
    const b = 'delivered the platform on time and under budget for the client'
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: a } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: b } })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    // The longer original is the quoted one.
    expect(r.findings[0].detail).toBe(a)
  })

  it('trims a very long quoted sentence to 120 chars with an ellipsis', () => {
    const LONG_SENT = 'Architected implemented and documented the complete organisation wide monitoring alerting and incident response capability spanning every production system and team.'
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: LONG_SENT } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: LONG_SENT } })]
    const detail = report(s).findings[0].detail
    expect(detail.length).toBeLessThanOrEqual(120)
    expect(detail.endsWith('…')).toBe(true)
    expect(detail.startsWith('Architected implemented and documented')).toBe(true)
  })
})

describe('redundancyReport — near-duplicate sentences', () => {
  // 13 distinct tokens; B changes one word (Jaccard 12/14 ≈ 0.86), C changes
  // three (10/16 ≈ 0.63).
  const A = 'Designed built and operated the national payment clearing platform for seven European banks.'
  const B = 'Designed built and operated the national payment clearing platform for nine European banks.'
  const C = 'Designed built and operated the regional card settlement platform for seven European banks.'

  const pair = (x: string, y: string): ResumeStore => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: x } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: y } })]
    return s
  }

  it('flags a sentence with a single word changed', () => {
    const r = report(pair(A, B))
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].kind).toBe('sentence')
    // The longer of the two originals is quoted.
    expect(r.findings[0].detail).toBe(A)
  })

  it('stays quiet once enough words differ', () => {
    expect(report(pair(A, C)).findings).toEqual([])
  })

  it('skips the near-match pass on a very large corpus — exact matches still found', () => {
    // 2000 filler sentences (9 tokens each) push the index over the cap.
    const filler = Array.from(
      { length: 2000 },
      (_, i) => `Filler alpha bravo charlie delta echo foxtrot golf token${i}.`,
    ).join(' ')
    const s = pair(A, B)
    s.projects.push(makeProject({ id: 'big', long_description: { en: filler } }))
    s.positions = [makePosition({ id: 'x1', description: { en: SHARED } })]
    s.key_competencies = [makeKeyCompetency({ id: 'kc1', description: { en: SHARED } })]
    const r = report(s)
    // The A/B near-pair is no longer found; the exact SHARED pair still is.
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].kind).toBe('sentence')
    expect(r.findings[0].dismissKey).toBe('dup:key_competencies:kc1:positions:x1')
  })
})

describe('redundancyReport — field-level near-copies', () => {
  // 27 tokens — over the 25-token field floor; each sentence is over the
  // 8-token sentence floor too, so sentence hits compete with the field hit.
  const LONG = 'Led the modernisation programme for the retail banking platform. ' +
    'Migrated forty legacy services to a managed cloud runtime. ' +
    'Introduced automated quality gates across every delivery pipeline stage.'

  it('reports two near-identical fields as ONE field finding that beats its sentence hits', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: { en: LONG } }),
      makeProject({ id: 'p2', customer: { en: 'Beta' }, long_description: { en: LONG } }),
    ]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].kind).toBe('field')
    expect(r.findings[0].detail).toBe('The two descriptions share 100% of their phrasing.')
  })

  it('stays quiet for two long but unrelated fields', () => {
    const OTHER = 'Coordinated the compliance audit for a public sector client. ' +
      'Facilitated workshops with domain experts and regulators. ' +
      'Documented findings and remediation plans across three departments in detail.'
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p1', long_description: { en: LONG } }),
      makeProject({ id: 'p2', long_description: { en: OTHER } }),
    ]
    expect(report(s).findings).toEqual([])
  })

  it('sorts field findings before sentence findings', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p1', customer: { en: 'Alpha' }, long_description: { en: LONG } }),
      makeProject({ id: 'p2', customer: { en: 'Bravo' }, long_description: { en: LONG } }),
      makeProject({ id: 'p3', customer: { en: 'Yankee' }, long_description: { en: SHARED } }),
    ]
    s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Zulu' }, long_description: { en: SHARED } })]
    const r = report(s)
    expect(r.findings.map((f) => [f.kind, f.a.itemLabel])).toEqual([
      ['field', 'Alpha'],
      ['sentence', 'Yankee'],
    ])
  })
})

describe('redundancyReport — collapsing per item pair', () => {
  it('keeps one finding per pair, quoting the LONGEST shared sentence', () => {
    // Two shared sentences; total tokens stay under the field floor so only
    // the sentence pass runs.
    const S1 = 'Delivered the customer portal rebuild across web and mobile channels together.'
    const S2 = 'Coordinated three distributed feature teams through weekly release trains and quarterly planning cycles.'
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: `${S1} ${S2}` } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: `${S1} ${S2}` } })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].detail).toBe(S2)
  })
})

describe('redundancyReport — locales', () => {
  it('finds a duplicate present only in a secondary locale, and reports that locale', () => {
    // 12 tokens in Norwegian; the English sides differ.
    const NO_SHARED = 'Ansvarlig for utvikling og drift av bankens nye kundeportal gjennom hele perioden.'
    const s = emptyStore()
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Acme' },
      long_description: { en: 'Totally different english text here for now.', no: NO_SHARED },
    })]
    s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'BigCo' }, long_description: { no: NO_SHARED } })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].locale).toBe('no')
    expect(r.findings[0].detail).toBe(NO_SHARED)
    // Labels still resolve in the requested label locale.
    expect(r.findings[0].a.itemLabel).toBe('Acme')
    // (field, locale) texts with content: p1 en + p1 no + w1 no.
    expect(r.comparedFields).toBe(3)
  })
})

describe('redundancyReport — dismiss keys and snoozing', () => {
  it('orders the pair key (and a/b) the same whichever item comes first', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p-b', customer: { en: 'Beta' }, long_description: { en: SHARED } }),
      makeProject({ id: 'p-a', customer: { en: 'Alpha' }, long_description: { en: SHARED } }),
    ]
    const r = report(s)
    expect(r.findings[0].dismissKey).toBe('dup:projects:p-a:projects:p-b')
    expect(r.findings[0].a.itemId).toBe('p-a')
    expect(dupDismissKey('projects:p-b', 'projects:p-a'))
      .toBe(dupDismissKey('projects:p-a', 'projects:p-b'))
  })

  it('holds a snoozed pair back (labelled A ↔ B) until the snooze lapses', () => {
    const key = 'dup:projects:p1:work_experiences:w1'
    const r = report(sharedPair(), { [key]: '2026-09-01T00:00:00Z' })
    expect(r.findings).toEqual([])
    expect(r.snoozed).toEqual([{ key, label: 'Acme ↔ BigCo', until: '2026-09-01T00:00:00Z' }])

    const later = report(sharedPair(), { [key]: '2026-09-01T00:00:00Z' }, new Date('2026-09-02T00:00:00Z'))
    expect(later.findings).toHaveLength(1)
    expect(later.snoozed).toEqual([])
  })

  it('ignores an unparseable snooze date rather than hiding the pair forever', () => {
    const key = 'dup:projects:p1:work_experiences:w1'
    expect(report(sharedPair(), { [key]: 'not a date' }).findings).toHaveLength(1)
  })
})

describe('redundancyReport — the scanned pool', () => {
  it('counts every (field, locale) text with content, across all scanned sections', () => {
    const s = emptyStore()
    s.key_qualifications = [makeKQ({ summary: { en: 'A summary.', no: 'Et sammendrag.' } })]
    s.key_competencies = [makeKeyCompetency({ description: { en: 'A description.' } })]
    s.projects = [makeProject({
      long_description: { en: 'A long description.' },
      highlights: [{ en: 'A highlight.' }, {}],
    })]
    s.positions = [makePosition({ description: {} })]
    expect(report(s).comparedFields).toBe(5)
  })

  it('skips disabled items entirely', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p1', disabled: true, long_description: { en: SHARED } }),
      makeProject({ id: 'p2', long_description: { en: SHARED } }),
    ]
    const r = report(s)
    expect(r.findings).toEqual([])
    expect(r.comparedFields).toBe(1)
  })

  it('reports an empty store as empty', () => {
    expect(report(emptyStore())).toEqual({ findings: [], snoozed: [], comparedFields: 0 })
  })
})

// ─── Mutation-audit tripwires ────────────────────────────────────────────────
// Each case kills a mutant the first Stryker pass reported surviving.

describe('redundancyReport — boundaries and filters (mutation audit)', () => {
  it('disabled profiles, competencies, employments and positions are never scanned', () => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: SHARED } })]
    s.work_experiences = [makeWork({ disabled: true, long_description: { en: SHARED } })]
    s.positions = [makePosition({ disabled: true, description: { en: SHARED } })]
    s.key_competencies = [makeKeyCompetency({ disabled: true, description: { en: SHARED } })]
    s.key_qualifications = [makeKQ({ disabled: true, summary: { en: SHARED } })]
    const r = report(s)
    expect(r.findings).toEqual([])
    expect(r.comparedFields).toBe(1)
  })

  it('falls back to "Profile" / "Untitled role" labels when names are empty', () => {
    const s = emptyStore()
    s.key_qualifications = [makeKQ({ id: 'k1', label: {}, summary: { en: SHARED } })]
    s.positions = [makePosition({ id: 'pos1', name: {}, description: { en: SHARED } })]
    const labels = report(s).findings[0]
    expect([labels.a.itemLabel, labels.b.itemLabel].sort()).toEqual(['Profile', 'Untitled role'])
  })

  it('a sentence of exactly eight tokens is indexed — the floor is inclusive', () => {
    const eight = 'Built the platform for the retail customer group.'
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: eight } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: eight } })]
    expect(report(s).findings.map((f) => f.kind)).toEqual(['sentence'])
  })

  it('matches across casing and punctuation, and quotes the LONGER original', () => {
    const short = 'Delivered the new platform for the retail customer group.'
    const long = '"DELIVERED — the NEW platform, for the retail customer group!!!"'
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: short } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: long } })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].detail).toBe(long)
  })

  it('a near-match at exactly the 0.8 Jaccard threshold fires', () => {
    // 9 tokens each, 8 shared → intersection 8 / union 10 = 0.8 exactly.
    const a = 'Alpha bravo charlie delta echo foxtrot golf hotel india.'
    const b = 'Alpha bravo charlie delta echo foxtrot golf hotel juliet.'
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: a } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: b } })]
    expect(report(s).findings.map((f) => f.kind)).toEqual(['sentence'])
  })

  it('sentences that normalize to nothing are ignored, not crashed on', () => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: '!!! ??? ***.' } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: '!!! ??? ***.' } })]
    expect(report(s).findings).toEqual([])
  })

  it('a field of exactly 25 tokens qualifies for the whole-field pass', () => {
    // Five 5-token sentences: every sentence is below the 8-token floor, so
    // only the field pass can see the copy — at exactly the 25-token minimum.
    const text = Array.from({ length: 5 }, () => 'Rapid delivery of tested software.').join(' ')
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', long_description: { en: text } })]
    s.work_experiences = [makeWork({ id: 'w1', long_description: { en: text } })]
    expect(report(s).findings.map((f) => f.kind)).toEqual(['field'])
  })

  it('quotes a 120-character sentence whole and clips a longer one with an ellipsis', () => {
    const make = (len: number): string => {
      const head = 'alpha bravo charlie delta echo foxtrot golf '
      return head + 'x'.repeat(len - head.length - 1) + '.'
    }
    const s120 = make(120)
    const s121 = make(121)
    expect(s120).toHaveLength(120)

    const at = emptyStore()
    at.projects = [makeProject({ id: 'p1', long_description: { en: s120 } })]
    at.work_experiences = [makeWork({ id: 'w1', long_description: { en: s120 } })]
    expect(report(at).findings[0].detail).toBe(s120)

    const over = emptyStore()
    over.projects = [makeProject({ id: 'p1', long_description: { en: s121 } })]
    over.work_experiences = [makeWork({ id: 'w1', long_description: { en: s121 } })]
    const clipped = report(over).findings[0].detail
    expect(clipped.endsWith('…')).toBe(true)
    expect(clipped).toHaveLength(120)
  })
})
