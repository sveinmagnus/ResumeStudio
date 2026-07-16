/**
 * "What should I cut?" — shown only when a view is over its page limit.
 *
 * Subtractive by design: it proposes whole ITEMS to leave out and applies them
 * through the view's own `excluded_item_ids`, exactly as if you'd unticked them.
 * Reversible, scoped to this view, master CV untouched. It will never offer to
 * shorten your prose — see lib/pageFit.ts.
 */

import { useState } from 'react'
import { Scissors } from 'lucide-react'
import { useStore } from '../../../store/useStore'
import { AssistRun } from '../../ui/AssistRun'
import { extractJson } from '../../../lib/llmAssist'
import {
  buildPageFitPrompt, validatePageFit, applyCuts, type FitSuggestion,
} from '../../../lib/pageFit'
import type { ResumeView } from '../../../types'

interface Props {
  view: ResumeView
  locale: string
  pages: number
  limit: number
  onUpdate: (patch: Partial<ResumeView>) => void
}

export function PageFitPanel({ view, locale, pages, limit, onUpdate }: Props) {
  const data = useStore((s) => s.data)
  const [cuts, setCuts] = useState<FitSuggestion[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const onResult = (text: string) => {
    setError(null); setCuts(null)
    try {
      const s = validatePageFit(JSON.parse(extractJson(text)), data, view, locale)
      setCuts(s)
      setPicked(new Set(s.map((x) => x.itemId)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }

  const apply = () => {
    if (!cuts) return
    onUpdate({ excluded_item_ids: applyCuts(view, [...picked]) })
    setCuts(null); setPicked(new Set())
  }

  const toggle = (id: string) => setPicked((p) => {
    const next = new Set(p)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="pf-wrap">
      <div className="pf-head">
        <Scissors size={13} />
        {pages.toFixed(1)} pages — {limit} allowed
      </div>

      <AssistRun
        buildPrompt={() => buildPageFitPrompt(data, view, locale, pages, limit)}
        onResult={onResult}
        wholeCv
        label="Suggest what to cut"
        maxTokens={700}
      />
      <p className="pf-hint">
        Suggests whole items to leave out of <em>this view</em> — it never rewrites or
        shortens your text. Applying is the same as unticking them by hand.
      </p>
      {error && <p className="pf-hint pf-err" role="alert">{error}</p>}

      {cuts && (
        <div className="pf-result">
          {cuts.length === 0 && <p className="pf-hint">No cuts suggested — you may need to raise the limit.</p>}
          {cuts.map((c) => (
            <label key={c.itemId} className="pf-row">
              <input type="checkbox" checked={picked.has(c.itemId)} onChange={() => toggle(c.itemId)} />
              <span className="pf-text">
                <strong>{c.title}</strong>
                <span className="pf-sec">{c.section}</span>
                {c.why && <span className="pf-why">{c.why}</span>}
              </span>
            </label>
          ))}
          {cuts.length > 0 && (
            <div className="pf-actions">
              <button className="pf-btn" onClick={() => setCuts(null)}>Discard</button>
              <button className="pf-btn pf-primary" onClick={apply} disabled={picked.size === 0}>
                Exclude {picked.size}
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .pf-wrap {
          display: flex; flex-direction: column; gap: 7px;
          padding: 11px 12px; margin-top: 10px;
          border: 1px solid var(--warn-ink); border-radius: var(--r-sm);
          background: var(--warn-wash);
        }
        .pf-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--warn-ink); }
        .pf-hint { font-size: 11.5px; color: var(--ink-soft); margin: 0; line-height: 1.45; }
        .pf-err { color: var(--err-ink); }
        .pf-result {
          display: flex; flex-direction: column; gap: 5px;
          padding: 8px; border-radius: var(--r-sm); background: var(--paper);
        }
        .pf-row { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; cursor: pointer; }
        .pf-row input { accent-color: var(--accent); width: 14px; height: 14px; margin-top: 3px; flex-shrink: 0; }
        .pf-text { display: flex; flex-direction: column; gap: 1px; }
        .pf-sec { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-faint); }
        .pf-why { font-size: 11.5px; color: var(--ink-soft); font-style: italic; }
        .pf-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
        .pf-btn {
          padding: 5px 11px; font-size: 12.5px; border: 1px solid var(--line-strong);
          border-radius: var(--r-sm); background: var(--paper-raised); cursor: pointer;
        }
        .pf-primary { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }
        .pf-primary:disabled { opacity: .5; cursor: default; }
      `}</style>
    </div>
  )
}
