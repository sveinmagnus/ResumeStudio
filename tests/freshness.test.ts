import { describe, it, expect } from 'vitest'
import {
  freshnessReport, isResumeStale, DEFAULT_FRESHNESS,
  snoozeUntil, certWarningKey, staleWarningKey, consentWarningKey,
} from '../src/lib/freshness'
import { emptyStore, makeCertification, makeProject, makeWork, makeResume, makeReference } from './fixtures'
import type { ResumeStore } from '../src/types'

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

  it('places the two boundaries: expiring this month, and the last month in the window', () => {
    // "now" is June 2026 and the window is a number of months, so both edges
    // are a single month wide and neither was covered from both sides.
    const within = emptyStore()
    within.certifications.push(makeCertification({ id: 'now', expires: { year: 2026, month: 6 } }))
    const r = freshnessReport(within, NOW, 'en')
    // Expiring THIS month has not expired yet.
    expect(r.expiringCerts.map((c) => c.id)).toEqual(['now'])
    expect(r.expiredCerts).toEqual([])

    const edge = emptyStore()
    const last = 6 + DEFAULT_FRESHNESS.expiringWithinMonths
    edge.certifications.push(makeCertification({ id: 'edge', expires: { year: 2026, month: last } }))
    expect(freshnessReport(edge, NOW, 'en').expiringCerts.map((c) => c.id)).toEqual(['edge'])

    const past = emptyStore()
    past.certifications.push(makeCertification({ id: 'past', expires: { year: 2026, month: last + 1 } }))
    expect(freshnessReport(past, NOW, 'en').total).toBe(0)
  })

  it('holds a snoozed warning back until the snooze lapses', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({ id: 'c1', name: { en: 'AWS SA' }, expires: { year: 2025, month: 1 } }))
    store.resume = {
      ...emptyStore().resume!,
      attention_dismissals: { [certWarningKey('c1')]: '2026-09-01T00:00:00Z' },
    }

    const r = freshnessReport(store, NOW, 'en')
    expect(r.expiredCerts).toEqual([])
    expect(r.snoozed.map((s) => s.label)).toEqual(['AWS SA'])

    // Once the date passes, the warning comes back rather than staying hidden.
    const later = freshnessReport(store, new Date('2026-09-02T00:00:00Z'), 'en')
    expect(later.expiredCerts.map((c) => c.id)).toEqual(['c1'])
    expect(later.snoozed).toEqual([])
  })

  it('ignores an unparseable snooze date rather than hiding the warning forever', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({ id: 'c1', expires: { year: 2025, month: 1 } }))
    store.resume = {
      ...emptyStore().resume!,
      attention_dismissals: { [certWarningKey('c1')]: 'not a date' },
    } as never
    expect(freshnessReport(store, NOW, 'en').expiredCerts.map((c) => c.id)).toEqual(['c1'])
  })

  it('reports on a store with no resume record', () => {
    // The dismissals live on the resume; without one there are simply none.
    const store = { ...emptyStore(), resume: null }
    store.certifications.push(makeCertification({ id: 'c1', expires: { year: 2025, month: 1 } }))
    expect(freshnessReport(store, NOW, 'en').expiredCerts.map((c) => c.id)).toEqual(['c1'])
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
  it('flags an old part-time ongoing project (not the main full-time engagement)', () => {
    const store = emptyStore()
    // percent_allocated 50 ⇒ part-time, so the sole-full-time-project exemption
    // does NOT apply and a long-running ongoing project is still flagged.
    store.projects.push(makeProject({
      id: 'p1', customer: { en: 'LongCorp' }, start: { year: 2019, month: 1 }, end: null,
      percent_allocated: 50,
    }))
    const r = freshnessReport(store, NOW, 'en')
    expect(r.staleOngoing.map((s) => s.id)).toEqual(['p1'])
    expect(r.staleOngoing[0].section).toBe('projects')
    expect(r.staleOngoing[0].label).toBe('LongCorp')
    expect(r.staleOngoing[0].dismissKey).toBe('stale:projects:p1')
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

  it('flags stale ongoing employments when more than one is open', () => {
    const store = emptyStore()
    // Two ongoing employments ⇒ neither is the sole "main job", so the old one
    // is still flagged. (A single ongoing employment is auto-exempt — see the
    // exemption describe block below.)
    store.work_experiences.push(makeWork({
      id: 'w1', employer: { en: 'OldEmployer' }, start: { year: 2015, month: 6 }, end: null,
    }))
    store.work_experiences.push(makeWork({
      id: 'w2', employer: { en: 'CurrentEmployer' }, start: { year: 2025, month: 1 }, end: null,
    }))
    const r = freshnessReport(store, NOW, 'en')
    expect(r.staleOngoing.map((s) => s.id)).toEqual(['w1'])
    expect(r.staleOngoing[0].section).toBe('work_experiences')
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
    store.projects.push(makeProject({ start: { year: 2010, month: 1 }, end: null, percent_allocated: 50 })) // stale part-time
    const r = freshnessReport(store, NOW, 'en')
    expect(r.total).toBe(2)
    // A wider stale window (20y) drops the stale-ongoing flag.
    const r2 = freshnessReport(store, NOW, 'en', { ...DEFAULT_FRESHNESS, staleOngoingYears: 20 })
    expect(r2.staleOngoing).toEqual([])
  })

  it('resolves labels in the requested locale', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      customer: { en: 'English', no: 'Norsk' }, start: { year: 2010, month: 1 }, end: null,
      percent_allocated: 50,
    }))
    expect(freshnessReport(store, NOW, 'no').staleOngoing[0].label).toBe('Norsk')
  })
})

describe('freshnessReport — current-engagement exemptions', () => {
  it('does not flag the sole ongoing employment (the current main job)', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({
      id: 'w1', start: { year: 2018, month: 1 }, end: null, // old + ongoing
    }))
    expect(freshnessReport(store, NOW, 'en').staleOngoing).toEqual([])
  })

  it('does not flag the sole open full-time project (100% allocated)', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      id: 'p1', start: { year: 2018, month: 1 }, end: null, percent_allocated: 100,
    }))
    expect(freshnessReport(store, NOW, 'en').staleOngoing).toEqual([])
  })

  it('treats an open project with unspecified allocation as the main project', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      id: 'p1', start: { year: 2010, month: 1 }, end: null, percent_allocated: null,
    }))
    expect(freshnessReport(store, NOW, 'en').staleOngoing).toEqual([])
  })

  it('flags open full-time projects when more than one is open', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1', start: { year: 2010, month: 1 }, end: null, percent_allocated: 100 }))
    store.projects.push(makeProject({ id: 'p2', start: { year: 2024, month: 1 }, end: null, percent_allocated: 100 }))
    // Two open full-time projects ⇒ no single "main" project ⇒ the old one is flagged.
    expect(freshnessReport(store, NOW, 'en').staleOngoing.map((s) => s.id)).toEqual(['p1'])
  })
})

describe('freshnessReport — dismiss / snooze', () => {
  it('suppresses a warning dismissed within the snooze window and lists it as snoozed', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({ id: 'c1', name: { en: 'AWS SA' }, expires: { year: 2020, month: 1 } }))
    store.resume!.attention_dismissals = { [certWarningKey('c1')]: snoozeUntil(NOW) }
    const r = freshnessReport(store, NOW, 'en')
    expect(r.expiredCerts).toEqual([])
    expect(r.total).toBe(0)
    expect(r.snoozed.map((s) => s.key)).toEqual([certWarningKey('c1')])
    expect(r.snoozed[0].label).toBe('AWS SA')
  })

  it('re-flags a warning whose snooze has already lapsed', () => {
    const store = emptyStore()
    store.certifications.push(makeCertification({ id: 'c1', expires: { year: 2020, month: 1 } }))
    // Dismissed until a date in the past → no longer suppressed.
    store.resume!.attention_dismissals = { [certWarningKey('c1')]: '2025-01-01T00:00:00Z' }
    const r = freshnessReport(store, NOW, 'en')
    expect(r.expiredCerts.map((c) => c.id)).toEqual(['c1'])
    expect(r.snoozed).toEqual([])
  })

  it('snoozes a stale ongoing item by its key', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1', start: { year: 2010, month: 1 }, end: null, percent_allocated: 50 }))
    store.resume!.attention_dismissals = { [staleWarningKey('projects', 'p1')]: snoozeUntil(NOW) }
    const r = freshnessReport(store, NOW, 'en')
    expect(r.staleOngoing).toEqual([])
    expect(r.snoozed.map((s) => s.key)).toEqual([staleWarningKey('projects', 'p1')])
  })

  it('snoozeUntil returns ~12 months ahead by default', () => {
    const until = snoozeUntil(NOW)
    const d = new Date(until)
    expect(d.getFullYear()).toBe(2027)
    expect(d.getMonth()).toBe(5) // June (0-based) — same month, next year
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

/**
 * The exemption and ordering rules.
 *
 * The report is only useful if it is trustworthy: a warning about the job you
 * currently hold is noise that teaches the user to ignore the panel, and an
 * unordered list buries the urgent item. Both rules had survivors.
 */
describe('freshness — exemptions and ordering', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari' })
    return s
  }
  const old = { year: NOW.getFullYear() - 12, month: 1 }
  const older = { year: NOW.getFullYear() - 20, month: 1 }

  it('exempts a SINGLE ongoing employment — that is the current job', () => {
    const s = store()
    s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, start: old, end: null })]
    expect(freshnessReport(s, NOW, 'en').staleOngoing).toHaveLength(0)
  })

  it('exempts NONE when several are open — one may be a forgotten leftover', () => {
    const s = store()
    s.work_experiences = [
      makeWork({ id: 'w1', employer: { en: 'Acme' }, start: old, end: null }),
      makeWork({ id: 'w2', employer: { en: 'Beta' }, start: older, end: null }),
    ]
    expect(freshnessReport(s, NOW, 'en').staleOngoing).toHaveLength(2)
  })

  it('does not count a DISABLED open item toward the exemption', () => {
    // A soft-deleted row must not make the real open job look like one of two.
    const s = store()
    s.work_experiences = [
      makeWork({ id: 'w1', employer: { en: 'Acme' }, start: old, end: null }),
      makeWork({ id: 'w2', employer: { en: 'Beta' }, start: older, end: null, disabled: true }),
    ]
    expect(freshnessReport(s, NOW, 'en').staleOngoing).toHaveLength(0)
  })

  it('treats an unspecified allocation as full time for the project exemption', () => {
    // An open project with no part-time allocation set is assumed to be the
    // main engagement — that is what makes the single-project exemption work
    // for the common case where nobody fills the field in.
    const s = store()
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, start: old, end: null, percent_allocated: null })]
    expect(freshnessReport(s, NOW, 'en').staleOngoing).toHaveLength(0)
  })

  it('does not exempt a part-time open project', () => {
    const s = store()
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, start: old, end: null, percent_allocated: 40 })]
    expect(freshnessReport(s, NOW, 'en').staleOngoing).toHaveLength(1)
  })

  it('puts the OLDEST stale item first', () => {
    const s = store()
    s.work_experiences = [
      makeWork({ id: 'w1', employer: { en: 'Newer' }, start: old, end: null }),
      makeWork({ id: 'w2', employer: { en: 'Older' }, start: older, end: null }),
    ]
    expect(freshnessReport(s, NOW, 'en').staleOngoing.map((x) => x.label)).toEqual(['Older', 'Newer'])
  })

  it('counts the total across all three lists', () => {
    const s = store()
    s.work_experiences = [
      makeWork({ id: 'w1', employer: { en: 'A' }, start: old, end: null }),
      makeWork({ id: 'w2', employer: { en: 'B' }, start: older, end: null }),
    ]
    const r = freshnessReport(s, NOW, 'en')
    expect(r.total).toBe(r.expiredCerts.length + r.expiringCerts.length + r.staleOngoing.length)
    expect(r.total).toBe(2)
  })

  describe('snoozing', () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString()
    const past = new Date(NOW.getTime() - 86_400_000).toISOString()
    const withDismissal = (until: string) => {
      const s = store()
      s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, start: old, end: null })]
      s.work_experiences.push(makeWork({ id: 'w2', employer: { en: 'Beta' }, start: older, end: null }))
      s.resume = makeResume({ full_name: 'Kari', attention_dismissals: { [staleWarningKey('work_experiences', 'w1')]: until } })
      return freshnessReport(s, NOW, 'en')
    }

    it('hides a warning whose snooze has not lapsed', () => {
      const r = withDismissal(future)
      expect(r.staleOngoing.map((x) => x.label)).toEqual(['Beta'])
      expect(r.snoozed.map((x) => x.label)).toEqual(['Acme'])
    })

    it('shows it again once the snooze has lapsed', () => {
      expect(withDismissal(past).staleOngoing.map((x) => x.label).sort()).toEqual(['Acme', 'Beta'])
    })

    it('ignores an unparseable snooze date rather than hiding forever', () => {
      expect(withDismissal('not a date').staleOngoing).toHaveLength(2)
    })
  })
})


describe('freshnessReport — the single-engagement exemption', () => {
  const old = { year: 2018, month: 1 }
  const work = (id: string, over = {}) =>
    makeWork({ id, employer: { en: id }, start: old, end: null, ...over })
  const proj = (id: string, over = {}) =>
    makeProject({ id, customer: { en: id }, start: old, end: null, ...over })

  it('exempts a lone ongoing employment, however old its start', () => {
    const s = emptyStore()
    s.work_experiences = [work('main')]
    expect(freshnessReport(s, NOW, 'en').staleOngoing).toEqual([])
  })

  it('exempts nobody once TWO employments are open — one may be a leftover', () => {
    const s = emptyStore()
    s.work_experiences = [work('a'), work('b')]
    expect(freshnessReport(s, NOW, 'en').staleOngoing.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })

  it('does not count a DISABLED open employment towards the exemption', () => {
    // Two rows, but only one is live, so the live one is still the main job.
    const s = emptyStore()
    s.work_experiences = [work('live'), work('gone', { disabled: true })]
    expect(freshnessReport(s, NOW, 'en').staleOngoing).toEqual([])
  })

  it('does not count an employment with NO start towards the exemption', () => {
    // An undated open row is not a candidate for "the current job", and it is
    // not stale either — staleness is measured from a start date.
    const s = emptyStore()
    s.work_experiences = [work('dated'), work('undated', { start: null })]
    expect(freshnessReport(s, NOW, 'en').staleOngoing).toEqual([])
  })

  it('does not count a CLOSED employment towards the exemption', () => {
    const s = emptyStore()
    s.work_experiences = [work('open'), work('closed', { end: { year: 2020, month: 6 } })]
    expect(freshnessReport(s, NOW, 'en').staleOngoing).toEqual([])
  })

  it('exempts a lone open project only when it is full-time or unspecified', () => {
    const full = emptyStore()
    full.projects = [proj('main', { percent_allocated: 100 })]
    expect(freshnessReport(full, NOW, 'en').staleOngoing).toEqual([])

    const unset = emptyStore()
    unset.projects = [proj('main', { percent_allocated: null })]
    expect(freshnessReport(unset, NOW, 'en').staleOngoing).toEqual([])

    // A part-time open project is not the main engagement, so it still nags.
    const part = emptyStore()
    part.projects = [proj('side', { percent_allocated: 20 })]
    expect(freshnessReport(part, NOW, 'en').staleOngoing.map((x) => x.id)).toEqual(['side'])
  })

  it('does not count a CLOSED or DISABLED project towards the project exemption', () => {
    // Both siblings are full-time, so only the open/live test can keep the lone
    // open project exempt.
    const closed = emptyStore()
    closed.projects = [proj('open'), proj('done', { end: { year: 2020, month: 1 } })]
    expect(freshnessReport(closed, NOW, 'en').staleOngoing).toEqual([])

    const hidden = emptyStore()
    hidden.projects = [proj('open'), proj('gone', { disabled: true })]
    expect(freshnessReport(hidden, NOW, 'en').staleOngoing).toEqual([])

    const undated = emptyStore()
    undated.projects = [proj('open'), proj('undated', { start: null })]
    expect(freshnessReport(undated, NOW, 'en').staleOngoing).toEqual([])
  })

  it('keeps the employment and project exemptions separate', () => {
    const s = emptyStore()
    s.work_experiences = [work('job')]
    s.projects = [proj('p1'), proj('p2')]
    expect(freshnessReport(s, NOW, 'en').staleOngoing.map((x) => x.id).sort()).toEqual(['p1', 'p2'])
  })
})

describe('freshnessReport — the stale threshold and labels', () => {
  it('nags at the threshold but not one month inside it', () => {
    // NOW is June 2026 and the default is 3 years, so June 2023 is the edge.
    const at = (start: { year: number; month: number }) => {
      const s = emptyStore()
      s.projects = [
        makeProject({ id: 'p', customer: { en: 'P' }, start, end: null }),
        makeProject({ id: 'other', customer: { en: 'O' }, start, end: null }),
      ]
      return freshnessReport(s, NOW, 'en').staleOngoing.map((x) => x.id)
    }
    expect(at({ year: 2023, month: 6 })).toEqual(['p', 'other'])
    expect(at({ year: 2023, month: 7 })).toEqual([])
  })

  it('treats a year-only start as January — the earliest plausible date', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p', customer: { en: 'P' }, start: { year: 2023, month: null }, end: null }),
      makeProject({ id: 'other', customer: { en: 'O' }, start: { year: 2026, month: 1 }, end: null }),
    ]
    expect(freshnessReport(s, NOW, 'en').staleOngoing.map((x) => x.id)).toEqual(['p'])
  })

  it('labels each stale row from its own identity field, with a fallback', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p1', customer: { en: 'Acme' }, start: { year: 2018, month: 1 }, end: null }),
      makeProject({ id: 'p2', customer: {}, start: { year: 2018, month: 1 }, end: null }),
    ]
    s.work_experiences = [
      makeWork({ id: 'w1', employer: { en: 'Cartavio' }, start: { year: 2018, month: 1 }, end: null }),
      makeWork({ id: 'w2', employer: {}, start: { year: 2018, month: 1 }, end: null }),
    ]
    const rows = freshnessReport(s, NOW, 'en').staleOngoing
    expect(rows.find((r) => r.id === 'p1')!.label).toBe('Acme')
    expect(rows.find((r) => r.id === 'p2')!.label).toBe('Untitled project')
    expect(rows.find((r) => r.id === 'w1')!.label).toBe('Cartavio')
    expect(rows.find((r) => r.id === 'w2')!.label).toBe('Untitled employer')
  })

  it('resolves a label in the requested locale', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p1', customer: { en: 'The Bank', no: 'Banken' }, start: { year: 2018, month: 1 }, end: null }),
      makeProject({ id: 'p2', customer: { en: 'Other' }, start: { year: 2018, month: 1 }, end: null }),
    ]
    expect(freshnessReport(s, NOW, 'no').staleOngoing.find((r) => r.id === 'p1')!.label).toBe('Banken')
  })
})

describe('freshnessReport — ordering and totals', () => {
  it('orders certifications soonest-first within each bucket', () => {
    const s = emptyStore()
    s.certifications = [
      makeCertification({ id: 'later', name: { en: 'L' }, expires: { year: 2026, month: 8 } }),
      makeCertification({ id: 'soon', name: { en: 'S' }, expires: { year: 2026, month: 7 } }),
      makeCertification({ id: 'old', name: { en: 'O' }, expires: { year: 2024, month: 1 } }),
      makeCertification({ id: 'older', name: { en: 'Or' }, expires: { year: 2020, month: 1 } }),
    ]
    const r = freshnessReport(s, NOW, 'en')
    expect(r.expiringCerts.map((c) => c.id)).toEqual(['soon', 'later'])
    expect(r.expiredCerts.map((c) => c.id)).toEqual(['older', 'old'])
  })

  it('orders stale rows oldest-first', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'newer', customer: { en: 'N' }, start: { year: 2022, month: 1 }, end: null }),
      makeProject({ id: 'oldest', customer: { en: 'O' }, start: { year: 2015, month: 1 }, end: null }),
      makeProject({ id: 'middle', customer: { en: 'M' }, start: { year: 2019, month: 1 }, end: null }),
    ]
    expect(freshnessReport(s, NOW, 'en').staleOngoing.map((x) => x.id))
      .toEqual(['oldest', 'middle', 'newer'])
  })

  it('orders snoozed rows by label', () => {
    const s = emptyStore()
    s.certifications = [
      makeCertification({ id: 'c1', name: { en: 'Zebra' }, expires: { year: 2026, month: 7 } }),
      makeCertification({ id: 'c2', name: { en: 'Alpha' }, expires: { year: 2026, month: 7 } }),
    ]
    s.resume = makeResume({
      attention_dismissals: {
        [certWarningKey('c1')]: '2027-01-01T00:00:00Z',
        [certWarningKey('c2')]: '2027-01-01T00:00:00Z',
      },
    })
    expect(freshnessReport(s, NOW, 'en').snoozed.map((x) => x.label)).toEqual(['Alpha', 'Zebra'])
  })

  it('totals all three buckets, and counts a snoozed row in none of them', () => {
    const s = emptyStore()
    s.certifications = [
      makeCertification({ id: 'exp', name: { en: 'E' }, expires: { year: 2024, month: 1 } }),
      makeCertification({ id: 'soon', name: { en: 'S' }, expires: { year: 2026, month: 7 } }),
      makeCertification({ id: 'hush', name: { en: 'H' }, expires: { year: 2026, month: 7 } }),
    ]
    s.projects = [
      makeProject({ id: 'p1', customer: { en: 'P' }, start: { year: 2018, month: 1 }, end: null }),
      makeProject({ id: 'p2', customer: { en: 'Q' }, start: { year: 2018, month: 1 }, end: null }),
    ]
    s.resume = makeResume({ attention_dismissals: { [certWarningKey('hush')]: '2027-01-01T00:00:00Z' } })
    const r = freshnessReport(s, NOW, 'en')
    expect([r.expiredCerts.length, r.expiringCerts.length, r.staleOngoing.length]).toEqual([1, 1, 2])
    expect(r.total).toBe(4)
    expect(r.snoozed.map((x) => x.key)).toEqual([certWarningKey('hush')])
  })
})

describe('freshnessReport — the snooze window', () => {
  const soon = { year: 2026, month: 7 }
  const withDismissal = (until: string): ReturnType<typeof freshnessReport> => {
    const s = emptyStore()
    s.certifications = [makeCertification({ id: 'c1', name: { en: 'AWS' }, expires: soon })]
    s.resume = makeResume({ attention_dismissals: { [certWarningKey('c1')]: until } })
    return freshnessReport(s, NOW, 'en')
  }

  it('suppresses the warning while the snooze is in the future', () => {
    const r = withDismissal('2026-06-16T00:00:00Z')
    expect(r.expiringCerts).toEqual([])
    expect(r.snoozed.map((x) => x.until)).toEqual(['2026-06-16T00:00:00Z'])
  })

  it('surfaces the warning again the instant the snooze lapses', () => {
    // Exactly NOW has lapsed — the window is strictly in the future.
    expect(withDismissal(NOW.toISOString()).expiringCerts.map((c) => c.id)).toEqual(['c1'])
    expect(withDismissal('2026-06-14T00:00:00Z').expiringCerts.map((c) => c.id)).toEqual(['c1'])
  })

  it('ignores an unparseable dismissal rather than suppressing forever', () => {
    expect(withDismissal('whenever').expiringCerts.map((c) => c.id)).toEqual(['c1'])
    expect(withDismissal('').expiringCerts.map((c) => c.id)).toEqual(['c1'])
  })

  it('keys a certification warning distinctly from a stale-ongoing one', () => {
    expect(certWarningKey('x')).toBe('cert:x')
    expect(staleWarningKey('projects', 'x')).not.toBe(certWarningKey('x'))
    expect(staleWarningKey('projects', 'x')).not.toBe(staleWarningKey('work_experiences', 'x'))
  })
})

describe('freshnessReport — reference consent', () => {
  it('flags an export-included reference without confirmed consent', () => {
    const s = emptyStore()
    s.references = [makeReference({ id: 'r1', name: 'Jane Doe', include_in_exports: true })]
    const r = freshnessReport(s, NOW, 'en')
    expect(r.referenceConsent.map((c) => [c.id, c.status])).toEqual([['r1', 'missing']])
    expect(r.total).toBe(1)
  })

  it('never flags a private reference — it does not leave the machine', () => {
    const s = emptyStore()
    s.references = [makeReference({ include_in_exports: false })]
    expect(freshnessReport(s, NOW, 'en').total).toBe(0)
  })

  it('flags a declined reference still included in exports, ahead of the rest', () => {
    const s = emptyStore()
    s.references = [
      makeReference({ id: 'ask', name: 'A Asked', include_in_exports: true, consent_status: 'asked' }),
      makeReference({ id: 'no', name: 'B Declined', include_in_exports: true, consent_status: 'declined' }),
    ]
    const r = freshnessReport(s, NOW, 'en')
    expect(r.referenceConsent.map((c) => c.status)).toEqual(['declined', 'missing'])
  })

  it('ages out an old confirmation but accepts a recent or undated one', () => {
    const s = emptyStore()
    s.references = [
      makeReference({ id: 'old', include_in_exports: true, consent_status: 'confirmed', consent_confirmed_at: '2023-01-01T00:00:00Z' }),
      makeReference({ id: 'new', include_in_exports: true, consent_status: 'confirmed', consent_confirmed_at: '2026-01-01T00:00:00Z' }),
      makeReference({ id: 'undated', include_in_exports: true, consent_status: 'confirmed' }),
    ]
    const r = freshnessReport(s, NOW, 'en')
    expect(r.referenceConsent.map((c) => [c.id, c.status])).toEqual([['old', 'stale']])
    expect(r.referenceConsent[0].confirmedAt).toBe('2023-01-01T00:00:00Z')
  })

  it('snoozes a dismissed consent warning like any other', () => {
    const s = emptyStore()
    s.references = [makeReference({ id: 'r1', name: 'Jane Doe', include_in_exports: true })]
    s.resume = makeResume({ attention_dismissals: { [consentWarningKey('r1')]: '2027-01-01T00:00:00Z' } })
    const r = freshnessReport(s, NOW, 'en')
    expect(r.referenceConsent).toEqual([])
    expect(r.snoozed.map((x) => x.key)).toEqual([consentWarningKey('r1')])
  })

  it('keys consent warnings distinctly, in the refconsent namespace', () => {
    expect(consentWarningKey('x')).toBe('refconsent:x')
  })

  it('a confirmation exactly AT the staleness cutoff is still fresh — the cutoff is strict', () => {
    const cutoff = new Date(
      NOW.getTime() - DEFAULT_FRESHNESS.consentStaleMonths * 30.44 * 24 * 3600 * 1000,
    ).toISOString()
    const s = emptyStore()
    s.references = [makeReference({
      include_in_exports: true, consent_status: 'confirmed', consent_confirmed_at: cutoff,
    })]
    expect(freshnessReport(s, NOW, 'en').referenceConsent).toEqual([])
  })

  it('a whitespace-only name reads as "Unnamed reference" in the warning', () => {
    const s = emptyStore()
    s.references = [makeReference({ name: '   ', include_in_exports: true })]
    expect(freshnessReport(s, NOW, 'en').referenceConsent[0].name).toBe('Unnamed reference')
  })
})

describe('isResumeStale — the cutoff', () => {
  it('is stale strictly before the cutoff, not at it', () => {
    const cutoff = new Date(NOW)
    cutoff.setMonth(cutoff.getMonth() - 6)
    expect(isResumeStale(cutoff.toISOString(), NOW)).toBe(false)
    expect(isResumeStale(new Date(cutoff.getTime() - 1).toISOString(), NOW)).toBe(true)
  })

  it('treats an unparseable or empty timestamp as fresh', () => {
    expect(isResumeStale('not a date', NOW)).toBe(false)
    expect(isResumeStale('', NOW)).toBe(false)
  })

  it('honours a custom window', () => {
    expect(isResumeStale('2026-04-01T00:00:00Z', NOW, 1)).toBe(true)
    expect(isResumeStale('2026-04-01T00:00:00Z', NOW, 6)).toBe(false)
  })
})
