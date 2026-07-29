/**
 * D1 — generate positioning Profiles with their competency bundles
 * (lib/profileGenerator.ts), from the whole CV plus a brief the user writes.
 *
 * The brief textarea is the point of this panel, not decoration. A profile
 * claims what someone is FOR, and the CV cannot say which of several careers
 * they want to be read as having next. So Run stays disabled until something is
 * written there — the one place in this app where an assist refuses to guess.
 *
 * Drafts are previewed side by side and added ONE at a time: these are
 * alternatives, not a batch. Adding one appends it to the profile list rather
 * than replacing anything, because a view presents the FIRST non-disabled
 * profile and silently reordering that would change every existing export.
 */

import { useCallback, useState } from 'react'
import { Sparkles, Check, ChevronDown, ChevronRight, Quote } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { AssistRun } from './AssistRun'
import { AdvancedAssistCard } from './AdvancedAssistCard'
import { extractJson } from '../../lib/llmAssist'
import {
  applyProfileDraft, buildProfilePrompt, validateProfileDraft,
  DEFAULT_PROFILE_COUNT, type DraftProfile, type ProfileDraftResult,
} from '../../lib/profileGenerator'

export function ProfileGeneratorPanel() {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const replaceData = useStore((s) => s.replaceData)

  const [brief, setBrief] = useState('')
  const [count, setCount] = useState(DEFAULT_PROFILE_COUNT)
  const [result, setResult] = useState<ProfileDraftResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())

  const onResult = useCallback((text: string) => {
    setError(null); setResult(null); setAdded(new Set())
    try {
      const parsed = validateProfileDraft(JSON.parse(extractJson(text)), data, locale)
      setResult(parsed)
      setOpen(parsed.profiles[0]?.key ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }, [data, locale])

  const add = (draft: DraftProfile) => {
    replaceData(applyProfileDraft(data, draft, locale))
    setAdded((prev) => new Set(prev).add(draft.key))
  }

  const ready = brief.trim().length > 0

  return (
    <AdvancedAssistCard
      title="Draft a profile for a target role"
      icon={<Sparkles size={15} />}
      blurb={
        <>Reads your whole CV and drafts alternative opening profiles — tag line,
        summary, and the ordered competency bundle each one should present.
        Tell it what you&rsquo;re aiming at; it supplies the evidence, not the ambition.</>
      }
    >
      <label className="pgp-label" htmlFor="pgp-brief">
        What is this profile for?
      </label>
      <textarea
        id="pgp-brief"
        className="pgp-brief"
        rows={3}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="e.g. Lead architect on public-sector cloud migrations. Reader is a procurement officer, not a developer. Play down the early front-end years."
      />
      <p className="pgp-hint">
        The more specific the better: target role, who is reading, which part of
        your background to lead with, and what to leave in the background.
      </p>

      <label className="pgp-label" htmlFor="pgp-count">How many alternatives?</label>
      <select id="pgp-count" className="pgp-count" value={count}
        onChange={(e) => setCount(Number(e.target.value))}>
        <option value={1}>1 — just the strongest angle</option>
        <option value={2}>2</option>
        <option value={3}>3 — a spread to choose from</option>
        <option value={4}>4</option>
      </select>

      <AssistRun
        buildPrompt={() => buildProfilePrompt(data, locale, { brief, count })}
        onResult={onResult}
        label="Draft profiles"
        maxTokens={8000}
        advanced
        wholeCv
        disabled={!ready}
        hasManualPath={false}
      />
      {!ready && <p className="pgp-hint pgp-need">Write the brief first — without it you get an average of your CV, which is what a generic profile is.</p>}
      {error && <p className="pgp-err" role="alert">{error}</p>}

      {result && result.profiles.length > 0 && (
        <ul className="pgp-list">
          {result.profiles.map((p) => {
            const isOpen = open === p.key
            const isAdded = added.has(p.key)
            return (
              <li key={p.key} className="pgp-item">
                <button className="pgp-head" onClick={() => setOpen(isOpen ? null : p.key)}
                  aria-expanded={isOpen}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="pgp-tag">{p.tagLine || '(no tag line)'}</span>
                  {isAdded && <span className="pgp-added"><Check size={11} /> added</span>}
                </button>

                {isOpen && (
                  <div className="pgp-body">
                    {p.rationale && <p className="pgp-rationale">{p.rationale}</p>}
                    <p className="pgp-summary">{p.summary}</p>
                    {p.summaryShort && (
                      <>
                        <div className="pgp-sub">Short version</div>
                        <p className="pgp-summary pgp-short">{p.summaryShort}</p>
                      </>
                    )}

                    {p.bundle.length > 0 && (
                      <>
                        <div className="pgp-sub">Competency bundle ({p.bundle.length})</div>
                        <ol className="pgp-bundle">
                          {p.bundle.map((b, i) => (
                            <li key={`${p.key}:${b.id ?? b.title}:${i}`}>
                              <span className="pgp-b-title">{b.title}</span>
                              {b.isNew && <span className="pgp-new">new</span>}
                            </li>
                          ))}
                        </ol>
                      </>
                    )}

                    {p.evidence.length > 0 && (
                      <p className="pgp-evidence">
                        <Quote size={11} /> Drawn from: {p.evidence.join(' · ')}
                      </p>
                    )}

                    <button className="pgp-add" onClick={() => add(p)} disabled={isAdded}>
                      <Check size={13} /> {isAdded ? 'Added to Profiles' : 'Add this profile'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {result && result.dropped.length > 0 && (
        <details className="pgp-dropped">
          <summary>{result.dropped.length} note(s) about the reply</summary>
          <ul>{result.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </details>
      )}

      <style>{`
        .pgp-label { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
        .pgp-brief {
          width: 100%; padding: 9px 11px; font: inherit; font-size: 13px; line-height: 1.5;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); color: var(--ink); resize: vertical;
        }
        .pgp-brief:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
        .pgp-count {
          align-self: flex-start; padding: 6px 9px; font: inherit; font-size: 12.5px;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); color: var(--ink);
        }
        .pgp-hint { margin: 0; font-size: 12px; color: var(--ink-faint); line-height: 1.45; }
        .pgp-need { color: var(--warn-ink); }
        .pgp-err { margin: 0; font-size: 12.5px; color: var(--err-ink); line-height: 1.45; }
        .pgp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .pgp-item { border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper); }
        .pgp-head {
          display: flex; align-items: center; gap: 7px; width: 100%;
          padding: 10px 12px; cursor: pointer; text-align: left;
          background: none; border: none; color: var(--ink);
        }
        .pgp-head svg { flex-shrink: 0; color: var(--ink-faint); }
        .pgp-tag { flex: 1; font-size: 13.5px; font-weight: 600; }
        .pgp-added {
          display: inline-flex; align-items: center; gap: 3px;
          font-size: 11px; font-weight: 600; color: var(--ok-ink);
        }
        .pgp-body {
          display: flex; flex-direction: column; gap: 8px;
          padding: 0 12px 12px 33px; border-top: 1px solid var(--line); padding-top: 10px;
        }
        .pgp-rationale { margin: 0; font-size: 12.5px; font-style: italic; color: var(--secondary-ink-text); }
        .pgp-summary { margin: 0; font-size: 13px; line-height: 1.55; color: var(--ink); white-space: pre-wrap; }
        .pgp-short { color: var(--ink-soft); }
        .pgp-sub {
          font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
          color: var(--ink-faint);
        }
        .pgp-bundle { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 3px; }
        .pgp-bundle li { font-size: 12.5px; color: var(--ink-soft); }
        .pgp-b-title { color: var(--ink); }
        .pgp-new {
          margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 10.5px; font-weight: 700;
          color: var(--secondary-ink-text); background: var(--secondary-tint);
          border: 1px solid var(--secondary-line);
        }
        .pgp-evidence {
          display: flex; align-items: flex-start; gap: 5px; margin: 0;
          font-size: 11.5px; color: var(--ink-faint); line-height: 1.45;
        }
        .pgp-evidence svg { flex-shrink: 0; margin-top: 2px; }
        .pgp-add {
          align-self: flex-start; display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
          cursor: pointer; background: var(--accent); color: #fff; border: 1px solid var(--accent);
        }
        .pgp-add:hover:not(:disabled) { background: var(--accent-bright); }
        .pgp-add:disabled { opacity: .55; cursor: default; }
        .pgp-dropped { font-size: 11.5px; color: var(--ink-faint); }
        .pgp-dropped summary { cursor: pointer; }
        .pgp-dropped ul { margin: 6px 0 0; padding-left: 18px; }
      `}</style>
    </AdvancedAssistCard>
  )
}
