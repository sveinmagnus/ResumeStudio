import { describe, it, expect } from 'vitest'
import {
  isPlainObject, str, strOrNull, norm, toNames, toYearMonth, checkDate,
  type ImportIssue,
} from '../src/lib/coerce'

/**
 * The coercion primitives shared by aiImport and bulkImport. Both modules used
 * to carry private copies of these; the copies had drifted (see the month
 * clamp below), which is what this module exists to prevent.
 */
describe('coerce', () => {
  describe('str / strOrNull', () => {
    it('trims strings and stringifies scalars', () => {
      expect(str('  hi  ')).toBe('hi')
      expect(str(42)).toBe('42')
      expect(str(true)).toBe('true')
    })

    it('rejects non-scalars', () => {
      expect(str(null)).toBe('')
      expect(str(undefined)).toBe('')
      expect(str({})).toBe('')
      expect(str([1])).toBe('')
    })

    it('strOrNull maps empty to null', () => {
      expect(strOrNull('  ')).toBeNull()
      expect(strOrNull('x')).toBe('x')
    })
  })

  it('isPlainObject accepts objects but not arrays or null', () => {
    expect(isPlainObject({ a: 1 })).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('s')).toBe(false)
  })

  it('norm trims and lower-cases', () => {
    expect(norm('  Solution Architect ')).toBe('solution architect')
  })

  it('toNames keeps only usable strings', () => {
    expect(toNames(['a', ' b ', '', 3, null, {}])).toEqual(['a', 'b', '3'])
    expect(toNames('not an array')).toEqual([])
  })

  describe('toYearMonth', () => {
    it('accepts a bare year as number or string', () => {
      expect(toYearMonth(2019)).toEqual({ year: 2019, month: null })
      expect(toYearMonth('2019')).toEqual({ year: 2019, month: null })
    })

    it('accepts a { year, month } object', () => {
      expect(toYearMonth({ year: 2019, month: 6 })).toEqual({ year: 2019, month: 6 })
      expect(toYearMonth({ year: 2019, month: null })).toEqual({ year: 2019, month: null })
    })

    it('returns null for unusable input', () => {
      expect(toYearMonth(null)).toBeNull()
      expect(toYearMonth('nope')).toBeNull()
      expect(toYearMonth({ month: 6 })).toBeNull()
      expect(toYearMonth([2019])).toBeNull()
    })

    /**
     * Regression: the two private copies disagreed here. bulkImport clamped the
     * month to 1–12; aiImport only checked Number.isInteger, so a month of 0 or
     * 13 would have survived into the data model (where month is 1-based) had
     * validation not caught it first. The stricter rule is the shared one.
     */
    it('drops an out-of-range month rather than carrying it through', () => {
      expect(toYearMonth({ year: 2019, month: 13 })).toEqual({ year: 2019, month: null })
      expect(toYearMonth({ year: 2019, month: 0 })).toEqual({ year: 2019, month: null })
      expect(toYearMonth({ year: 2019, month: -3 })).toEqual({ year: 2019, month: null })
      expect(toYearMonth({ year: 2019, month: 6.5 })).toEqual({ year: 2019, month: null })
      // The boundaries themselves stay.
      expect(toYearMonth({ year: 2019, month: 1 })).toEqual({ year: 2019, month: 1 })
      expect(toYearMonth({ year: 2019, month: 12 })).toEqual({ year: 2019, month: 12 })
    })
  })

  describe('checkDate', () => {
    const issues = (v: unknown): ImportIssue[] => {
      const out: ImportIssue[] = []
      checkDate(v, 'x.start', out)
      return out
    }

    it('passes null and well-formed dates', () => {
      expect(issues(null)).toEqual([])
      expect(issues(2019)).toEqual([])
      expect(issues({ year: 2019, month: 6 })).toEqual([])
      expect(issues({ year: 2019, month: null })).toEqual([])
    })

    it('flags an implausible year', () => {
      expect(issues(19)[0].path).toBe('x.start')
      expect(issues({ year: 12 })[0].path).toBe('x.start.year')
    })

    it('accepts the years at the edge of the plausible range', () => {
      // Only the far side was tested, so moving either bound by one year was
      // invisible — and 1000/3000 are the bounds, not 1001/2999.
      for (const y of [1000, 3000]) {
        expect(issues(y), `bare ${y}`).toEqual([])
        expect(issues({ year: y }), `object ${y}`).toEqual([])
      }
      expect(issues(999)).toHaveLength(1)
      expect(issues({ year: 3001 })).toHaveLength(1)
    })

    it('flags an out-of-range month on its own path', () => {
      const [issue] = issues({ year: 2019, month: 13 })
      expect(issue.path).toBe('x.start.month')
      expect(issue.reason).toMatch(/1–12/)
    })

    it('flags a wholly wrong shape', () => {
      expect(issues(['2019'])[0].reason).toMatch(/year number or a \{ year, month \} object/)
    })
  })
})

describe('toYearMonth — every shape an import can send', () => {
  it('reads a bare year, as a number or a string', () => {
    expect(toYearMonth(2019)).toEqual({ year: 2019, month: null })
    expect(toYearMonth('2019')).toEqual({ year: 2019, month: null })
  })

  it('truncates a fractional year rather than storing it', () => {
    expect(toYearMonth(2019.9)).toEqual({ year: 2019, month: null })
    expect(toYearMonth({ year: 2019.9, month: 3 })).toEqual({ year: 2019, month: 3 })
  })

  it('is null for nothing at all, and for anything unreadable', () => {
    expect(toYearMonth(null)).toBeNull()
    expect(toYearMonth(undefined)).toBeNull()
    expect(toYearMonth('not a year')).toBeNull()
    expect(toYearMonth([2019])).toBeNull()
    expect(toYearMonth(true)).toBeNull()
    expect(toYearMonth({ month: 3 })).toBeNull()
    expect(toYearMonth({ year: 'nope' })).toBeNull()
  })

  it('reads a { year, month } pair, as numbers or strings', () => {
    expect(toYearMonth({ year: 2019, month: 3 })).toEqual({ year: 2019, month: 3 })
    expect(toYearMonth({ year: '2019', month: '3' })).toEqual({ year: 2019, month: 3 })
  })

  it('keeps a month of null as year-only precision', () => {
    expect(toYearMonth({ year: 2019, month: null })).toEqual({ year: 2019, month: null })
    expect(toYearMonth({ year: 2019 })).toEqual({ year: 2019, month: null })
  })

  it('drops an out-of-range or non-integer month instead of storing a bad date', () => {
    for (const month of [0, 13, -1, 3.5, 'March', {}]) {
      expect(toYearMonth({ year: 2019, month }), String(month)).toEqual({ year: 2019, month: null })
    }
  })

  it('keeps both ends of the legal month range', () => {
    expect(toYearMonth({ year: 2019, month: 1 })?.month).toBe(1)
    expect(toYearMonth({ year: 2019, month: 12 })?.month).toBe(12)
  })
})

describe('checkDate — what it complains about', () => {
  const issues = (val: unknown): ImportIssue[] => {
    const out: ImportIssue[] = []
    checkDate(val, 'start', out)
    return out
  }

  it('says nothing about an absent date — a date is optional', () => {
    expect(issues(null)).toEqual([])
    expect(issues(undefined)).toEqual([])
  })

  it('accepts a plausible year on its own', () => {
    expect(issues(2019)).toEqual([])
    expect(issues('2019')).toEqual([])
  })

  it('rejects a year outside the four-digit range, at both ends', () => {
    expect(issues(999)).toHaveLength(1)
    expect(issues(3001)).toHaveLength(1)
    expect(issues(1000)).toEqual([])
    expect(issues(3000)).toEqual([])
  })

  it('names the offending value in the message', () => {
    expect(issues('yesterday')[0]).toEqual({
      path: 'start', reason: 'expected a 4-digit year, got "yesterday"',
    })
  })

  it('checks the year of an object under a .year path', () => {
    expect(issues({ year: 12 })[0].path).toBe('start.year')
  })

  it('accepts a legal month and rejects an illegal one, under a .month path', () => {
    expect(issues({ year: 2019, month: 1 })).toEqual([])
    expect(issues({ year: 2019, month: 12 })).toEqual([])
    expect(issues({ year: 2019, month: null })).toEqual([])
    for (const month of [0, 13, 3.5, 'March']) {
      const out = issues({ year: 2019, month })
      expect(out, String(month)).toHaveLength(1)
      expect(out[0].path).toBe('start.month')
    }
  })

  it('rejects a shape that is neither a year nor a year/month object', () => {
    expect(issues([2019])[0]).toEqual({
      path: 'start', reason: 'expected a year number or a { year, month } object',
    })
    expect(issues(true)).toHaveLength(1)
  })
})

describe('toYearMonth — the shapes a model actually sends', () => {
  it('reads null and undefined as no date, not as year zero', () => {
    expect(toYearMonth(null)).toBeNull()
    expect(toYearMonth(undefined)).toBeNull()
  })

  it('reads a bare year from a number or a string', () => {
    expect(toYearMonth(2019)).toEqual({ year: 2019, month: null })
    expect(toYearMonth('2019')).toEqual({ year: 2019, month: null })
    expect(toYearMonth('not a year')).toBeNull()
  })

  it('reads an object, and treats a missing month as year-only', () => {
    expect(toYearMonth({ year: 2019, month: 6 })).toEqual({ year: 2019, month: 6 })
    expect(toYearMonth({ year: 2019 })).toEqual({ year: 2019, month: null })
    expect(toYearMonth({ year: 2019, month: null })).toEqual({ year: 2019, month: null })
  })

  it('refuses a shape that is neither a scalar nor a plain object', () => {
    // An array of numbers is a plausible model answer for a date, and reading
    // `['2019','06'].year` would silently produce a NaN year.
    expect(toYearMonth([2019, 6])).toBeNull()
    expect(toYearMonth(new Date())).toBeNull()
    expect(toYearMonth(true)).toBeNull()
  })

  it('drops an out-of-range or fractional month rather than the whole date', () => {
    // The year is the part a CV reader needs; losing it over a bad month would
    // drop the entry out of every date sort.
    for (const month of [0, 13, 6.5, 'June']) {
      expect(toYearMonth({ year: 2019, month }), String(month)).toEqual({ year: 2019, month: null })
    }
  })
})
