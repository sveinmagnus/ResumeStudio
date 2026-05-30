/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DualField } from '../../src/components/ui/DualField'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'

describe('<DualField>', () => {
  beforeEach(() => resetStore())

  it('renders a single input when no secondary locale is selected', () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: null })
    render(<DualField label="Title" value={{ en: 'hello' }} onChange={() => {}} />)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toHaveValue('hello')
  })

  it('renders two inputs when a secondary locale is selected', () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    render(<DualField label="Title" value={{ en: 'hello', no: 'hei' }} onChange={() => {}} />)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toHaveValue('hello')
    expect(inputs[1]).toHaveValue('hei')
  })

  it('writes the primary-locale key on edit', async () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    const onChange = vi.fn()
    render(<DualField label="Title" value={{ no: 'hei' }} onChange={onChange} />)
    const [primary] = screen.getAllByRole('textbox')
    await userEvent.type(primary, 'X')
    expect(onChange).toHaveBeenLastCalledWith({ no: 'hei', en: 'X' })
  })

  it('writes the secondary-locale key on edit', async () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    const onChange = vi.fn()
    render(<DualField label="Title" value={{ en: 'hello' }} onChange={onChange} />)
    const [, secondary] = screen.getAllByRole('textbox')
    await userEvent.type(secondary, 'Y')
    expect(onChange).toHaveBeenLastCalledWith({ en: 'hello', no: 'Y' })
  })

  it('deletes the locale key when the input is cleared', async () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    const onChange = vi.fn()
    render(<DualField label="Title" value={{ en: 'a', no: 'b' }} onChange={onChange} />)
    const [primary] = screen.getAllByRole('textbox')
    await userEvent.clear(primary)
    // Clearing removes the key — keeps the store free of empty strings.
    expect(onChange).toHaveBeenLastCalledWith({ no: 'b' })
  })
})
