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
