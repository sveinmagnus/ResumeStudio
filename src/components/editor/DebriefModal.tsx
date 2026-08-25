import { useMemo, useState } from 'react'
import { X, Copy, Check, ClipboardPaste, MessageSquareText } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useDialog } from '../ui/useDialog'
import { AssistRun } from '../ui/AssistRun'
import { extractJson } from '../../lib/llmAssist'
import {
  debriefQuestions, buildDebriefPrompt, validateDebrief, applyDebrief,
  type DebriefDraft,
} from '../../lib/debrief'
import { resolveSuggestions, type ExtractionResult } from '../../lib/skillExtract'
import { resolve, fmtRange } from '../../lib/locales'
import type { Project } from '../../types'

/**
 * The project debrief interview (lib/debrief.ts): structural questions, the
 * consultant's answers, and a review list of drafted highlights / skill links /
 * short description. Everything applies through ONE `replaceData` so the whole
 * debrief is a single undo step; nothing writes until the user ticks and
 * confirms. The questions need no model — with none configured, the BYO
 * copy-prompt / paste-reply path is the (first-class) way through.
 */
export function DebriefModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { data, primaryLocale, replaceData, updateItem } = useStore()
  const dialogRef = useDialog(onClose)

  const questions = useMemo(() => debriefQuestions(project, primaryLocale), [project, primaryLocale])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const answered = questions.some((q) => (answers[q.id] ?? '').trim())

  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DebriefDraft | null>(null)
  const [skillGroups, setSkillGroups] = useState<ExtractionResult | null>(null)
  const [pickedHighlights, setPickedHighlights] = useState<Set<string>>(new Set())
  const [pickedSkills, setPickedSkills] = useState<Set<string>>(new Set())
  const [useShort, setUseShort] = useState(false)

  const [pasted, setPasted] = useState('')
  const [copied, setCopied] = useState(false)

  const buildPrompt = () => buildDebriefPrompt(project, primaryLocale, questions, answers)

  const onResult = (text: string) => {
    setError(null)
    try {
      const d = validateDebrief(JSON.parse(extractJson(text)))
      const groups = resolveSuggestions(d.skills, project, data.skills, primaryLocale)
      setDraft(d)
      setSkillGroups(groups)
      setPickedHighlights(new Set(d.highlights))
      // Existing registry hits are cheap to link → pre-ticked; new registry
      // entries grow a shared resource → a deliberate click (skillExtract rule).
      setPickedSkills(new Set(groups.existing.map((s) => s.label)))
      // Pre-tick the drafted one-liner only where it fills a gap, never where
      // it would overwrite something the user already wrote.
      setUseShort(!!d.short_description && !(project.short_description?.[primaryLocale] ?? '').trim())
    } catch (e) {
      setDraft(null)
      setSkillGroups(null)
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }

  const copyPrompt = () => {
    void navigator.clipboard?.writeText(buildPrompt()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  const toggle = (set: Set<string>, update: (s: Set<string>) => void, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key); else next.add(key)
    update(next)
  }

  const pickedCount = pickedHighlights.size + pickedSkills.size + (useShort ? 1 : 0)

  const apply = () => {
    if (!draft || !skillGroups) return
    const current = useStore.getState().data
    replaceData(applyDebrief(current, project.id, {
      highlights: draft.highlights.filter((h) => pickedHighlights.has(h)),
      linkSkillIds: skillGroups.existing
        .filter((s) => pickedSkills.has(s.label) && s.skillId)
        .map((s) => s.skillId!),
      newSkills: skillGroups.novel.filter((s) => pickedSkills.has(s.label)).map((s) => s.label),
      shortDescription: useShort ? draft.short_description : null,
    }, primaryLocale))
    onClose()
  }

  const markDone = () => {
    updateItem('projects', project.id, { debriefed_at: new Date().toISOString() })
    onClose()
  }

  const title = resolve(project.customer, primaryLocale)
    || resolve(project.description, primaryLocale) || 'Untitled project'

  return (
    <div className="db-backdrop" role="presentation" onClick={onClose}>
      <div
        className="db-modal" ref={dialogRef} role="dialog" aria-modal="true"
        aria-labelledby="db-title" onClick={(e) => e.stopPropagation()}
      >
        <div className="db-head">
          <div>
            <h3 id="db-title"><MessageSquareText size={18} /> Debrief — {title}</h3>
            <p className="db-sub">
              {fmtRange(project.start, project.end)} · Answer what you can while it's fresh —
              the answers become highlights, skills and a summary you review before anything is saved.
            </p>
          </div>
          <button className="db-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="db-questions">
          {questions.map((q) => (
            <label key={q.id} className="db-q">
              <span className="db-q-text">{q.text}</span>
              <span className="db-q-hint">{q.hint}</span>
              <textarea
                className="db-q-input"
                rows={2}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            </label>
          ))}
        </div>

        <AssistRun
          buildPrompt={buildPrompt}
          onResult={onResult}
          disabled={!answered}
          label="Draft updates from my answers"
          maxTokens={1200}
          hasManualPath
        >
          <div className="db-manual">
            <button type="button" className="db-btn" onClick={copyPrompt} disabled={!answered}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy prompt'}
            </button>
            <textarea
              className="db-paste"
              rows={3}
              placeholder="Paste the AI's JSON reply here…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              aria-label="Paste the AI reply"
            />
            <button
              type="button" className="db-btn" disabled={!pasted.trim()}
              onClick={() => onResult(pasted)}
            >
              <ClipboardPaste size={13} /> Use reply
            </button>
          </div>
        </AssistRun>
        {!answered && <p className="db-hint">Answer at least one question first.</p>}
        {error && <p className="db-err" role="alert">{error}</p>}

        {draft && skillGroups && (
          <div className="db-review">
            {draft.highlights.length > 0 && (
              <div className="db-group">
                <div className="db-group-head">New highlights</div>
                {draft.highlights.map((h) => (
                  <label key={h} className="db-row">
                    <input
                      type="checkbox" checked={pickedHighlights.has(h)}
                      onChange={() => toggle(pickedHighlights, setPickedHighlights, h)}
                    />
                    <span>{h}</span>
                  </label>
                ))}
              </div>
            )}
            {(skillGroups.existing.length > 0 || skillGroups.novel.length > 0) && (
              <div className="db-group">
                <div className="db-group-head">Skills to link</div>
                {skillGroups.existing.map((s) => (
                  <label key={s.label} className="db-row">
                    <input
                      type="checkbox" checked={pickedSkills.has(s.label)}
                      onChange={() => toggle(pickedSkills, setPickedSkills, s.label)}
                    />
                    <span>{s.label}</span>
                    <span className="db-tag">in registry</span>
                  </label>
                ))}
                {skillGroups.novel.map((s) => (
                  <label key={s.label} className="db-row">
                    <input
                      type="checkbox" checked={pickedSkills.has(s.label)}
                      onChange={() => toggle(pickedSkills, setPickedSkills, s.label)}
                    />
                    <span>{s.label}</span>
                    <span className="db-tag db-tag-new">new registry skill</span>
                  </label>
                ))}
              </div>
            )}
            {draft.short_description && (
              <div className="db-group">
                <div className="db-group-head">Short description</div>
                <label className="db-row">
                  <input type="checkbox" checked={useShort} onChange={() => setUseShort((v) => !v)} />
                  <span>{draft.short_description}</span>
                  {(project.short_description?.[primaryLocale] ?? '').trim() && (
                    <span className="db-tag db-tag-new">replaces the current line</span>
                  )}
                </label>
              </div>
            )}
            <div className="db-actions">
              <button className="db-btn" onClick={() => { setDraft(null); setSkillGroups(null) }}>Discard</button>
              <button className="db-btn db-primary" onClick={apply} disabled={pickedCount === 0}>
                Apply {pickedCount} change{pickedCount === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}

        <div className="db-foot">
          <button className="db-done" onClick={markDone} title="Nothing new to capture — stop offering the debrief for this ending">
            Nothing new — mark as debriefed
          </button>
        </div>
      </div>
      <style>{`
        .db-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.35);
          display: grid; place-items: center; z-index: 100; animation: fadeIn .15s ease;
        }
        .db-modal {
          background: var(--paper); border-radius: var(--r-md);
          padding: 24px 26px; width: min(680px, 94vw);
          max-height: 88vh; overflow-y: auto; overscroll-behavior: contain;
          box-shadow: var(--shadow-lg);
        }
        .db-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
        .db-head h3 { display: flex; align-items: center; gap: 8px; font-size: 21px; }
        .db-sub { font-size: 12.5px; color: var(--ink-faint); margin-top: 4px; line-height: 1.5; }
        .db-close {
          width: 30px; height: 30px; display: grid; place-items: center; flex-shrink: 0;
          border-radius: var(--r-sm); color: var(--ink-faint); transition: color .12s, background .12s;
        }
        .db-close:hover { background: var(--paper-sunken); color: var(--accent); }
        .db-questions { display: flex; flex-direction: column; gap: 14px; margin-bottom: 16px; }
        .db-q { display: flex; flex-direction: column; gap: 3px; }
        .db-q-text { font-size: 13.5px; font-weight: 600; color: var(--ink); }
        .db-q-hint { font-size: 12px; color: var(--ink-faint); margin-bottom: 3px; }
        .db-q-input {
          padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: var(--r-sm);
          background: var(--paper-raised); font-size: 13px; font-family: inherit; resize: vertical;
        }
        .db-q-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
        .db-manual { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
        .db-paste {
          width: 100%; padding: 8px 10px; border: 1px solid var(--line-strong);
          border-radius: var(--r-sm); background: var(--paper-raised);
          font-size: 12.5px; font-family: monospace; resize: vertical;
        }
        .db-hint { font-size: 12px; color: var(--ink-faint); margin-top: 6px; }
        .db-err { font-size: 12.5px; color: var(--err-ink); margin-top: 8px; }
        .db-review {
          margin-top: 14px; padding: 12px 14px;
          border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper-sunken);
          display: flex; flex-direction: column; gap: 12px;
        }
        .db-group { display: flex; flex-direction: column; gap: 4px; }
        .db-group-head {
          font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
          color: var(--ink-faint); margin-bottom: 2px;
        }
        .db-row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; cursor: pointer; }
        .db-row input { accent-color: var(--accent); width: 14px; height: 14px; flex-shrink: 0; transform: translateY(2px); }
        .db-tag { font-size: 11px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .04em; flex-shrink: 0; }
        .db-tag-new { color: var(--warn-ink); }
        .db-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .db-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; font-size: 12.5px; font-weight: 600;
          border: 1px solid var(--line-strong); border-radius: var(--r-sm);
          background: var(--paper-raised); color: var(--ink-soft); cursor: pointer;
          transition: color .12s, border-color .12s, background .12s;
        }
        .db-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
        .db-btn:disabled { opacity: .5; cursor: default; }
        .db-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
        .db-primary:hover:not(:disabled) { background: var(--accent-bright); color: #fff; }
        .db-foot { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 10px; }
        .db-done {
          font-size: 12.5px; color: var(--ink-faint); padding: 4px 8px; border-radius: var(--r-sm);
          transition: color .12s, background .12s;
        }
        .db-done:hover { color: var(--accent); background: var(--accent-wash); }
      `}</style>
    </div>
  )
}
