/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Autocomplete } from '../../src/components/ui/Autocomplete'

const OPTIONS = [
  { id: 'ts', label: 'TypeScript', sublabel: 'technical' },
  { id: 'js', label: 'JavaScript', sublabel: 'technical' },
  { id: 'py', label: 'Python', sublabel: 'technical' },
]

describe('<Autocomplete>', () => {
  it('opens the dropdown on focus and shows all options when empty', async () => {
    const user = userEvent.setup()
    render(<Autocomplete options={OPTIONS} onPick={() => {}} addLabel="skill" />)
    const input = screen.getByRole('textbox')
    await user.click(input)
    expect(screen.getByRole('option', { name: /TypeScript/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /JavaScript/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Python/ })).toBeInTheDocument()
  })

  it('filters options by case-insensitive substring match', async () => {
    const user = userEvent.setup()
    render(<Autocomplete options={OPTIONS} onPick={() => {}} addLabel="skill" />)
    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.type(input, 'pt')  // matches "TypeScript"
    expect(screen.getByRole('option', { name: /TypeScript/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Python/ })).not.toBeInTheDocument()
  })

  it('picks the highlighted option on Enter', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Autocomplete options={OPTIONS} onPick={onPick} addLabel="skill" />)
    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.type(input, 'java{Enter}')
    expect(onPick).toHaveBeenCalledWith('js')
  })

  it('clicking a row picks that option', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Autocomplete options={OPTIONS} onPick={onPick} addLabel="skill" />)
    await user.click(screen.getByRole('textbox'))
    await user.click(screen.getByRole('option', { name: /Python/ }))
    expect(onPick).toHaveBeenCalledWith('py')
  })

  it('shows an "Add" button only when onAddNew is provided and no exact match exists', async () => {
    const user = userEvent.setup()
    render(
      <Autocomplete
        options={OPTIONS}
        onPick={() => {}}
        onAddNew={() => {}}
        addLabel="skill"
      />,
    )
    const input = screen.getByRole('textbox')
    await user.click(input)
    // Typing a query with no exact match — Add button appears.
    await user.type(input, 'Rust')
    expect(screen.getAllByRole('button', { name: /Add/ })[0]).toBeInTheDocument()

    // Clear, then type an exact label — no Add button.
    await user.clear(input)
    await user.type(input, 'TypeScript')
    // The dropdown's add-new row only appears when there's no exact match.
    expect(screen.queryByText(/Add new skill/)).not.toBeInTheDocument()
  })

  it('Enter on a no-match query calls onAddNew with the trimmed text', async () => {
    const user = userEvent.setup()
    const onAddNew = vi.fn()
    render(
      <Autocomplete
        options={OPTIONS}
        onPick={() => {}}
        onAddNew={onAddNew}
        addLabel="skill"
      />,
    )
    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.type(input, '  Kotlin  {Enter}')
    expect(onAddNew).toHaveBeenCalledWith('Kotlin')
  })

  it('does not call onAddNew when no handler is provided', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Autocomplete options={OPTIONS} onPick={onPick} addLabel="skill" />)
    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.type(input, 'NoSuchThing{Enter}')
    // No exact / partial match and no onAddNew → Enter is a no-op.
    expect(onPick).not.toHaveBeenCalled()
  })
})
