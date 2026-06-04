import type { YearMonth } from '../../types'

// ─── Plain text field (not localized) ─────────────────────────────────────────

export function TextField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div className="pf-wrap">
      <label className="pf-label">{label}</label>
      <input className="pf-input" type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
      <PlainStyles />
    </div>
  )
}

// ─── Year/Month field ─────────────────────────────────────────────────────────

export function DateField({ label, value, onChange, allowOngoing }: {
  label: string; value: YearMonth | null; onChange: (v: YearMonth | null) => void; allowOngoing?: boolean
}) {
  const months = ['—','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return (
    <div className="pf-wrap">
      <label className="pf-label">{label}</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input className="pf-input" type="number" placeholder="Year" style={{ width: 80 }}
          value={value?.year || ''} onChange={(e) => {
            const y = parseInt(e.target.value)
            if (!y) { if (allowOngoing) onChange(null); return }
            onChange({ year: y, month: value?.month ?? null })
          }} />
        <select className="pf-input" style={{ width: 90 }} value={value?.month ?? 0}
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
      <PlainStyles />
    </div>
  )
}

// ─── Tag input ─────────────────────────────────────────────────────────────────

export function TagField({ label, tags, onChange, suggestions = [] }: {
  label: string; tags: string[]; onChange: (t: string[]) => void; suggestions?: string[]
}) {
  const add = (t: string) => {
    const v = t.trim().toLowerCase()
    if (v && !tags.includes(v)) onChange([...tags, v])
  }
  return (
    <div className="pf-wrap">
      <label className="pf-label">{label}</label>
      <div className="tag-box">
        {tags.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
          </span>
        ))}
        <input className="tag-input" placeholder="add tag…"
          list="tag-suggestions"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add((e.target as HTMLInputElement).value)
              ;(e.target as HTMLInputElement).value = ''
            }
          }} />
        <datalist id="tag-suggestions">
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      </div>
      <PlainStyles />
      <style>{`
        .tag-box {
          display: flex; flex-wrap: wrap; gap: 6px; padding: 7px 9px;
          background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--r-sm);
          min-height: 40px; align-items: center;
        }
        .tag-chip {
          display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px;
          background: var(--accent-wash); color: var(--accent); border-radius: 20px;
          font-size: 12px; font-weight: 500;
        }
        .tag-chip button { color: var(--accent); font-size: 14px; line-height: 1; opacity: .6; }
        .tag-chip button:hover { opacity: 1; }
        .tag-input { flex: 1; min-width: 80px; border: none; background: none; outline: none; }
      `}</style>
    </div>
  )
}

function PlainStyles() {
  return (
    <style>{`
      .pf-wrap { margin-bottom: 16px; }
      .pf-label {
        display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
        text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
      }
      .pf-input {
        padding: 9px 11px; background: var(--paper-raised);
        border: 1px solid var(--line); border-radius: var(--r-sm);
        transition: border-color .15s, box-shadow .15s;
      }
      .pf-input:focus {
        outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); background: #fff;
      }
      input.pf-input { width: 100%; }
      .pf-ongoing {
        padding: 0 14px; background: var(--paper-sunken); border: 1px solid var(--line);
        border-radius: var(--r-sm); font-size: 13px; font-weight: 500; white-space: nowrap;
      }
      .pf-ongoing:hover { border-color: var(--accent); color: var(--accent); }
    `}</style>
  )
}
