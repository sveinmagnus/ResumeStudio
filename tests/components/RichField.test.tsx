/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RichField } from '../../src/components/ui/RichField'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { resetTranslationAvailability } from '../../src/lib/translateClient'

/** Minimal clipboardData stand-in — fireEvent assigns it onto the event. */
const clipboard = (data: Record<string, string>) => ({
  clipboardData: { getData: (type: string) => data[type] || '' },
})

describe('<RichField>', () => {
  beforeEach(() => {
    resetStore()
    resetTranslationAvailability()
    useStore.setState({ primaryLocale: 'en', secondaryLocale: null })
  })
  afterEach(() => vi.restoreAllMocks())

  it('cleans pasted HTML down to the allowed tags', () => {
    const onChange = vi.fn()
    render(<RichField label="Description" value={{}} onChange={onChange} />)
    const editor = screen.getByRole('textbox')
    fireEvent.paste(editor, clipboard({
      'text/html': '<div style="color:red">one <span style="font-weight:700">bold</span></div><div>two</div>',
    }))
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls.at(-1)![0] as Record<string, string>
    expect(next.en).toBe('<p>one <strong>bold</strong></p><p>two</p>')
  })

  it('does not let the Google Docs bold wrapper bold everything', () => {
    const onChange = vi.fn()
    render(<RichField label="Description" value={{}} onChange={onChange} />)
    fireEvent.paste(screen.getByRole('textbox'), clipboard({
      'text/html': '<b style="font-weight:normal" id="docs-internal-guid-1"><p>plain text</p></b>',
    }))
    const next = onChange.mock.calls.at(-1)![0] as Record<string, string>
    expect(next.en).toBe('<p>plain text</p>')
  })

  it('falls back to plain-text paste when no HTML flavour exists', () => {
    const onChange = vi.fn()
    render(<RichField label="Description" value={{}} onChange={onChange} />)
    fireEvent.paste(screen.getByRole('textbox'), clipboard({
      'text/plain': 'line one\n\nline two',
    }))
    const next = onChange.mock.calls.at(-1)![0] as Record<string, string>
    expect(next.en).toBe('<p>line one</p><p>line two</p>')
  })

  it('ignores a paste with nothing usable on the clipboard', () => {
    const onChange = vi.fn()
    render(<RichField label="Description" value={{}} onChange={onChange} />)
    fireEvent.paste(screen.getByRole('textbox'), clipboard({}))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables the indent buttons when the caret is not in a list', () => {
    render(<RichField label="Description" value={{}} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Increase indent/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Decrease indent/ })).toBeDisabled()
  })

  it('renders one toolbar per visible locale column', () => {
    useStore.setState({ primaryLocale: 'en', secondaryLocale: 'no' })
    render(<RichField label="Description" value={{}} onChange={() => {}} />)
    expect(screen.getAllByRole('toolbar')).toHaveLength(2)
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
  })
})
