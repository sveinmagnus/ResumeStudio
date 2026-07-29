/**
 * Renders proposed rewrites (lib/assistProposals.ts) as a tick-list of
 * before/after pairs, and applies the accepted ones as ONE undo step.
 *
 * Everything starts UNTICKED. Pre-ticking would be the natural convenience and
 * it is the wrong default here: these proposals replace prose the user wrote,
 * and the failure mode — a rewrite that reads better and says something
 * slightly untrue — is invisible unless someone actually compares the two
 * columns. Making each acceptance a deliberate click is the review.
 */

import { useMemo, useState } from 'react'
import { Check, CheckCheck, Square, X } from 'lucide-react'
import type { Proposal, ProposalsResult } from '../../lib/assistProposals'
import { applyProposals } from '../../lib/assistProposals'
import { sectionLabel } from '../../lib/sections'
import { useStore } from '../../store/useStore'
import { unresolved, type AdvisorRun } from '../../store/useAdvisors'
import { CollapsibleSection } from './CollapsibleSection'

interface Props {
  result: ProposalsResult | null
  /** The stored run, so applied/dismissed rewrites stay gone. */
  run?: AdvisorRun
  /** Mark rewrites done. Applying some must leave the rest on screen. */
  onResolve?: (keys: readonly string[], how: 'accepted' | 'dismissed') => void
  /** Fold state, when the caller keeps it (store-backed advisors). */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

export function AssistProposalsPanel({
  result, run, onResolve, collapsed, onCollapsedChange,
}: Props) {
  const data = useStore((s) => s.data)
  const replaceData = useStore((s) => s.replaceData)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)

  // Only what's still outstanding: accepting three of eight must leave five.
  const proposals = unresolved(result?.proposals ?? [], run)
  const doneCount = (result?.proposals.length ?? 0) - proposals.length
  const allOn = proposals.length > 0 && accepted.size === proposals.length

  const toggle = (key: string) => {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const chosen = useMemo(
    () => proposals.filter((p) => accepted.has(p.key)),
    [proposals, accepted],
  )

  const apply = () => {
    if (!chosen.length) return
    // ONE replaceData for the whole batch: one undo step, one auto-save.
    const { data: next, applied, skipped } = applyProposals(data, chosen)
    if (applied > 0) replaceData(next)

    // Resolve only what actually landed. A skipped rewrite (the field changed
    // under it) stays on the list, since it was never applied.
    const skippedKeys = new Set(skipped.map((p) => p.key))
    onResolve?.(chosen.filter((p) => !skippedKeys.has(p.key)).map((p) => p.key), 'accepted')
    setAccepted(new Set())
    setNote(skipped.length
      ? `Applied ${applied}. Skipped ${skipped.length} — you changed that text after the run, so the rewrite no longer matched.`
      : null)
  }

  const dismissAll = () => {
    onResolve?.(proposals.map((p) => p.key), 'dismissed')
    setAccepted(new Set())
    setNote(null)
  }

  if (!result) return null

  return (
    <div className="app-wrap">
      {proposals.length === 0 && (
        <p className="app-empty">
          <Check size={14} />
          {doneCount > 0
            ? `All ${doneCount} suggested rewrite(s) dealt with.`
            : 'Nothing to change — the writing is already consistent.'}
        </p>
      )}

      {proposals.length > 0 && (
        <>
          <CollapsibleSection
            title="Suggested rewrites"
            count={proposals.length}
            open={collapsed === undefined ? undefined : !collapsed}
            onToggle={(open) => onCollapsedChange?.(!open)}
            actions={
              <>
                <span className="app-count">
                  {accepted.size} selected
                  {doneCount > 0 && ` · ${doneCount} done`}
                </span>
                <button className="app-all" onClick={() => setAccepted(allOn ? new Set() : new Set(proposals.map((p) => p.key)))}>
                  {allOn ? <Square size={12} /> : <CheckCheck size={12} />}
                  {allOn ? 'Clear all' : 'Select all'}
                </button>
              </>
            }
          >
          <ul className="app-list">
            {proposals.map((p) => (
              <li key={p.key} className={accepted.has(p.key) ? 'app-item app-on' : 'app-item'}>
                <label className="app-pick">
                  <input type="checkbox" checked={accepted.has(p.key)} onChange={() => toggle(p.key)} />
                  <span className="app-where">
                    {sectionLabel(p.section)} · {p.itemLabel} · <strong>{p.fieldLabel}</strong>
                  </span>
                </label>
                {p.why && <p className="app-why">{p.why}</p>}
                <div className="app-compare">
                  <div className="app-side">
                    <div className="app-side-label">Suggested</div>
                    <p className="app-text app-new">{p.proposed}</p>
                  </div>
                  <div className="app-side">
                    <div className="app-side-label">Yours now</div>
                    <p className="app-text app-old">{p.current || <em>(empty)</em>}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          </CollapsibleSection>

          {note && <p className="app-note" role="status">{note}</p>}

          <div className="app-actions">
            <button className="app-apply" onClick={apply} disabled={!chosen.length}>
              <Check size={13} /> Apply {chosen.length || ''} selected
            </button>
            <button className="app-discard" onClick={dismissAll}>
              <X size={13} /> Dismiss the rest
            </button>
          </div>
        </>
      )}

      {result.dropped.length > 0 && (
        <details className="app-dropped">
          <summary>{result.dropped.length} edit(s) in the reply were rejected</summary>
          <ul>{result.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </details>
      )}

      <style>{`
        .app-wrap { display: flex; flex-direction: column; gap: 10px; }
        .app-empty {
          display: flex; align-items: center; gap: 7px; margin: 0;
          font-size: 13px; color: var(--ok-ink);
        }
        .app-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .app-count { font-size: 12px; color: var(--ink-faint); }
        .app-all {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 4px 9px; border-radius: var(--r-sm); cursor: pointer;
          font-size: 12px; font-weight: 600;
          border: 1px solid var(--line); background: var(--paper); color: var(--ink-soft);
        }
        .app-all:hover { border-color: var(--accent); color: var(--accent); }
        .app-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .app-item {
          display: flex; flex-direction: column; gap: 6px;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); padding: 10px 12px;
        }
        .app-on { border-color: var(--accent); background: var(--accent-wash); }
        .app-pick { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
        .app-pick input { margin-top: 2px; flex-shrink: 0; }
        .app-where { font-size: 12.5px; color: var(--ink-soft); line-height: 1.4; }
        .app-why { margin: 0 0 0 24px; font-size: 12px; color: var(--ink-faint); font-style: italic; }
        .app-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-left: 24px; }
        @media (max-width: 860px) { .app-compare { grid-template-columns: 1fr; } }
        .app-side { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .app-side-label {
          font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
          color: var(--ink-faint);
        }
        .app-text {
          margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap;
          padding: 8px 10px; border-radius: var(--r-sm); background: var(--paper);
          border: 1px solid var(--line);
        }
        .app-new { border-color: var(--ok-ink); }
        .app-old { color: var(--ink-soft); }
        .app-note { margin: 0; font-size: 12.5px; color: var(--warn-ink); line-height: 1.45; }
        .app-actions { display: flex; gap: 8px; }
        .app-apply, .app-discard {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--line); background: var(--paper);
        }
        .app-apply { background: var(--accent); color: #fff; border-color: var(--accent); }
        .app-apply:hover:not(:disabled) { background: var(--accent-bright); }
        .app-apply:disabled { opacity: .55; cursor: default; }
        .app-discard:hover { border-color: var(--line-strong); }
        .app-dropped { font-size: 11.5px; color: var(--ink-faint); }
        .app-dropped summary { cursor: pointer; }
        .app-dropped ul { margin: 6px 0 0; padding-left: 18px; }
      `}</style>
    </div>
  )
}
