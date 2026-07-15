/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SummarizeAllButton } from '../../src/components/ui/SummarizeAllButton'
import { SortBar } from '../../src/components/ui/SortBar'
import { api } from '../../src/lib/api'
import { resetSummarizeAvailability } from '../../src/lib/summarizeClient'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeResume, makeCourse } from '../fixtures'
import type { ResumeStore } from '../../src/types'

/** Seed the store with courses and set the visible language columns. */
function seed(courses: ResumeStore['courses'], secondary: string | null = null) {
  useStore.setState({
    data: { ...emptyStore(), resume: makeResume({ id: 'r1' }), courses },
    hasData: true,
    primaryLocale: 'no',
    secondaryLocale: secondary,
  })
}

/** Pretend the server has a summarize backend (or not). */
function backend(configured: boolean) {
  resetSummarizeAvailability()
  vi.spyOn(api, 'summarizeStatus').mockResolvedValue(configured)
}

beforeEach(() => {
  resetStore()
  vi.restoreAllMocks()
  resetSummarizeAvailability()
})

describe('SummarizeAllButton — when it shows', () => {
  it('shows with the count of empty fields it can fill', async () => {
    backend(true)
    seed([
      makeCourse({ id: 'c1', description: { no: 'Lang tekst' } }),
      makeCourse({ id: 'c2', description: { no: 'Mer tekst' } }),
    ])
    render(<SummarizeAllButton section="courses" />)
    expect(await screen.findByRole('button', { name: /Summarize all empty \(2\)/ })).toBeInTheDocument()
  })

  it('stays hidden when no summarize backend is configured', async () => {
    backend(false)
    seed([makeCourse({ id: 'c1', description: { no: 'Lang tekst' } })])
    render(<SummarizeAllButton section="courses" />)
    await waitFor(() => expect(api.summarizeStatus).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Summarize all empty/ })).not.toBeInTheDocument()
  })

  it('stays hidden when every summary is already filled', async () => {
    backend(true)
    seed([makeCourse({ id: 'c1', description: { no: 'Tekst' }, short_description: { no: 'Fylt' } })])
    render(<SummarizeAllButton section="courses" />)
    await waitFor(() => expect(api.summarizeStatus).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Summarize all empty/ })).not.toBeInTheDocument()
  })

  it('stays hidden when there is nothing to summarize from', async () => {
    backend(true)
    seed([makeCourse({ id: 'c1', description: {} })])
    render(<SummarizeAllButton section="courses" />)
    await waitFor(() => expect(api.summarizeStatus).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Summarize all empty/ })).not.toBeInTheDocument()
  })

  it('counts both visible columns when a secondary language is shown', async () => {
    backend(true)
    seed([makeCourse({ id: 'c1', description: { no: 'Norsk tekst', en: 'English text' } })], 'en')
    render(<SummarizeAllButton section="courses" />)
    expect(await screen.findByRole('button', { name: /Summarize all empty \(2\)/ })).toBeInTheDocument()
  })

  it('counts only the primary column when the secondary is hidden', async () => {
    backend(true)
    seed([makeCourse({ id: 'c1', description: { no: 'Norsk tekst', en: 'English text' } })], null)
    render(<SummarizeAllButton section="courses" />)
    expect(await screen.findByRole('button', { name: /Summarize all empty \(1\)/ })).toBeInTheDocument()
  })

  it('renders nothing at all for a section with no summary field', async () => {
    backend(true)
    seed([])
    const { container } = render(<SummarizeAllButton section="spoken_languages" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('SummarizeAllButton — running the batch', () => {
  it('fills every empty field and writes the results into the store', async () => {
    backend(true)
    vi.spyOn(api, 'summarize').mockImplementation(async (text: string) => `summary of ${text}`)
    seed([
      makeCourse({ id: 'c1', description: { no: 'Første' } }),
      makeCourse({ id: 'c2', description: { no: 'Andre' } }),
    ])
    render(<SummarizeAllButton section="courses" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarize all empty \(2\)/ }))

    await waitFor(() => {
      const courses = useStore.getState().data.courses
      expect(courses[0].short_description).toEqual({ no: 'summary of Første' })
      expect(courses[1].short_description).toEqual({ no: 'summary of Andre' })
    })
  })

  it('summarizes each locale from that locale — the model writes what it reads', async () => {
    backend(true)
    const spy = vi.spyOn(api, 'summarize').mockImplementation(async (t, l) => `[${l}] ${t}`)
    seed([makeCourse({ id: 'c1', description: { no: 'Norsk kilde', en: 'English source' } })], 'en')
    render(<SummarizeAllButton section="courses" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarize all empty \(2\)/ }))

    await waitFor(() => {
      expect(useStore.getState().data.courses[0].short_description).toEqual({
        no: '[no] Norsk kilde', en: '[en] English source',
      })
    })
    expect(spy).toHaveBeenCalledWith('Norsk kilde', 'no')
    expect(spy).toHaveBeenCalledWith('English source', 'en')
  })

  it('applies the whole batch as ONE undo step', async () => {
    backend(true)
    vi.spyOn(api, 'summarize').mockResolvedValue('A summary')
    seed([
      makeCourse({ id: 'c1', description: { no: 'A' } }),
      makeCourse({ id: 'c2', description: { no: 'B' } }),
      makeCourse({ id: 'c3', description: { no: 'C' } }),
    ])
    const before = useStore.getState().mutationCount
    render(<SummarizeAllButton section="courses" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarize all empty \(3\)/ }))

    await waitFor(() => {
      expect(useStore.getState().data.courses[2].short_description).toEqual({ no: 'A summary' })
    })
    // Three fields filled, one mutation — not three.
    expect(useStore.getState().mutationCount).toBe(before + 1)
  })

  it('does not touch a summary the user already wrote', async () => {
    backend(true)
    vi.spyOn(api, 'summarize').mockResolvedValue('Drafted')
    seed([
      makeCourse({ id: 'c1', description: { no: 'A' }, short_description: { no: 'Håndskrevet' } }),
      makeCourse({ id: 'c2', description: { no: 'B' } }),
    ])
    render(<SummarizeAllButton section="courses" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarize all empty \(1\)/ }))

    await waitFor(() => {
      expect(useStore.getState().data.courses[1].short_description).toEqual({ no: 'Drafted' })
    })
    expect(useStore.getState().data.courses[0].short_description).toEqual({ no: 'Håndskrevet' })
  })

  it('disappears once there is nothing left to fill', async () => {
    backend(true)
    vi.spyOn(api, 'summarize').mockResolvedValue('Done')
    seed([makeCourse({ id: 'c1', description: { no: 'A' } })])
    render(<SummarizeAllButton section="courses" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarize all empty \(1\)/ }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Summarize all empty/ })).not.toBeInTheDocument()
    })
  })

  it('keeps what succeeded when the backend fails partway, and says so', async () => {
    backend(true)
    vi.spyOn(api, 'summarize')
      .mockResolvedValueOnce('First one')
      .mockRejectedValue(new Error('Model not found'))
    seed([
      makeCourse({ id: 'c1', description: { no: 'A' } }),
      makeCourse({ id: 'c2', description: { no: 'B' } }),
      makeCourse({ id: 'c3', description: { no: 'C' } }),
    ])
    render(<SummarizeAllButton section="courses" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarize all empty \(3\)/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Model not found')
    expect(alert).toHaveTextContent('kept the 1 that succeeded')
    expect(useStore.getState().data.courses[0].short_description).toEqual({ no: 'First one' })
    expect(useStore.getState().data.courses[1].short_description ?? {}).toEqual({})
  })

  it('reports a failure with nothing kept when the first call fails', async () => {
    backend(true)
    vi.spyOn(api, 'summarize').mockRejectedValue(new Error('Backend down'))
    seed([makeCourse({ id: 'c1', description: { no: 'A' } })])
    render(<SummarizeAllButton section="courses" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarize all empty \(1\)/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Backend down')
    expect(alert).not.toHaveTextContent('succeeded')
    expect(useStore.getState().mutationCount).toBe(0) // nothing applied
  })

  it('shows progress while running and lets the user stop', async () => {
    backend(true)
    let release: (v: string) => void = () => {}
    vi.spyOn(api, 'summarize')
      .mockImplementationOnce(() => new Promise((res) => { release = res }))
      .mockResolvedValue('Later one')
    seed([
      makeCourse({ id: 'c1', description: { no: 'A' } }),
      makeCourse({ id: 'c2', description: { no: 'B' } }),
    ])
    render(<SummarizeAllButton section="courses" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarize all empty \(2\)/ }))

    const progress = await screen.findByRole('button', { name: /Summarizing 1 of 2/ })
    await userEvent.click(progress) // stop
    release('First one')

    await waitFor(() => {
      // The in-flight one is kept; the second was never requested.
      expect(useStore.getState().data.courses[0].short_description).toEqual({ no: 'First one' })
      expect(useStore.getState().data.courses[1].short_description ?? {}).toEqual({})
    })
  })
})

describe('SortBar integration', () => {
  it('sits next to Bulk add in the section bar', async () => {
    backend(true)
    seed([makeCourse({ id: 'c1', description: { no: 'Tekst' } })])
    render(<SortBar section="courses" count={1} />)
    expect(await screen.findByRole('button', { name: /Summarize all empty \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bulk add/ })).toBeInTheDocument()
  })

  it('leaves Bulk add alone on a section with no summary field', async () => {
    backend(true)
    useStore.setState({
      data: { ...emptyStore(), resume: makeResume({ id: 'r1' }) },
      hasData: true, primaryLocale: 'no', secondaryLocale: null,
    })
    render(<SortBar section="references" count={0} />)
    expect(screen.getByRole('button', { name: /Bulk add/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Summarize all empty/ })).not.toBeInTheDocument()
  })
})
