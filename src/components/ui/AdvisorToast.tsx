/**
 * Top-right notice that an advisor run has finished.
 *
 * Mounted at app level, not on Overview — the point is that it reaches you
 * wherever you went while the model was thinking. Starting a whole-CV review and
 * then carrying on editing is the normal case, not an edge one, and without this
 * you'd have to guess when to go back and look.
 *
 * It announces; it never navigates on its own. "Show me" takes you to the
 * results, dismiss just marks the run seen — the findings themselves stay in the
 * store either way, so dismissing costs nothing.
 */

import { Sparkles, X, ArrowRight, AlertTriangle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import {
  ADVISOR_LABEL, advisorSection, unseenRuns, useAdvisors, type AdvisorRun,
} from '../../store/useAdvisors'
import { lookup } from '../../lib/lookup'

export function AdvisorToast() {
  const resumeId = useStore((s) => s.currentResumeId)
  const setActiveSection = useStore((s) => s.setActiveSection)
  const runs = useAdvisors((s) => s.runs)
  const markSeen = useAdvisors((s) => s.markSeen)

  if (!resumeId) return null
  const pending = unseenRuns(runs, resumeId)
  if (!pending.length) return null

  const show = (run: AdvisorRun) => {
    // Scoped advisors (a view's intro, one section's gaps) know where they
    // belong better than a static per-advisor map does.
    setActiveSection(advisorSection(run))
    markSeen(run)
  }

  return (
    <div className="atoast" role="status" aria-live="polite">
      {pending.map((run) => (
        <div key={`${run.resumeId}:${run.id}:${run.scope ?? ''}`} className={`atoast-card${run.status === 'error' ? ' atoast-err' : ''}`}>
          <span className="atoast-icon">
            {run.status === 'error' ? <AlertTriangle size={15} /> : <Sparkles size={15} />}
          </span>
          <div className="atoast-body">
            <div className="atoast-title">
              {lookup(ADVISOR_LABEL, run.id, 'AI advisor')}
              {run.status === 'error' ? ' failed' : ' is ready'}
            </div>
            <div className="atoast-detail">
              {run.status === 'error'
                ? run.error
                : 'Your suggestions are waiting — “Show me” takes you there.'}
            </div>
            {run.status !== 'error' && (
              <button className="atoast-go" onClick={() => show(run)}>
                Show me <ArrowRight size={12} />
              </button>
            )}
          </div>
          <button
            className="atoast-x"
            onClick={() => markSeen(run)}
            aria-label={`Dismiss ${lookup(ADVISOR_LABEL, run.id, 'advisor')} notification`}
            title="Dismiss — the results stay where they were produced"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      <style>{`
        .atoast {
          position: fixed; top: 16px; right: 16px; z-index: 200;
          display: flex; flex-direction: column; gap: 8px;
          max-width: min(360px, calc(100vw - 32px));
        }
        .atoast-card {
          display: flex; align-items: flex-start; gap: 9px;
          padding: 11px 12px; border-radius: var(--r-md);
          background: var(--paper); border: 1px solid var(--secondary-line);
          border-left: 3px solid var(--secondary-ink);
          box-shadow: var(--shadow-lg);
        }
        .atoast-err { border-color: var(--err-ink); border-left-color: var(--err-ink); }
        .atoast-icon { flex-shrink: 0; margin-top: 1px; color: var(--secondary-ink); }
        .atoast-err .atoast-icon { color: var(--err-ink); }
        .atoast-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .atoast-title { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.35; }
        .atoast-detail { font-size: 12px; color: var(--ink-soft); line-height: 1.45; }
        .atoast-go {
          align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
          margin-top: 4px; padding: 4px 9px; border-radius: var(--r-sm); cursor: pointer;
          font-size: 12px; font-weight: 600;
          background: var(--accent); color: #fff; border: 1px solid var(--accent);
        }
        .atoast-go:hover { background: var(--accent-bright); }
        .atoast-x {
          flex-shrink: 0; background: none; border: none; cursor: pointer;
          color: var(--ink-faint); padding: 2px; border-radius: var(--r-sm);
        }
        .atoast-x:hover { color: var(--ink); background: var(--paper-sunken); }
      `}</style>
    </div>
  )
}
