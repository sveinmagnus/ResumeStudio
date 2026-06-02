/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextField, DateField, TagField } from '../../src/components/ui/Fields'
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
})

describe('<TagField>', () => {
  function Wrap() {
    const [tags, setTags] = useState<string[]>([])
    return <TagField label="Tags" tags={tags} onChange={setTags} />
  }

  it('adds a tag on Enter (lower-cased) and removes it', async () => {
    render(<Wrap />)
    const input = screen.getByPlaceholderText('add tag…')
    await userEvent.type(input, 'React{Enter}')
    expect(screen.getByText('react')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '×' }))
    expect(screen.queryByText('react')).not.toBeInTheDocument()
  })

  it('does not add duplicate tags', async () => {
    render(<Wrap />)
    const input = screen.getByPlaceholderText('add tag…')
    await userEvent.type(input, 'node{Enter}')
    await userEvent.type(input, 'node{Enter}')
    expect(screen.getAllByText('node')).toHaveLength(1)
  })
})
