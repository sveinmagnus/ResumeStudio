import { useCallback, useState } from 'react'
import { Sparkles, X, Copy, Check, AlertTriangle, FileCheck2, Wand2 } from 'lucide-react'
import { useStore } from '../../../store/useStore'
import {
  buildTailorPrompt, validateTailorResponse, applyTailorResponse,
  InvalidTailorResponseError, type TailorIssue, type TailorResult,
} from '../../../lib/viewTailor'

interface TailorViewModalProps {
  /** Add the tailored view to the store and open it. */
  onApply: (result: TailorResult) => void
  onClose: () => void
}

/**
 * "Tailor view" dialog (roadmap F2) — bring-your-own-LLM, no server call:
 * paste the job posting, copy the generated prompt into any LLM, paste the
 * JSON it returns, review the proposed view (detail levels, exclusions,
 * drafted intro, gap list), then apply. Mirrors the AIImportModal pattern.
 */
export function TailorViewModal({ onApply, onClose }: TailorViewModalProps) {
  const { data, primaryLocale } = useStore()
  const [posting, setPosting] = useState('')
  const [copied, setCopied] = useState(false)
  const [responseText, setResponseText] = useState('')
  const [issues, setIssues] = useState<TailorIssue[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<TailorResult | null>(null)

  const copyPrompt = useCallback(async () => {
    const prompt = buildTailorPrompt(data, posting, primaryLocale)
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked (e.g. no permission) — fall back to a download.
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([prompt], { type: 'text/plain' }))
      a.download = 'tailor-prompt.txt'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 100)
    }
  }, [data, posting, primaryLocale])

  const validate = useCallback((text: string) => {
    setIssues([]); setParseError(null); setResult(null)
    const trimmed = text.trim()
    if (!trimmed) { setParseError('Paste the JSON your LLM produced.'); return }
    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch (e) {
      setParseError(`That isn't valid JSON: ${(e as Error).message}`)
      return
    }
    try {
      const validated = validateTailorResponse(json)
      setResult(applyTailorResponse(data, validated, primaryLocale))
    } catch (e) {
      if (e instanceof InvalidTailorResponseError) setIssues(e.issues)
      else setParseError((e as Error).message)
    }
  }, [data, primaryLocale])

  const sectionCounts = result
    ? {
        full: result.view.sections.filter((s) => s.detail === 'full').length,
        summary: result.view.sections.filter((s) => s.detail === 'summary').length,
        off: result.view.sections.filter((s) => s.detail === 'off').length,
      }
    : null

  return (
    <div className="tv-overlay" role="dialog" aria-modal="true" aria-label="Tailor view from job posting" onClick={onClose}>
      <div className="tv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tv-head">
          <span className="tv-title"><Wand2 size={16} /> Tailor a view to a job posting</span>
          <button className="tv-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {result ? (
          <div className="tv-body">
            <div className="tv-preview-head"><FileCheck2 size={18} /> Proposed view</div>
            <div className="tv-sum-name">{result.view.name}</div>
            {sectionCounts && (
              <div className="tv-sum-line">
                Sections: {sectionCounts.full} full · {sectionCounts.summary} summary · {sectionCounts.off} off
              </div>
            )}
            {Object.keys(result.view.introduction).length > 0 && (
              <div className="tv-block">
                <div className="tv-block-label">Drafted introduction (review required)</div>
                <div className="tv-intro">{result.view.introduction[primaryLocale]}</div>
              </div>
            )}
            {result.excludedTitles.length > 0 && (
              <div className="tv-block">
                <div className="tv-block-label">{result.excludedTitles.length} item{result.excludedTitles.length !== 1 ? 's' : ''} excluded</div>
                <ul className="tv-list">
                  {result.excludedTitles.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}
            {result.gaps.length > 0 && (
              <div className="tv-block">
                <div className="tv-block-label">Gaps the posting asks for</div>
                <ul className="tv-list tv-gaps">
                  {result.gaps.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
            )}
            {(result.unknownItemIds.length > 0 || result.unknownSections.length > 0) && (
              <div className="tv-warn">
                <AlertTriangle size={14} />
                Ignored from the response: {[
                  result.unknownItemIds.length ? `${result.unknownItemIds.length} unknown item id(s)` : '',
                  result.unknownSections.length ? `unknown section(s) ${result.unknownSections.join(', ')}` : '',
                ].filter(Boolean).join(' and ')}.
              </div>
            )}
            <div className="tv-actions">
              <button className="tv-btn tv-btn-ghost" onClick={() => setResult(null)}>Back</button>
              <button className="tv-btn tv-btn-primary" onClick={() => onApply(result)}>
                <Sparkles size={14} /> Create this view
              </button>
            </div>
          </div>
        ) : (
          <div className="tv-body">
            <div className="tv-step">
              <div className="tv-step-label">1 · Paste the job posting / tender text</div>
              <textarea
                className="tv-textarea"
                rows={7}
                placeholder="Paste the posting here…"
                value={posting}
                onChange={(e) => setPosting(e.target.value)}
              />
              <button className="tv-btn tv-btn-ghost" onClick={() => void copyPrompt()} disabled={!posting.trim()}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy prompt for your LLM'}
              </button>
              <p className="tv-hint">
                The prompt bundles the posting with a compact catalog of this CV
                (titles only) and the response format. Run it in any LLM you trust.
              </p>
            </div>
            <div className="tv-step">
              <div className="tv-step-label">2 · Paste the JSON the LLM returned</div>
              <textarea
                className="tv-textarea"
                rows={6}
                placeholder='{"$schema": "resumestudio-tailor/v1", …}'
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
              />
              <button className="tv-btn tv-btn-primary" onClick={() => validate(responseText)} disabled={!responseText.trim()}>
                Review proposal
              </button>
              {parseError && <div className="tv-error">{parseError}</div>}
              {issues.length > 0 && (
                <div className="tv-error">
                  <div>The response has {issues.length} problem{issues.length !== 1 ? 's' : ''}:</div>
                  <ul className="tv-list">
                    {issues.slice(0, 8).map((iss, i) => <li key={i}><code>{iss.path}</code> — {iss.reason}</li>)}
                    {issues.length > 8 && <li>…and {issues.length - 8} more</li>}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        <style>{`
          .tv-overlay {
            position: fixed; inset: 0; z-index: 60;
            background: rgba(15, 23, 42, .45);
            display: grid; place-items: center; padding: 24px;
          }
          .tv-modal {
            width: 100%; max-width: 640px; max-height: 86vh; overflow-y: auto;
            background: var(--paper); border-radius: var(--r-lg);
            box-shadow: var(--shadow-lg); border: 1px solid var(--line);
          }
          .tv-head {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 18px; border-bottom: 1px solid var(--line);
            position: sticky; top: 0; background: var(--paper); z-index: 1;
          }
          .tv-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--accent); font-size: 14px; }
          .tv-close { color: var(--ink-faint); display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--r-sm); }
          .tv-close:hover { background: var(--paper-sunken); color: var(--ink); }
          .tv-body { padding: 18px; display: flex; flex-direction: column; gap: 18px; }
          .tv-step { display: flex; flex-direction: column; gap: 8px; }
          .tv-step-label { font-size: 13px; font-weight: 600; color: var(--ink); }
          .tv-textarea {
            width: 100%; resize: vertical; font-size: 12.5px; line-height: 1.45;
            padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-sm);
            background: var(--paper-raised); color: var(--ink); font-family: inherit;
          }
          .tv-textarea:focus { outline: none; border-color: var(--accent); }
          .tv-hint { font-size: 12px; color: var(--ink-faint); }
          .tv-btn {
            display: inline-flex; align-items: center; gap: 7px; align-self: flex-start;
            padding: 8px 14px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          }
          .tv-btn:disabled { opacity: .45; cursor: default; }
          .tv-btn-primary { background: var(--accent); color: #fff; }
          .tv-btn-primary:hover:not(:disabled) { background: var(--accent-bright); }
          .tv-btn-ghost { border: 1px solid var(--line); color: var(--ink-soft); background: var(--paper-raised); }
          .tv-btn-ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
          .tv-error {
            font-size: 12.5px; color: #b91c1c; background: #fef2f2;
            border-radius: var(--r-sm); padding: 9px 12px;
          }
          .tv-error code { font-size: 11.5px; }
          .tv-preview-head { display: inline-flex; align-items: center; gap: 8px; color: var(--accent); font-weight: 600; font-size: 14px; }
          .tv-sum-name { font-size: 16px; font-weight: 700; color: var(--ink); }
          .tv-sum-line { font-size: 12.5px; color: var(--ink-soft); }
          .tv-block { display: flex; flex-direction: column; gap: 5px; }
          .tv-block-label { font-size: 12px; font-weight: 600; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .02em; }
          .tv-intro { font-size: 13px; color: var(--ink); background: var(--accent-wash); border-left: 3px solid var(--accent); padding: 9px 12px; border-radius: var(--r-sm); white-space: pre-line; }
          .tv-list { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--ink-soft); }
          .tv-list li { margin: 2px 0; }
          .tv-gaps li { color: #b87900; }
          .tv-warn {
            display: flex; align-items: flex-start; gap: 7px;
            font-size: 12.5px; color: #b87900; background: #fff7e6;
            border-radius: var(--r-sm); padding: 9px 12px;
          }
          .tv-actions { display: flex; justify-content: flex-end; gap: 10px; }
        `}</style>
      </div>
    </div>
  )
}
