/**
 * B4 — the ATS / keyword audit, in the view editor beside the export controls.
 *
 * It lives here rather than on Overview because it audits an ARTIFACT: the
 * document this view exports, not the CV behind it. Running it from anywhere
 * else would invite auditing the wrong thing.
 *
 * The free pass runs on a button with no model at all, so this panel is useful
 * on an install with no AI configured — the only advanced part is the optional
 * second pass, and that is the only part gated.
 */

import { useEffect, useMemo, useState } from 'react'
import { ScanSearch, Check, PackageOpen, CircleX, Quote, Sparkles } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { AssistRun } from './AssistRun'
import { useAdvancedAssist } from './AdvancedAssistCard'
import { CollapsibleSection } from './CollapsibleSection'
import { selectRun, useAdvisors } from '../../store/useAdvisors'
import { useAdvisorRun, jsonReply } from '../../store/useAdvisorRun'
import {
  buildAtsPrompt, coverageTally, runLiteralAudit, validateAtsResponse,
  type AtsCoverage, type AtsEquivalence, type AtsModelResult, type TermStatus,
} from '../../lib/atsAudit'
import { buildViewText } from '../../lib/viewText'
import type { ResumeView } from '../../types'

const STATUS_ICON: Record<TermStatus, React.ReactNode> = {
  present: <Check size={12} />,
  elsewhere: <PackageOpen size={12} />,
  absent: <CircleX size={12} />,
}

const STATUS_WORD: Record<TermStatus, string> = {
  present: 'In the export',
  elsewhere: 'Excluded from this view',
  absent: 'Not in your CV',
}

export function AtsAuditPanel({ view }: { view: ResumeView }) {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const { enabled: advanced } = useAdvancedAssist()

  const resumeId = useStore((s) => s.currentResumeId) ?? ''
  const [posting, setPosting] = useState('')
  const [coverage, setCoverage] = useState<AtsCoverage | null>(null)

  const viewTextOut = useMemo(() => buildViewText(data, view, locale), [data, view, locale])

  /**
   * Restore the posting a stored report was produced from — on mount, and when
   * the open view changes.
   *
   * The model's answers are keyed to terms extracted from the posting, so
   * keeping the report without the posting would leave a table of verdicts about
   * nothing. The free pass is a local text search, so recomputing it here costs
   * nothing and no model call.
   */
  useEffect(() => {
    const stored = selectRun(useAdvisors.getState().runs, 'ats', resumeId, view.id)?.input ?? ''
    setPosting(stored)
    setCoverage(stored ? runLiteralAudit(data, view, locale, stored) : null)
    // Deliberately keyed on the RUN's identity only: re-running the free pass on
    // every CV keystroke would fight the user's own "Check keywords" button.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the run only (see above)
  }, [resumeId, view.id])

  const runLiteral = () => setCoverage(runLiteralAudit(data, view, locale, posting))

  const gaps = coverage?.terms.filter((t) => t.status !== 'present').map((t) => t.term) ?? []

  // The paid second pass is scoped to this view and held in the run store:
  // acting on an `elsewhere` verdict means navigating away to re-include an
  // item, and component state would lose the report on the way.
  const { ref, result: model, parseError: error } = useAdvisorRun<AtsModelResult>(
    'ats',
    jsonReply((json) => validateAtsResponse(json, gaps)),
    view.id,
    gaps.join('\u0000'),
  )

  const byTerm = new Map<string, AtsEquivalence>()
  for (const e of model?.equivalences ?? []) byTerm.set(e.term, e)

  const tally = coverage ? coverageTally(coverage) : null
  const ready = posting.trim().length > 40

  return (
    <div className="ats">
      <h4 className="ats-head"><ScanSearch size={15} /> Keyword check against a posting</h4>
      <p className="ats-blurb">
        Reads the <strong>text this view actually exports</strong> and reports which
        of a posting&rsquo;s terms appear in it. Recruiters search their database by
        keyword, so a term that isn&rsquo;t in the document can&rsquo;t be found —
        whether or not you have the experience.
      </p>

      <label className="ats-label" htmlFor="ats-posting">Paste the job posting</label>
      <textarea
        id="ats-posting"
        className="ats-posting"
        rows={4}
        value={posting}
        onChange={(e) => setPosting(e.target.value)}
        placeholder="Paste the advert or requirement list here…"
      />

      <div className="ats-actions">
        <button className="ats-run" onClick={runLiteral} disabled={!ready}>
          <ScanSearch size={13} /> Check keywords
        </button>
        <span className="ats-free">No AI needed — this is a text search on your export.</span>
      </div>

      {coverage && (
        <>
          {tally && (
            <div className="ats-tally">
              <span className="ats-chip ats-present">{tally.present} in the export</span>
              <span className="ats-chip ats-elsewhere">{tally.elsewhere} excluded by this view</span>
              <span className="ats-chip ats-absent">{tally.absent} not in your CV</span>
            </div>
          )}

          {tally?.elsewhere ? (
            <p className="ats-tip">
              <PackageOpen size={13} /> The &ldquo;excluded&rdquo; ones are in your master CV but
              this view leaves those items out. Re-including an item fixes those
              without writing anything.
            </p>
          ) : null}

          <CollapsibleSection title="Terms" count={coverage.terms.length}>
          <ul className="ats-list">
            {coverage.terms.map((t) => {
              const eq = byTerm.get(t.term)
              return (
                <li key={t.term} className={`ats-term ats-${t.status}`}>
                  <div className="ats-term-head">
                    <span className="ats-status">{STATUS_ICON[t.status]} {STATUS_WORD[t.status]}</span>
                    <span className="ats-word">{t.term}</span>
                    {t.known && <span className="ats-known" title="This is in your skill or role registry">registry</span>}
                    {eq && eq.verdict !== 'missing' && (
                      <span className={`ats-verdict ats-v-${eq.verdict}`}>
                        {eq.verdict === 'covered' ? 'said differently' : 'wording gap'}
                      </span>
                    )}
                  </div>
                  {eq?.quote && (
                    <p className="ats-quote"><Quote size={11} /> {eq.quote}</p>
                  )}
                  {eq?.suggestion && <p className="ats-suggestion">{eq.suggestion}</p>}
                </li>
              )
            })}
          </ul>
          </CollapsibleSection>

          {gaps.length > 0 && advanced && (
            <div className="ats-second">
              <div className="ats-second-head">
                <Sparkles size={13} /> Second pass — synonyms, the other language, and where a truthful mention would fit
              </div>
              <p className="ats-blurb">
                A text search can&rsquo;t tell that &ldquo;K8s&rdquo; is Kubernetes, or that your
                Norwegian text already answers an English requirement. This asks your
                model about the {gaps.length} term(s) above that weren&rsquo;t found —
                and it will never suggest claiming something your CV doesn&rsquo;t show.
              </p>
              <AssistRun
                buildPrompt={() => buildAtsPrompt(coverage, viewTextOut, posting, locale)}
                advisor={ref}
                advisorInput={posting}
                label="Check for equivalents"
                maxTokens={4000}
                advanced
                wholeCv
                hasManualPath={false}
              />
            </div>
          )}

          {error && <p className="ats-err" role="alert">{error}</p>}
          {model && model.dropped.length > 0 && (
            <details className="ats-dropped">
              <summary>{model.dropped.length} reply entr(ies) ignored</summary>
              <ul>{model.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </details>
          )}
        </>
      )}

      <style>{`
        .ats { display: flex; flex-direction: column; gap: 8px; }
        .ats-head {
          display: flex; align-items: center; gap: 7px; margin: 0;
          font-family: var(--serif); font-weight: 400; font-size: 16px; color: var(--ink);
        }
        .ats-head svg { color: var(--secondary-ink); }
        .ats-blurb { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
        .ats-label { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
        .ats-posting {
          width: 100%; padding: 9px 11px; font: inherit; font-size: 13px; line-height: 1.5;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); color: var(--ink); resize: vertical;
        }
        .ats-posting:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
        .ats-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .ats-run {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 13px; border-radius: var(--r-sm); font-size: 13px; font-weight: 600;
          background: var(--accent); color: #fff; border: 1px solid var(--accent); cursor: pointer;
        }
        .ats-run:hover:not(:disabled) { background: var(--accent-bright); }
        .ats-run:disabled { opacity: .55; cursor: default; }
        .ats-free { font-size: 11.5px; color: var(--ok-ink); }
        .ats-tally { display: flex; gap: 6px; flex-wrap: wrap; }
        .ats-chip {
          font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
          border: 1px solid var(--line);
        }
        .ats-chip.ats-present { color: var(--ok-ink); background: var(--ok-wash); border-color: var(--ok-ink); }
        .ats-chip.ats-elsewhere { color: var(--warn-ink); background: var(--warn-wash); border-color: var(--warn-ink); }
        .ats-chip.ats-absent { color: var(--err-ink); background: var(--err-wash); border-color: var(--err-ink); }
        .ats-tip {
          display: flex; align-items: flex-start; gap: 6px; margin: 0;
          font-size: 12.5px; line-height: 1.5; color: var(--warn-ink);
        }
        .ats-tip svg { flex-shrink: 0; margin-top: 2px; }
        .ats-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
        .ats-term {
          border: 1px solid var(--line); border-left-width: 3px;
          border-radius: var(--r-sm); background: var(--paper); padding: 7px 10px;
        }
        .ats-term.ats-present { border-left-color: var(--ok-ink); }
        .ats-term.ats-elsewhere { border-left-color: var(--warn-ink); }
        .ats-term.ats-absent { border-left-color: var(--err-ink); }
        .ats-term-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .ats-status {
          display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
          font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
        }
        .ats-present .ats-status { color: var(--ok-ink); }
        .ats-elsewhere .ats-status { color: var(--warn-ink); }
        .ats-absent .ats-status { color: var(--err-ink); }
        .ats-word { font-size: 13px; font-weight: 600; color: var(--ink); }
        .ats-known, .ats-verdict {
          font-size: 11px; font-weight: 600; border-radius: 999px; padding: 0 6px;
          border: 1px solid var(--line); color: var(--ink-faint);
        }
        .ats-verdict.ats-v-covered { color: var(--ok-ink); border-color: var(--ok-ink); background: var(--ok-wash); }
        .ats-verdict.ats-v-phrasing { color: var(--secondary-ink-text); border-color: var(--secondary-line); background: var(--secondary-tint); }
        .ats-quote {
          display: flex; align-items: flex-start; gap: 5px; margin: 4px 0 0;
          font-size: 12px; font-style: italic; color: var(--ink-soft); line-height: 1.45;
        }
        .ats-quote svg { flex-shrink: 0; margin-top: 3px; }
        .ats-suggestion { margin: 3px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
        .ats-second {
          display: flex; flex-direction: column; gap: 8px; margin-top: 4px;
          padding: 11px; border: 1px solid var(--secondary-line);
          border-radius: var(--r-sm); background: var(--paper-raised);
        }
        .ats-second-head {
          display: flex; align-items: center; gap: 6px;
          font-size: 12.5px; font-weight: 600; color: var(--secondary-ink-text);
        }
        .ats-err { margin: 0; font-size: 12.5px; color: var(--err-ink); }
        .ats-dropped { font-size: 11.5px; color: var(--ink-faint); }
        .ats-dropped summary { cursor: pointer; }
        .ats-dropped ul { margin: 6px 0 0; padding-left: 18px; }
      `}</style>
    </div>
  )
}
