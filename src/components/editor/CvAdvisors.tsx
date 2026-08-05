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

import { useState } from 'react'
import {
  ClipboardCheck, PenLine, Languages, Trophy, Check, CheckCheck, Square, X, Quote,
  Lock, Settings,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { unresolved } from '../../store/useAdvisors'
import { useAdvisorRun, jsonReply } from '../../store/useAdvisorRun'
import { AssistRun } from '../ui/AssistRun'
import { AdvancedAssistCard, useAdvancedAssist } from '../ui/AdvancedAssistCard'
import { AssistFindingsPanel } from '../ui/AssistFindingsPanel'
import { AssistProposalsPanel } from '../ui/AssistProposalsPanel'
import { CollapsibleSection } from '../ui/CollapsibleSection'
import { JobFitPanel } from '../ui/JobFitPanel'
import { backendName } from '../../lib/llmAssist'
import { openSettings } from '../../lib/settingsBus'
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

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return <p className="cva-err" role="alert">{error}</p>
}

// ── A1 — whole-CV review ─────────────────────────────────────────────────────

function CvReview() {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const {
    resumeId, run, result, parseError, resolve, collapsed, setCollapsed,
  } = useAdvisorRun<FindingsResult>('review', jsonReply((json) => validateFindings(json, data, locale)))

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
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        emptyText="Nothing to flag — this CV reads well."
      />
    </AdvancedAssistCard>
  )
}

// ── A2 — consistency & voice ─────────────────────────────────────────────────

function VoicePass() {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const {
    resumeId, run, result, parseError, resolveMany, collapsed, setCollapsed,
  } = useAdvisorRun<ProposalsResult>('voice', jsonReply((json) => validateProposals(json, data, locale)))

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
      <AssistProposalsPanel
        result={result}
        run={run}
        onResolve={resolveMany}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />
    </AdvancedAssistCard>
  )
}

// ── A3 — cross-language meaning ──────────────────────────────────────────────

function SemanticDrift() {
  const data = useStore((s) => s.data)
  const primary = useStore((s) => s.primaryLocale)
  const secondary = useStore((s) => s.secondaryLocale)
  const {
    resumeId, run, result, parseError, resolve, collapsed, setCollapsed,
  } = useAdvisorRun<FindingsResult>('drift', jsonReply((json) => validateFindings(json, data, primary)))

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
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
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
  const {
    resumeId, run, result, parseError, resolveMany, collapsed, setCollapsed,
  } = useAdvisorRun<MiningResult>('achievements', jsonReply((json) => validateMining(json, data, locale)))

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
      // silently say less. Best-effort: with no translator configured the write
      // is primary-only.
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
          <CollapsibleSection
            title="Achievements found"
            count={items.length}
            open={!collapsed}
            onToggle={(open) => setCollapsed(!open)}
            actions={
              <>
                <span className="cva-count">{accepted.size} selected</span>
                <button className="cva-all"
                  onClick={() => setAccepted(allOn ? new Set() : new Set(items.map((a) => a.key)))}>
                  {allOn ? <Square size={12} /> : <CheckCheck size={12} />}
                  {allOn ? 'Clear all' : 'Select all'}
                </button>
              </>
            }
          >
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
          </CollapsibleSection>

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
  const { enabled, status } = useAdvancedAssist()

  return (
    <section className="cva-wrap" aria-label="AI advisors">
      <h2 className="cva-heading">AI advisors</h2>
      {enabled ? (
        <p className="cva-sub">
          Each advisor below reads your whole CV in one pass. Everything they
          produce is a draft for you to check — nothing is saved until you accept it.
        </p>
      ) : (
        /* The heading stays even with nothing configured. Hiding it entirely
           meant the capability was invisible to anyone who hadn't already read
           about it — you can't choose to unlock a feature you've never seen. */
        <div className="cva-locked">
          {/* The icon and the prose are the flex container's only two children.
              Leaving the sentence as bare text made every run between the tags
              its own anonymous flex item, so a <strong> mid-sentence sliced the
              paragraph into columns. */}
          <p className="cva-locked-lede">
            <Lock size={14} />
            <span>
              The AI assists elsewhere in the editor each work on one field —
              summarise this description, translate that column. An{' '}
              <strong>advisor</strong> is the opposite: it reads your{' '}
              <strong>whole CV in one pass</strong> and reports on it as a
              document. That&rsquo;s the only way to catch anything comparative —
              a claim nothing else backs up, two entries that contradict each
              other, the one project that undersells itself.
            </span>
          </p>
          <ul className="cva-locked-list">
            <li>
              <strong>Review my whole CV</strong> — what a careful reader would hold
              against it: thin entries, unevidenced claims, repeated phrasing, gaps.
            </li>
            <li>
              <strong>Make the writing consistent</strong> — works out the voice your
              CV mostly uses and proposes moving the outliers to it. Same facts,
              better prose.
            </li>
            <li>
              <strong>Find buried achievements</strong> — results hidden in your long
              descriptions, quoted back so you can promote them to highlights.
            </li>
            <li>
              <strong>Do my two languages say the same thing?</strong> — compares the
              language columns for MEANING, not just for which fields are filled
              (needs a second language on screen).
            </li>
            <li>
              <strong>Can I answer this posting?</strong> — pulls every requirement
              out of a job ad and checks each one against your CV.
            </li>
          </ul>
          <p className="cva-sub">
            {status.configured
              ? <>Your configured model (<strong>{backendName(status)}</strong>) isn&rsquo;t marked
                as high-end. These passes judge the entire document, and a small model
                answers them confidently and wrongly — so they stay hidden until you
                say the model can handle it.</>
              : <>They need an AI model configured, and marked as high-end — a frontier
                hosted model, or a large local one.</>}
          </p>
          <button className="cva-setup" onClick={() => openSettings('ai')}>
            <Settings size={13} /> {status.configured ? 'Review the AI settings' : 'Set up a model'}
          </button>
        </div>
      )}
      {enabled && <CvReview />}
      {enabled && <VoicePass />}
      {enabled && <SemanticDrift />}
      {enabled && <AchievementMining />}
      {/* Applying to something specific rather than tending the CV — last,
          because it needs a posting pasted in and the others don't. */}
      {enabled && <JobFitPanel />}

      <style>{`
        .cva-wrap { display: flex; flex-direction: column; gap: 12px; margin-top: 28px; }
        .cva-heading {
          margin: 0; font-family: var(--serif); font-weight: 300;
          font-size: 21px; color: var(--ink);
        }
        .cva-sub { margin: -4px 0 4px; font-size: 13px; color: var(--ink-soft); line-height: 1.5; }
        .cva-locked {
          display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
          padding: 14px; border: 1px dashed var(--secondary-line);
          border-radius: var(--r-md); background: var(--paper-raised);
        }
        .cva-locked-lede {
          display: flex; align-items: flex-start; gap: 7px; margin: 0;
          font-size: 13px; line-height: 1.5; color: var(--ink);
        }
        .cva-locked-lede svg { flex-shrink: 0; margin-top: 2px; color: var(--secondary-ink); }
        .cva-locked .cva-sub { margin: 0; }
        /* The five advisors, named as they're named on their own cards, so the
           locked state teaches the same vocabulary the unlocked one uses. */
        .cva-locked-list {
          margin: 0 0 0 21px; padding: 0; display: flex; flex-direction: column; gap: 5px;
          font-size: 12.5px; line-height: 1.5; color: var(--ink-soft);
        }
        .cva-locked-list strong { color: var(--ink); }
        .cva-setup {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 12px; border-radius: var(--r-sm); cursor: pointer;
          font-size: 12.5px; font-weight: 600;
          background: var(--accent); color: #fff; border: 1px solid var(--accent);
        }
        .cva-setup:hover { background: var(--accent-bright); }
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
