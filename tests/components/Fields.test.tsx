/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextField, DateField } from '../../src/components/ui/Fields'
import type { YearMonth } from '../../src/types'

describe('<TextField>', () => {
  it('reflects typed input through onChange', async () => {
    function Wrap() {
      const [v, setV] = useState('')
      return <TextField label="Name" value={v} onChange={setV} />
    }
    render(<Wrap />)
    await userEvent.type(screen.getByRole('textbox'), 'Hello')
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument()
  })
})

describe('<DateField>', () => {
  function Wrap() {
    const [v, setV] = useState<YearMonth | null>(null)
    return <DateField label="Date" value={v} onChange={setV} allowOngoing />
  }

  it('captures a year and then a month', async () => {
    render(<Wrap />)
    await userEvent.type(screen.getByPlaceholderText('Year'), '2022')
    expect(screen.getByDisplayValue('2022')).toBeInTheDocument()
    // Month select only commits once a year is present.
    await userEvent.selectOptions(screen.getByRole('combobox'), '3')
    expect(screen.getByDisplayValue('Mar')).toBeInTheDocument()
  })

  it('clears to ongoing via the toggle button', async () => {
    render(<Wrap />)
    await userEvent.type(screen.getByPlaceholderText('Year'), '2020')
    // With a value set, the button reads "Clear"; clicking it nulls the date.
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: 'Ongoing' })).toBeInTheDocument()
  })

  // Regression: a single-date field (no allowOngoing — e.g. publications) used
  // to REJECT an emptied year and revert the controlled input to the prior
  // year, so select-all → delete → retype silently restored the old value.
  it('clears the year to empty when the field is emptied (no allowOngoing)', async () => {
    let latest: YearMonth | null | undefined
    function Wrap2() {
      const [v, setV] = useState<YearMonth | null>({ year: 2023, month: null })
      latest = v
      return <DateField label="Date" value={v} onChange={(nv) => { latest = nv; setV(nv) }} />
    }
    render(<Wrap2 />)
    const year = screen.getByPlaceholderText('Year')
    await userEvent.clear(year)
    // The field actually empties (no revert to 2023) and the date becomes null.
    expect((year as HTMLInputElement).value).toBe('')
    expect(latest).toBeNull()
  })

  it('a fresh year replaces the old one after emptying (no stale revert)', async () => {
    function Wrap3() {
      const [v, setV] = useState<YearMonth | null>({ year: 2023, month: null })
      return <DateField label="Date" value={v} onChange={setV} />
    }
    render(<Wrap3 />)
    const year = screen.getByPlaceholderText('Year')
    await userEvent.clear(year)
    await userEvent.type(year, '2006')
    expect(screen.getByDisplayValue('2006')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('2023')).not.toBeInTheDocument()
  })

  it('steps the year up and down with the arrow buttons', async () => {
    function Wrap4() {
      const [v, setV] = useState<YearMonth | null>({ year: 2020, month: 3 })
      return <DateField label="Date" value={v} onChange={setV} />
    }
    render(<Wrap4 />)
    await userEvent.click(screen.getByRole('button', { name: /increase year/i }))
    expect(screen.getByDisplayValue('2021')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /decrease year/i }))
    await userEvent.click(screen.getByRole('button', { name: /decrease year/i }))
    expect(screen.getByDisplayValue('2019')).toBeInTheDocument()
    // The month is preserved across steps.
    expect(screen.getByDisplayValue('Mar')).toBeInTheDocument()
  })

  it('seeds the current year when stepping an empty field', async () => {
    let latest: YearMonth | null | undefined
    function Wrap5() {
      const [v, setV] = useState<YearMonth | null>(null)
      return <DateField label="Date" value={v} onChange={(nv) => { latest = nv; setV(nv) }} />
    }
    render(<Wrap5 />)
    await userEvent.click(screen.getByRole('button', { name: /increase year/i }))
    expect(latest).toEqual({ year: new Date().getFullYear(), month: null })
  })
})
