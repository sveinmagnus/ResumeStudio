/**
 * The item layout every render adapter shares (CLAUDE.md §7).
 *
 * Like `viewSectionPlan`, this module was reached only through viewFilter,
 * exporter, pdfExporter and viewText — each of which asserts its own output, so
 * a slot order was only ever checked as one detail of a rendered string, and
 * the mutation report read that as no coverage at all. What is asserted here is
 * the ordering itself: which slot leads, which separator joins two parts, and
 * where a full item's date lands, since getting one of those wrong moves all
 * four exports at once.
 */
import { describe, it, expect } from 'vitest'
import {
  slotsFor, summarySegments, summaryColumns, tabulatedColumns, fullItemLayout,
} from '../src/lib/itemLayout'
import type { SummaryPart, SummaryView } from '../src/lib/sectionCatalog'
import type { FullLayout, SummaryLayout } from '../src/types'

const view = (parts: SummaryPart[], sep: SummaryView['sep'] = '—'): SummaryView => ({ parts, sep })

/** The joined line an adapter would draw from the segments. */
const line = (v: SummaryView, layout: SummaryLayout): string =>
  summarySegments(v, layout).map((s) => s.joiner + s.text).join('')

describe('slotsFor', () => {
  it('gives each layout its own slot order', () => {
    expect(slotsFor('title-org-date')).toEqual(['title', 'org', 'date'])
    expect(slotsFor('title-date-org')).toEqual(['title', 'date', 'org'])
    expect(slotsFor('org-title-date')).toEqual(['org', 'title', 'date'])
    expect(slotsFor('org-date-title')).toEqual(['org', 'date', 'title'])
    expect(slotsFor('date-title-org')).toEqual(['date', 'title', 'org'])
    expect(slotsFor('date-org-title')).toEqual(['date', 'org', 'title'])
  })

  it('falls back to the default order for a value outside the enum', () => {
    // Stored view JSON is untrusted input; an unknown layout must still render.
    expect(slotsFor('sideways' as SummaryLayout)).toEqual(['title', 'org', 'date'])
  })
})

describe('summarySegments', () => {
  const full = view([
    { key: 'title', value: 'Payments platform' },
    { key: 'role', value: 'Tech lead' },
    { key: 'org', value: 'Acme' },
    { key: 'start', value: '2021' },
    { key: 'end', value: '2023' },
  ])

  it('groups the parts into title, org and date, in the layout order', () => {
    expect(summarySegments(full, 'title-org-date').map((s) => s.slot))
      .toEqual(['title', 'org', 'date'])
    expect(summarySegments(full, 'date-org-title').map((s) => s.slot))
      .toEqual(['date', 'org', 'title'])
  })

  it('reads the same facts in whichever order the layout asks for', () => {
    expect(line(full, 'title-org-date')).toBe('Payments platform — Tech lead · Acme · 2021 – 2023')
    expect(line(full, 'title-date-org')).toBe('Payments platform — 2021 – 2023 · Tech lead · Acme')
    expect(line(full, 'org-title-date')).toBe('Tech lead · Acme · Payments platform · 2021 – 2023')
    expect(line(full, 'date-org-title')).toBe('2021 – 2023 · Tech lead · Acme · Payments platform')
  })

  it('joins a date range with a dash and everything else with a middot', () => {
    const [org, date] = summarySegments(full, 'org-date-title')
    expect(org.text).toBe('Tech lead · Acme')
    expect(date.text).toBe('2021 – 2023')
  })

  it('leaves the first segment without a joiner', () => {
    expect(summarySegments(full, 'title-org-date')[0].joiner).toBe('')
    expect(summarySegments(full, 'date-title-org')[0].joiner).toBe('')
  })

  it('uses the em-dash lead-in only for the segment that follows a leading title', () => {
    expect(summarySegments(full, 'title-org-date').map((s) => s.joiner))
      .toEqual(['', ' — ', ' · '])
  })

  it('honours the descriptor separator when the title leads', () => {
    const colon = view(full.parts, ':')
    expect(summarySegments(colon, 'title-org-date').map((s) => s.joiner))
      .toEqual(['', ': ', ' · '])
    // The separator is a title lead-in, not a general joiner.
    expect(summarySegments(colon, 'org-title-date').map((s) => s.joiner))
      .toEqual(['', ' · ', ' · '])
  })

  it('keeps the middot when the configured layout puts something before the title', () => {
    expect(summarySegments(full, 'date-title-org').map((s) => s.joiner))
      .toEqual(['', ' · ', ' · '])
  })

  it('leads with the title anyway when the layout\'s earlier slots are empty', () => {
    // Languages carry no date; a date-first layout must still read
    // "Norwegian — Native", not "· Native".
    const language = view([
      { key: 'title', value: 'Norwegian' },
      { key: 'org', value: 'Native' },
    ])
    expect(line(language, 'date-title-org')).toBe('Norwegian — Native')
  })

  it('drops a slot whose parts are all empty', () => {
    const noOrg = view([
      { key: 'title', value: 'Payments platform' },
      { key: 'role', value: '' },
      { key: 'org', value: '' },
      { key: 'date', value: '2023' },
    ])
    expect(summarySegments(noOrg, 'title-org-date').map((s) => s.slot)).toEqual(['title', 'date'])
    expect(line(noOrg, 'title-org-date')).toBe('Payments platform — 2023')
  })

  it('returns nothing at all for a summary with no values', () => {
    // No segment means no leading title to key the joiners off — the empty
    // case has to survive that lookup rather than throw.
    expect(summarySegments(view([]), 'title-org-date')).toEqual([])
    expect(summarySegments(view([{ key: 'title', value: '' }]), 'date-org-title')).toEqual([])
  })
})

describe('summaryColumns', () => {
  const rows: SummaryView[] = [
    view([
      { key: 'title', value: 'Payments platform' },
      { key: 'role', value: 'Tech lead' },
      { key: 'org', value: 'Acme' },
      { key: 'start', value: '2021' },
      { key: 'end', value: '2023' },
    ]),
    view([
      { key: 'title', value: 'Data mesh' },
      { key: 'date', value: '2020' },
    ]),
  ]

  it('columns every key present across the rows, in slot order', () => {
    expect(summaryColumns(rows, 'title-org-date'))
      .toEqual(['title', 'role', 'org', 'start', 'end', 'date'])
    expect(summaryColumns(rows, 'date-org-title'))
      .toEqual(['start', 'end', 'date', 'role', 'org', 'title'])
  })

  it('omits a key no row fills', () => {
    const titleOnly = [view([
      { key: 'title', value: 'Data mesh' },
      { key: 'role', value: '' },
      { key: 'org', value: '' },
      { key: 'start', value: '' },
      { key: 'end', value: '' },
      { key: 'date', value: '' },
    ])]
    expect(summaryColumns(titleOnly, 'title-org-date')).toEqual(['title'])
  })

  it('has no columns for no rows', () => {
    expect(summaryColumns([], 'title-org-date')).toEqual([])
  })
})

describe('tabulatedColumns', () => {
  it('slips a separator column between adjacent start and end dates', () => {
    expect(tabulatedColumns(['title', 'start', 'end']))
      .toEqual(['title', 'start', 'sep', 'end'])
  })

  it('leaves a start that no end follows alone', () => {
    // Nothing to range against — a dangling dash would read as an open end.
    expect(tabulatedColumns(['title', 'start'])).toEqual(['title', 'start'])
    expect(tabulatedColumns(['start', 'title', 'end'])).toEqual(['start', 'title', 'end'])
    expect(tabulatedColumns(['end', 'start'])).toEqual(['end', 'start'])
  })

  it('passes through columns with no dates', () => {
    expect(tabulatedColumns(['title', 'role', 'org'])).toEqual(['title', 'role', 'org'])
    expect(tabulatedColumns([])).toEqual([])
  })
})

describe('fullItemLayout', () => {
  const item = { meta: ['Acme', 'Tech lead'], date: '2021 – 2023' }

  it('puts the date last for the org-first layouts and first for the date-first ones', () => {
    expect(fullItemLayout(item, 'title-org-date').metaParts)
      .toEqual(['Acme', 'Tech lead', '2021 – 2023'])
    expect(fullItemLayout(item, 'lead-org-date').metaParts)
      .toEqual(['Acme', 'Tech lead', '2021 – 2023'])
    expect(fullItemLayout(item, 'title-date-org').metaParts)
      .toEqual(['2021 – 2023', 'Acme', 'Tech lead'])
    expect(fullItemLayout(item, 'lead-date-org').metaParts)
      .toEqual(['2021 – 2023', 'Acme', 'Tech lead'])
  })

  it('draws the details line above the title only for the lead layouts', () => {
    expect(fullItemLayout(item, 'title-org-date').metaFirst).toBe(false)
    expect(fullItemLayout(item, 'title-date-org').metaFirst).toBe(false)
    expect(fullItemLayout(item, 'lead-org-date').metaFirst).toBe(true)
    expect(fullItemLayout(item, 'lead-date-org').metaFirst).toBe(true)
  })

  it('drops the empty parts rather than rendering a bare separator', () => {
    const sparse = { meta: ['', 'Acme', ''], date: '' }
    expect(fullItemLayout(sparse, 'title-org-date').metaParts).toEqual(['Acme'])
    expect(fullItemLayout(sparse, 'title-date-org').metaParts).toEqual(['Acme'])
    expect(fullItemLayout({ meta: [], date: '' }, 'lead-org-date').metaParts).toEqual([])
  })

  it('falls back to the details-line-last order for a value outside the enum', () => {
    const out = fullItemLayout(item, 'sideways' as FullLayout)
    expect(out.metaParts).toEqual(['Acme', 'Tech lead', '2021 – 2023'])
    expect(out.metaFirst).toBe(false)
  })
})
