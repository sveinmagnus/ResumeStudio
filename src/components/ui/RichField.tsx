import { useEffect, useId, useState, useRef, useLayoutEffect } from 'react'
import {
  Copy, Languages, Loader2, Bold, Italic, Underline, List, ListOrdered,
  IndentIncrease, IndentDecrease,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { LocalizedString } from '../../types'
import { LOCALE_LABELS, bcp47 } from '../../lib/locales'
import { api } from '../../lib/api'
import { canDraftBetween } from '../../lib/translateClient'
import { useTranslationAvailable } from '../../store/useTranslation'
import { sanitizeRich, cleanPastedHtml, plainToRichHtml } from '../../lib/richText'

interface RichFieldProps {
  label: string
  value: LocalizedString
  onChange: (next: LocalizedString) => void
  placeholder?: string
}

/**
 * Localized rich-text editor — sibling of DualField. Renders one
 * contentEditable per visible locale with a tiny toolbar (bold, italic,
 * underline, bullet list, numbered list, list indent/outdent).
 *
 * Storage is sanitised HTML per locale. The toolbar uses document.execCommand
 * — deprecated but still the lowest-friction primitive for these few tags.
 * Every blur sanitises the buffer so we never trust the editor's output.
 *
 * Paste is intercepted: clipboard HTML (Word / Google Docs / websites) is
 * normalised through `cleanPastedHtml` before insertion, so the editor never
 * shows — and the store never receives — foreign formatting.
 *
 * Copy / Draft assist mirror DualField semantics.
 */
export function RichField({ label, value, onChange, placeholder }: RichFieldProps) {
  const primary = useStore((s) => s.primaryLocale)
  const secondary = useStore((s) => s.secondaryLocale)
  const translationAvailable = useTranslationAvailable()

  // Assist state keys off the TARGET locale so Copy/Draft can run in either
  // direction (primary→secondary or secondary→primary) — see DualField.
  const [busyLocale, setBusyLocale] = useState<string | null>(null)
  const [draftedLocale, setDraftedLocale] = useState<string | null>(null)
  const [error, setError] = useState<{ locale: string; msg: string } | null>(null)

  const set = (locale: string, html: string) => {
    const next = { ...value }
    const clean = sanitizeRich(html)
    if (clean) next[locale] = clean
    else delete next[locale]
    onChange(next)
  }

  const textOf = (locale: string) => stripTags(value[locale] || '').trim()

  const commit = (locale: string, html: string) => {
    set(locale, html)
    // Editing a column clears its own draft/error annotation.
    if (draftedLocale === locale) setDraftedLocale(null)
    if (error?.locale === locale) setError(null)
  }

  const copyBetween = (from: string, to: string) => {
    if (!textOf(from)) return
    set(to, value[from] || '')
    if (draftedLocale === to) setDraftedLocale(null)
    if (error?.locale === to) setError(null)
  }

  const draftBetween = async (from: string, to: string) => {
    const sourcePlain = textOf(from)
    if (!sourcePlain || busyLocale) return
    setBusyLocale(to)
    setError(null)
    try {
      // Translate the plain-text projection — the backend doesn't preserve
      // markup, so we don't pretend to round-trip it.
      const translated = await api.translate(sourcePlain, from, to)
      set(to, translated)
      setDraftedLocale(to)
    } catch (e) {
      setError({ locale: to, msg: (e as Error).message || 'Translation failed' })
    } finally {
      setBusyLocale(null)
    }
  }

  const fieldId = useId()

  // Assist (Copy + Draft) on whichever column is EMPTY, sourcing from the other
  // — bidirectional, mirroring DualField.
  const renderAssist = (target: string, source: string) => {
    if (!textOf(source) || textOf(target)) return null
    const sourceName = LOCALE_LABELS[source]?.name || source
    const canDraft = translationAvailable && canDraftBetween(source, target)
    const busy = busyLocale === target
    return (
      <div className="rf-actions">
        <button
          type="button"
          className="rf-assist-btn"
          onClick={() => copyBetween(source, target)}
          title={`Copy the ${sourceName} text here as a starting point`}
        >
          <Copy size={12} /> Copy
        </button>
        {canDraft && (
          <button
            type="button"
            className="rf-assist-btn rf-draft-btn"
            onClick={() => void draftBetween(source, target)}
            disabled={busy}
            title={`Draft a translation from ${sourceName} (review required)`}
          >
            {busy ? <Loader2 size={12} className="rf-spin" /> : <Languages size={12} />}
            {busy ? 'Drafting…' : 'Draft'}
          </button>
        )}
      </div>
    )
  }

  const renderNotes = (locale: string) => (
    <>
      {draftedLocale === locale && error?.locale !== locale && (
        <span className="rf-note rf-note-draft" role="status">Machine draft — please review</span>
      )}
      {error?.locale === locale && <span className="rf-note rf-note-error" role="alert">{error.msg}</span>}
    </>
  )

  return (
    <div className="rf-wrap">
      {/* contentEditable can't take htmlFor — the columns name themselves
          via aria-label ("Description (Norsk)") built from this label. */}
      <span className="rf-label" id={`${fieldId}-label`}>{label}</span>
      <div className={`rf-grid ${secondary ? 'rf-dual' : 'rf-single'}`}>
        <div className="rf-sec-col">
          <RichColumn
            variant="primary"
            locale={primary}
            fieldLabel={label}
            html={value[primary] || ''}
            onCommit={(html) => commit(primary, html)}
            placeholder={placeholder}
            header={secondary ? renderAssist(primary, secondary) : undefined}
          />
          {secondary && renderNotes(primary)}
        </div>
        {secondary && (
          <div className="rf-sec-col">
            <RichColumn
              variant="secondary"
              locale={secondary}
              fieldLabel={label}
              html={value[secondary] || ''}
              onCommit={(html) => commit(secondary, html)}
              placeholder={placeholder}
              header={renderAssist(secondary, primary)}
            />
            {renderNotes(secondary)}
          </div>
        )}
      </div>

      <style>{`
        .rf-wrap { margin-bottom: 18px; animation: fadeIn .3s ease; container-type: inline-size; }
        .rf-label {
          display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
        }
        .rf-grid { display: grid; gap: 12px; }
        .rf-dual { grid-template-columns: 1fr 1fr; }
        .rf-single { grid-template-columns: 1fr; }
        /* Reflow (WCAG 1.4.10): stack the locale columns when the field is
           narrow — same container query as DualField. */
        @container (max-width: 560px) {
          .rf-dual { grid-template-columns: 1fr; }
        }
        .rf-sec-col { display: flex; flex-direction: column; gap: 4px; }
        .rf-actions { display: flex; align-items: center; gap: 4px; }
        .rf-assist-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 7px; border-radius: var(--r-sm);
          font-size: 11px; font-weight: 600; color: var(--ink-soft);
          background: var(--paper-sunken); border: 1px solid var(--line);
          transition: color .12s, background .12s, border-color .12s, box-shadow .12s; cursor: pointer;
        }
        .rf-assist-btn:hover:not(:disabled) { border-color: var(--secondary-ink); color: var(--secondary-ink-text); }
        .rf-assist-btn:disabled { opacity: .4; cursor: default; }
        .rf-draft-btn:hover:not(:disabled) { background: var(--secondary-tint); }
        .rf-spin { animation: rf-spin 1s linear infinite; }
        @keyframes rf-spin { to { transform: rotate(360deg); } }
        .rf-note { font-size: 11px; margin-top: 1px; }
        .rf-note-draft { color: var(--secondary-ink-text); }
        .rf-note-error { color: var(--err-ink); }
      `}</style>
    </div>
  )
}

// ─── One contentEditable column ─────────────────────────────────────────────

interface RichColumnProps {
  variant: 'primary' | 'secondary'
  locale: string
  /** The field's visible label — combined with the locale name for the accessible name. */
  fieldLabel: string
  html: string
  onCommit: (html: string) => void
  placeholder?: string
  /** Inline content rendered to the right of the locale tag (e.g. assist buttons). */
  header?: React.ReactNode
}

function RichColumn({ variant, locale, fieldLabel, html, onCommit, placeholder, header }: RichColumnProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false, inList: false })

  /** Is the selection anchored inside a list item of this editor? */
  const selectionInListItem = () => {
    const el = editorRef.current
    const sel = window.getSelection()
    if (!el || !sel || !sel.anchorNode) return false
    let n: Node | null = sel.anchorNode
    while (n && n !== el) {
      if (n.nodeType === 1 && (n as Element).tagName === 'LI') return true
      n = n.parentNode
    }
    return false
  }

  // Track the inline-format state at the caret so the toolbar toggles can
  // expose aria-pressed. queryCommandState is deprecated alongside
  // execCommand, but it is the matching primitive; guarded for jsdom.
  useEffect(() => {
    const update = () => {
      const el = editorRef.current
      if (!el || document.activeElement !== el) return
      const inList = selectionInListItem()
      if (typeof document.queryCommandState !== 'function') {
        setFmt((f) => ({ ...f, inList }))
        return
      }
      try {
        setFmt({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          inList,
        })
      } catch {
        // Some engines throw for unfocused selections — keep the last state.
      }
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])

  /**
   * We treat the contentEditable as uncontrolled: we set innerHTML manually
   * when the store value diverges from the DOM (load, undo, copy-from-primary,
   * draft), and never re-set during the user's own typing — doing so would
   * collapse the caret to the start every keystroke.
   *
   * SECURITY: the stored value is sanitised on every write through this
   * editor, but the store can also be filled by an untrusted backup/snapshot
   * import — so this DOM write is a render boundary and must sanitise too
   * (same rule as renderRichHtml on the export side). sanitizeRich is
   * idempotent, so editor-written values pass through unchanged.
   */
  useLayoutEffect(() => {
    const el = editorRef.current
    if (!el) return
    const clean = sanitizeRich(html)
    if (el.innerHTML === clean) return
    // While the field is focused, only repaint when the incoming value is
    // genuinely DIFFERENT content — an external change (undo/redo, copy, draft)
    // — not merely the sanitiser's reformatting of what the user is typing
    // right now (repainting that would jump the caret every keystroke).
    // Comparing the SANITISED DOM against the incoming value separates the two:
    // equal ⇒ the same content the user just produced, leave the caret alone;
    // different ⇒ external, so repaint even mid-focus. This is what makes Ctrl+Z
    // update the field while the caret is still inside it — clicking the Undo
    // button blurs the field first, which is why only the keyboard path looked
    // broken.
    const focused = document.activeElement === el
    if (focused && sanitizeRich(el.innerHTML) === clean) return
    el.innerHTML = clean
    // We just replaced the DOM under a live caret; drop the caret at the end so
    // typing continues naturally after an undo/redo instead of from position 0.
    if (focused) placeCaretAtEnd(el)
  }, [html])

  // Commit on every input — sanitiser cleans whatever the browser produced.
  const onInput = () => {
    const el = editorRef.current
    if (!el) return
    onCommit(el.innerHTML)
  }

  const exec = (cmd: Cmd) => {
    const el = editorRef.current
    if (!el) return
    // indent/outdent only make sense inside a list — outside one, the
    // browser would emit a <blockquote> the sanitiser flattens anyway.
    if ((cmd === 'indent' || cmd === 'outdent') && !selectionInListItem()) return
    el.focus()
    // execCommand is deprecated but widely supported; the small subset of
    // commands we use is stable across Chromium / Firefox / WebKit. We
    // accept the deprecation risk for the zero-dependency win.
    document.execCommand(cmd)
    onInput()
  }

  /**
   * Paste: never let the browser insert the clipboard's raw HTML — Word /
   * Google Docs / website markup would flood the field with junk the
   * sanitiser only partially digests (lost paragraphs, stray bold). Clean it
   * first, then splice it in at the caret.
   */
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rawHtml = e.clipboardData.getData('text/html')
    const cleaned = rawHtml
      ? cleanPastedHtml(rawHtml)
      : plainToRichHtml(e.clipboardData.getData('text/plain'))
    if (!cleaned) return
    insertHtmlAtCaret(cleaned)
    onInput()
  }

  const insertHtmlAtCaret = (cleanHtml: string) => {
    const el = editorRef.current
    if (!el) return
    el.focus()
    let done = false
    try {
      done = document.execCommand('insertHTML', false, cleanHtml)
    } catch {
      done = false
    }
    if (done) return
    // Engines without insertHTML (jsdom): splice via Range instead.
    const sel = window.getSelection()
    const range =
      sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)
        ? sel.getRangeAt(0)
        : null
    const frag = document.createRange().createContextualFragment(cleanHtml)
    if (range) {
      range.deleteContents()
      range.insertNode(frag)
      range.collapse(false)
    } else {
      el.appendChild(frag)
    }
  }

  /**
   * Intercept the standard formatting shortcuts. Browsers DO handle
   * Ctrl/Cmd+B/I/U natively inside a contentEditable, but the markup they
   * emit varies (some wrap in <b>, some apply inline styles the sanitiser
   * then strips). Routing through `exec` guarantees the same allowed tags
   * and that the change is committed to the store on the spot.
   *
   * Tab / Shift+Tab nest / un-nest the current list item. Outside a list the
   * key is NOT hijacked, so keyboard users can still tab through the form.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (selectionInListItem()) {
        e.preventDefault()
        exec(e.shiftKey ? 'outdent' : 'indent')
      }
      return
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const key = e.key.toLowerCase()
    if (key === 'b')      { e.preventDefault(); exec('bold') }
    else if (key === 'i') { e.preventDefault(); exec('italic') }
    else if (key === 'u') { e.preventDefault(); exec('underline') }
  }

  // Show placeholder via :empty + ::before in CSS — but only when the
  // editor truly has zero text content (an empty <p> still counts as empty
  // markup, so we treat that as empty too).
  const isEmpty = !stripTags(html).length

  return (
    <div className={`rf-col rf-col-${variant}`}>
      <div className="rf-col-head">
        <span className={`rf-locale-tag rf-tag-${variant}`}>
          {LOCALE_LABELS[locale]?.flag} {LOCALE_LABELS[locale]?.name || locale}
        </span>
        {header}
      </div>
      <Toolbar onCmd={exec} active={fmt} />
      <div
        ref={editorRef}
        className={`rf-input rf-${variant} ${isEmpty ? 'rf-empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={`${fieldLabel} (${LOCALE_LABELS[locale]?.name || locale})`}
        lang={bcp47(locale)}
        data-placeholder={placeholder || `${LOCALE_LABELS[locale]?.name || locale}…`}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => {
          // Re-sanitise on blur as a belt-and-braces step.
          const el = editorRef.current
          if (el) onCommit(el.innerHTML)
        }}
      />

      <style>{`
        .rf-col { display: flex; flex-direction: column; gap: 4px; position: relative; }
        .rf-col-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px; min-height: 20px;
        }
        .rf-locale-tag {
          font-size: 11px; font-weight: 600; letter-spacing: .04em;
          color: var(--ink-faint); display: flex; align-items: center; gap: 4px;
        }
        .rf-tag-secondary { color: var(--secondary-ink-text); }
        .rf-input {
          min-height: 72px; padding: 9px 11px;
          background: var(--paper-raised);
          border: 1px solid var(--line); border-radius: var(--r-sm);
          transition: border-color .15s, box-shadow .15s, background .15s;
          line-height: 1.5; font-size: 15px; outline: none;
          white-space: pre-wrap; word-wrap: break-word;
        }
        .rf-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); background: #fff; }
        .rf-input.rf-secondary { background: var(--secondary-tint); border-color: var(--secondary-line); }
        .rf-input.rf-secondary:focus { border-color: var(--secondary-ink); box-shadow: 0 0 0 3px rgba(0,184,222,0.15); }
        .rf-input.rf-empty::before {
          content: attr(data-placeholder);
          color: var(--ink-faint); pointer-events: none;
        }
        .rf-input p { margin: 0 0 4px; }
        .rf-input p:last-child { margin-bottom: 0; }
        .rf-input ul, .rf-input ol { padding-left: 22px; margin: 4px 0; }
        .rf-input li { margin: 2px 0; }
      `}</style>
    </div>
  )
}

// ─── Toolbar ────────────────────────────────────────────────────────────────

type Cmd =
  | 'bold' | 'italic' | 'underline'
  | 'insertUnorderedList' | 'insertOrderedList'
  | 'indent' | 'outdent'

interface ToolbarActive { bold: boolean; italic: boolean; underline: boolean; inList: boolean }

function Toolbar({ onCmd, active }: { onCmd: (c: Cmd) => void; active: ToolbarActive }) {
  return (
    <div className="rf-toolbar" role="toolbar" aria-label="Formatting">
      <ToolBtn label="Bold (Ctrl+B)" pressed={active.bold} onClick={() => onCmd('bold')}><Bold size={13} /></ToolBtn>
      <ToolBtn label="Italic (Ctrl+I)" pressed={active.italic} onClick={() => onCmd('italic')}><Italic size={13} /></ToolBtn>
      <ToolBtn label="Underline (Ctrl+U)" pressed={active.underline} onClick={() => onCmd('underline')}><Underline size={13} /></ToolBtn>
      <span className="rf-tb-sep" />
      <ToolBtn label="Bulleted list" onClick={() => onCmd('insertUnorderedList')}><List size={13} /></ToolBtn>
      <ToolBtn label="Numbered list" onClick={() => onCmd('insertOrderedList')}><ListOrdered size={13} /></ToolBtn>
      <ToolBtn label="Increase indent (Tab)" disabled={!active.inList} onClick={() => onCmd('indent')}><IndentIncrease size={13} /></ToolBtn>
      <ToolBtn label="Decrease indent (Shift+Tab)" disabled={!active.inList} onClick={() => onCmd('outdent')}><IndentDecrease size={13} /></ToolBtn>
      <style>{`
        .rf-toolbar {
          display: flex; align-items: center; gap: 2px;
          padding: 3px; background: var(--paper-sunken);
          border: 1px solid var(--line); border-bottom: none;
          border-radius: var(--r-sm) var(--r-sm) 0 0;
        }
        .rf-tb-sep {
          width: 1px; height: 16px; background: var(--line); margin: 0 4px;
        }
        .rf-input { border-top-left-radius: 0; border-top-right-radius: 0; margin-top: -1px; }
      `}</style>
    </div>
  )
}

function ToolBtn({ label, pressed, disabled, onClick, children }: {
  label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={pressed ? 'rf-tb-btn rf-tb-on' : 'rf-tb-btn'}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Prevent the click from stealing focus from the editor — execCommand
      // needs the contentEditable to remain the active element.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
      <style>{`
        .rf-tb-btn {
          width: 26px; height: 24px; display: grid; place-items: center;
          color: var(--ink-soft); border-radius: 3px; transition: color .12s, background .12s, border-color .12s, box-shadow .12s;
        }
        .rf-tb-btn:hover:not(:disabled) { background: var(--paper-raised); color: var(--accent); }
        .rf-tb-btn:active:not(:disabled) { background: var(--accent-wash); }
        .rf-tb-btn:disabled { opacity: .35; cursor: default; }
        .rf-tb-on { background: var(--accent-wash); color: var(--accent); }
      `}</style>
    </button>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
}

/**
 * Move the caret to the end of a contentEditable after we replace its innerHTML
 * under a live focus (undo/redo). Best-effort and fully guarded — jsdom and
 * older engines may lack parts of the Selection/Range API, and a failure here
 * must never break the repaint that just happened.
 */
function placeCaretAtEnd(el: HTMLElement): void {
  try {
    const sel = window.getSelection?.()
    if (!sel || typeof document.createRange !== 'function') return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  } catch {
    /* selection API unavailable — the content is repainted, which is what matters */
  }
}
