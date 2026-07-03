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
