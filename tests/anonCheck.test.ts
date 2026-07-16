/**
 * @vitest-environment jsdom
 *
 * jsdom: buildViewText renders rich text via richToPlain (DOMParser).
 */
import { describe, it, expect } from 'vitest'
import {
  findKnownLeaks, knownNames, buildAnonCheckPrompt, validateAnonCheck, modelFindings,
  InvalidAnonCheckError, ANON_CHECK_SCHEMA,
} from '../src/lib/anonCheck'
import { buildViewSections } from '../src/lib/viewFilter'
import { emptyStore, makeProject, makeView, makeResume, makeWork } from './fixtures'
import type { ResumeStore, ResumeView } from '../src/types'

/** A store whose project prose names the real client the alias hides. */
function store(over: Partial<ResumeStore> = {}): ResumeStore {
  return {
    ...emptyStore(),
    resume: makeResume(),
    projects: [makeProject({
      id: 'p1',
      customer: { en: 'Acme Corporation' },
      customer_anonymized: { en: 'A large retailer' },
      description: { en: 'Platform rebuild' },
      long_description: { en: '<p>Led the Acme Corporation migration to AWS.</p>' },
    })],
    ...over,
  }
}

const anonView = (): ResumeView => makeView({ sections: buildViewSections(), force_anonymized: true })
const plainView = (): ResumeView => makeView({ sections: buildViewSections(), force_anonymized: false })

describe('knownNames()', () => {
  it('collects the customer names an anonymised view is meant to hide', () => {
    const names = knownNames(store(), 'en')
    expect(names.map((n) => n.name)).toContain('Acme Corporation')
    expect(names.find((n) => n.name === 'Acme Corporation')?.origin).toBe('Customer')
  })

  it('does NOT collect employers or schools — anonymising never hides those', () => {
    // force_anonymized swaps customers + references only. Flagging an employer
    // would be true, intended, and pure noise; a check that cries wolf about
    // every employer is a check nobody reads.
    const s = store({ work_experiences: [makeWork({ employer: { en: 'BigCorp' } })] })
    expect(knownNames(s, 'en').map((n) => n.name)).not.toContain('BigCorp')
  })

  it('orders longest first so the fullest name is reported', () => {
    const s = store({
      projects: [
        makeProject({ customer: { en: 'Acme Corporation' }, customer_anonymized: { en: 'R' } }),
        makeProject({ customer: { en: 'Acme' }, customer_anonymized: { en: 'R2' } }),
      ],
    })
    expect(knownNames(s, 'en')[0].name).toBe('Acme Corporation')
  })

  it('ignores names too short to match safely', () => {
    const s = store({ projects: [makeProject({ customer: { en: 'X' }, customer_anonymized: { en: 'R' } })] })
    expect(knownNames(s, 'en').map((n) => n.name)).not.toContain('X')
  })
})

describe('findKnownLeaks() — pass 1, no model', () => {
  it('finds a real client name left in the prose of an anonymised view', () => {
    // The whole point: force_anonymized swaps the customer FIELD, but the
    // description still says it out loud.
    const f = findKnownLeaks(store(), anonView(), 'en')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ text: 'Acme Corporation', origin: 'Customer', source: 'known' })
    expect(f[0].context).toMatch(/migration to AWS/i)
  })

  it('does nothing on a view that is not anonymised', () => {
    // The real name is supposed to be there.
    expect(findKnownLeaks(store(), plainView(), 'en')).toEqual([])
  })

  it('is silent when the prose uses no real names', () => {
    const clean = store({
      projects: [makeProject({
        customer: { en: 'Acme Corporation' },
        customer_anonymized: { en: 'A large retailer' },
        long_description: { en: '<p>Led the migration to AWS.</p>' },
      })],
    })
    expect(findKnownLeaks(clean, anonView(), 'en')).toEqual([])
  })

  it('matches case-insensitively', () => {
    const s = store({
      projects: [makeProject({
        customer: { en: 'Acme Corporation' },
        customer_anonymized: { en: 'Retailer' },
        long_description: { en: '<p>Worked with ACME CORPORATION on delivery.</p>' },
      })],
    })
    expect(findKnownLeaks(s, anonView(), 'en')).toHaveLength(1)
  })

  it('matches whole words only', () => {
    // "Acme" must not fire inside "acmeism" — noise destroys trust in the check.
    const s = store({
      projects: [makeProject({
        customer: { en: 'Acme' },
        customer_anonymized: { en: 'Retailer' },
        long_description: { en: '<p>A study of acmeism in poetry.</p>' },
      })],
    })
    expect(findKnownLeaks(s, anonView(), 'en')).toEqual([])
  })

  it('reports an overlapping name once, preferring the longer one', () => {
    // Two customers, one name contained in the other. The prose says the long
    // one; "Acme Corporation" covers the "Acme" inside it → one finding.
    const s = store({
      projects: [
        makeProject({
          customer: { en: 'Acme Corporation' }, customer_anonymized: { en: 'Retailer' },
          long_description: { en: '<p>Led the Acme Corporation migration.</p>' },
        }),
        makeProject({ customer: { en: 'Acme' }, customer_anonymized: { en: 'Retailer 2' }, long_description: {} }),
      ],
    })
    const f = findKnownLeaks(s, anonView(), 'en')
    expect(f).toHaveLength(1)
    expect(f[0].text).toBe('Acme Corporation')
  })

  it('leaves an employer named in prose alone', () => {
    // Employers are not anonymised, so their name in a description is not a leak.
    const s = store({
      projects: [makeProject({
        customer: { en: 'Acme Corporation' }, customer_anonymized: { en: 'Retailer' },
        long_description: { en: '<p>While at BigCorp, led a migration.</p>' },
      })],
      work_experiences: [makeWork({ employer: { en: 'BigCorp' } })],
    })
    expect(findKnownLeaks(s, anonView(), 'en')).toEqual([])
  })
})

describe('buildAnonCheckPrompt()', () => {
  it('includes the rendered CV and asks for the schema', () => {
    const p = buildAnonCheckPrompt(store(), anonView(), 'en')
    expect(p).toContain('Acme Corporation')
    expect(p).toContain(ANON_CHECK_SCHEMA)
  })

  it('tells the model to ignore technologies, not just anything capitalised', () => {
    expect(buildAnonCheckPrompt(store(), anonView(), 'en')).toMatch(/ignore technologies/i)
  })
})

describe('validateAnonCheck()', () => {
  it('accepts a list of names', () => {
    expect(validateAnonCheck({ names: [' Globex ', '', 7] })).toEqual(['Globex'])
  })

  it('accepts an empty list — "nothing found" is a real answer', () => {
    expect(validateAnonCheck({ names: [] })).toEqual([])
  })

  it('rejects a malformed reply', () => {
    expect(() => validateAnonCheck({})).toThrow(InvalidAnonCheckError)
    expect(() => validateAnonCheck(null)).toThrow(InvalidAnonCheckError)
  })
})

describe('modelFindings() — pass 2 residual', () => {
  const s = store({
    projects: [makeProject({
      customer: { en: 'Acme Corporation' },
      customer_anonymized: { en: 'Retailer' },
      long_description: { en: '<p>Led the Acme Corporation migration, partnering with Globex.</p>' },
    })],
  })
  const v = anonView()

  it('reports an org the store never recorded', () => {
    // Globex is in the prose but is nobody's customer/employer — only a model
    // can spot it, and this is exactly the residual pass 2 exists for.
    const f = modelFindings(['Globex'], s, v, 'en', [])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ text: 'Globex', source: 'model' })
  })

  it('does not repeat what pass 1 already found', () => {
    const known = findKnownLeaks(s, v, 'en')
    const f = modelFindings(['Acme Corporation', 'Globex'], s, v, 'en', known)
    expect(f.map((x) => x.text)).toEqual(['Globex'])
  })

  it('drops a name the model invented that is not in the text', () => {
    // Models hallucinate plausible client names; reporting one would send the
    // user hunting for text that does not exist.
    expect(modelFindings(['Initech'], s, v, 'en', [])).toEqual([])
  })

  it('dedupes repeated names from one reply', () => {
    expect(modelFindings(['Globex', 'globex'], s, v, 'en', [])).toHaveLength(1)
  })
})
