/**
 * The whole-CV advisors, gathered on the Overview page: review (A1), voice &
 * consistency (A2), cross-language meaning (A3) and achievement mining (A4).
 *
 * They live together because they share an input — the entire CV — and because
 * that makes them a place you go rather than four buttons you have to know
 * about. Each is a separate run: bundling them into one call would produce one
 * enormous reply, one failure mode, and no way to accept the wording changes
 * while ignoring the review.
 *
 * Every one of them is wrapped in `AdvancedAssistCard`, which renders nothing
 * unless the configured model is declared high-end — so on a small local model
 * this entire block is simply absent.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardCheck, PenLine, Languages, Trophy, Check, CheckCheck, Square, X, Quote,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import {
  selectRun, unresolved, useAdvisors, type AdvisorId,
} from '../../store/useAdvisors'
import { AssistRun } from '../ui/AssistRun'
import { AdvancedAssistCard, useAdvancedAssist } from '../ui/AdvancedAssistCard'
import { AssistFindingsPanel } from '../ui/AssistFindingsPanel'
import { AssistProposalsPanel } from '../ui/AssistProposalsPanel'
import { JobFitPanel } from '../ui/JobFitPanel'
import { extractJson } from '../../lib/llmAssist'
import { validateFindings, type FindingsResult } from '../../lib/assistFindings'
import { validateProposals, type ProposalsResult } from '../../lib/assistProposals'
import { buildCvReviewPrompt } from '../../lib/cvReview'
import { buildVoicePassPrompt } from '../../lib/voicePass'
import { buildSemanticDriftPrompt } from '../../lib/semanticDrift'
import {
  applyAchievements, buildMiningPrompt, validateMining,
  type Achievement, type MiningResult,
} from '../../lib/achievementMining'
import { translateAchievements } from '../../lib/achievementTranslate'
import { sectionLabel } from '../../lib/sections'

/**
 * Read a stored advisor run and parse it, keeping only the suggestions the user
 * hasn't already dealt with.
 *
 * Parsing on every render rather than at reply time is deliberate: the
 * validators resolve ids against the LIVE CV, so a finding about an item you
 * deleted (or already fixed) falls out by itself, with no invalidation logic to
 * get wrong. The raw reply is the only thing stored.
 */
function useAdvisorRun<T>(id: AdvisorId, parse: (json: unknown) => T) {
  const resumeId = useStore((s) => s.currentResumeId) ?? ''
  const run = useAdvisors((s) => selectRun(s.runs, id, resumeId))
  const markSeen = useAdvisors((s) => s.markSeen)
  const clear = useAdvisors((s) => s.clear)
  const resolve = useAdvisors((s) => s.resolve)
  const resolveMany = useAdvisors((s) => s.resolveMany)

  // Looking at the panel IS seeing the result — that's what clears the toast.
  useEffect(() => {
    if (run && run.status !== 'running' && !run.seen) markSeen(id, resumeId)
  }, [run, id, resumeId, markSeen])

  const parsed = useMemo(() => {
    if (!run?.raw) return { result: null as T | null, error: null as string | null }
    try {
      return { result: parse(JSON.parse(extractJson(run.raw))), error: null }
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'The reply could not be read.' }
    }
    // `parse` closes over the live store, so re-run whenever the run changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.raw, run?.resolved])

  return {
    resumeId,
    run,
    result: parsed.result,
    parseError: parsed.error,
    resolve: (key: string, how: 'accepted' | 'dismissed') => resolve(id, resumeId, key, how),
    resolveMany: (keys: readonly string[], how: 'accepted' | 'dismissed') => resolveMany(id, resumeId, keys, how),
    clear: () => clear(id, resumeId),
  }
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return <p className="cva-err" role="alert">{error}</p>
}

// ── A1 — whole-CV review ─────────────────────────────────────────────────────

function CvReview() {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const { resumeId, run, result, parseError, resolve } = useAdvisorRun<FindingsResult>(
    'review', (json) => validateFindings(json, data, locale),
  )

  return (
    <AdvancedAssistCard
      title="Review my whole CV"
      icon={<ClipboardCheck size={15} />}
      blurb={
        <>Reads every section at once and reports what a careful reader would hold
        against it — thin entries, claims nothing below evidences, repeated
        phrasing, gaps. It reports; it never rewrites.</>
      }
    >
      <AssistRun
        buildPrompt={() => buildCvReviewPrompt(data, locale)}
        label="Review my CV"
        maxTokens={6000}
        advanced
        wholeCv
        advisor={{ id: 'review', resumeId }}
        hasManualPath={false}
      />
      <ErrorLine error={parseError} />
      <AssistFindingsPanel
        result={result}
        run={run}
        onResolve={resolve}
        emptyText="Nothing to flag — this CV reads well."
      />
    </AdvancedAssistCard>
  )
}

// ── A2 — consistency & voice ─────────────────────────────────────────────────

function VoicePass() {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const { resumeId, run, result, parseError, resolveMany } = useAdvisorRun<ProposalsResult>(
    'voice', (json) => validateProposals(json, data, locale),
  )

  return (
    <AdvancedAssistCard
      title="Make the writing consistent"
      icon={<PenLine size={15} />}
      blurb={
        <>Works out the voice your CV mostly uses — person, tense, length, how you
        capitalise technologies — and proposes moving the outliers to it. Same
        facts, better prose. Every change is shown against the original and
        applied only if you tick it.</>
      }
    >
      <AssistRun
        buildPrompt={() => buildVoicePassPrompt(data, locale)}
        label="Check my writing"
        maxTokens={12000}
        advanced
        wholeCv
        advisor={{ id: 'voice', resumeId }}
        hasManualPath={false}
      />
      <ErrorLine error={parseError} />
      <AssistProposalsPanel result={result} run={run} onResolve={resolveMany} />
    </AdvancedAssistCard>
  )
}

// ── A3 — cross-language meaning ──────────────────────────────────────────────

function SemanticDrift() {
  const data = useStore((s) => s.data)
  const primary = useStore((s) => s.primaryLocale)
  const secondary = useStore((s) => s.secondaryLocale)
  const { resumeId, run, result, parseError, resolve } = useAdvisorRun<FindingsResult>(
    'drift', (json) => validateFindings(json, data, primary),
  )

  // Nothing to compare with one language on screen. Hidden rather than
  // disabled: the fix is the language switcher, not this panel.
  if (!secondary) return null

  return (
    <AdvancedAssistCard
      title="Do my two languages say the same thing?"
      icon={<Languages size={15} />}
      blurb={
        <>Compares the {primary.toUpperCase()} and {secondary.toUpperCase()} columns
        for MEANING, which the offline drift check above can't do: a dropped
        sentence, a job title translated wrongly, a term rendered three ways
        across three projects.</>
      }
    >
      <AssistRun
        buildPrompt={() => buildSemanticDriftPrompt(data, primary, secondary)}
        label="Compare the languages"
        maxTokens={6000}
        advanced
        wholeCv
        advisor={{ id: 'drift', resumeId }}
        hasManualPath={false}
      />
      <ErrorLine error={parseError} />
      <AssistFindingsPanel
        result={result}
        run={run}
        onResolve={resolve}
        emptyText="The two languages agree."
      />
    </AdvancedAssistCard>
  )
}

// ── A4 — achievement mining ──────────────────────────────────────────────────

function AchievementMining() {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const secondary = useStore((s) => s.secondaryLocale)
  const replaceData = useStore((s) => s.replaceData)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const { resumeId, run, result, parseError, resolveMany } = useAdvisorRun<MiningResult>(
    'achievements', (json) => validateMining(json, data, locale),
  )

  // Only what the user hasn't already dealt with — accepting one suggestion
  // must not discard the other four.
  const items = unresolved(result?.achievements ?? [], run)
  const chosen = items.filter((a) => accepted.has(a.key))
  const allOn = items.length > 0 && accepted.size === items.length

  const toggle = (key: string) => setAccepted((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const apply = async () => {
    if (!chosen.length || applying) return
    setApplying(true)
    try {
      // Translate first so the write fills BOTH language columns at once — a
      // highlight that lands in one column makes the other version of the CV
      // silently say less. Best-effort: no translator configured just means
      // primary-only, which is what used to happen unconditionally.
      const ready = await translateAchievements(data, chosen, locale, secondary)
      const { data: next } = applyAchievements(data, ready, locale)
      replaceData(next)
      resolveMany(chosen.map((a) => a.key), 'accepted')
      setAccepted(new Set())
    } finally {
      setApplying(false)
    }
  }

  const dismissAll = () => {
    resolveMany(items.map((a) => a.key), 'dismissed')
    setAccepted(new Set())
  }

  return (
    <AdvancedAssistCard
      title="Find buried achievements"
      icon={<Trophy size={15} />}
      blurb={
        <>Looks through your long descriptions for results a skimming reader would
        miss, and proposes promoting them to project highlights or to a key
        competency. Every proposal quotes the sentence it came from — if the quote
        isn't there, don't accept it.</>
      }
    >
      <AssistRun
        buildPrompt={() => buildMiningPrompt(data, locale)}
        label="Find achievements"
        maxTokens={8000}
        advanced
        wholeCv
        advisor={{ id: 'achievements', resumeId }}
        hasManualPath={false}
      />
      <ErrorLine error={parseError} />

      {result && items.length === 0 && (
        <p className="cva-ok"><Check size={14} /> Nothing buried — your highlights already carry the results.</p>
      )}

      {items.length > 0 && (
        <div className="cva-mine">
          <div className="cva-bar">
            <span className="cva-count">{accepted.size} of {items.length} selected</span>
            <button className="cva-all"
              onClick={() => setAccepted(allOn ? new Set() : new Set(items.map((a) => a.key)))}>
              {allOn ? <Square size={12} /> : <CheckCheck size={12} />}
              {allOn ? 'Clear all' : 'Select all'}
            </button>
          </div>

          <ul className="cva-list">
            {items.map((a: Achievement) => (
              <li key={a.key} className={accepted.has(a.key) ? 'cva-item cva-on' : 'cva-item'}>
                <label className="cva-pick">
                  <input type="checkbox" checked={accepted.has(a.key)} onChange={() => toggle(a.key)} />
                  <span className="cva-target">
                    {a.target === 'highlight' ? 'Highlight' : 'New competency'}
                  </span>
                  <span className="cva-where">{sectionLabel(a.section)} · {a.itemLabel}</span>
                </label>
                <p className="cva-text">{a.text}</p>
                {a.detail && <p className="cva-detail">{a.detail}</p>}
                <p className="cva-evidence"><Quote size={11} /> {a.evidence}</p>
              </li>
            ))}
          </ul>

          <div className="cva-actions">
            <button className="cva-apply" onClick={() => void apply()} disabled={!chosen.length || applying}>
              <Check size={13} /> {applying ? 'Adding…' : `Add ${chosen.length || ''} selected`}
            </button>
            <button className="cva-discard" onClick={dismissAll} disabled={applying}>
              <X size={13} /> Dismiss the rest
            </button>
          </div>
        </div>
      )}

      {result && result.dropped.length > 0 && (
        <details className="cva-dropped">
          <summary>{result.dropped.length} proposal(s) were rejected</summary>
          <ul>{result.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </details>
      )}
    </AdvancedAssistCard>
  )
}

// ── The block ────────────────────────────────────────────────────────────────

export function CvAdvisors() {
  const { enabled } = useAdvancedAssist()
  // Hide the heading too, not just the cards — an empty "AI advisors" section
  // would be an advert for a feature this install doesn't have.
  if (!enabled) return null

  return (
    <section className="cva-wrap" aria-label="AI advisors">
      <h2 className="cva-heading">AI advisors</h2>
      <p className="cva-sub">
        Each of these reads your whole CV in one pass. Everything they produce is
        a draft for you to check — nothing is saved until you accept it.
      </p>
      <CvReview />
      <VoicePass />
      <SemanticDrift />
      <AchievementMining />
      {/* Applying to something specific rather than tending the CV — last,
          because it needs a posting pasted in and the others don't. */}
      <JobFitPanel />

      <style>{`
        .cva-wrap { display: flex; flex-direction: column; gap: 12px; margin-top: 28px; }
        .cva-heading {
          margin: 0; font-family: var(--serif); font-weight: 300;
          font-size: 21px; color: var(--ink);
        }
        .cva-sub { margin: -4px 0 4px; font-size: 13px; color: var(--ink-soft); line-height: 1.5; }
        .cva-err { margin: 0; font-size: 12.5px; color: var(--err-ink); line-height: 1.45; }
        .cva-ok {
          display: flex; align-items: center; gap: 7px; margin: 0;
          font-size: 13px; color: var(--ok-ink);
        }
        .cva-mine { display: flex; flex-direction: column; gap: 10px; }
        .cva-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .cva-count { font-size: 12px; color: var(--ink-faint); }
        .cva-all {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 4px 9px; border-radius: var(--r-sm); cursor: pointer;
          font-size: 12px; font-weight: 600;
          border: 1px solid var(--line); background: var(--paper); color: var(--ink-soft);
        }
        .cva-all:hover { border-color: var(--accent); color: var(--accent); }
        .cva-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .cva-item {
          display: flex; flex-direction: column; gap: 5px;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); padding: 10px 12px;
        }
        .cva-on { border-color: var(--accent); background: var(--accent-wash); }
        .cva-pick { display: flex; align-items: center; gap: 8px; cursor: pointer; flex-wrap: wrap; }
        .cva-pick input { flex-shrink: 0; }
        .cva-target {
          font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
          color: var(--secondary-ink-text); background: var(--secondary-tint);
          border: 1px solid var(--secondary-line); border-radius: 999px; padding: 1px 7px;
        }
        .cva-where { font-size: 11.5px; color: var(--ink-faint); }
        .cva-text { margin: 0 0 0 24px; font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.45; }
        .cva-detail { margin: 0 0 0 24px; font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; }
        .cva-evidence {
          display: flex; align-items: flex-start; gap: 5px; margin: 2px 0 0 24px;
          font-size: 12px; font-style: italic; color: var(--ink-faint); line-height: 1.45;
        }
        .cva-evidence svg { flex-shrink: 0; margin-top: 3px; }
        .cva-actions { display: flex; gap: 8px; }
        .cva-apply, .cva-discard {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--line); background: var(--paper);
        }
        .cva-apply { background: var(--accent); color: #fff; border-color: var(--accent); }
        .cva-apply:hover:not(:disabled) { background: var(--accent-bright); }
        .cva-apply:disabled { opacity: .55; cursor: default; }
        .cva-discard:hover { border-color: var(--line-strong); }
        .cva-dropped { font-size: 11.5px; color: var(--ink-faint); }
        .cva-dropped summary { cursor: pointer; }
        .cva-dropped ul { margin: 6px 0 0; padding-left: 18px; }
      `}</style>
    </section>
  )
}
