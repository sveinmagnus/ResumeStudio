/**
 * "Suggest bullet points from the description" — one panel, two callers:
 * a project's highlights and a profile block's key points (lib/keyPoints.ts).
 *
 * Nothing is written until the user confirms, and every point starts TICKED:
 * unlike a new registry skill, adding a bullet to one item is local and trivially
 * undone, so the cost of a wrong default is a keystroke rather than a shared
 * resource polluted.
 */

import { useState } from 'react'
import { AssistRun } from './AssistRun'
import { extractJson } from '../../lib/llmAssist'
import {
  buildKeyPointsPrompt, validateKeyPoints, type DraftPoint, type PointStyle,
} from '../../lib/keyPoints'
import type { LocalizedString } from '../../types'

interface Props {
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

export function KeyPointsPanel({ source, locale, style, onApply, noun = 'points', inline = false }: Props) {
  const [draft, setDraft] = useState<DraftPoint[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const hasProse = !!(source[locale] ?? '').trim()

  const onResult = (text: string) => {
    setError(null); setDraft(null)
    try {
      const points = validateKeyPoints(JSON.parse(extractJson(text)))
      setDraft(points)
      setPicked(new Set(points.map((_, i) => i)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }

  const apply = () => {
    if (!draft) return
    onApply(draft.filter((_, i) => picked.has(i)))
    setDraft(null); setPicked(new Set())
  }

  const toggle = (i: number) => setPicked((p) => {
    const next = new Set(p)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  })

  return (
    <div className={inline ? 'kp-wrap kp-inline' : 'kp-wrap'}>
      <AssistRun
        buildPrompt={() => buildKeyPointsPrompt(source, locale, style)}
        onResult={onResult}
        compact={inline}
        disabled={!hasProse}
        // Beside "Add highlight" the long form pushes the row onto two lines,
        // and the source is obvious from where the button sits.
        label={inline ? `Suggest ${noun}` : `Suggest ${noun} from the description`}
        maxTokens={600}
        hasManualPath={false}
      />
      {!hasProse && <p className="kp-hint">Write the description first — there’s nothing to reshape yet.</p>}
      {error && <p className="kp-hint kp-err" role="alert">{error}</p>}

      {draft && (
        <div className="kp-result">
          <p className="kp-hint">
            Drafted from your own text — review each one before adding.
          </p>
          {draft.map((p, i) => (
            <label key={i} className="kp-row">
              <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
              <span className="kp-text">
                {p.label && <strong className="kp-label">{p.label}: </strong>}
                {p.body}
              </span>
            </label>
          ))}
          <div className="kp-actions">
            <button className="kp-btn" onClick={() => setDraft(null)}>Discard</button>
            <button className="kp-btn kp-primary" onClick={apply} disabled={picked.size === 0}>
              Add {picked.size}
            </button>
          </div>
        </div>
      )}

      <style>{`
        .kp-wrap { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
        .kp-hint { font-size: 12px; color: var(--ink-faint); margin: 0; }
        .kp-err { color: var(--err-ink); }
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
