/**
 * "Suggest bullet points from the description" — one panel, two callers:
 * a project's highlights and a profile block's key points (lib/keyPoints.ts).
 *
 * Nothing is written until the user confirms, and every point starts TICKED:
 * unlike a new registry skill, adding a bullet to one item is local and trivially
 * undone, so the cost of a wrong default is a keystroke rather than a shared
 * resource polluted.
 *
 * The run lives in the ADVISOR STORE, scoped to this item — `EditorCard` renders
 * its body only while expanded, so clicking to another item used to unmount this
 * panel and lose both the spinner and the finished list. The TICKS ride along
 * too (`resolved`), because coming back to find eight carefully-unticked points
 * all re-ticked is the same loss in miniature.
 */

import { AssistRun } from './AssistRun'
import { useAdvisorRun, jsonReply } from '../../store/useAdvisorRun'
import { ASSIST_MAX_TOKENS } from '../../lib/llmAssist'
import { fieldScope } from '../../store/useAdvisors'
import {
  buildKeyPointsPrompt, validateKeyPoints, type DraftPoint, type PointStyle,
} from '../../lib/keyPoints'
import type { LocalizedString } from '../../types'

interface Props {
  /** The section and item this belongs to — scopes the run, and takes the
   *  "ready" notice back to the right card. */
  section: string
  itemId: string
  /** The prose to reshape — the item's long description. */
  source: LocalizedString
  locale: string
  style: PointStyle
  /** Append the ticked points. The caller owns the store shape. */
  onApply: (points: DraftPoint[]) => void
  /** What the points are called here, for the button + count. */
  noun?: string
  /**
   * Sitting on a row beside "Add highlight" rather than stacked under the list:
   * the button renders as a chip and the provenance line goes beside it, since
   * a full-width blurb would push the row apart.
   */
  inline?: boolean
}

/**
 * A point's identity within its run. The body rather than the index: the list is
 * re-parsed from the raw reply on every render, and an index would re-point at a
 * different line if the model's ordering were ever read differently.
 */
const pointKey = (p: DraftPoint, i: number) => `${i}:${p.label}|${p.body}`

export function KeyPointsPanel({
  section, itemId, source, locale, style, onApply, noun = 'points', inline = false,
}: Props) {
  const {
    ref, result: draft, parseError, run, resolve, clear,
  } = useAdvisorRun('points', jsonReply(validateKeyPoints), fieldScope(section, itemId))

  const hasProse = !!(source[locale] ?? '').trim()

  // Ticked unless explicitly unticked, so a fresh result arrives all-ticked
  // (the deliberate default) with no effect to synchronise.
  const isPicked = (key: string) => run?.resolved[key] !== 'dismissed'
  const picked = (draft ?? []).filter((p, i) => isPicked(pointKey(p, i)))

  const toggle = (key: string) => resolve(key, isPicked(key) ? 'dismissed' : 'accepted')

  const apply = () => {
    if (!picked.length) return
    onApply(picked)
    clear()
  }

  return (
    <div className={inline ? 'kp-wrap kp-inline' : 'kp-wrap'}>
      <AssistRun
        buildPrompt={() => buildKeyPointsPrompt(source, locale, style)}
        advisor={ref}
        compact={inline}
        disabled={!hasProse}
        // Beside "Add highlight" the long form pushes the row onto two lines,
        // and the source is obvious from where the button sits.
        label={inline ? `Suggest ${noun}` : `Suggest ${noun} from the description`}
        maxTokens={ASSIST_MAX_TOKENS}
        hasManualPath={false}
      />
      {!hasProse && !run && <p className="kp-hint">Write the description first — there’s nothing to reshape yet.</p>}
      {/* The run succeeded, so nothing else would ever clear an unreadable
          reply — it needs its own way out. */}
      {parseError && (
        <p className="kp-hint kp-err" role="alert">
          The model&rsquo;s reply could not be read: {parseError}{' '}
          <button type="button" className="kp-dismiss" onClick={clear}>Dismiss</button>
        </p>
      )}

      {draft && (
        <div className="kp-result">
          <p className="kp-hint">
            Drafted from your own text — review each one before adding.
          </p>
          {draft.map((p, i) => {
            const key = pointKey(p, i)
            return (
              <label key={key} className="kp-row">
                <input type="checkbox" checked={isPicked(key)} onChange={() => toggle(key)} />
                <span className="kp-text">
                  {p.label && <strong className="kp-label">{p.label}: </strong>}
                  {p.body}
                </span>
              </label>
            )
          })}
          <div className="kp-actions">
            <button className="kp-btn" onClick={clear}>Discard</button>
            <button className="kp-btn kp-primary" onClick={apply} disabled={picked.length === 0}>
              Add {picked.length}
            </button>
          </div>
        </div>
      )}

      <style>{`
        .kp-wrap { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
        .kp-hint { font-size: 12px; color: var(--ink-faint); margin: 0; }
        .kp-err { color: var(--err-ink); }
        .kp-dismiss {
          background: none; border: none; padding: 0; font-size: 11.5px;
          font-weight: 600; color: var(--err-ink); text-decoration: underline; cursor: pointer;
        }
        .kp-result {
          display: flex; flex-direction: column; gap: 5px;
          padding: 10px; border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper-sunken);
        }
        .kp-row { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; cursor: pointer; }
        .kp-row input { accent-color: var(--accent); width: 14px; height: 14px; margin-top: 3px; flex-shrink: 0; }
        .kp-text { line-height: 1.45; }
        .kp-label { color: var(--accent); }
        .kp-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
        .kp-btn {
          padding: 5px 11px; font-size: 12.5px; border: 1px solid var(--line-strong);
          border-radius: var(--r-sm); background: var(--paper-raised); cursor: pointer;
        }
        .kp-primary { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }
        .kp-primary:disabled { opacity: .5; cursor: default; }
      `}</style>
    </div>
  )
}
