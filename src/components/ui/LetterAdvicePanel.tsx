/**
 * B5 — three angles, and a critique (lib/letterAdvice.ts), under the letter body.
 *
 * Two passes in one card because they're the two halves of the same moment: you
 * either haven't decided what to say yet, or you've said it and want a second
 * reader. Which one you need is obvious from whether the body is empty, so the
 * card leads with that rather than making you choose from a menu.
 *
 * Angles REPLACE the body when picked (that's what choosing an angle means), so
 * each one is shown in full first, and picking one is a click on that specific
 * letter rather than a generic Apply. Critique never writes anything.
 */

import { useCallback, useState } from 'react'
import {
  Shuffle, MessageSquareWarning, Check, ChevronDown, ChevronRight,
  CircleAlert, AlertTriangle, Info, HelpCircle,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { AssistRun } from './AssistRun'
import { AdvancedAssistCard } from './AdvancedAssistCard'
import { extractJson } from '../../lib/llmAssist'
import {
  buildLetterAnglesPrompt, buildLetterCritiquePrompt, hasLetterContext,
  validateLetterAngles, validateLetterCritique,
  type CritiqueResult, type CritiqueSeverity, type LetterAngle,
} from '../../lib/letterAdvice'
import type { CoverLetter, LocalizedString } from '../../types'

const SEVERITY_ICON: Record<CritiqueSeverity, React.ReactNode> = {
  high: <CircleAlert size={13} />,
  medium: <AlertTriangle size={13} />,
  low: <Info size={13} />,
}

interface Props {
  letter: CoverLetter
  /** Replace the body's primary-locale slot with a chosen angle. */
  onApplyBody: (next: LocalizedString) => void
}

export function LetterAdvicePanel({ letter, onApplyBody }: Props) {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)

  const [angles, setAngles] = useState<LetterAngle[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [critique, setCritique] = useState<CritiqueResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const body = (letter.body?.[locale] ?? '').trim()
  const ready = hasLetterContext(letter)

  const onAngles = useCallback((text: string) => {
    setError(null); setCritique(null)
    try {
      const parsed = validateLetterAngles(JSON.parse(extractJson(text)))
      setAngles(parsed)
      setOpen(parsed[0]?.key ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }, [])

  const onCritique = useCallback((text: string) => {
    setError(null); setAngles(null)
    try {
      setCritique(validateLetterCritique(JSON.parse(extractJson(text))))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }, [])

  const pick = (angle: LetterAngle) => {
    onApplyBody({ ...letter.body, [locale]: angle.body })
    setAngles(null)
  }

  return (
    <AdvancedAssistCard
      title="Angles &amp; second opinion"
      icon={<Shuffle size={15} />}
      blurb={
        <>The hard part of a letter isn&rsquo;t the paragraphs, it&rsquo;s deciding
        which true story to tell. Draft several complete letters taking different
        approaches and pick one — or have the one you wrote read back to you by
        someone who has the posting and your CV in front of them.</>
      }
    >
      <div className="lap-runs">
        <div className="lap-run">
          <AssistRun
            buildPrompt={() => buildLetterAnglesPrompt(data, letter, locale)}
            onResult={onAngles}
            label="Draft three angles"
            maxTokens={8000}
            advanced
            wholeCv
            disabled={!ready}
            hasManualPath={false}
          />
        </div>
        <div className="lap-run">
          <AssistRun
            buildPrompt={() => buildLetterCritiquePrompt(data, letter, locale)}
            onResult={onCritique}
            label="Critique what I wrote"
            maxTokens={4000}
            advanced
            wholeCv
            disabled={!ready || !body}
            hasManualPath={false}
          />
          {!body && <p className="lap-hint">Write the body first — there&rsquo;s nothing to read yet.</p>}
        </div>
      </div>

      {!ready && (
        <p className="lap-hint lap-need">
          Add the posting (or at least the role) above first — without it both
          passes are guessing at what the reader wants.
        </p>
      )}
      {error && <p className="lap-err" role="alert">{error}</p>}

      {angles && (
        <ul className="lap-list">
          {angles.map((a) => {
            const isOpen = open === a.key
            return (
              <li key={a.key} className="lap-item">
                <button className="lap-head" onClick={() => setOpen(isOpen ? null : a.key)}
                  aria-expanded={isOpen}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="lap-name">{a.name}</span>
                </button>
                {isOpen && (
                  <div className="lap-body">
                    {a.rationale && <p className="lap-rationale">{a.rationale}</p>}
                    <p className="lap-letter">{a.body}</p>
                    <button className="lap-pick" onClick={() => pick(a)}>
                      <Check size={13} /> {body ? 'Replace my letter with this' : 'Use this letter'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {critique && (
        <div className="lap-critique">
          {critique.overall && (
            <p className="lap-overall"><MessageSquareWarning size={14} /> {critique.overall}</p>
          )}
          {critique.notes.length === 0 && (
            <p className="lap-ok"><Check size={14} /> Nothing else to flag.</p>
          )}
          <ul className="lap-notes">
            {critique.notes.map((n) => (
              <li key={n.key} className={`lap-note lap-${n.severity}`}>
                <span className="lap-sev">{SEVERITY_ICON[n.severity]}</span>
                <div className="lap-note-body">
                  <div className="lap-note-title">{n.title}</div>
                  {n.detail && <p className="lap-note-detail">{n.detail}</p>}
                  {n.ask && <p className="lap-ask"><HelpCircle size={12} /> {n.ask}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <style>{`
        .lap-runs { display: flex; flex-wrap: wrap; gap: 16px; }
        .lap-run { display: flex; flex-direction: column; gap: 5px; min-width: 260px; flex: 1; }
        .lap-hint { margin: 0; font-size: 12px; color: var(--ink-faint); line-height: 1.45; }
        .lap-need { color: var(--warn-ink); }
        .lap-err { margin: 0; font-size: 12.5px; color: var(--err-ink); line-height: 1.45; }
        .lap-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .lap-item { border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper); }
        .lap-head {
          display: flex; align-items: center; gap: 7px; width: 100%;
          padding: 10px 12px; cursor: pointer; text-align: left;
          background: none; border: none; color: var(--ink);
        }
        .lap-head svg { flex-shrink: 0; color: var(--ink-faint); }
        .lap-name { flex: 1; font-size: 13.5px; font-weight: 600; }
        .lap-body {
          display: flex; flex-direction: column; gap: 8px;
          padding: 10px 12px 12px 33px; border-top: 1px solid var(--line);
        }
        .lap-rationale { margin: 0; font-size: 12.5px; font-style: italic; color: var(--secondary-ink-text); line-height: 1.5; }
        .lap-letter {
          margin: 0; font-size: 13px; line-height: 1.6; white-space: pre-wrap; color: var(--ink);
          padding: 10px 12px; background: var(--paper-sunken);
          border: 1px solid var(--line); border-radius: var(--r-sm);
        }
        .lap-pick {
          align-self: flex-start; display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
          cursor: pointer; background: var(--accent); color: #fff; border: 1px solid var(--accent);
        }
        .lap-pick:hover { background: var(--accent-bright); }
        .lap-critique { display: flex; flex-direction: column; gap: 8px; }
        .lap-overall {
          display: flex; align-items: flex-start; gap: 7px; margin: 0;
          padding: 10px 12px; font-size: 13px; line-height: 1.55;
          background: var(--paper-sunken); border-left: 3px solid var(--accent);
          border-radius: var(--r-sm); color: var(--ink);
        }
        .lap-overall svg { flex-shrink: 0; margin-top: 3px; color: var(--accent); }
        .lap-ok { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 13px; color: var(--ok-ink); }
        .lap-notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .lap-note {
          display: flex; align-items: flex-start; gap: 9px;
          border: 1px solid var(--line); border-left-width: 3px;
          border-radius: var(--r-sm); background: var(--paper); padding: 10px 12px;
        }
        .lap-note.lap-high { border-left-color: var(--err-ink); }
        .lap-note.lap-medium { border-left-color: var(--warn-ink); }
        .lap-note.lap-low { border-left-color: var(--line-strong); }
        .lap-sev { flex-shrink: 0; margin-top: 2px; }
        .lap-high .lap-sev { color: var(--err-ink); }
        .lap-medium .lap-sev { color: var(--warn-ink); }
        .lap-low .lap-sev { color: var(--ink-faint); }
        .lap-note-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .lap-note-title { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.4; }
        .lap-note-detail { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
        .lap-ask {
          display: flex; align-items: flex-start; gap: 5px; margin: 4px 0 0;
          font-size: 12.5px; line-height: 1.45; color: var(--secondary-ink-text);
        }
        .lap-ask svg { flex-shrink: 0; margin-top: 2px; }
      `}</style>
    </AdvancedAssistCard>
  )
}
