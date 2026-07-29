/**
 * B1 — the job fit report (lib/jobFit.ts), as a card in the CV advisors block.
 *
 * Renders a table rather than a score. The rows are ordered gaps-first within
 * essentials, so what opens is the thing that would sink the application, and
 * each row that cites CV items links straight to them — the point of the report
 * is the edits it provokes, and an edit you have to go hunting for doesn't
 * happen.
 *
 * Nothing here writes. The report is advice about whether and how to apply; the
 * tailoring flow on the Views page is what turns a decision to apply into a
 * document.
 */

import { useEffect, useMemo, useState } from 'react'
import { Target, ArrowRight, CircleCheck, CircleDashed, CircleX } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { selectRun, useAdvisors } from '../../store/useAdvisors'
import { AssistRun } from './AssistRun'
import { AdvancedAssistCard } from './AdvancedAssistCard'
import { CollapsibleSection } from './CollapsibleSection'
import { extractJson } from '../../lib/llmAssist'
import {
  buildJobFitPrompt, fitTally, hasPosting, validateJobFit,
  type FitStatus, type JobFitResult,
} from '../../lib/jobFit'
import { sectionLabel } from '../../lib/sections'

const STATUS_ICON: Record<FitStatus, React.ReactNode> = {
  evidenced: <CircleCheck size={13} />,
  adjacent: <CircleDashed size={13} />,
  missing: <CircleX size={13} />,
}

const STATUS_WORD: Record<FitStatus, string> = {
  evidenced: 'Evidenced',
  adjacent: 'Nearly',
  missing: 'Missing',
}

export function JobFitPanel() {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const setActiveSection = useStore((s) => s.setActiveSection)
  const setExpandedItem = useStore((s) => s.setExpandedItem)

  const resumeId = useStore((s) => s.currentResumeId) ?? ''
  const run = useAdvisors((s) => selectRun(s.runs, 'jobfit', resumeId))
  const markSeen = useAdvisors((s) => s.markSeen)
  const clearRun = useAdvisors((s) => s.clear)
  const setCollapsed = useAdvisors((s) => s.setCollapsed)
  const [posting, setPosting] = useState('')

  // Looking at the panel is seeing the result — that's what clears the toast.
  useEffect(() => {
    if (run && run.status !== 'running' && !run.seen) markSeen('jobfit', resumeId)
  }, [run, resumeId, markSeen])

  // Parsed from the stored reply on each render, so the report survives
  // navigating off to fix one of the gaps it just told you about.
  const { result, error } = useMemo(() => {
    if (!run?.raw) return { result: null as JobFitResult | null, error: null as string | null }
    try {
      return { result: validateJobFit(JSON.parse(extractJson(run.raw)), data, locale), error: null }
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'The reply could not be read.' }
    }
  }, [run?.raw, data, locale])

  const jump = (section: string, itemId: string) => {
    setActiveSection(section)
    setExpandedItem(itemId)
  }

  const ready = hasPosting(posting)
  const tally = result ? fitTally(result) : null

  return (
    <AdvancedAssistCard
      title="Can I answer this posting?"
      icon={<Target size={15} />}
      blurb={
        <>Pulls every requirement out of a job posting and checks it against your
        CV: what you can evidence, what you can&rsquo;t, and — the useful one —
        what you nearly can, where the experience is there but never named the way
        the posting names it.</>
      }
    >
      <label className="jfp-label" htmlFor="jfp-posting">Paste the job posting</label>
      <textarea
        id="jfp-posting"
        className="jfp-posting"
        rows={5}
        value={posting}
        onChange={(e) => setPosting(e.target.value)}
        placeholder="Paste the advert or requirement list here…"
      />

      <AssistRun
        buildPrompt={() => buildJobFitPrompt(data, locale, posting)}
        label="Check the fit"
        maxTokens={8000}
        advanced
        wholeCv
        disabled={!ready}
        advisor={{ id: 'jobfit', resumeId }}
        hasManualPath={false}
      />
      {!ready && posting.trim().length > 0 && (
        <p className="jfp-hint">That&rsquo;s very short for a posting — paste the requirements too.</p>
      )}
      {error && <p className="jfp-err" role="alert">{error}</p>}

      {result && (
        <div className="jfp-report">
          <div className="jfp-report-bar">
            <span className="jfp-kept">Kept until you clear it — safe to go and fix things.</span>
            <button className="jfp-clear" onClick={() => clearRun('jobfit', resumeId)}>Clear report</button>
          </div>
          {result.verdict && <p className="jfp-verdict">{result.verdict}</p>}

          {tally && (
            <div className="jfp-tally">
              <span className="jfp-chip jfp-evidenced">{tally.evidenced} evidenced</span>
              <span className="jfp-chip jfp-adjacent">{tally.adjacent} nearly</span>
              <span className="jfp-chip jfp-missing">{tally.missing} missing</span>
            </div>
          )}

          <CollapsibleSection
            title="Requirements"
            count={result.requirements.length}
            open={run?.collapsed !== true}
            onToggle={(open) => setCollapsed('jobfit', resumeId, !open)}
          >
          <ul className="jfp-list">
            {result.requirements.map((r) => (
              <li key={r.key} className={`jfp-row jfp-${r.status}`}>
                <div className="jfp-row-head">
                  <span className="jfp-status" aria-label={STATUS_WORD[r.status]}>
                    {STATUS_ICON[r.status]} {STATUS_WORD[r.status]}
                  </span>
                  <span className="jfp-req">{r.requirement}</span>
                  {r.weight === 'desirable' && <span className="jfp-weight">nice to have</span>}
                </div>

                {r.evidence.length > 0 && (
                  <ul className="jfp-evidence">
                    {r.evidence.map((e, i) => (
                      <li key={`${r.key}:${e.itemId}:${i}`}>
                        <button className="jfp-jump" onClick={() => jump(e.section, e.itemId)}>
                          {sectionLabel(e.section)} · {e.itemLabel} <ArrowRight size={11} />
                        </button>
                        {e.note && <span className="jfp-note"> {e.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}

                {r.suggestion && <p className="jfp-suggestion">{r.suggestion}</p>}
              </li>
            ))}
          </ul>
          </CollapsibleSection>

          {result.dropped.length > 0 && (
            <details className="jfp-dropped">
              <summary>{result.dropped.length} citation(s) couldn’t be matched to your CV</summary>
              <ul>{result.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      <style>{`
        .jfp-label { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
        .jfp-posting {
          width: 100%; padding: 9px 11px; font: inherit; font-size: 13px; line-height: 1.5;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); color: var(--ink); resize: vertical;
        }
        .jfp-posting:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
        .jfp-hint { margin: 0; font-size: 12px; color: var(--warn-ink); }
        .jfp-err { margin: 0; font-size: 12.5px; color: var(--err-ink); line-height: 1.45; }
        .jfp-report { display: flex; flex-direction: column; gap: 10px; }
        .jfp-report-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .jfp-kept { font-size: 11.5px; color: var(--ink-faint); }
        .jfp-clear {
          padding: 3px 9px; border-radius: var(--r-sm); cursor: pointer;
          font-size: 12px; font-weight: 600;
          border: 1px solid var(--line); background: var(--paper); color: var(--ink-soft);
        }
        .jfp-clear:hover { border-color: var(--line-strong); color: var(--ink); }
        .jfp-verdict {
          margin: 0; padding: 10px 12px; font-size: 13px; line-height: 1.55;
          background: var(--paper-sunken); border-left: 3px solid var(--accent);
          border-radius: var(--r-sm); color: var(--ink);
        }
        .jfp-tally { display: flex; gap: 6px; flex-wrap: wrap; }
        .jfp-chip {
          font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
          border: 1px solid var(--line);
        }
        .jfp-chip.jfp-evidenced { color: var(--ok-ink); background: var(--ok-wash); border-color: var(--ok-ink); }
        .jfp-chip.jfp-adjacent { color: var(--warn-ink); background: var(--warn-wash); border-color: var(--warn-ink); }
        .jfp-chip.jfp-missing { color: var(--err-ink); background: var(--err-wash); border-color: var(--err-ink); }
        .jfp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .jfp-row {
          display: flex; flex-direction: column; gap: 5px;
          border: 1px solid var(--line); border-left-width: 3px;
          border-radius: var(--r-sm); background: var(--paper); padding: 10px 12px;
        }
        .jfp-row.jfp-evidenced { border-left-color: var(--ok-ink); }
        .jfp-row.jfp-adjacent { border-left-color: var(--warn-ink); }
        .jfp-row.jfp-missing { border-left-color: var(--err-ink); }
        .jfp-row-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .jfp-status {
          display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
          font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
        }
        .jfp-status svg { flex-shrink: 0; }
        .jfp-row.jfp-evidenced .jfp-status { color: var(--ok-ink); }
        .jfp-row.jfp-adjacent .jfp-status { color: var(--warn-ink); }
        .jfp-row.jfp-missing .jfp-status { color: var(--err-ink); }
        .jfp-req { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.4; }
        .jfp-weight {
          font-size: 10.5px; font-weight: 600; color: var(--ink-faint);
          border: 1px solid var(--line); border-radius: 999px; padding: 0 6px;
        }
        .jfp-evidence { list-style: none; margin: 0; padding: 0 0 0 2px; display: flex; flex-direction: column; gap: 3px; }
        .jfp-jump {
          display: inline-flex; align-items: center; gap: 4px;
          background: none; border: none; padding: 0; cursor: pointer;
          font-size: 12px; font-weight: 600; color: var(--accent);
        }
        .jfp-jump:hover { text-decoration: underline; }
        .jfp-note { font-size: 12px; color: var(--ink-soft); }
        .jfp-suggestion { margin: 2px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
        .jfp-dropped { font-size: 11.5px; color: var(--ink-faint); }
        .jfp-dropped summary { cursor: pointer; }
        .jfp-dropped ul { margin: 6px 0 0; padding-left: 18px; }
      `}</style>
    </AdvancedAssistCard>
  )
}
