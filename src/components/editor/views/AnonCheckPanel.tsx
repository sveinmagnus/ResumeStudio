/**
 * Anonymisation leak check — shown only on a view with "Anonymize clients" on.
 *
 * Pass 1 runs automatically because it is free: the store already knows every
 * real customer and reference, so finding those in the rendered view costs
 * nothing and sends nothing anywhere. Pass 2 (an LLM reading the whole CV for
 * organisations we never recorded) is opt-in — it's the assist that ships the
 * most sensitive text in the app, so it must never happen on its own.
 *
 * Advisory: it reports, it never edits the prose.
 */

import { useMemo, useState } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useStore } from '../../../store/useStore'
import { AssistRun } from '../../ui/AssistRun'
import { extractJson } from '../../../lib/llmAssist'
import {
  findKnownLeaks, buildAnonCheckPrompt, validateAnonCheck, modelFindings, type AnonFinding,
} from '../../../lib/anonCheck'
import type { ResumeView } from '../../../types'

export function AnonCheckPanel({ view, locale }: { view: ResumeView; locale: string }) {
  const data = useStore((s) => s.data)
  const [modelFound, setModelFound] = useState<AnonFinding[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Free + exact. Recomputed as the view/CV changes — no run button needed.
  const known = useMemo(() => findKnownLeaks(data, view, locale), [data, view, locale])

  const onResult = (text: string) => {
    setError(null)
    try {
      const names = validateAnonCheck(JSON.parse(extractJson(text)))
      setModelFound(modelFindings(names, data, view, locale, known))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }

  const all = [...known, ...(modelFound ?? [])]
  const clean = all.length === 0

  const row = (f: AnonFinding, i: number) => (
    <li key={`${f.source}-${f.text}-${i}`} className="ac-row">
      <span className="ac-name">{f.text}</span>
      <span className="ac-origin">{f.origin || 'spotted by the model'}</span>
      <span className="ac-ctx">{f.context}</span>
    </li>
  )

  return (
    <div className="ac-wrap">
      <div className={`ac-head ${clean ? 'ac-ok' : 'ac-warn'}`}>
        {clean ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
        {clean
          ? 'No real client names found in this view’s text.'
          : `${all.length} name${all.length === 1 ? '' : 's'} still visible in this view’s text`}
      </div>

      <p className="ac-help">
        Anonymising swaps the customer field and redacts references — it can’t rewrite your
        prose. This checks the text your client would actually read.
      </p>

      {all.length > 0 && <ul className="ac-list">{all.map(row)}</ul>}

      {modelFound === null && (
        <div className="ac-deep">
          <AssistRun
            buildPrompt={() => buildAnonCheckPrompt(data, view, locale)}
            onResult={onResult}
            wholeCv
            label="Also check for names I never recorded"
            maxTokens={500}
          />
          <p className="ac-help">
            The check above only knows the names in your CV’s fields. A model can also spot a
            client mentioned only in passing — but it has to read the whole view to do it.
          </p>
        </div>
      )}
      {modelFound !== null && modelFound.length === 0 && (
        <p className="ac-help">The deeper check found no other organisation names.</p>
      )}
      {error && <p className="ac-help ac-err" role="alert">{error}</p>}

      <style>{`
        .ac-wrap {
          display: flex; flex-direction: column; gap: 8px;
          padding: 11px 12px; margin-top: 10px;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper-sunken);
        }
        .ac-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
        .ac-ok { color: var(--ok-ink); }
        .ac-warn { color: var(--warn-ink); }
        .ac-help { font-size: 11.5px; color: var(--ink-faint); margin: 0; line-height: 1.45; }
        .ac-err { color: var(--err-ink); }
        .ac-list { list-style: none; display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; }
        .ac-row {
          display: grid; grid-template-columns: auto auto 1fr; gap: 4px 8px; align-items: baseline;
          font-size: 12px; padding: 5px 7px; border-radius: var(--r-sm); background: var(--warn-wash);
        }
        .ac-name { font-weight: 600; color: var(--warn-ink); }
        .ac-origin { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-faint); }
        .ac-ctx { grid-column: 1 / -1; color: var(--ink-soft); font-style: italic; }
        .ac-deep { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
      `}</style>
    </div>
  )
}
