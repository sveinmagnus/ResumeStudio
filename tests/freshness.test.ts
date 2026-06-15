import { describe, it, expect } from 'vitest'
import { freshnessReport, isResumeStale, DEFAULT_FRESHNESS } from '../src/lib/freshness'
import { emptyStore, makeCertification, makeProject, makeWork } from './fixtures'

// Fixed "now" so the relative checks are deterministic.
const NOW = new Date('2026-06-15T00:00:00Z')

describe('freshnessReport — certifications', () => {
  it('flags an expired certification', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({
      id: 'c1', name: { en: 'AWS SA' }, expires: { year: 2025, month: 1 },
    }))
    const r = freshnessReport(store, NOW, 'en')
    expect(r.expiredCerts.map((c) => c.id)).toEqual(['c1'])
    expect(r.expiredCerts[0].status).toBe('expired')
    expect(r.expiringCerts).toEqual([])
  })

  it('flags a certification expiring within the window', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({
      id: 'c1', expires: { year: 2026, month: 8 }, // ~2 months out
    }))
    const r = freshnessReport(store, NOW, 'en')
    expect(r.expiringCerts.map((c) => c.id)).toEqual(['c1'])
    expect(r.expiredCerts).toEqual([])
  })

  it('ignores a certification expiring well beyond the window', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({ expires: { year: 2030, month: 1 } }))
    expect(freshnessReport(store, NOW, 'en').total).toBe(0)
  })

  it('ignores disabled certs and those with no expiry', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({ expires: { year: 2025, month: 1 }, disabled: true }))
    store.certifications.push(makeCertification({ expires: null }))
    expect(freshnessReport(store, NOW, 'en').total).toBe(0)
  })

  it('treats a year-only expiry leniently (end of that year)', () => {
    const store = emptyStore()
    // "expires 2026" should NOT be expired in June 2026 (lenient = Dec 2026).
    store.certifications.push(makeCertification({ id: 'c1', expires: { year: 2026, month: null } }))
    const r = freshnessReport(store, NOW, 'en')
    expect(r.expiredCerts).toEqual([])
    // Dec 2026 is 6 months out — beyond the default 3-month window.
    expect(r.expiringCerts).toEqual([])
  })

  it('sorts expired certs soonest-expiry first', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({ id: 'newer', expires: { year: 2026, month: 1 } }))
    store.certifications.push(makeCertification({ id: 'older', expires: { year: 2023, month: 1 } }))
    const r = freshnessReport(store, NOW, 'en')
    expect(r.expiredCerts.map((c) => c.id)).toEqual(['older', 'newer'])
  })
})

describe('freshnessReport — stale ongoing items', () => {
  it('flags an ongoing project older than the threshold', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      id: 'p1', customer: { en: 'LongCorp' }, start: { year: 2019, month: 1 }, end: null,
    }))
    const r = freshnessReport(store, NOW, 'en')
    expect(r.staleOngoing.map((s) => s.id)).toEqual(['p1'])
    expect(r.staleOngoing[0].section).toBe('projects')
    expect(r.staleOngoing[0].label).toBe('LongCorp')
  })

  it('does not flag a recent ongoing project', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ start: { year: 2025, month: 1 }, end: null }))
    expect(freshnessReport(store, NOW, 'en').staleOngoing).toEqual([])
  })

  it('does not flag a project that has an end date', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ start: { year: 2010, month: 1 }, end: { year: 2012, month: 1 } }))
    expect(freshnessReport(store, NOW, 'en').staleOngoing).toEqual([])
  })

  it('flags stale ongoing employments too', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'OldEmployer' }, start: { year: 2015, month: 6 }, end: null,
    }))
    const r = freshnessReport(store, NOW, 'en')
    expect(r.staleOngoing.map((s) => s.section)).toEqual(['work_experiences'])
  })

  it('ignores disabled items', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ start: { year: 2010, month: 1 }, end: null, disabled: true }))
    expect(freshnessReport(store, NOW, 'en').staleOngoing).toEqual([])
  })
})

describe('freshnessReport — total and locale', () => {
  it('counts every warning and respects config thresholds', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({ expires: { year: 2025, month: 1 } })) // expired
    store.projects.push(makeProject({ start: { year: 2010, month: 1 }, end: null }))    // stale
    const r = freshnessReport(store, NOW, 'en')
    expect(r.total).toBe(2)
    // A wider stale window (10y) drops the stale-ongoing flag.
    const r2 = freshnessReport(store, NOW, 'en', { ...DEFAULT_FRESHNESS, staleOngoingYears: 20 })
    expect(r2.staleOngoing).toEqual([])
  })

  it('resolves labels in the requested locale', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      customer: { en: 'English', no: 'Norsk' }, start: { year: 2010, month: 1 }, end: null,
    }))
    expect(freshnessReport(store, NOW, 'no').staleOngoing[0].label).toBe('Norsk')
  })
})

describe('isResumeStale', () => {
  it('is true for a save older than the window', () => {
    expect(isResumeStale('2025-01-01T00:00:00Z', NOW, 6)).toBe(true)
  })
  it('is false for a recent save', () => {
    expect(isResumeStale('2026-05-01T00:00:00Z', NOW, 6)).toBe(false)
  })
  it('treats an unparseable timestamp as fresh', () => {
    expect(isResumeStale('not-a-date', NOW, 6)).toBe(false)
  })
})
