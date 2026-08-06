import { describe, it, expect } from 'vitest'
import {
  normalizeKey, tokenize, editDistance, buildDomainIndex, matchSkillDomain,
  matchSemantic, type SkillDomainModel,
} from '../src/lib/skillMatch'

const DOMAINS: Record<string, string> = {
  'React': 'Software Development',
  'Node.js': 'Software Development',
  'Kubernetes': 'Cloud & Infrastructure',
  'Amazon Web Services': 'Cloud & Infrastructure',
  'Microsoft Azure': 'Cloud & Infrastructure',
  'PostgreSQL': 'Data & Analytics',
}

const MODEL: SkillDomainModel = {
  cloud: { 'Cloud & Infrastructure': 10 },
  security: { 'Security & Cybersecurity': 12 },
  engineer: { 'Software Development': 1 },
  data: { 'Data & Analytics': 9 },
}

describe('normalizeKey', () => {
  it.each([
    ['React.js', 'react js'],
    ['Node JS', 'node js'],
    ['  PostgreSQL  ', 'postgresql'],
    ['Java 8', 'java'],           // trailing version dropped
    ['Angular v14', 'angular'],   // v-version dropped
    ['C#', 'c'],                  // punctuation stripped
    // A combining accent folds away, so an accented name matches however it
    // was typed. 'ø' is its own letter rather than o+accent, so NFKD leaves it
    // and it becomes a separator — worth pinning, since it decides whether
    // "Løsningsarkitektur" is one token or two.
    ['Café Systems', 'cafe systems'],
    ['Løsningsarkitektur', 'l sningsarkitektur'],
    // Several separators in a row collapse to one gap, not several.
    ['React -- Native', 'react native'],
    ['  spaced   out  ', 'spaced out'],
    // A version token is dropped wherever it sits, and a pure number alone
    // leaves nothing behind.
    ['Java 8 SE', 'java se'],
    ['2024', ''],
  ])('normalizes %j → %j', (input, expected) => {
    expect(normalizeKey(input)).toBe(expected)
  })
})

describe('tokenize', () => {
  it('drops stopwords, 1-char and numeric tokens', () => {
    expect(tokenize('Internet of Things')).toEqual(['internet', 'things'])
    expect(tokenize('Java 8 Programming')).toEqual(['java', 'programming'])
  })
})

describe('editDistance (bounded)', () => {
  it('computes small distances', () => {
    expect(editDistance('kubernetes', 'kubernets', 3)).toBe(1)
    expect(editDistance('abc', 'abc', 2)).toBe(0)
  })
  it('short-circuits past the max', () => {
    expect(editDistance('abcdef', 'zzzzzz', 2)).toBe(3) // max + 1
  })
})

describe('matchSkillDomain — tiers', () => {
  const idx = buildDomainIndex(DOMAINS)

  it('exact (normalized): formatting + version variants land', () => {
    expect(matchSkillDomain('react.js', idx)).toEqual({ domain: 'Software Development', tier: 'exact' })
    expect(matchSkillDomain('Node JS', idx)).toEqual({ domain: 'Software Development', tier: 'exact' })
    expect(matchSkillDomain('React 18', idx)).toEqual({ domain: 'Software Development', tier: 'exact' })
  })

  it('token: a multi-word library name contained in the query', () => {
    expect(matchSkillDomain('Amazon Web Services (AWS)', idx))
      .toEqual({ domain: 'Cloud & Infrastructure', tier: 'token' })
    expect(matchSkillDomain('Microsoft Azure DevOps Pipelines', idx))
      .toEqual({ domain: 'Cloud & Infrastructure', tier: 'token' })
  })

  it('fuzzy: typos within the edit budget', () => {
    const m = matchSkillDomain('Kubernets', idx)
    expect(m).toEqual({ domain: 'Cloud & Infrastructure', tier: 'fuzzy' })
  })

  it('semantic: places a skill by its words when one domain dominates', () => {
    const m = matchSkillDomain('Cloud Infrastructure Automation', idx, { model: MODEL })
    expect(m).toEqual({ domain: 'Cloud & Infrastructure', tier: 'semantic' })
  })

  it('semantic: leaves genuinely ambiguous skills uncategorized (margin guard)', () => {
    // cloud (10) and security (12) are close → no confident winner.
    expect(matchSkillDomain('Cloud Security Engineer', idx, { model: MODEL })).toBeNull()
  })

  it('returns null when nothing is confident enough', () => {
    expect(matchSkillDomain('Løsningsarkitektur', idx, { model: MODEL })).toBeNull()
    expect(matchSkillDomain('Zzzzq Widget', idx, { model: MODEL })).toBeNull()
  })

  it('fuzzy can be disabled', () => {
    expect(matchSkillDomain('Kubernets', idx, { fuzzy: false })).toBeNull()
  })
})

describe('matchSemantic — thresholds', () => {
  it('needs a clear margin over the runner-up', () => {
    const model: SkillDomainModel = {
      a: { X: 3 },
      b: { Y: 2.8 }, // close second → ambiguous
    }
    expect(matchSemantic(['a', 'b'], model)).toBeNull()
  })

  it('assigns when one domain dominates', () => {
    const model: SkillDomainModel = { a: { X: 5 }, b: { X: 3 } }
    expect(matchSemantic(['a', 'b'], model)).toBe('X')
  })

  it('needs a minimum score', () => {
    expect(matchSemantic(['a'], { a: { X: 1 } })).toBeNull() // below minScore
  })
})

/**
 * The fuzzy tier's budget.
 *
 * It is what turns a typo into a match, and it is length-scaled on purpose:
 * below 5 characters an edit-distance match is noise, not a near-miss, and a
 * fixed budget would categorise short skill names essentially at random. Every
 * band edge had survivors.
 */
describe('matchSkill — the fuzzy budget', () => {
  const index = (...names: Array<[string, string]>) =>
    buildDomainIndex(Object.fromEntries(names))

  it('refuses a short name outright — a 1-edit match there is noise', () => {
    // "Go" vs " Go" vs "Rx": at four characters or fewer almost everything is
    // within one edit of something.
    expect(matchSkillDomain('java', index(['jaba', 'Languages']))?.tier).not.toBe('fuzzy')
    expect(matchSkillDomain('rust', index(['ruse', 'Languages']))?.tier).not.toBe('fuzzy')
  })

  it('allows ONE edit at five and six characters', () => {
    // A genuine one-edit typo: a transposition ('pyhton') is TWO edits under
    // Levenshtein, which is exactly the distinction the budget turns on.
    expect(matchSkillDomain('pythom', index(['python', 'Languages'])))
      .toMatchObject({ domain: 'Languages', tier: 'fuzzy' })
    expect(matchSkillDomain('kotlim', index(['kotlin', 'Languages'])))
      .toMatchObject({ domain: 'Languages', tier: 'fuzzy' })
  })

  it('does NOT allow two edits at six characters', () => {
    expect(matchSkillDomain('kotlxm', index(['kotlin', 'Languages']))?.tier).not.toBe('fuzzy')
  })

  it('allows two edits from seven characters up — and not at six', () => {
    // The band edge is at 6, so a SEVEN-character name is the first that gets
    // two. Moving the edge either way changes which typos are forgiven.
    expect(matchSkillDomain('kubernetez', index(['kubernetes', 'Platforms'])))
      .toMatchObject({ domain: 'Platforms', tier: 'fuzzy' })
    expect(matchSkillDomain('anguxax', index(['angular', 'Frameworks'])))
      .toMatchObject({ domain: 'Frameworks', tier: 'fuzzy' })
  })

  it('answers from the exact tier even when a near-miss also exists', () => {
    // The tiers are ordered, so a name present in the library never reaches
    // the fuzzy scan at all — which is why fuzzy's own distance-0 skip is
    // defensive rather than load-bearing.
    const idx = index(['docker', 'Platforms'], ['dockek', 'Wrong'])
    expect(matchSkillDomain('docker', idx)).toMatchObject({ tier: 'exact', domain: 'Platforms' })
  })

  it('prefers the NEAREST candidate when several are within budget', () => {
    const idx = index(['postgres', 'Databases'], ['postgrey', 'Other'])
    // One edit from 'postgres', two from 'postgrey'.
    expect(matchSkillDomain('postgrer', idx)?.domain).toBe('Databases')
  })

  it('never reports an exact name as a fuzzy match', () => {
    // Distance 0 is the exact tier's job; letting it through here would label
    // a perfectly good match as an approximate one.
    const hit = matchSkillDomain('python', index(['python', 'Languages']))
    expect(hit?.tier).toBe('exact')
  })
})

