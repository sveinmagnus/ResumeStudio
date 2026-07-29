/**
 * D2 — draft a Resume View's introduction for a stated audience
 * (lib/introDraft.ts).
 *
 * Sits under the introduction field, and writes into the PRIMARY locale column
 * only. The model was shown one language and read one language; filling the
 * secondary column too would be a translation nobody asked for, and the
 * Draft-translation button on that column already owns that job.
 *
 * The draft is shown before it is applied, like every other assist here — but
 * the accept is a single button rather than a tick list, because there is one
 * field and one candidate.
 */

import { useCallback, useState } from 'react'
import { PenLine, Check, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { AssistRun } from './AssistRun'
import { AdvancedAssistCard } from './AdvancedAssistCard'
import { buildIntroPrompt, tidyIntro, type IntroFocus } from '../../lib/introDraft'
import type { LocalizedString, ResumeView } from '../../types'

interface Props {
  view: ResumeView
  /** Merge the accepted draft into the introduction's primary-locale slot. */
  onApply: (next: LocalizedString) => void
}

export function IntroDraftPanel({ view, onApply }: Props) {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const [focus, setFocus] = useState<IntroFocus>({ audience: '', length: 'paragraph' })
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onResult = useCallback((text: string) => {
    setError(null)
    const tidied = tidyIntro(text)
    if (!tidied) { setError('The model returned nothing usable.'); return }
    setDraft(tidied)
  }, [])

  const apply = () => {
    if (!draft) return
    onApply({ ...view.introduction, [locale]: draft })
    setDraft(null)
  }

  const current = view.introduction[locale] ?? ''

  return (
    <AdvancedAssistCard
      title="Draft the introduction"
      icon={<PenLine size={15} />}
      blurb={
        <>Writes an opening paragraph against the items THIS view actually
        includes, so it can&rsquo;t promise something the reader then can&rsquo;t
        find. Lands in the {locale.toUpperCase()} column for you to review.</>
      }
    >
      <label className="idp-label" htmlFor="idp-audience">Who is reading this version?</label>
      <input
        id="idp-audience"
        className="idp-input"
        value={focus.audience}
        onChange={(e) => setFocus((f) => ({ ...f, audience: e.target.value }))}
        placeholder="e.g. A public-sector procurement panel scoring a framework bid"
      />

      <fieldset className="idp-len">
        <legend className="idp-label">Length</legend>
        <label className="check-row">
          <input type="radio" name="idp-length" checked={focus.length === 'paragraph'}
            onChange={() => setFocus((f) => ({ ...f, length: 'paragraph' }))} />
          <span>A short paragraph</span>
        </label>
        <label className="check-row">
          <input type="radio" name="idp-length" checked={focus.length === 'line'}
            onChange={() => setFocus((f) => ({ ...f, length: 'line' }))} />
          <span>One sentence</span>
        </label>
      </fieldset>

      <AssistRun
        buildPrompt={() => buildIntroPrompt(data, view, locale, focus)}
        onResult={onResult}
        label="Draft the introduction"
        maxTokens={1200}
        advanced
        wholeCv
        hasManualPath={false}
      />
      {error && <p className="idp-err" role="alert">{error}</p>}

      {draft && (
        <div className="idp-draft">
          <div className="idp-sub">Suggested</div>
          <p className="idp-text idp-new">{draft}</p>
          {current && (
            <>
              <div className="idp-sub">Yours now</div>
              <p className="idp-text idp-old">{current}</p>
            </>
          )}
          <div className="idp-actions">
            <button className="idp-apply" onClick={apply}>
              <Check size={13} /> {current ? 'Replace the introduction' : 'Use this introduction'}
            </button>
            <button className="idp-discard" onClick={() => setDraft(null)}>
              <X size={13} /> Discard
            </button>
          </div>
        </div>
      )}

      <style>{`
        .idp-label { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
        .idp-input {
          width: 100%; padding: 8px 11px; font: inherit; font-size: 13px;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); color: var(--ink);
        }
        .idp-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
        .idp-len { border: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
        .idp-err { margin: 0; font-size: 12.5px; color: var(--err-ink); line-height: 1.45; }
        .idp-draft {
          display: flex; flex-direction: column; gap: 6px;
          padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper-sunken);
        }
        .idp-sub {
          font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
          color: var(--ink-faint);
        }
        .idp-text {
          margin: 0; font-size: 13px; line-height: 1.55; white-space: pre-wrap;
          padding: 8px 10px; border-radius: var(--r-sm); background: var(--paper);
          border: 1px solid var(--line);
        }
        .idp-new { border-color: var(--ok-ink); }
        .idp-old { color: var(--ink-soft); }
        .idp-actions { display: flex; gap: 8px; margin-top: 2px; }
        .idp-apply, .idp-discard {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--line); background: var(--paper);
        }
        .idp-apply { background: var(--accent); color: #fff; border-color: var(--accent); }
        .idp-apply:hover { background: var(--accent-bright); }
        .idp-discard:hover { border-color: var(--line-strong); }
      `}</style>
    </AdvancedAssistCard>
  )
}
