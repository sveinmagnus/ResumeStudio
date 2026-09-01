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
 *
 * The run lives in the ADVISOR STORE, not in this component: `EditorCard`
 * renders its body only while expanded, so clicking to another item unmounted
 * the panel mid-request — the spinner vanished with no way to tell whether a
 * reply was still coming, and coming back showed nothing. Scoped per item
 * (`fieldScope`), so a rewrite started on one project can't replace the one you
 * are still reading on another.
 */

import { useMemo } from 'react'
import { Check, X, HelpCircle, AlertTriangle } from 'lucide-react'
import { AssistRun } from './AssistRun'
import { useAdvisorRun, jsonReply } from '../../store/useAdvisorRun'
import { fieldScope } from '../../store/useAdvisors'
import {
  buildCoachPrompt, buildDraftPrompt, validateCoachResponse,
  hasCoachableSource, hasDraftableFacts, isUnchangedRewrite,
} from '../../lib/writingCoach'
import { itemFacts } from '../../lib/cvDigest'
import { sectionLabel } from '../../lib/sections'
import { richToPlain, hasRichFormatting, plainToRichHtml } from '../../lib/richText'
import type { LocalizedString } from '../../types'

interface Props {
  /** Section key, e.g. 'projects' — used for the identity facts and wording. */
  section: string
  /**
   * The item, for its identity facts when drafting from scratch and for the id
   * that scopes the run. Typed loosely because callers pass a concrete entity
   * (Project, Course, …) and TypeScript won't widen an interface to an index
   * signature; `itemFacts` only ever reads keys the section's field map names.
   */
  item: { id: string }
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
  const {
    ref, result: draft, parseError, run, clear,
  } = useAdvisorRun('write', jsonReply(validateCoachResponse), fieldScope(section, item.id))

  const raw = source[locale] ?? ''
  const original = richToPlain(raw).trim()
  const hasSource = hasCoachableSource(source, locale)
  // The model works on flattened text, so an accepted rewrite is prose. Warn
  // only when the value has formatting that flattening actually loses — plain
  // `<p>` paragraphs survive the round trip, and every rich-editor value has
  // them, so hasMarkup here made the warning near-unconditional.
  const losesFormatting = hasRichFormatting(raw)

  const facts = useMemo(
    () => itemFacts(section, item as unknown as Record<string, unknown>, locale),
    [section, item, locale],
  )
  const canDraft = hasDraftableFacts(facts)

  // Applying and discarding both END the run — the suggestion stays on screen
  // through any amount of navigation until one of them happens, which is the
  // whole contract.
  const apply = () => {
    if (!draft) return
    onApply(plainToRichHtml(draft.rewrite))
    clear()
  }

  // A rewrite returned verbatim is the model saying "already reads well" (the
  // prompt names that as the honest answer) — a verdict, not a change to review.
  const unchanged = draft != null && hasSource && isUnchangedRewrite(draft.rewrite, original)

  // Nothing written AND nothing to write from — a blank card has no assist.
  // A live run outranks that: emptying the field while a request is in flight
  // must not take the spinner (or an unreviewed suggestion) off screen.
  if (!hasSource && !canDraft && !run) return null

  return (
    <div className="wa-wrap">
      <AssistRun
        buildPrompt={() => (hasSource
          ? buildCoachPrompt(source, locale, facts)
          : buildDraftPrompt(facts, sectionLabel(section), locale))}
        advisor={ref}
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

      {parseError && <p className="wa-note wa-err" role="alert">{parseError}</p>}

      {draft && (
        <div className="wa-result">
          {unchanged ? (
            <p className="wa-note wa-ok">
              <Check size={13} />
              This {noun} already reads well — the model suggests no changes.
            </p>
          ) : (
            <p className="wa-note">
              {hasSource
                ? 'Rewritten from your own text — read it against the original and check every claim is one you actually made.'
                : 'A starting point, not a description of what you did. Replace the generic parts with your own work.'}
            </p>
          )}

          {!unchanged && (
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
          )}

          {draft.asks.length > 0 && (
            <div className="wa-asks">
              <div className="wa-asks-label">
                <HelpCircle size={13} /> Only you can answer these
              </div>
              <ul>{draft.asks.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}

          {!unchanged && losesFormatting && (
            <p className="wa-note wa-warn">
              Your current {noun} has formatting (bold, lists). Applying replaces it with plain paragraphs.
            </p>
          )}

          <div className="wa-actions">
            {!unchanged && (
              <button className="wa-apply" onClick={apply}>
                <Check size={13} /> {hasSource ? 'Use the suggestion' : 'Use this draft'}
              </button>
            )}
            <button className="wa-discard" onClick={clear}>
              <X size={13} /> {unchanged ? 'Dismiss' : 'Discard'}
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
        .wa-ok { color: var(--ok-ink); }
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
