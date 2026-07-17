/**
 * "Strengthen this description" — the writing-coach assist (lib/writingCoach.ts).
 *
 * Two things it deliberately does NOT do:
 *  - overwrite anything. The rewrite is shown ABOVE the original, both readable,
 *    and applied only on an explicit click. A rewrite you can't compare against
 *    the original is a rewrite you can't check for invented facts, and that's
 *    the exact failure this assist has to make visible.
 *  - touch the other language column. The model saw one locale; the other is the
 *    Draft-translation path's job.
 */

import { useState } from 'react'
import { PenLine, Check, X, HelpCircle } from 'lucide-react'
import { AssistRun } from './AssistRun'
import { extractJson } from '../../lib/llmAssist'
import {
  buildCoachPrompt, validateCoachResponse, hasCoachableSource, type CoachResult,
} from '../../lib/writingCoach'
import { richToPlain, hasMarkup, plainToRichHtml } from '../../lib/richText'
import type { LocalizedString } from '../../types'

interface Props {
  /** The description to coach. */
  source: LocalizedString
  locale: string
  /** Replace the description with the accepted rewrite (rich HTML). */
  onApply: (html: string) => void
  /** What this field is called, for the button. */
  noun?: string
}

export function WritingCoachPanel({ source, locale, onApply, noun = 'description' }: Props) {
  const [draft, setDraft] = useState<CoachResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const raw = source[locale] ?? ''
  const original = richToPlain(raw).trim()
  const hasSource = hasCoachableSource(source, locale)
  // The model works on flattened text, so an accepted rewrite is prose. Say so
  // up front when the current value has formatting to lose.
  const losesFormatting = hasMarkup(raw)

  const onResult = (text: string) => {
    setError(null); setDraft(null)
    try {
      setDraft(validateCoachResponse(JSON.parse(extractJson(text))))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }

  const apply = () => {
    if (!draft) return
    onApply(plainToRichHtml(draft.rewrite))
    setDraft(null)
  }

  return (
    <div className="wc-wrap">
      <AssistRun
        buildPrompt={() => buildCoachPrompt(source, locale)}
        onResult={onResult}
        disabled={!hasSource}
        label={`Strengthen this ${noun}`}
        maxTokens={900}
      />
      {!hasSource && <p className="wc-hint">Write the {noun} first — there’s nothing to work on yet.</p>}
      {error && <p className="wc-hint wc-err" role="alert">{error}</p>}

      {draft && (
        <div className="wc-result">
          <p className="wc-hint">
            Rewritten from your own text — read it against the original and check
            every claim is one you actually made.
          </p>

          <div className="wc-compare">
            <div className="wc-side">
              <div className="wc-side-label">Suggested</div>
              <p className="wc-text wc-new">{draft.rewrite}</p>
            </div>
            <div className="wc-side">
              <div className="wc-side-label">Yours now</div>
              <p className="wc-text wc-old">{original}</p>
            </div>
          </div>

          {draft.asks.length > 0 && (
            <div className="wc-asks">
              <div className="wc-asks-label"><HelpCircle size={13} /> Would make it stronger — only you can answer</div>
              <ul>
                {draft.asks.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          {losesFormatting && (
            <p className="wc-hint wc-warn">
              Your current {noun} has formatting (bold, lists). Applying replaces it with plain paragraphs.
            </p>
          )}

          <div className="wc-actions">
            <button className="wc-apply" onClick={apply}>
              <Check size={13} /> Use the suggestion
            </button>
            <button className="wc-discard" onClick={() => setDraft(null)}>
              <X size={13} /> Discard
            </button>
          </div>
        </div>
      )}

      <style>{`
        .wc-wrap { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
        .wc-hint { font-size: 12px; color: var(--ink-faint); margin: 0; line-height: 1.45; }
        .wc-err { color: var(--err-ink); }
        .wc-warn { color: var(--warn-ink); }
        .wc-result {
          display: flex; flex-direction: column; gap: 10px;
          padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper-sunken);
        }
        /* Side by side when there's room; stacked when there isn't — the
           comparison is the point, so it must survive a narrow column. */
        .wc-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 860px) { .wc-compare { grid-template-columns: 1fr; } }
        .wc-side { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .wc-side-label {
          font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
          color: var(--ink-faint);
        }
        .wc-text {
          margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap;
          padding: 8px 10px; border-radius: var(--r-sm); background: var(--paper);
          border: 1px solid var(--line);
        }
        .wc-new { border-color: var(--ok-ink); }
        .wc-old { color: var(--ink-soft); }
        .wc-asks {
          display: flex; flex-direction: column; gap: 4px;
          padding: 8px 10px; border-radius: var(--r-sm); background: var(--secondary-tint);
          border: 1px solid var(--secondary-line);
        }
        .wc-asks-label {
          display: flex; align-items: center; gap: 5px;
          font-size: 11.5px; font-weight: 600; color: var(--secondary-ink-text);
        }
        .wc-asks ul { margin: 0; padding-left: 26px; }
        .wc-asks li { font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
        .wc-actions { display: flex; gap: 8px; }
        .wc-apply, .wc-discard {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--line); background: var(--paper);
        }
        .wc-apply { background: var(--accent); color: #fff; border-color: var(--accent); }
        .wc-apply:hover { background: var(--accent-bright); }
        .wc-discard:hover { border-color: var(--line-strong); }
      `}</style>
    </div>
  )
}
