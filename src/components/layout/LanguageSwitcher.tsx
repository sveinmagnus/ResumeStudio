import { useStore } from '../../store/useStore'
import { LOCALE_LABELS } from '../../lib/locales'
import { ArrowLeftRight, Eye, EyeOff, RefreshCw } from 'lucide-react'

export function LanguageSwitcher() {
  const { data, primaryLocale, secondaryLocale, setPrimaryLocale, setSecondaryLocale, detectAndSetLocales, addSupportedLocale } = useStore()
  const locales = data.resume?.supported_locales || ['en']
  const addable = Object.keys(LOCALE_LABELS).filter((c) => !locales.includes(c))

  const swap = () => {
    if (!secondaryLocale) return
    setPrimaryLocale(secondaryLocale)
    setSecondaryLocale(primaryLocale)
  }

  return (
    <div className="lang-switch">
      <div className="lang-block">
        <span className="lang-role">Primary</span>
        <select value={primaryLocale} onChange={(e) => setPrimaryLocale(e.target.value)} className="lang-sel lang-sel-primary">
          {locales.map((l) => (
            <option key={l} value={l} disabled={l === secondaryLocale}>
              {LOCALE_LABELS[l]?.flag} {LOCALE_LABELS[l]?.name || l}
            </option>
          ))}
        </select>
      </div>

      <button className="lang-swap" onClick={swap} disabled={!secondaryLocale} title="Swap languages">
        <ArrowLeftRight size={15} />
      </button>

      <div className="lang-block">
        <span className="lang-role lang-role-sec">Secondary</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <select
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
            className="lang-toggle"
            onClick={() => setSecondaryLocale(secondaryLocale ? null : (locales.find((l) => l !== primaryLocale) || null))}
            title={secondaryLocale ? 'Hide secondary column' : 'Show secondary column'}>
            {secondaryLocale ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </div>
      </div>

      {addable.length > 0 && (
        <div className="lang-block">
          <span className="lang-role lang-role-add">Add</span>
          <select
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
        <RefreshCw size={13} />
      </button>

      <style>{`
        .lang-switch {
          display: flex; align-items: flex-end; gap: 10px;
          padding: 10px 14px; background: var(--paper-raised);
          border: 1px solid var(--line); border-radius: var(--r-md);
          box-shadow: var(--shadow-sm);
          /* Wrap so a narrow control cluster can stack the language blocks
             vertically rather than overflowing the header row. */
          flex-wrap: wrap; max-width: 100%;
        }
        .lang-block { display: flex; flex-direction: column; gap: 4px; }
        .lang-role { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
        .lang-role-sec { color: var(--secondary-ink); }
        .lang-role-add { color: var(--ink-faint); }
        .lang-add { border-style: dashed; color: var(--ink-soft); }
        .lang-add:hover { border-color: var(--accent); color: var(--accent); }
        .lang-sel {
          padding: 6px 10px; border-radius: var(--r-sm); border: 1px solid var(--line);
          background: var(--paper); font-weight: 500; font-size: 13px; cursor: pointer;
        }
        .lang-sel-primary { border-color: var(--accent); }
        .lang-sel-secondary { border-color: var(--secondary-line); }
        .lang-swap {
          width: 32px; height: 32px; display: grid; place-items: center; margin-bottom: 1px;
          border-radius: var(--r-sm); background: var(--paper-sunken); color: var(--ink-soft);
          transition: all .15s;
        }
        .lang-swap:hover:not(:disabled) { background: var(--accent); color: var(--paper-raised); }
        .lang-swap:disabled { opacity: .3; cursor: default; }
        .lang-toggle {
          width: 32px; display: grid; place-items: center;
          border-radius: var(--r-sm); background: var(--paper-sunken); color: var(--ink-soft);
          border: 1px solid var(--line);
        }
        .lang-toggle:hover { color: var(--accent); border-color: var(--accent); }
        .lang-detect {
          width: 32px; height: 32px; display: grid; place-items: center; margin-bottom: 1px;
          border-radius: var(--r-sm); background: var(--paper-sunken); color: var(--ink-soft);
          transition: all .15s;
        }
        .lang-detect:hover { color: var(--accent); background: var(--accent-wash); }

        /* Make each block's <select> shrink to fit when the cluster wraps,
           so two stacked rows never blow out of the header on a phone. */
        @media (max-width: 560px) {
          .lang-switch { padding: 8px 10px; gap: 8px; }
          .lang-sel { font-size: 12px; padding: 5px 8px; }
        }
      `}</style>
    </div>
  )
}
