import { useId, useState, useLayoutEffect, useRef } from 'react'
import { Copy, Languages, Loader2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { LocalizedString } from '../../types'
import { LOCALE_LABELS, bcp47 } from '../../lib/locales'
import { api } from '../../lib/api'
import { canDraftBetween } from '../../lib/translateClient'
import { useTranslationAvailable } from '../../store/useTranslation'

/**
 * Resize a textarea to fit its content. Called on mount (so editing an
 * existing long value opens already-expanded) and on every keystroke.
 *
 * We reset to `auto` first so shrinking on backspace works — `scrollHeight`
 * never decreases when the element's height stays fixed.
 */
function autoSize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function AutoTextarea({
  id, value, rows, placeholder, className, lang, ariaLabel, onChange,
}: {
  id?: string
  value: string
  rows: number
  placeholder: string
  className: string
  lang?: string
  ariaLabel?: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // useLayoutEffect so the resize happens before the browser paints — no
  // brief flash at the initial small height.
  useLayoutEffect(() => { autoSize(ref.current) }, [value])
  return (
    <textarea
      ref={ref}
      id={id}
      value={value}
      rows={rows}
      placeholder={placeholder}
      className={className}
      lang={lang}
      aria-label={ariaLabel}
      onChange={(e) => { onChange(e); autoSize(e.currentTarget) }}
      style={{ overflow: 'hidden', resize: 'none' }}
    />
  )
}

interface DualFieldProps {
  label: string
  value: LocalizedString
  onChange: (next: LocalizedString) => void
  multiline?: boolean
  rows?: number
  placeholder?: string
}

/**
 * Renders a single logical field as two side-by-side inputs:
 * primary language (left) and secondary language (right).
 * If no secondary language is selected, only the primary input shows.
 *
 * The secondary column carries two assist affordances:
 *   - "Copy from primary" — fills the secondary with the primary text as a
 *     starting point (no network).
 *   - "Draft translation" — calls the server translation proxy to pre-fill a
 *     review-required draft. Only shown when the server reports a translation
 *     backend is configured (see useTranslationAvailable).
 */
export function DualField({ label, value, onChange, multiline, rows = 3, placeholder }: DualFieldProps) {
  const primary = useStore((s) => s.primaryLocale)
  const secondary = useStore((s) => s.secondaryLocale)
  const translationAvailable = useTranslationAvailable()
  const fieldId = useId()

  const [busy, setBusy] = useState(false)
  const [drafted, setDrafted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (locale: string, text: string) => {
    const next = { ...value }
    if (text) next[locale] = text
    else delete next[locale]
    onChange(next)
  }

  const primaryText = (value[primary] || '').trim()

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
      const translated = await api.translate(value[primary] || '', primary, secondary)
      set(secondary, translated)
      setDrafted(true)
    } catch (e) {
      setError((e as Error).message || 'Translation failed')
    } finally {
      setBusy(false)
    }
  }

  const handleChange = (locale: string, variant: 'primary' | 'secondary', text: string) => {
    set(locale, text)
    // Editing the secondary clears the draft/error annotations — the user has
    // taken ownership of the text.
    if (variant === 'secondary') {
      setDrafted(false)
      setError(null)
    }
  }

  const renderInput = (locale: string, variant: 'primary' | 'secondary') => {
    const v = value[locale] || ''
    const ph = placeholder || `${LOCALE_LABELS[locale]?.name || locale}…`
    const cls = `df-input df-${variant}`
    // Each input gets its own accessible name ("Job title (Norsk)") since the
    // visual label is shared by two inputs, plus a `lang` so screen readers
    // and the browser spell-checker switch language per column (WCAG 3.1.2).
    const inputId = `${fieldId}-${variant}`
    const localeName = LOCALE_LABELS[locale]?.name || locale
    const ariaLabel = `${label} (${localeName})`
    if (multiline) {
      return (
        <AutoTextarea
          id={inputId}
          value={v}
          rows={rows}
          placeholder={ph}
          className={cls}
          lang={bcp47(locale)}
          ariaLabel={ariaLabel}
          onChange={(e) => handleChange(locale, variant, e.target.value)}
        />
      )
    }
    return (
      <input
        id={inputId}
        type="text"
        value={v}
        placeholder={ph}
        className={cls}
        lang={bcp47(locale)}
        aria-label={ariaLabel}
        onChange={(e) => handleChange(locale, variant, e.target.value)}
      />
    )
  }

  const canDraft = !!secondary && translationAvailable && canDraftBetween(primary, secondary)

  return (
    <div className="df-wrap">
      <label className="df-label" htmlFor={`${fieldId}-primary`}>{label}</label>
      <div className={`df-grid ${secondary ? 'df-dual' : 'df-single'}`}>
        <div className="df-col">
          <div className="df-col-head">
            <span className="df-locale-tag df-tag-primary">{LOCALE_LABELS[primary]?.flag} {LOCALE_LABELS[primary]?.name || primary}</span>
          </div>
          {renderInput(primary, 'primary')}
        </div>
        {secondary && (
          <div className="df-col">
            <div className="df-col-head">
              <span className="df-locale-tag df-tag-secondary">{LOCALE_LABELS[secondary]?.flag} {LOCALE_LABELS[secondary]?.name || secondary}</span>
              <div className="df-actions">
                <button
                  type="button"
                  className="df-assist-btn"
                  onClick={copyFromPrimary}
                  disabled={!primaryText}
                  title="Copy the primary text here as a starting point"
                >
                  <Copy size={12} /> Copy
                </button>
                {canDraft && (
                  <button
                    type="button"
                    className="df-assist-btn df-draft-btn"
                    onClick={() => void draftTranslation()}
                    disabled={!primaryText || busy}
                    title="Draft a translation from the primary text (review required)"
                  >
                    {busy ? <Loader2 size={12} className="df-spin" /> : <Languages size={12} />}
                    {busy ? 'Drafting…' : 'Draft'}
                  </button>
                )}
              </div>
            </div>
            {renderInput(secondary, 'secondary')}
            {drafted && !error && (
              <span className="df-note df-note-draft">Machine draft — please review</span>
            )}
            {error && <span className="df-note df-note-error">{error}</span>}
          </div>
        )}
      </div>

      <style>{`
        .df-wrap { margin-bottom: 18px; animation: fadeIn .3s ease; }
        .df-label {
          display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
        }
        .df-grid { display: grid; gap: 12px; }
        .df-dual { grid-template-columns: 1fr 1fr; }
        .df-single { grid-template-columns: 1fr; }
        .df-col { display: flex; flex-direction: column; gap: 4px; position: relative; }
        .df-col-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px; min-height: 20px;
        }
        .df-locale-tag {
          font-size: 10px; font-weight: 600; letter-spacing: .04em;
          color: var(--ink-faint); display: flex; align-items: center; gap: 4px;
        }
        .df-tag-secondary { color: var(--secondary-ink); }
        .df-actions { display: flex; align-items: center; gap: 4px; }
        .df-assist-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 7px; border-radius: var(--r-sm);
          font-size: 10px; font-weight: 600; color: var(--ink-soft);
          background: var(--paper-sunken); border: 1px solid var(--line);
          transition: all .12s; cursor: pointer;
        }
        .df-assist-btn:hover:not(:disabled) { border-color: var(--secondary-ink); color: var(--secondary-ink); }
        .df-assist-btn:disabled { opacity: .4; cursor: default; }
        .df-draft-btn:hover:not(:disabled) { background: var(--secondary-tint); }
        .df-spin { animation: df-spin 1s linear infinite; }
        @keyframes df-spin { to { transform: rotate(360deg); } }
        .df-input {
          width: 100%; padding: 9px 11px; background: var(--paper-raised);
          border: 1px solid var(--line); border-radius: var(--r-sm);
          transition: border-color .15s, box-shadow .15s, background .15s;
          resize: vertical; line-height: 1.45;
        }
        .df-input:focus {
          outline: none; border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-wash); background: #fff;
        }
        .df-secondary { background: var(--secondary-tint); border-color: var(--secondary-line); }
        .df-secondary:focus {
          border-color: var(--secondary-ink);
          box-shadow: 0 0 0 3px rgba(58,71,80,0.10);
        }
        .df-note { font-size: 10px; margin-top: 1px; }
        .df-note-draft { color: var(--secondary-ink); }
        .df-note-error { color: #b91c1c; }
      `}</style>
    </div>
  )
}
