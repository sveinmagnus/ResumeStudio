/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CareerTimeline } from '../../src/components/editor/CareerTimeline'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeWork, makeProject, makeEducation } from '../fixtures'
import type { ResumeStore } from '../../src/types'

function seed(over: Partial<ResumeStore> = {}) {
  useStore.setState({
    data: { ...emptyStore(), ...over },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'overview', expandedItemId: null, mutationCount: 0,
  })
}

describe('<CareerTimeline>', () => {
  beforeEach(() => resetStore())

  it('renders nothing when there is no dated history', () => {
    seed()
    const { container } = render(<CareerTimeline />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders employment + project bars and a gap note', () => {
    seed({
      work_experiences: [
        makeWork({ id: 'w1', employer: { en: 'Cartavio' }, start: { year: 2018, month: 1 }, end: { year: 2019, month: 6 } }),
        makeWork({ id: 'w2', employer: { en: 'OldCorp' }, start: { year: 2021, month: 1 }, end: null }),
      ],
      projects: [makeProject({ id: 'p1', customer: { en: 'AcmeProj' }, start: { year: 2021, month: 3 }, end: { year: 2021, month: 9 } })],
    })
    render(<CareerTimeline />)
    expect(screen.getByText('Career timeline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Employment: Cartavio/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Project: AcmeProj/i })).toBeInTheDocument()
    // Jul 2019 → Dec 2020 is an 18-month gap with no work or education.
    expect(screen.getByText(/1 gap in work history/i)).toBeInTheDocument()
  })

  it('renders an education bar and a study period fills the gap', () => {
    seed({
      work_experiences: [
        makeWork({ id: 'w1', employer: { en: 'Cartavio' }, start: { year: 2018, month: 1 }, end: { year: 2019, month: 6 } }),
        makeWork({ id: 'w2', employer: { en: 'NewCo' }, start: { year: 2021, month: 1 }, end: null }),
      ],
      // Education covers Jul 2019 – Dec 2020, the span that was an employment gap.
      educations: [makeEducation({ id: 'e1', school: { en: 'NTNU' }, start: { year: 2019, month: 7 }, end: { year: 2020, month: 12 } })],
    })
    render(<CareerTimeline />)
    expect(screen.getByRole('button', { name: /Education: NTNU/i })).toBeInTheDocument()
    expect(screen.queryByText(/gap in work history/i)).not.toBeInTheDocument()
  })

  it('opens the full-width zoom modal and closes it', async () => {
    seed({
      work_experiences: [makeWork({ id: 'w1', employer: { en: 'Cartavio' }, start: { year: 2020, month: 1 }, end: null })],
    })
    render(<CareerTimeline />)
    await userEvent.click(screen.getByRole('button', { name: /expand timeline to full width/i }))
    const dialog = screen.getByRole('dialog', { name: /career timeline/i })
    expect(dialog).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('clicking an employment bar navigates and expands it', async () => {
    seed({
      work_experiences: [makeWork({ id: 'w1', employer: { en: 'Cartavio' }, start: { year: 2020, month: 1 }, end: null })],
    })
    render(<CareerTimeline />)
    await userEvent.click(screen.getByRole('button', { name: /Employment: Cartavio/i }))
    expect(useStore.getState().activeSection).toBe('work_experiences')
    expect(useStore.getState().expandedItemId).toBe('w1')
  })
})
