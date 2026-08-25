import { useState } from 'react'
import { Check, EyeOff, ArrowRight } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { claimEvidenceReport, type ClaimFinding } from '../../lib/claimEvidence'
import { redundancyReport, type RedundancyFinding } from '../../lib/redundancy'
import { snoozeUntil } from '../../lib/freshness'

/**
 * The two structural Overview checks that sit beside drift:
 *  - claim–evidence (lib/claimEvidence.ts): claims the CV's own structure
 *    doesn't back — an expert rating with no dated usage, a showcased skill no
 *    project shows, a competency no engagement mentions;
 *  - repetition (lib/redundancy.ts): the same sentence sold twice across items.
 * Like drift, both are hints, not verdicts: every row navigates to the item,
 * and a dismissal snoozes it for a year via the shared attention machinery.
 */
export function EvidencePanels() {
  const { data, primaryLocale, setActiveSection, setExpandedItem, dismissAttention } = useStore()
  const dismissals = data.resume?.attention_dismissals ?? {}

  const claims = claimEvidenceReport(data, primaryLocale, dismissals)
  const dups = redundancyReport(data, primaryLocale, dismissals)

  const goTo = (section: string, itemId: string) => {
    setActiveSection(section)
    setExpandedItem(itemId)
  }
  const dismiss = (key: string) => dismissAttention(key, snoozeUntil(new Date()))

  const [claimsOpen, setClaimsOpen] = useState(false)
  const [dupsOpen, setDupsOpen] = useState(false)

  const KIND_LABEL: Record<ClaimFinding['kind'], string> = {
    proficiency: 'rating',
    showcase: 'showcase',
    role_years: 'years',
    competency: 'competency',
  }

  return (
    <>
      {claims.checked > 0 && (
        <div className="ov-card">
          <h3 className="ov-section-title">Claim–evidence check</h3>
          {claims.findings.length === 0 ? (
            <div className="ov-panel">
              <p className="ov-trans-hint ov-drift-ok">
                <Check size={14} /> The {claims.checked} claim{claims.checked !== 1 ? 's' : ''} checked —
                skill ratings, role years, showcased skills, competencies — are backed by the CV's own content.
              </p>
            </div>
          ) : (
            <>
              <p className="ov-trans-hint">
                {claims.findings.length} claim{claims.findings.length !== 1 ? 's' : ''} the CV's own structure
                doesn't back up. These are the questions an interviewer would ask — link a project, adjust the
                rating, or dismiss what you can defend anyway.
              </p>
              <div className="ov-panel">
                <ul className="ov-drift-list">
                  {(claimsOpen ? claims.findings : claims.findings.slice(0, 6)).map((f) => (
                    <li key={f.dismissKey} className="ov-drift-li">
                      <button className="ov-drift-row" onClick={() => goTo(f.section, f.itemId)}>
                        <span className={`ov-drift-badge ov-drift-${f.severity}`}>{KIND_LABEL[f.kind]}</span>
                        <span className="ov-drift-loc">
                          <span className="ov-missing-item">{f.itemLabel}</span>
                        </span>
                        <span className="ov-drift-detail">{f.detail}</span>
                      </button>
                      <button
                        className="ov-drift-ignore"
                        onClick={() => dismiss(f.dismissKey)}
                        title="I can defend this — don't flag it for a year"
                        aria-label={`Dismiss the ${KIND_LABEL[f.kind]} finding for ${f.itemLabel} for a year`}
                      >
                        <EyeOff size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
                {claims.findings.length > 6 && (
                  <button className="ov-drift-more" onClick={() => setClaimsOpen((v) => !v)}>
                    {claimsOpen ? 'Show fewer' : `Show all ${claims.findings.length}`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {dups.comparedFields > 1 && (
        <div className="ov-card">
          <h3 className="ov-section-title">Repetition check</h3>
          {dups.findings.length === 0 ? (
            <div className="ov-panel">
              <p className="ov-trans-hint ov-drift-ok">
                <Check size={14} /> No two items tell the same story — the {dups.comparedFields} prose
                fields compared don't repeat each other.
              </p>
            </div>
          ) : (
            <>
              <p className="ov-trans-hint">
                {dups.findings.length} pair{dups.findings.length !== 1 ? 's' : ''} of items say nearly the
                same thing — usually an achievement pasted into both the employment and its project. A reader
                notices; keep the strongest telling and trim the other.
              </p>
              <div className="ov-panel">
                <ul className="ov-drift-list">
                  {(dupsOpen ? dups.findings : dups.findings.slice(0, 6)).map((f) => (
                    <li key={f.dismissKey} className="ov-drift-li">
                      <div className="ov-dup-row">
                        <span className={`ov-drift-badge ov-drift-${f.kind === 'field' ? 'high' : 'low'}`}>
                          {f.kind === 'field' ? 'near-copy' : 'sentence'}
                        </span>
                        <span className="ov-dup-pair">
                          <DupSide loc={f.a} onGo={goTo} />
                          <span className="ov-missing-sep">↔</span>
                          <DupSide loc={f.b} onGo={goTo} />
                        </span>
                        <span className="ov-drift-detail">{f.detail}</span>
                      </div>
                      <button
                        className="ov-drift-ignore"
                        onClick={() => dismiss(f.dismissKey)}
                        title="Intentional — don't flag this pair for a year"
                        aria-label={`Dismiss the repetition finding for ${f.a.itemLabel} and ${f.b.itemLabel} for a year`}
                      >
                        <EyeOff size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
                {dups.findings.length > 6 && (
                  <button className="ov-drift-more" onClick={() => setDupsOpen((v) => !v)}>
                    {dupsOpen ? 'Show fewer' : `Show all ${dups.findings.length}`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        .ov-dup-row {
          display: flex; align-items: baseline; gap: 10px; flex: 1; min-width: 0;
          padding: 6px 12px; font-size: 13px; color: var(--ink-soft); flex-wrap: wrap;
        }
        .ov-dup-pair { display: inline-flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
        .ov-dup-side {
          display: inline-flex; align-items: baseline; gap: 4px;
          padding: 1px 4px; border-radius: var(--r-sm);
          font-weight: 500; color: var(--ink); background: transparent;
          transition: color .12s, background .12s;
        }
        .ov-dup-side:hover { background: var(--accent-wash); color: var(--accent); }
        .ov-dup-go { color: var(--ink-faint); transform: translateY(1px); }
        .ov-dup-side:hover .ov-dup-go { color: var(--accent); }
      `}</style>
    </>
  )
}

function DupSide({ loc, onGo }: {
  loc: RedundancyFinding['a']
  onGo: (section: string, itemId: string) => void
}) {
  return (
    <button
      className="ov-dup-side"
      onClick={() => onGo(loc.section, loc.itemId)}
      title={`Open ${loc.itemLabel} (${loc.fieldLabel})`}
    >
      {loc.itemLabel}
      <ArrowRight size={11} className="ov-dup-go" />
    </button>
  )
}
