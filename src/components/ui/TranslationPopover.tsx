/**
 * Generic dual-language translation popover. Renders a DualField bound to a
 * LocalizedString, with a heading and a footnote, dismissing on outside click.
 * Used by skill chips, role chips, the employment role pill, and skill/role
 * category headers.
 */
import { useEffect, useRef } from 'react'
import { DualField } from './DualField'
import type { LocalizedString } from '../../types'

export function TranslationPopover({
  title, fieldLabel, value, footnote, onClose, onChange,
}: {
  title: string
  fieldLabel: string
  value: LocalizedString
  footnote?: string
  onClose: () => void
  onChange: (value: LocalizedString) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Defer registration so the click that OPENED the popover doesn't
    // immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h) }
  }, [onClose])
  return (
    <div ref={ref} className="stp-pop">
      <div className="stp-head">{title}</div>
      <DualField label={fieldLabel} value={value} onChange={onChange} />
      {footnote && <div className="stp-foot">{footnote}</div>}
      <style>{`
        .stp-pop {
          position: absolute; top: calc(100% + 6px); left: 0; z-index: 40;
          width: min(420px, 90vw); padding: 14px 14px 10px;
          background: var(--paper-raised); border: 1px solid var(--line-strong);
          border-radius: var(--r-md); box-shadow: var(--shadow-lg);
        }
        .stp-head {
          font-size: 12px; font-weight: 700; letter-spacing: .04em;
          text-transform: uppercase; color: var(--ink-soft); margin-bottom: 10px;
        }
        .stp-foot { font-size: 11px; color: var(--ink-faint); margin-top: 4px; }
      `}</style>
    </div>
  )
}
