/**
 * Renders a list of advisory findings (lib/assistFindings.ts) as a work list.
 *
 * Shared by the whole-CV review, the cross-language meaning check and the
 * per-section "what's missing" pass — they differ in what they ask the model,
 * not in what a finding looks like once it comes back.
 *
 * There is no Apply button anywhere here, by design: a finding is advice about
 * YOUR text, and the fix is a decision only you can make. What the panel does
 * offer is a jump — clicking a finding opens the item it's about, because the
 * distance between "here's what's wrong" and "here's the field" is where advice
 * goes to die.
 */

import { AlertTriangle, Info, CircleAlert, HelpCircle, ArrowRight, CheckCircle2 } from 'lucide-react'
import type { Finding, FindingsResult } from '../../lib/assistFindings'
import { sectionLabel } from '../../lib/sections'
import { useStore } from '../../store/useStore'

const SEVERITY_ICON = {
  high: <CircleAlert size={13} />,
  medium: <AlertTriangle size={13} />,
  low: <Info size={13} />,
}

interface Props {
  result: FindingsResult | null
  /** Shown when a run returned nothing — phrased per caller. */
  emptyText?: string
}

export function AssistFindingsPanel({ result, emptyText = 'Nothing to flag — this reads well.' }: Props) {
  const setActiveSection = useStore((s) => s.setActiveSection)
  const setExpandedItem = useStore((s) => s.setExpandedItem)

  if (!result) return null

  const jump = (f: Finding) => {
    setActiveSection(f.section)
    if (f.itemId) setExpandedItem(f.itemId)
  }

  return (
    <div className="afp">
      {result.findings.length === 0 && (
        <p className="afp-empty"><CheckCircle2 size={14} /> {emptyText}</p>
      )}

      {result.findings.length > 0 && (
        <ul className="afp-list">
          {result.findings.map((f) => (
            <li key={f.key} className={`afp-item afp-${f.severity}`}>
              <div className="afp-row">
                <span className="afp-sev" aria-label={`${f.severity} priority`}>{SEVERITY_ICON[f.severity]}</span>
                <div className="afp-body">
                  <div className="afp-title">{f.title}</div>
                  <div className="afp-where">
                    {sectionLabel(f.section)}
                    {f.itemLabel && <> · {f.itemLabel}</>}
                  </div>
                  {f.detail && <p className="afp-detail">{f.detail}</p>}
                  {f.ask && (
                    <p className="afp-ask"><HelpCircle size={12} /> {f.ask}</p>
                  )}
                </div>
                <button className="afp-jump" onClick={() => jump(f)}
                  aria-label={`Open ${f.itemLabel || sectionLabel(f.section)}`}>
                  Open <ArrowRight size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {result.dropped.length > 0 && (
        <details className="afp-dropped">
          <summary>{result.dropped.length} item(s) in the reply couldn’t be matched to your CV</summary>
          <ul>{result.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </details>
      )}

      <style>{`
        .afp { display: flex; flex-direction: column; gap: 10px; }
        .afp-empty {
          display: flex; align-items: center; gap: 7px; margin: 0;
          font-size: 13px; color: var(--ok-ink);
        }
        .afp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .afp-item {
          border: 1px solid var(--line); border-left-width: 3px;
          border-radius: var(--r-sm); background: var(--paper); padding: 10px 12px;
        }
        .afp-high { border-left-color: var(--err-ink); }
        .afp-medium { border-left-color: var(--warn-ink); }
        .afp-low { border-left-color: var(--line-strong); }
        .afp-row { display: flex; align-items: flex-start; gap: 9px; }
        .afp-sev { flex-shrink: 0; margin-top: 2px; }
        .afp-high .afp-sev { color: var(--err-ink); }
        .afp-medium .afp-sev { color: var(--warn-ink); }
        .afp-low .afp-sev { color: var(--ink-faint); }
        .afp-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .afp-title { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.4; }
        .afp-where { font-size: 11.5px; color: var(--ink-faint); }
        .afp-detail { margin: 2px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
        .afp-ask {
          display: flex; align-items: flex-start; gap: 5px; margin: 4px 0 0;
          font-size: 12.5px; line-height: 1.45; color: var(--secondary-ink-text);
        }
        .afp-ask svg { flex-shrink: 0; margin-top: 2px; }
        .afp-jump {
          display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
          padding: 4px 9px; border-radius: var(--r-sm); cursor: pointer;
          font-size: 12px; font-weight: 600;
          border: 1px solid var(--line); background: var(--paper-sunken); color: var(--ink-soft);
        }
        .afp-jump:hover { border-color: var(--accent); color: var(--accent); }
        .afp-dropped { font-size: 11.5px; color: var(--ink-faint); }
        .afp-dropped summary { cursor: pointer; }
        .afp-dropped ul { margin: 6px 0 0; padding-left: 18px; }
      `}</style>
    </div>
  )
}
