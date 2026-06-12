import { useId, useState, useRef, useLayoutEffect } from 'react'
import { Copy, Languages, Loader2, Bold, Italic, Underline, List, ListOrdered } from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { LocalizedString } from '../../types'
import { LOCALE_LABELS, bcp47 } from '../../lib/locales'
import { api } from '../../lib/api'
import { canDraftBetween } from '../../lib/translateClient'
import { useTranslationAvailable } from '../../store/useTranslation'
import { sanitizeRich } from '../../lib/richText'

interface RichFieldProps {
  label: string
  value: LocalizedString
  onChange: (next: LocalizedString) => void
  placeholder?: string
}

/**
 * Localized rich-text editor — sibling of DualField. Renders one
 * contentEditable per visible locale with a tiny toolbar (bold, italic,
 * underline, bullet list, numbered list).
 *
 * Storage is sanitised HTML per locale. The toolbar uses document.execCommand
 * — deprecated but still the lowest-friction primitive for these five tags.
 * Every blur sanitises the buffer so we never trust the editor's output.
 *
 * Copy / Draft assist mirror DualField semantics.
 */
export function RichField({ label, value, onChange, placeholder }: RichFieldProps) {
  const primary = useStore((s) => s.primaryLocale)
  const secondary = useStore((s) => s.secondaryLocale)
  const translationAvailable = useTranslationAvailable()

  const [busy, setBusy] = useState(false)
  const [drafted, setDrafted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (locale: string, html: string) => {
    const next = { ...value }
    const clean = sanitizeRich(html)
    if (clean) next[locale] = clean
    else delete next[locale]
    onChange(next)
  }

  const primaryText = stripTags(value[primary] || '').trim()

  const copyFromPrimary = () => {
    if (!secondary || !primaryText) return
    set(secondary, value[primary] || '')
    setDrafted(false)
    setError(null)
  }

  const draftTranslation = async () => {
    if (!secondary || !primaryText || busy) return
    setBusy(true)
    setError(null)
    try {
      // Translate the plain-text projection — the backend doesn't preserve
      // markup, so we don't pretend to round-trip it.
      const translated = await api.translate(primaryText, primary, secondary)
      set(secondary, translated)
      setDrafted(true)
    } catch (e) {
      setError((e as Error).message || 'Translation failed')
    } finally {
      setBusy(false)
    }
  }

  const canDraft = !!secondary && translationAvailable && canDraftBetween(primary, secondary)

  const fieldId = useId()

  return (
    <div className="rf-wrap">
      {/* contentEditable can't take htmlFor — the columns name themselves
          via aria-label ("Description (Norsk)") built from this label. */}
      <span className="rf-label" id={`${fieldId}-label`}>{label}</span>
      <div className={`rf-grid ${secondary ? 'rf-dual' : 'rf-single'}`}>
        <RichColumn
          variant="primary"
          locale={primary}
          fieldLabel={label}
          html={value[primary] || ''}
          onCommit={(html) => set(primary, html)}
          placeholder={placeholder}
        />
        {secondary && (
          <div className="rf-sec-col">
            <RichColumn
              variant="secondary"
              locale={secondary}
              fieldLabel={label}
              html={value[secondary] || ''}
              onCommit={(html) => {
                set(secondary, html)
                setDrafted(false)
                setError(null)
              }}
              placeholder={placeholder}
              header={
                <div className="rf-actions">
                  <button
                    type="button"
                    className="rf-assist-btn"
                    onClick={copyFromPrimary}
                    disabled={!primaryText}
                    title="Copy the primary text here as a starting point"
                  >
                    <Copy size={12} /> Copy
                  </button>
                  {canDraft && (
                    <button
                      type="button"
                      className="rf-assist-btn rf-draft-btn"
                      onClick={() => void draftTranslation()}
                      disabled={!primaryText || busy}
                      title="Draft a translation from the primary text (review required)"
                    >
                      {busy ? <Loader2 size={12} className="rf-spin" /> : <Languages size={12} />}
                      {busy ? 'Drafting…' : 'Draft'}
                    </button>
                  )}
                </div>
              }
            />
            {drafted && !error && (
              <span className="rf-note rf-note-draft" role="status">Machine draft — please review</span>
            )}
            {error && <span className="rf-note rf-note-error" role="alert">{error}</span>}
          </div>
        )}
      </div>

      <style>{`
        .rf-wrap { margin-bottom: 18px; animation: fadeIn .3s ease; }
        .rf-label {
          display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
        }
        .rf-grid { display: grid; gap: 12px; }
        .rf-dual { grid-template-columns: 1fr 1fr; }
        .rf-single { grid-template-columns: 1fr; }
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

  /**
   * We treat the contentEditable as uncontrolled: we set innerHTML manually
   * when the store value diverges from the DOM (load, undo, copy-from-primary,
   * draft), and never re-set during the user's own typing — doing so would
   * collapse the caret to the start every keystroke.
   */
  useLayoutEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (el.innerHTML === html) return
    // Only re-sync when not focused; while typing the user owns the buffer.
    if (document.activeElement === el) return
    el.innerHTML = html
  }, [html])

  // Commit on every input — sanitiser cleans whatever the browser produced.
  const onInput = () => {
    const el = editorRef.current
    if (!el) return
    onCommit(el.innerHTML)
  }

  const exec = (cmd: 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList') => {
    const el = editorRef.current
    if (!el) return
    el.focus()
    // execCommand is deprecated but widely supported; the small subset of
    // commands we use is stable across Chromium / Firefox / WebKit. We
    // accept the deprecation risk for the zero-dependency win.
    document.execCommand(cmd)
    onInput()
  }

  /**
   * Intercept the standard formatting shortcuts. Browsers DO handle
   * Ctrl/Cmd+B/I/U natively inside a contentEditable, but the markup they
   * emit varies (some wrap in <b>, some apply inline styles the sanitiser
   * then strips). Routing through `exec` guarantees the same allowed tags
   * and that the change is committed to the store on the spot.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
      <Toolbar onCmd={exec} />
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

type Cmd = 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList'

function Toolbar({ onCmd }: { onCmd: (c: Cmd) => void }) {
  return (
    <div className="rf-toolbar" role="toolbar" aria-label="Formatting">
      <ToolBtn label="Bold (Ctrl+B)" onClick={() => onCmd('bold')}><Bold size={13} /></ToolBtn>
      <ToolBtn label="Italic (Ctrl+I)" onClick={() => onCmd('italic')}><Italic size={13} /></ToolBtn>
      <ToolBtn label="Underline (Ctrl+U)" onClick={() => onCmd('underline')}><Underline size={13} /></ToolBtn>
      <span className="rf-tb-sep" />
      <ToolBtn label="Bulleted list" onClick={() => onCmd('insertUnorderedList')}><List size={13} /></ToolBtn>
      <ToolBtn label="Numbered list" onClick={() => onCmd('insertOrderedList')}><ListOrdered size={13} /></ToolBtn>
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

function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="rf-tb-btn"
      title={label}
      aria-label={label}
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
        .rf-tb-btn:hover { background: var(--paper-raised); color: var(--accent); }
        .rf-tb-btn:active { background: var(--accent-wash); }
      `}</style>
    </button>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
}
