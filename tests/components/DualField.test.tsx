/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DualField } from '../../src/components/ui/DualField'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { api } from '../../src/lib/api'
import { resetTranslationAvailability } from '../../src/lib/translateClient'

describe('<DualField>', () => {
  beforeEach(() => {
    resetStore()
    resetTranslationAvailability()
  })
  afterEach(() => vi.restoreAllMocks())

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

  // ── Accessible names + language of parts ───────────────────────────────

  it('gives each input an accessible name combining label and locale', () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    render(<DualField label="Title" value={{}} onChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'Title (English)' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Title (Norsk)' })).toBeInTheDocument()
  })

  it('associates the visible label with the primary input (click-to-focus)', () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    render(<DualField label="Title" value={{}} onChange={() => {}} />)
    const primary = screen.getByRole('textbox', { name: 'Title (English)' })
    expect(screen.getByText('Title')).toHaveAttribute('for', primary.id)
  })

  it('sets a BCP-47 lang per column (se → sv, dk → da)', () => {
    useStore.setState({ primaryLocale: 'se', secondaryLocale: 'dk' })
    render(<DualField label="Title" value={{}} onChange={() => {}} multiline />)
    const [primary, secondary] = screen.getAllByRole('textbox')
    expect(primary).toHaveAttribute('lang', 'sv')
    expect(secondary).toHaveAttribute('lang', 'da')
  })

  // ── Translation assist ──────────────────────────────────────────────────

  it('copies the primary value into the secondary locale on "Copy"', async () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    const onChange = vi.fn()
    render(<DualField label="Title" value={{ en: 'hello' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(onChange).toHaveBeenLastCalledWith({ en: 'hello', no: 'hello' })
  })

  it('disables "Copy" when the primary value is empty', () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    render(<DualField label="Title" value={{ no: 'hei' }} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /copy/i })).toBeDisabled()
  })

  it('shows a Draft button only when translation is configured, and fills a draft', async () => {
    vi.spyOn(api, 'translateStatus').mockResolvedValue(true)
    const translateSpy = vi.spyOn(api, 'translate').mockResolvedValue('hei oversatt')
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    const onChange = vi.fn()
    render(<DualField label="Title" value={{ en: 'hello' }} onChange={onChange} />)

    // Appears asynchronously once the availability probe resolves.
    const draft = await screen.findByRole('button', { name: /draft/i })
    await userEvent.click(draft)

    expect(translateSpy).toHaveBeenCalledWith('hello', 'en', 'no')
    expect(onChange).toHaveBeenLastCalledWith({ en: 'hello', no: 'hei oversatt' })
    expect(await screen.findByText(/please review/i)).toBeInTheDocument()
  })

  it('hides the Draft button when translation is not configured', async () => {
    vi.spyOn(api, 'translateStatus').mockResolvedValue(false)
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    render(<DualField label="Title" value={{ en: 'hello' }} onChange={() => {}} />)
    // Copy is always present; give the probe a tick to resolve, then assert no Draft.
    expect(await screen.findByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /draft/i })).not.toBeInTheDocument()
  })
})
