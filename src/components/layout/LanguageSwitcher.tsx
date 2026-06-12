import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { LOCALE_LABELS } from '../../lib/locales'
import { ArrowLeftRight, ChevronDown, Eye, EyeOff, Languages, RefreshCw } from 'lucide-react'

/**
 * Language settings, folded behind one compact header button.
 *
 * Most users pick their language pair once and never touch it again, so the
 * full primary/secondary/add cluster doesn't earn permanent header space —
 * the trigger shows the current pair ("EN / NO") and opens a popover with
 * the actual controls (disclosure pattern: aria-expanded on the trigger,
 * outside-click + Esc close, focus returns to the trigger on Esc).
 */
export function LanguageSwitcher() {
  const { data, primaryLocale, secondaryLocale, setPrimaryLocale, setSecondaryLocale, detectAndSetLocales, addSupportedLocale } = useStore()
  const locales = data.resume?.supported_locales || ['en']
  const addable = Object.keys(LOCALE_LABELS).filter((c) => !locales.includes(c))

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Outside click closes. Mousedown (not click) so selecting inside a native
  // <select> dropdown doesn't bounce the popover shut on some platforms.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onPopKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const swap = () => {
    if (!secondaryLocale) return
    setPrimaryLocale(secondaryLocale)
    setSecondaryLocale(primaryLocale)
  }

  const pair = secondaryLocale
    ? `${primaryLocale.toUpperCase()} / ${secondaryLocale.toUpperCase()}`
    : primaryLocale.toUpperCase()

  return (
    <div className="lang-switch" ref={wrapRef} onKeyDown={onPopKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="lang-trigger"
        aria-expanded={open}
        aria-label={`Language settings — editing ${pair}`}
        title="Choose which languages you edit side-by-side"
        onClick={() => setOpen((v) => !v)}
      >
        <Languages size={15} />
        <span className="lang-trigger-pair">{pair}</span>
        <ChevronDown size={13} className={open ? 'lang-chev open' : 'lang-chev'} />
      </button>

      {open && (
        <div className="lang-pop">
          <div className="lang-row">
            <label className="lang-role" htmlFor="lang-sel-primary">Primary</label>
            <div className="lang-controls">
              <select id="lang-sel-primary" value={primaryLocale} onChange={(e) => setPrimaryLocale(e.target.value)} className="lang-sel lang-sel-primary">
                {locales.map((l) => (
                  <option key={l} value={l} disabled={l === secondaryLocale}>
                    {LOCALE_LABELS[l]?.flag} {LOCALE_LABELS[l]?.name || l}
                  </option>
                ))}
              </select>
              <button className="lang-iconbtn" onClick={swap} disabled={!secondaryLocale} title="Swap languages" aria-label="Swap primary and secondary languages">
                <ArrowLeftRight size={14} />
              </button>
            </div>
          </div>

          <div className="lang-row">
            <label className="lang-role lang-role-sec" htmlFor="lang-sel-secondary">Secondary</label>
            <div className="lang-controls">
              <select
                id="lang-sel-secondary"
                value={secondaryLocale || ''}
                onChange={(e) => setSecondaryLocale(e.target.value || null)}
                className="lang-sel lang-sel-secondary">
                <option value="">— none —</option>
                {locales.map((l) => (
                  <option key={l} value={l} disabled={l === primaryLocale}>
                    {LOCALE_LABELS[l]?.flag} {LOCALE_LABELS[l]?.name || l}
                  </option>
                ))}
              </select>
              <button
                className="lang-iconbtn"
                onClick={() => setSecondaryLocale(secondaryLocale ? null : (locales.find((l) => l !== primaryLocale) || null))}
                title={secondaryLocale ? 'Hide secondary column' : 'Show secondary column'}
                aria-label={secondaryLocale ? 'Hide secondary column' : 'Show secondary column'}>
                {secondaryLocale ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
          </div>

          {addable.length > 0 && (
            <div className="lang-row">
              <label className="lang-role lang-role-add" htmlFor="lang-sel-add">Add</label>
              <select
                id="lang-sel-add"
                className="lang-sel lang-add"
                value=""
                onChange={(e) => { if (e.target.value) addSupportedLocale(e.target.value) }}
                title="Add another language to the dropdowns"
              >
                <option value="">+ Language…</option>
                {addable.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABELS[l]?.flag} {LOCALE_LABELS[l]?.name || l}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            className="lang-detect"
            onClick={detectAndSetLocales}
            title="Re-scan content for languages and update the list"
          >
            <RefreshCw size={13} /> Re-detect from content
          </button>
        </div>
      )}

      <style>{`
        .lang-switch { position: relative; display: inline-block; }
        .lang-trigger {
          display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px;
          border: 1.5px solid var(--line-strong); border-radius: var(--r-md);
          font-weight: 600; font-size: 13px; color: var(--ink-soft);
          transition: color .15s, border-color .15s, background .15s;
        }
        .lang-trigger:hover, .lang-trigger[aria-expanded="true"] {
          border-color: var(--accent); color: var(--accent);
        }
        .lang-trigger-pair { letter-spacing: .03em; }
        .lang-chev { transition: transform .15s; flex-shrink: 0; }
        .lang-chev.open { transform: rotate(180deg); }

        .lang-pop {
          position: absolute; top: calc(100% + 6px); right: 0; z-index: 60;
          min-width: 250px; padding: 14px;
          background: var(--paper); border: 1px solid var(--line-strong);
          border-radius: var(--r-md); box-shadow: var(--shadow-md);
          display: flex; flex-direction: column; gap: 12px;
          animation: lang-fade .12s ease;
        }
        @keyframes lang-fade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }

        .lang-row { display: flex; flex-direction: column; gap: 4px; }
        .lang-controls { display: flex; gap: 6px; }
        .lang-role { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
        .lang-role-sec { color: var(--secondary-ink-text); }
        .lang-role-add { color: var(--ink-faint); }
        .lang-add { border-style: dashed; color: var(--ink-soft); }
        .lang-add:hover { border-color: var(--accent); color: var(--accent); }
        .lang-sel {
          flex: 1; padding: 6px 10px; border-radius: var(--r-sm); border: 1px solid var(--line);
          background: var(--paper); font-weight: 500; font-size: 13px; cursor: pointer;
        }
        .lang-sel-primary { border-color: var(--accent); }
        .lang-sel-secondary { border-color: var(--secondary-line); }
        .lang-iconbtn {
          width: 32px; flex-shrink: 0; display: grid; place-items: center;
          border-radius: var(--r-sm); background: var(--paper-sunken); color: var(--ink-soft);
          border: 1px solid var(--line);
          transition: color .15s, background .15s, border-color .15s;
        }
        .lang-iconbtn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
        .lang-iconbtn:disabled { opacity: .3; cursor: default; }
        .lang-detect {
          display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          padding: 8px 10px; margin-top: 2px;
          border-radius: var(--r-sm); background: var(--paper-sunken); color: var(--ink-soft);
          font-size: 12.5px; font-weight: 600;
          transition: color .15s, background .15s;
        }
        .lang-detect:hover { color: var(--accent); background: var(--accent-wash); }

        /* Narrow header: the controls cluster is left-aligned there, so the
           popover anchors left to stay on-screen; the pair text gives way. */
        @media (max-width: 880px) {
          .lang-pop { right: auto; left: 0; max-width: calc(100vw - 24px); }
        }
        @media (max-width: 560px) {
          .lang-trigger { padding: 9px 11px; }
          .lang-trigger-pair { display: none; }
        }
      `}</style>
    </div>
  )
}
