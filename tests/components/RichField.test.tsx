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

  it('sanitises a stored value before writing it into the live DOM (untrusted import)', () => {
    // A backup/snapshot import can carry HTML that never went through this
    // editor's commit path — the DOM write is a render boundary (XSS).
    render(<RichField label="Description" value={{
      en: '<p>ok</p><img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>',
    }} onChange={vi.fn()} />)
    const editor = screen.getByRole('textbox')
    expect(editor.innerHTML).toBe('<p>ok</p>')
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()
  })

  it('repaints a FOCUSED editor when the value changes externally (undo/redo)', () => {
    // Regression: Ctrl+Z updated the store but the contentEditable didn't
    // repaint because it was still focused — the caret-preservation guard also
    // swallowed genuine external changes. The Undo *button* worked only because
    // clicking it blurred the field first.
    const { rerender } = render(
      <RichField label="Description" value={{ en: '<p>hello world</p>' }} onChange={vi.fn()} />,
    )
    const editor = screen.getByRole('textbox')
    expect(editor.innerHTML).toBe('<p>hello world</p>')

    editor.focus()
    // A contentEditable is focusable in jsdom; bail the assertion in if not, so
    // the test only makes its claim when it can actually reproduce the state.
    expect(document.activeElement).toBe(editor)

    // External value change (an undo) arrives while the field is still focused.
    rerender(<RichField label="Description" value={{ en: '<p>hello</p>' }} onChange={vi.fn()} />)
    expect(editor.innerHTML).toBe('<p>hello</p>')
  })

  it('does NOT clobber the caret when the focused DOM already matches (mid-typing)', () => {
    // The other half of the guard: an incoming value that sanitises to what the
    // focused editor already shows must be left alone (no repaint, no caret
    // jump). We approximate "already shows it" by rerendering the same content.
    const { rerender } = render(
      <RichField label="Description" value={{ en: '<p>draft</p>' }} onChange={vi.fn()} />,
    )
    const editor = screen.getByRole('textbox')
    editor.focus()
    const setSpy = vi.spyOn(editor, 'innerHTML', 'set')
    rerender(<RichField label="Description" value={{ en: '<p>draft</p>' }} onChange={vi.fn()} />)
    expect(setSpy).not.toHaveBeenCalled()
  })

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

  // Both Enter keys make a PARAGRAPH. Left to the browser they diverge: plain
  // Enter emits the engine's default separator (a <div> in Chrome, whose
  // boundary the allowlist drops — the two lines silently merged on reload)
  // and Shift+Enter emits a <br>, a break with no paragraph spacing that looks
  // the same while typing and different in every export.
  const enterCases: [string, boolean][] = [['Enter', false], ['Shift+Enter', true]]
  for (const [label, shiftKey] of enterCases) {
    it(`${label} inserts a paragraph, with the separator pinned to <p>`, () => {
      const cmds: [string, unknown][] = []
      const exec = vi.fn((cmd: string, _ui?: boolean, value?: string) => {
        cmds.push([cmd, value])
        return true
      })
      Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })

      render(<RichField label="Description" value={{ en: '<p>a</p>' }} onChange={vi.fn()} />)
      const editor = screen.getByRole('textbox')
      const ev = fireEvent.keyDown(editor, { key: 'Enter', shiftKey })

      // The browser's own handling is suppressed…
      expect(ev).toBe(false) // preventDefault() was called
      // …and the separator is set with the caret live (Chrome ignores it
      // otherwise), immediately before the split.
      expect(cmds).toEqual([['defaultParagraphSeparator', 'p'], ['insertParagraph', undefined]])
    })
  }

  it('leaves Enter alone mid-IME-composition', () => {
    const exec = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })
    render(<RichField label="Description" value={{ en: '<p>a</p>' }} onChange={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true })
    expect(exec).not.toHaveBeenCalled()
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
