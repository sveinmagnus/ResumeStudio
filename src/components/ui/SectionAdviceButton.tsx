/**
 * D3 — "what's missing" for the section you're standing in, as a button in the
 * section bar next to Bulk summarize / Bulk add.
 *
 * In the bar rather than on the Overview page because the question is one you
 * ask in context: you're looking at Courses, wondering whether it earns its
 * place. The whole-CV review (Overview) asks a different question of a much
 * larger text; running both is not redundant.
 *
 * Results open in a modal rather than expanding the bar: findings are a paragraph
 * each, and pushing the section list down by a screenful to show them would bury
 * the very items they refer to.
 *
 * Renders nothing unless the model is declared high-end, and nothing for a
 * section with no items — "what's missing from this empty section?" answers
 * itself.
 */

import { useState } from 'react'
import { Lightbulb, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useDialog } from './useDialog'
import { AssistRun } from './AssistRun'
import { useAdvancedAssist } from './AdvancedAssistCard'
import { AssistFindingsPanel } from './AssistFindingsPanel'
import { useAdvisorRun, jsonReply } from '../../store/useAdvisorRun'
import { validateFindings, type FindingsResult } from '../../lib/assistFindings'
import { buildSectionAdvicePrompt, hasAdvisableContent } from '../../lib/sectionAdvice'
import { sectionLabel } from '../../lib/sections'

export function SectionAdviceButton({ section }: { section: string }) {
  const { enabled } = useAdvancedAssist()
  const data = useStore((s) => s.data)
  const [open, setOpen] = useState(false)

  if (!enabled || !hasAdvisableContent(data, section)) return null

  return (
    <>
      <button
        className="sortbar-advice"
        onClick={() => setOpen(true)}
        title={`Ask your AI what a reader would expect to find in ${sectionLabel(section)}`}
      >
        <Lightbulb size={13} /> What&rsquo;s missing?
      </button>
      {open && <SectionAdviceModal section={section} onClose={() => setOpen(false)} />}
      <style>{`
        .sortbar-advice {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px; border-radius: var(--r-sm); cursor: pointer;
          font-size: 12.5px; font-weight: 600;
          border: 1px solid var(--secondary-line); background: var(--secondary-tint);
          color: var(--secondary-ink-text);
        }
        .sortbar-advice:hover { border-color: var(--secondary-ink); }
      `}</style>
    </>
  )
}

function SectionAdviceModal({ section, onClose }: { section: string; onClose: () => void }) {
  const dialogRef = useDialog(onClose)
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const label = sectionLabel(section)
  // Scoped per section, and held in the run store rather than this modal's
  // state: closing the dialog to go and look at the items it described is the
  // expected next move, and modal state wouldn't survive it.
  const { ref, result, parseError: error, clear } = useAdvisorRun<FindingsResult>(
    'section', jsonReply((json) => validateFindings(json, data, locale)), section,
  )

  return (
    <div className="sam-overlay" role="dialog" aria-modal="true"
      aria-label={`What's missing from ${label}`} onClick={onClose}>
      <div className="sam-modal" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="sam-head">
          <span className="sam-title"><Lightbulb size={16} /> What&rsquo;s missing from {label}?</span>
          <button className="sam-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="sam-body">
          <p className="sam-lede">
            Asks your model what a reader of this section would expect and not
            find — coverage, depth, recency, range, and whether anything here
            belongs somewhere else. It reports and asks; it never edits.
          </p>
          <AssistRun
            buildPrompt={() => buildSectionAdvicePrompt(data, section, locale)}
            advisor={ref}
            label={`Check ${label}`}
            maxTokens={4000}
            advanced
            hasManualPath={false}
          />
          {error && <p className="sam-err" role="alert">{error}</p>}
          {result && (
            <div className="sam-bar">
              <span className="sam-kept">Kept until you clear it — closing this is safe.</span>
              <button className="sam-clear" onClick={clear}>Clear</button>
            </div>
          )}
          <AssistFindingsPanel result={result} emptyText={`${label} looks complete.`} />
        </div>
      </div>

      <style>{`
        .sam-overlay {
          position: fixed; inset: 0; background: rgba(15, 23, 42, .45);
          display: flex; align-items: center; justify-content: center;
          z-index: 100; padding: 24px;
        }
        .sam-modal {
          background: var(--paper); border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg); width: 100%; max-width: 640px;
          max-height: 86vh; display: flex; flex-direction: column;
          padding: 22px 24px; overscroll-behavior: contain;
        }
        .sam-head { display: flex; align-items: center; justify-content: space-between; }
        .sam-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
        .sam-title svg { color: var(--accent); }
        .sam-close { color: var(--ink-faint); padding: 4px; border-radius: var(--r-sm); transition: color .12s, background .12s; }
        .sam-close:hover { background: var(--paper-sunken); color: var(--ink); }
        .sam-body { overflow-y: auto; margin-top: 10px; display: flex; flex-direction: column; gap: 12px; }
        .sam-lede { font-size: 13px; color: var(--ink-soft); line-height: 1.55; margin: 0; }
        .sam-err { margin: 0; font-size: 12.5px; color: var(--err-ink); line-height: 1.45; }
        .sam-bar {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          font-size: 11.5px; color: var(--ink-faint);
        }
        .sam-clear {
          padding: 4px 9px; border-radius: var(--r-sm); font-size: 12px; font-weight: 600;
          border: 1px solid var(--line); background: var(--paper); color: var(--ink-soft);
          cursor: pointer;
        }
        .sam-clear:hover { border-color: var(--line-strong); color: var(--ink); }
      `}</style>
    </div>
  )
}
