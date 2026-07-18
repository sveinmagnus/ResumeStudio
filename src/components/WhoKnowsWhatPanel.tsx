import { useState, useCallback } from 'react'
import { Users, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { api, type ResumeMeta, UnauthorizedError } from '../lib/api'
import { buildWhoKnowsWhat, type WhoKnowsWhat } from '../lib/whoKnowsWhat'
import { navigate } from '../lib/router'

/**
 * Picker panel: a skill × person matrix across every resume in the instance —
 * the small-team "who knows what" view. Collapsed by default so the picker
 * stays fast; expanding fetches each resume's full data once and aggregates
 * (`lib/whoKnowsWhat.ts`). Only offered when there are ≥2 resumes to compare.
 */
export function WhoKnowsWhatPanel({ items, onUnauthorized }: {
  items: ResumeMeta[]
  onUnauthorized: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<WhoKnowsWhat | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // Fetch every resume's full data. Fine for the small-team scale this
      // serves; if an instance ever holds many CVs this moves server-side.
      const loaded = await Promise.all(items.map((m) => api.loadResume(m.id)))
      const resumes = loaded
        .map((r, i) => (r ? { id: items[i].id, name: items[i].name, data: r.data } : null))
        .filter((r): r is { id: string; name: string; data: NonNullable<typeof r>['data'] } => r !== null)
      setData(buildWhoKnowsWhat(resumes))
    } catch (e) {
      if (e instanceof UnauthorizedError) { onUnauthorized(); return }
      setError('Could not build the skill matrix. Try again.')
    } finally {
      setBusy(false)
    }
  }, [items, onUnauthorized])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !data && !busy) void load()
  }

  if (items.length < 2) return null

  return (
    <section className="wkw">
      <button className="wkw-trigger" onClick={toggle} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Users size={15} />
        <span>Who knows what</span>
        <span className="wkw-sub">skills across {items.length} resumes</span>
      </button>

      {open && (
        <div className="wkw-body">
          {busy && <p className="wkw-status"><Loader2 size={14} className="wkw-spin" /> Building the matrix…</p>}
          {error && <p className="wkw-status wkw-err" role="alert">{error}</p>}
          {data && !busy && <Matrix data={data} />}
        </div>
      )}

      <style>{`
        .wkw { margin: 18px 0 8px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper-raised); }
        .wkw-trigger {
          display: flex; align-items: center; gap: 8px; width: 100%; padding: 13px 16px;
          background: transparent; font-size: 15px; font-weight: 600; color: var(--ink); text-align: left;
        }
        .wkw-trigger:hover { color: var(--accent); }
        .wkw-sub { font-weight: 400; font-size: 12px; color: var(--ink-faint); }
        .wkw-body { padding: 4px 16px 16px; }
        .wkw-status { display: flex; align-items: center; gap: 7px; color: var(--ink-soft); font-size: 13px; padding: 8px 0; }
        .wkw-err { color: var(--err-ink); }
        .wkw-spin { animation: wkw-rot 1s linear infinite; }
        @keyframes wkw-rot { to { transform: rotate(360deg); } }
        .wkw-controls { padding: 4px 0 12px; }
        .wkw-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-soft); cursor: pointer; }
        .wkw-scroll { overflow-x: auto; }
        .wkw-table { border-collapse: collapse; font-size: 13px; min-width: 100%; }
        .wkw-table th, .wkw-table td { padding: 6px 10px; text-align: left; white-space: nowrap; }
        .wkw-table thead th { border-bottom: 2px solid var(--line-strong); font-weight: 600; }
        .wkw-person { color: var(--ink-soft); font-weight: 600; }
        .wkw-person-link { background: transparent; color: inherit; font: inherit; }
        .wkw-person-link:hover { color: var(--accent); text-decoration: underline; }
        .wkw-table tbody tr:nth-child(even) { background: var(--paper-sunken); }
        .wkw-skill { font-weight: 600; }
        .wkw-cell { text-align: center; }
        .wkw-dot {
          display: inline-block; min-width: 22px; padding: 1px 6px; border-radius: 999px;
          font-size: 11px; font-weight: 700; background: var(--accent-wash); color: var(--accent);
        }
        .wkw-has { color: var(--ok-ink); font-weight: 700; }
        .wkw-none { color: var(--line-strong); }
        .wkw-empty { color: var(--ink-faint); font-size: 13px; padding: 8px 0; }
        @media (prefers-reduced-motion: reduce) { .wkw-spin { animation: none; } }
      `}</style>
    </section>
  )
}

function Matrix({ data }: { data: WhoKnowsWhat }) {
  const [sharedOnly, setSharedOnly] = useState(false)
  if (data.rows.length === 0) {
    return <p className="wkw-empty">No skills recorded across these resumes yet.</p>
  }
  const sharedCount = data.rows.filter((r) => r.holders.length > 1).length
  const rows = sharedOnly ? data.rows.filter((r) => r.holders.length > 1) : data.rows

  return (
    <>
      <div className="wkw-controls">
        <label className="wkw-check">
          <input type="checkbox" checked={sharedOnly} onChange={(e) => setSharedOnly(e.target.checked)} />
          Only skills more than one person has
          <span className="wkw-sub"> ({sharedCount} of {data.rows.length})</span>
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="wkw-empty">No skill is shared across these resumes yet — everyone's skills are unique.</p>
      ) : (
      <div className="wkw-scroll">
        <table className="wkw-table">
        <thead>
          <tr>
            <th>Skill</th>
            {data.people.map((p) => (
              <th key={p.resumeId} className="wkw-person">
                <button
                  className="wkw-person-link"
                  onClick={() => navigate(`/r/${p.resumeId}`)}
                  title={`Open ${p.personName}`}
                >
                  {p.personName}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => {
            const by = new Map(row.holders.map((h) => [h.resumeId, h.proficiency]))
            return (
              <tr key={row.key}>
                <td className="wkw-skill">{row.name}</td>
                {data.people.map((p) => {
                  const prof = by.get(p.resumeId)
                  if (prof == null) return <td key={p.resumeId} className="wkw-cell"><span className="wkw-none">·</span></td>
                  // Proficiency 0 = "has the skill, unrated" (CVpartner sets 0
                  // across the board) — a check reads truer than a "0" rating.
                  return (
                    <td key={p.resumeId} className="wkw-cell">
                      {prof > 0
                        ? <span className="wkw-dot" title={`Proficiency ${prof}/5`}>{prof}</span>
                        : <span className="wkw-has" title="Has this skill (unrated)">✓</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
      )}
    </>
  )
}
