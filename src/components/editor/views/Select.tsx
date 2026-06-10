// ─── Shared typed select for the views editor ─────────────────────────────────
// Styled by the shared rv-* stylesheet in ./Styles.tsx.

export function Select<T extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
}) {
  return (
    <label className="rv-vs-field">
      <span className="rv-vs-label">{label}</span>
      <select className="rv-vs-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}
