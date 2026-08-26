import { useId } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import type { YearMonth } from '../../types'

// ─── Plain text field (not localized) ─────────────────────────────────────────

export function TextField({ label, value, onChange, placeholder, type = 'text', onBlur }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
  /** For write-once wrappers (HeaderEditor's LockedField) that close on blur. */
  onBlur?: () => void
}) {
  const id = useId()
  return (
    <div className="pf-wrap">
      <label className="pf-label" htmlFor={id}>{label}</label>
      <input id={id} className="pf-input" type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </div>
  )
}

// ─── Year/Month field ─────────────────────────────────────────────────────────

export function DateField({ label, value, onChange, allowOngoing }: {
  label: string; value: YearMonth | null; onChange: (v: YearMonth | null) => void; allowOngoing?: boolean
}) {
  const months = ['—','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const yearId = useId()
  // Nudge the year up/down by one. Stepping an empty field seeds the current
  // year, so the arrows are useful even before a year is typed.
  const stepYear = (delta: number) => {
    const next = value?.year != null ? value.year + delta : new Date().getFullYear()
    onChange({ year: next, month: value?.month ?? null })
  }
  return (
    <div className="pf-wrap">
      <label className="pf-label" htmlFor={yearId}>{label}</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {/* text + inputmode rather than type=number: no browser spinner, no
            accidental scroll-wheel mutation, numeric keypad on touch. The
            explicit stepper below gives deliberate up/down adjustment. */}
        <div className="pf-year">
          <input id={yearId} className="pf-input" type="text" inputMode="numeric" placeholder="Year" style={{ width: 80 }}
            aria-label={`${label} — year`}
            value={value?.year || ''} onChange={(e) => {
              // Clearing the field always means "no date" (null is valid for every
              // YearMonth|null field). Returning early here — the old behaviour —
              // left the field un-clearable and, worse, reverted a controlled
              // input to its PRIOR year, so an edit that passed through the empty
              // state (select-all → delete → retype) silently restored the
              // original value. See the publications date-rewrite bug.
              const raw = e.target.value.trim()
              if (raw === '') { onChange(null); return }
              const y = parseInt(raw, 10)
              if (Number.isNaN(y)) return
              onChange({ year: y, month: value?.month ?? null })
            }} />
          <span className="pf-year-step">
            <button type="button" className="pf-year-btn" tabIndex={-1}
              aria-label={`${label} — increase year`} onClick={() => stepYear(1)}>
              <ChevronUp size={12} />
            </button>
            <button type="button" className="pf-year-btn" tabIndex={-1}
              aria-label={`${label} — decrease year`} onClick={() => stepYear(-1)}>
              <ChevronDown size={12} />
            </button>
          </span>
        </div>
        <select className="pf-input" style={{ width: 90 }} value={value?.month ?? 0}
          aria-label={`${label} — month`}
          onChange={(e) => {
            const m = parseInt(e.target.value)
            if (value?.year) onChange({ year: value.year, month: m || null })
          }}>
          {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
        {allowOngoing && (
          <button className="pf-ongoing" type="button"
            onClick={() => onChange(null)}
            style={{ opacity: value ? 0.5 : 1 }}>
            {value ? 'Clear' : 'Ongoing'}
          </button>
        )}
      </div>
    </div>
  )
}

