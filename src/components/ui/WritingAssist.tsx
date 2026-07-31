/**
 * The per-field writing assist, for every section.
 *
 * It does one of two things depending on the field it's attached to:
 *
 *  - **Strengthen** (field has prose) — tightens what you wrote, inventing
 *    nothing. The rewrite is shown ABOVE the original, both readable, applied
 *    only on an explicit click: a rewrite you can't compare against the original
 *    is one you can't check for invented facts, and that is the exact failure
 *    this assist has to make visible.
 *  - **Draft** (field is empty) — writes a starting point from the entry's
 *    identity plus whatever the model knows about the organisations named. It
 *    carries a louder warning, because unlike strengthening it can be
 *    confidently wrong about a real thing: an internal project at a client or a
 *    course from 2004 has no public footprint, and that is the common case in a
 *    consultant's CV.
 *
 * Replaces `WritingCoachPanel`, which existed only on Projects and only for a
 * non-empty field. Nothing here is project-specific — the identity facts come
 * from `cvFields`/`cvDigest`, so a section gets this by passing its key.
 */

import { useCallback, useMemo, useState } from 'react'
import { Check, X, HelpCircle, AlertTriangle } from 'lucide-react'
import { AssistRun } from './AssistRun'
import { extractJson } from '../../lib/llmAssist'
import {
  buildCoachPrompt, buildDraftPrompt, validateCoachResponse,
  hasCoachableSource, hasDraftableFacts, type CoachResult,
} from '../../lib/writingCoach'
import { itemFacts } from '../../lib/cvDigest'
import { sectionLabel } from '../../lib/sections'
import { richToPlain, hasMarkup, plainToRichHtml } from '../../lib/richText'
import type { LocalizedString } from '../../types'

interface Props {
  /** Section key, e.g. 'projects' — used for the identity facts and wording. */
  section: string
  /**
   * The item, for its identity facts when drafting from scratch. Typed loosely
   * because callers pass a concrete entity (Project, Course, …) and TypeScript
   * won't widen an interface to an index signature; `itemFacts` only ever reads
   * keys the section's field map names.
   */
  item: object
  /** The field being written. */
  source: LocalizedString
  locale: string
  /** Replace the field's primary-locale slot with the accepted text (rich HTML). */
  onApply: (html: string) => void
  /** What this field is called, for the button and the asks. */
  noun?: string
}

export function WritingAssist({
  section, item, source, locale, onApply, noun = 'description',
}: Props) {
  const [draft, setDraft] = useState<CoachResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const raw = source[locale] ?? ''
  const original = richToPlain(raw).trim()
  const hasSource = hasCoachableSource(source, locale)
  // The model works on flattened text, so an accepted rewrite is prose. Say so
  // up front when the current value has formatting to lose.
  const losesFormatting = hasMarkup(raw)

  const facts = useMemo(
    () => itemFacts(section, item as Record<string, unknown>, locale),
    [section, item, locale],
  )
  const canDraft = hasDraftableFacts(facts)

  const onResult = useCallback((text: string) => {
    setError(null); setDraft(null)
    try {
      setDraft(validateCoachResponse(JSON.parse(extractJson(text))))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }, [])

  const apply = () => {
    if (!draft) return
    onApply(plainToRichHtml(draft.rewrite))
    setDraft(null)
  }

  // Nothing written AND nothing to write from — a blank card has no assist.
  if (!hasSource && !canDraft) return null

  return (
    <div className="wa-wrap">
      <AssistRun
        buildPrompt={() => (hasSource
          ? buildCoachPrompt(source, locale)
          : buildDraftPrompt(facts, sectionLabel(section), locale))}
        onResult={onResult}
        label={hasSource ? `Strengthen this ${noun}` : `Draft this ${noun}`}
        maxTokens={900}
        compact
        warnWeakModel
        hasManualPath={false}
      />

      {!hasSource && (
        <p className="wa-note wa-warn">
          <AlertTriangle size={12} />
          Written from the entry&rsquo;s details and whatever the model knows publicly —
          it may be wrong or generic for anything never described online, such as
          internal client work or an older course. Treat it as a starting point and
          check every sentence.
        </p>
      )}

      {error && <p className="wa-note wa-err" role="alert">{error}</p>}

      {draft && (
        <div className="wa-result">
          <p className="wa-note">
            {hasSource
              ? 'Rewritten from your own text — read it against the original and check every claim is one you actually made.'
              : 'A starting point, not a description of what you did. Replace the generic parts with your own work.'}
          </p>

          <div className="wa-compare">
            <div className="wa-side">
              <div className="wa-side-label">Suggested</div>
              <p className="wa-text wa-new">{draft.rewrite}</p>
            </div>
            {hasSource && (
              <div className="wa-side">
                <div className="wa-side-label">Yours now</div>
                <p className="wa-text wa-old">{original}</p>
              </div>
            )}
          </div>

          {draft.asks.length > 0 && (
            <div className="wa-asks">
              <div className="wa-asks-label">
                <HelpCircle size={13} /> Only you can answer these
              </div>
              <ul>{draft.asks.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}

          {losesFormatting && (
            <p className="wa-note wa-warn">
              Your current {noun} has formatting (bold, lists). Applying replaces it with plain paragraphs.
            </p>
          )}

          <div className="wa-actions">
            <button className="wa-apply" onClick={apply}>
              <Check size={13} /> {hasSource ? 'Use the suggestion' : 'Use this draft'}
            </button>
            <button className="wa-discard" onClick={() => setDraft(null)}>
              <X size={13} /> Discard
            </button>
          </div>
        </div>
      )}

      <style>{`
        .wa-wrap { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
        .wa-note {
          display: flex; align-items: flex-start; gap: 5px; margin: 0;
          font-size: 11.5px; color: var(--ink-faint); line-height: 1.45;
        }
        .wa-note svg { flex-shrink: 0; margin-top: 2px; }
        .wa-warn { color: var(--warn-ink); }
        .wa-err { color: var(--err-ink); }
        .wa-result {
          display: flex; flex-direction: column; gap: 10px;
          padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper-sunken);
        }
        /* Side by side when there's room; stacked when there isn't — the
           comparison is the point, so it must survive a narrow column. */
        .wa-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 860px) { .wa-compare { grid-template-columns: 1fr; } }
        .wa-side { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .wa-side-label {
          font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
          color: var(--ink-faint);
        }
        .wa-text {
          margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap;
          padding: 8px 10px; border-radius: var(--r-sm); background: var(--paper);
          border: 1px solid var(--line);
        }
        .wa-new { border-color: var(--ok-ink); }
        .wa-old { color: var(--ink-soft); }
        .wa-asks {
          display: flex; flex-direction: column; gap: 4px;
          padding: 8px 10px; border-radius: var(--r-sm); background: var(--secondary-tint);
          border: 1px solid var(--secondary-line);
        }
        .wa-asks-label {
          display: flex; align-items: center; gap: 5px;
          font-size: 11.5px; font-weight: 600; color: var(--secondary-ink-text);
        }
        .wa-asks ul { margin: 0; padding-left: 26px; }
        .wa-asks li { font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
        .wa-actions { display: flex; gap: 8px; }
        .wa-apply, .wa-discard {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--line); background: var(--paper);
        }
        .wa-apply { background: var(--accent); color: #fff; border-color: var(--accent); }
        .wa-apply:hover { background: var(--accent-bright); }
        .wa-discard:hover { border-color: var(--line-strong); }
      `}</style>
    </div>
  )
}
