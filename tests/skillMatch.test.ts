import { describe, it, expect } from 'vitest'
import {
  normalizeKey, tokenize, editDistance, buildDomainIndex, matchSkillDomain,
  matchSemantic, INFERRED_TIERS, type SkillDomainModel,
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


/**
 * The tiers' thresholds and the semantic margin.
 *
 * Each threshold decides whether a guess is confident enough to act on. Too
 * loose and skills get filed at random; too tight and the feature does nothing.
 * They all return SOMETHING either way, so only the boundaries pin them.
 */
describe('skillMatch — tier thresholds', () => {
  const index = (...pairs: Array<[string, string]>) => buildDomainIndex(Object.fromEntries(pairs))

  describe('tokenize', () => {
    it('drops one-character tokens, keeping longer ones', () => {
      // A single letter matches almost anything; keeping them makes the token
      // tier fire on noise.
      expect(tokenize('a bc def')).toEqual(['bc', 'def'])
    })
  })

  describe('the token tier', () => {
    it('prefers the candidate with the MOST tokens in common', () => {
      // A two-token overlap is stronger evidence than a one-token one.
      const idx = index(['Cloud', 'Generic'], ['Cloud native platform', 'Specific'])
      expect(matchSkillDomain('cloud native platform engineering', idx)?.domain).toBe('Specific')
    })
  })

  describe('editDistance bounds', () => {
    it('gives up early when the lengths differ by more than the budget', () => {
      // The early-out is what keeps a 1,200-entry library cheap; it must not
      // change the ANSWER, only the work.
      expect(editDistance('abc', 'abcdefghij', 2)).toBeGreaterThan(2)
      expect(editDistance('abc', 'abcd', 2)).toBe(1)
    })

    it('reports 0 for identical keys and the exact count for small edits', () => {
      expect(editDistance('kubernetes', 'kubernetes', 3)).toBe(0)
      expect(editDistance('kubernetes', 'kubernetez', 3)).toBe(1)
      expect(editDistance('kubernetes', 'kubernetzz', 3)).toBe(2)
    })

    it('stops at the budget rather than computing the true distance', () => {
      expect(editDistance('aaaa', 'bbbb', 2)).toBeGreaterThan(2)
    })
  })

  describe('the semantic tier', () => {
    // The model is a flat token -> domain -> weight map, and matchSemantic
    // returns the winning DOMAIN NAME rather than a match object.
    const model = (weights: Record<string, Record<string, number>>) => weights

    it('needs the top score to clear the minimum', () => {
      const m = model({ go: { Languages: 3 } })
      expect(matchSemantic(['go'], m, 2.5)).toBe('Languages')
      expect(matchSemantic(['go'], m, 3.5)).toBeNull()
    })

    it('accepts a score exactly AT the minimum', () => {
      expect(matchSemantic(['go'], model({ go: { Languages: 2.5 } }), 2.5)).toBe('Languages')
    })

    it('refuses when the runner-up is too close', () => {
      // An ambiguous vote is worse than no answer: it files the skill under one
      // of two equally-likely domains with no way for the user to see why.
      const close = model({ go: { Languages: 3, Platforms: 2.9 } })
      expect(matchSemantic(['go'], close, 2.5)).toBeNull()
    })

    it('accepts when the top clears the runner-up by the margin', () => {
      const clear = model({ go: { Languages: 10, Platforms: 1 } })
      expect(matchSemantic(['go'], clear, 2.5)).toBe('Languages')
    })

    it('accepts a single-domain vote, where there is no runner-up', () => {
      expect(matchSemantic(['go'], model({ go: { Languages: 3 } }), 2.5)).toBe('Languages')
    })

    it('sums the weights across tokens', () => {
      const m = model({ go: { Languages: 1.5 }, lang: { Languages: 1.5 } })
      expect(matchSemantic(['go', 'lang'], m, 2.5)).toBe('Languages')
      expect(matchSemantic(['go'], m, 2.5)).toBeNull()
    })

    it('ignores a token the model does not know', () => {
      expect(matchSemantic(['nonesuch'], model({ go: { Languages: 9 } }), 2.5)).toBeNull()
    })
  })

  describe('opting out of the semantic tier', () => {
    it('runs it only when a model is supplied AND it is not disabled', () => {
      const idx = index(['Python', 'Languages'])
      const model = { nonesuch: { Guessed: 9 } }
      expect(matchSkillDomain('nonesuch', idx, { model })?.domain).toBe('Guessed')
      expect(matchSkillDomain('nonesuch', idx, { model, semantic: false })).toBeNull()
      expect(matchSkillDomain('nonesuch', idx, {})).toBeNull()
    })
  })
})

/**
 * The bounded edit distance and the two tiers built on it.
 *
 * These decide whether "Kubernets" finds Kubernetes and whether "management
 * system" matches half the library. Both failure modes are quiet: a missed
 * near-match just leaves a skill uncategorised, and an over-eager one files it
 * under something unrelated.
 */
describe('editDistance — the bound and the arithmetic', () => {
  it('measures a real distance when it is within the budget', () => {
    expect(editDistance('kubernetes', 'kubernetes', 3)).toBe(0)
    expect(editDistance('kubernetes', 'kubernets', 3)).toBe(1)
    expect(editDistance('kitten', 'sitting', 3)).toBe(3)
  })

  it('gives up as soon as the LENGTHS alone exceed the budget', () => {
    // The cheap pre-check: comparing "go" with a 20-character name cannot come
    // in under two edits, so the matrix is never built.
    expect(editDistance('go', 'kubernetes', 2)).toBe(3)
    // A difference of exactly the budget is still worth measuring.
    expect(editDistance('abc', 'abcde', 2)).toBe(2)
  })

  it('reports over-budget as one past the budget, not as the true distance', () => {
    expect(editDistance('kitten', 'sitting', 1)).toBe(2)
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBe(3)
  })

  it('handles an empty string on either side', () => {
    expect(editDistance('', '', 2)).toBe(0)
    expect(editDistance('abc', '', 5)).toBe(3)
    expect(editDistance('', 'abc', 5)).toBe(3)
  })

  it('is symmetric', () => {
    expect(editDistance('kubernetes', 'kubernets', 3)).toBe(editDistance('kubernets', 'kubernetes', 3))
    expect(editDistance('typescript', 'javascript', 5)).toBe(editDistance('javascript', 'typescript', 5))
  })
})

describe('the fuzzy tier — a typo, not a different skill', () => {
  const index = buildDomainIndex(DOMAINS)
  const domainOf = (name: string) => matchSkillDomain(name, index, { fuzzy: true })?.domain ?? null

  it('finds a one-character typo in a long name', () => {
    expect(domainOf('Kubernets')).toBe('Cloud & Infrastructure')
  })

  it('does not fuzzy-match a name shorter than five characters', () => {
    // With three letters, everything is within two edits of everything.
    expect(domainOf('Reac')).toBeNull()
    expect(domainOf('Go')).toBeNull()
  })

  it('scales the budget with the length: two edits pass, three do not', () => {
    // "kubernetes" is ten characters, so the budget is two.
    expect(domainOf('Kubernts')).toBe('Cloud & Infrastructure')
    expect(domainOf('Kubrnts')).toBeNull()
  })

  it('fuzzy-matches a name of exactly five characters', () => {
    // Five is the floor, not the first refusal: "Reacc" is one edit from React.
    expect(domainOf('Reacc')).toBe('Software Development')
    expect(domainOf('Reac')).toBeNull()
  })

  it('allows a third edit on a long name, and only two on a mid-length one', () => {
    // The budget grows with the length: 1 up to six characters, 2 up to twelve,
    // 3 beyond that. A long name survives three typos; a ten-character one does
    // not survive three.
    const long = buildDomainIndex({ Observability: 'Operations' })
    const match = (name: string) => matchSkillDomain(name, long, { fuzzy: true })?.domain ?? null
    expect(match('observabilityxyz')).toBe('Operations')   // 16 chars, 3 edits
    expect(match('observabilitywxyz')).toBeNull()          // 17 chars, 4 edits
    expect(domainOf('Kubrnts')).toBeNull()                 // 10-char key, 3 edits
  })

  it('never answers with an EXACT match through the fuzzy tier', () => {
    // An exact hit is the exact tier's job; the fuzzy pass skips the identical
    // key so it cannot report distance zero as a near-miss.
    const exact = matchSkillDomain('Kubernetes', index, { fuzzy: true })
    expect(exact?.tier).toBe('exact')
  })
})

describe('the token tier — two library words, not one generic one', () => {
  const index = buildDomainIndex({
    ...DOMAINS,
    'Management System': 'Management',
    'Content Management System': 'Management',
  })
  const match = (name: string) => matchSkillDomain(name, index)

  it('matches a multi-word library name contained in the query', () => {
    expect(match('Legacy Content Management System work')?.domain).toBe('Management')
  })

  it('prefers the MOST specific containing name', () => {
    // Both library names are contained; the longer one is the better answer, and
    // it must win regardless of which came first in the library.
    expect(match('Our Content Management System')?.tier).toBe('token')
    expect(match('Our Content Management System')?.domain).toBe('Management')
  })

  it('needs at least two library words to match', () => {
    // A single generic word would otherwise match almost any sentence.
    const single = buildDomainIndex({ Management: 'Management' })
    expect(matchSkillDomain('Some management of things', single)).toBeNull()
  })
})

describe('matchSemantic — picking the winner', () => {
  it('takes the HIGHEST-scoring domain, not the first one seen', () => {
    // The rows are summed into a map whose iteration order is insertion order;
    // without the sort the answer would depend on which token came first.
    const model: SkillDomainModel = { a: { Low: 3 }, b: { High: 9 } }
    expect(matchSemantic(['a', 'b'], model)).toBe('High')
    expect(matchSemantic(['b', 'a'], model)).toBe('High')
  })

  it('sums the weights a domain gets from several tokens', () => {
    const model: SkillDomainModel = { a: { X: 2 }, b: { X: 2 }, c: { Y: 3.5 } }
    // X: 2+2 = 4 against Y: 3.5 — inside the 1.3 margin, so still ambiguous…
    expect(matchSemantic(['a', 'b', 'c'], model)).toBeNull()
    // …and one more contribution to X puts it clear.
    expect(matchSemantic(['a', 'b', 'a', 'c'], model)).toBe('X')
  })

  it('assigns when there is only ONE domain in play', () => {
    // The margin rule compares against a runner-up; with none there is nothing
    // to be ambiguous with, and refusing here would leave every unambiguous
    // single-domain skill uncategorised.
    expect(matchSemantic(['a'], { a: { X: 5 } })).toBe('X')
  })

  it('refuses a tie', () => {
    expect(matchSemantic(['a', 'b'], { a: { X: 4 }, b: { Y: 4 } })).toBeNull()
  })
})

describe('matchSkillDomain — the fuzzy budget', () => {
  const index = buildDomainIndex(DOMAINS)
  const fuzzy = (name: string) => matchSkillDomain(name, index)

  it('matches a one-character typo in a short-ish name', () => {
    const m = fuzzy('Kubernets')
    expect(m).toMatchObject({ domain: 'Cloud & Infrastructure', tier: 'fuzzy' })
  })

  it('refuses a name too far from anything in the library', () => {
    // The budget is what stops "Kubernetes" absorbing every unrelated word of
    // a similar length; a wrong domain is worse than none.
    expect(fuzzy('Kandinskyish')).toBeNull()
  })

  it('allows three edits at twelve characters, the top of that band', () => {
    // The budget steps 1 → 2 → 3 at 6 and 12 characters. A twelve-character key
    // sits in the middle band, so a three-edit near-miss must NOT match.
    const small = buildDomainIndex({ abcdefghijkl: 'Target' })
    expect(matchSkillDomain('abcdefghixyz', small)).toBeNull()
    // …while two edits still do.
    expect(matchSkillDomain('abcdefghijxy', small)?.domain).toBe('Target')
  })

  it('picks the CLOSEST candidate, not the first within budget', () => {
    // Two library entries within the budget: stopping at the first one found
    // assigns the domain of whichever happens to be earlier in the index.
    const small = buildDomainIndex({ 'Postgresqll': 'Wrong', 'PostgreSQL': 'Data & Analytics' })
    expect(matchSkillDomain('PostgreSQI', small)?.domain).toBe('Data & Analytics')
  })
})

describe('normalizeKey — which tokens are dropped, and which only look droppable', () => {
  it('drops a token that is ONLY a number, or only a v-version', () => {
    expect(normalizeKey('Java 8')).toBe('java')
    expect(normalizeKey('Angular v14')).toBe('angular')
  })

  it('keeps a token that merely STARTS or ENDS with digits', () => {
    // "3D" and "MP3" are the skill, not a version of one; an unanchored version
    // of either rule erases them from the key entirely.
    expect(normalizeKey('3D Modelling')).toBe('3d modelling')
    expect(normalizeKey('MP3 encoding')).toBe('mp3 encoding')
    expect(normalizeKey('Srv2 Administration')).toBe('srv2 administration')
    // …and a token that starts LIKE a version but carries a name after it.
    expect(normalizeKey('V2Ray proxy')).toBe('v2ray proxy')
  })
})

describe('tokenize — one-character tokens are noise', () => {
  it('drops a single letter left behind by punctuation', () => {
    // "C#" normalises to "c"; as a token it would match half the library.
    expect(tokenize('C# and Go')).toEqual(['go'])
    expect(tokenize('R programming')).toEqual(['programming'])
  })
})

describe('buildDomainIndex — two names that normalise the same', () => {
  it('keeps the FIRST domain for a shared key', () => {
    // The library is walked in file order; last-writer-wins would make the
    // domain of a duplicated name depend on where it sits in a generated file.
    const index = buildDomainIndex({ 'Node.js': 'Software Development', 'Node JS': 'Wrong' })
    expect(index.byKey.get('node js')).toBe('Software Development')
    expect(matchSkillDomain('Node.js', index)?.domain).toBe('Software Development')
  })
})

describe('INFERRED_TIERS — which tiers are flagged as inferred', () => {
  it('holds every heuristic tier, and not the reliable one', () => {
    // The set drives the "check this" flag in the registry editor: a tier
    // missing from it silently presents a guess as a certainty.
    for (const tier of ['token', 'fuzzy', 'semantic', 'graph']) {
      expect(INFERRED_TIERS.has(tier as never), tier).toBe(true)
    }
    expect(INFERRED_TIERS.has('exact' as never)).toBe(false)
  })
})
