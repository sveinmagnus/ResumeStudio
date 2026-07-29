/**
 * C4 — registry hygiene review (lib/registryHygiene.ts).
 *
 * The safety requirements drive the whole layout:
 *
 *  - **Nothing starts ticked.** Not the merges, not the categories. A "Select
 *    all" exists for the categories, which are cheap and reversible, and
 *    deliberately does NOT cover the merges: choosing to delete twelve registry
 *    entries should take twelve decisions, not one.
 *  - **Every merge states its consequence in the row**: which name survives,
 *    which is deleted, and how many references get rewritten. That count is the
 *    thing that makes a wrong merge obvious before it happens.
 *  - **A confirm before anything is written**, naming the totals. Merges are
 *    undoable in principle and unnoticed in practice — you find out three
 *    exports later that a skill you use is gone.
 *  - Skills you categorised yourself are never re-categorised; the validator
 *    drops those proposals and says so.
 */

import { useCallback, useMemo, useState } from 'react'
import { Wand2, GitMerge, Tags, ArrowRight, AlertTriangle, Check, CheckCheck, Square } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { AssistRun } from './AssistRun'
import { AdvancedAssistCard } from './AdvancedAssistCard'
import { confirmDialog } from './ConfirmDialog'
import { extractJson } from '../../lib/llmAssist'
import {
  applyHygiene, buildHygienePrompt, hasRegistryContent, hygieneImpact, validateHygiene,
  type HygieneResult,
} from '../../lib/registryHygiene'

export function RegistryHygienePanel() {
  const data = useStore((s) => s.data)
  const locale = useStore((s) => s.primaryLocale)
  const replaceData = useStore((s) => s.replaceData)

  const [result, setResult] = useState<HygieneResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [okMerges, setOkMerges] = useState<Set<string>>(new Set())
  const [okCats, setOkCats] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)

  const onResult = useCallback((text: string) => {
    setError(null); setNote(null)
    // Every run starts from nothing selected — a previous run's ticks must not
    // carry over onto different proposals.
    setOkMerges(new Set()); setOkCats(new Set())
    try {
      setResult(validateHygiene(JSON.parse(extractJson(text)), data, locale))
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : 'The reply could not be read.')
    }
  }, [data, locale])

  const chosenMerges = useMemo(
    () => (result?.merges ?? []).filter((m) => okMerges.has(m.key)),
    [result, okMerges],
  )
  const chosenCats = useMemo(
    () => (result?.categories ?? []).filter((c) => okCats.has(c.key)),
    [result, okCats],
  )

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key); else next.add(key)
    setter(next)
  }

  const apply = async () => {
    if (!chosenMerges.length && !chosenCats.length) return
    const impact = hygieneImpact(chosenMerges, chosenCats)

    // The last gate. Spelled out in counts, because "apply 7 changes" tells you
    // nothing about what a merge does to the rest of the CV.
    const lines = [
      impact.entriesDeleted
        ? `Delete ${impact.entriesDeleted} registry entr${impact.entriesDeleted === 1 ? 'y' : 'ies'} and rewrite ${impact.referencesRewritten} reference${impact.referencesRewritten === 1 ? '' : 's'} across your CV.`
        : '',
      impact.skillsCategorised
        ? `Categorise ${impact.skillsCategorised} skill${impact.skillsCategorised === 1 ? '' : 's'}${impact.newCategories ? `, creating ${impact.newCategories} new categor${impact.newCategories === 1 ? 'y' : 'ies'}` : ''}.`
        : '',
      '',
      'This is one undo step, but a merge is hard to spot later — check the list before confirming.',
    ].filter(Boolean).join('\n')

    const ok = await confirmDialog({
      title: 'Apply these registry changes?',
      message: lines,
      confirmLabel: 'Apply',
    })
    if (!ok) return

    const out = applyHygiene(data, chosenMerges, chosenCats, locale)
    if (out.merged || out.categorised) replaceData(out.data)
    setNote(
      out.skipped.length
        ? `Applied ${out.merged} merge(s) and ${out.categorised} category change(s). Skipped ${out.skipped.length}: ${out.skipped.join('; ')}.`
        : `Applied ${out.merged} merge(s) and ${out.categorised} category change(s).`,
    )
    setResult(null)
    setOkMerges(new Set()); setOkCats(new Set())
  }

  if (!hasRegistryContent(data)) return null

  const allCats = (result?.categories.length ?? 0) > 0 && okCats.size === result!.categories.length

  return (
    <AdvancedAssistCard
      title="Tidy the registries"
      icon={<Wand2 size={15} />}
      blurb={
        <>Looks for entries that are the same thing recorded twice, and for skills
        with no category. <strong>It proposes; it never changes anything on its
        own</strong> — you tick each one, and a merge tells you how many references
        it would rewrite before you agree to it.</>
      }
    >
      <AssistRun
        buildPrompt={() => buildHygienePrompt(data, locale)}
        onResult={onResult}
        label="Review my registries"
        maxTokens={8000}
        advanced
        wholeCv
        hasManualPath={false}
      />
      {error && <p className="rhp-err" role="alert">{error}</p>}
      {note && <p className="rhp-note" role="status">{note}</p>}

      {result && result.merges.length === 0 && result.categories.length === 0 && (
        <p className="rhp-ok"><Check size={14} /> Nothing to tidy — no duplicates found and every skill has a category.</p>
      )}

      {result && result.merges.length > 0 && (
        <section className="rhp-group">
          <h4 className="rhp-group-head"><GitMerge size={14} /> Possible duplicates ({result.merges.length})</h4>
          <p className="rhp-warn">
            <AlertTriangle size={13} />
            Each of these <strong>deletes</strong> one entry and rewrites its references.
            Tick only the ones you are sure about — there is no “select all” here on purpose.
          </p>
          <ul className="rhp-list">
            {result.merges.map((m) => (
              <li key={m.key} className={okMerges.has(m.key) ? 'rhp-item rhp-on' : 'rhp-item'}>
                <label className="rhp-pick">
                  <input type="checkbox" checked={okMerges.has(m.key)}
                    onChange={() => toggle(okMerges, setOkMerges, m.key)} />
                  <span className="rhp-merge">
                    <span className="rhp-drop">{m.dropName}</span>
                    <ArrowRight size={12} />
                    <span className="rhp-keep">{m.keepName}</span>
                    <span className="rhp-kind">{m.kind}</span>
                  </span>
                </label>
                <p className="rhp-impact">
                  Deletes <strong>{m.dropName}</strong> ({m.dropRefs} use{m.dropRefs === 1 ? '' : 's'})
                  {' '}and points {m.dropRefs === 1 ? 'it' : 'them'} at <strong>{m.keepName}</strong>
                  {' '}({m.keepRefs} use{m.keepRefs === 1 ? '' : 's'}).
                </p>
                {m.reason && <p className="rhp-reason">{m.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result && result.categories.length > 0 && (
        <section className="rhp-group">
          <h4 className="rhp-group-head"><Tags size={14} /> Category suggestions ({result.categories.length})</h4>
          <div className="rhp-bar">
            <span className="rhp-count">{okCats.size} of {result.categories.length} selected</span>
            <button className="rhp-all"
              onClick={() => setOkCats(allCats ? new Set() : new Set(result.categories.map((c) => c.key)))}>
              {allCats ? <Square size={12} /> : <CheckCheck size={12} />}
              {allCats ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <ul className="rhp-list">
            {result.categories.map((c) => (
              <li key={c.key} className={okCats.has(c.key) ? 'rhp-item rhp-on' : 'rhp-item'}>
                <label className="rhp-pick">
                  <input type="checkbox" checked={okCats.has(c.key)}
                    onChange={() => toggle(okCats, setOkCats, c.key)} />
                  <span className="rhp-merge">
                    <span className="rhp-keep">{c.skillName}</span>
                    <ArrowRight size={12} />
                    <span className="rhp-cat">{c.categoryName}</span>
                    {c.isNewCategory && <span className="rhp-new">new category</span>}
                  </span>
                </label>
                {c.reason && <p className="rhp-reason">{c.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result && (result.merges.length > 0 || result.categories.length > 0) && (
        <div className="rhp-actions">
          <button className="rhp-apply" onClick={() => void apply()}
            disabled={!chosenMerges.length && !chosenCats.length}>
            <Check size={13} /> Review and apply {chosenMerges.length + chosenCats.length || ''}
          </button>
          <button className="rhp-discard" onClick={() => { setResult(null); setOkMerges(new Set()); setOkCats(new Set()) }}>
            Discard
          </button>
        </div>
      )}

      {result && result.dropped.length > 0 && (
        <details className="rhp-dropped">
          <summary>{result.dropped.length} suggestion(s) were rejected</summary>
          <ul>{result.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </details>
      )}

      <style>{`
        .rhp-err { margin: 0; font-size: 12.5px; color: var(--err-ink); line-height: 1.45; }
        .rhp-note { margin: 0; font-size: 12.5px; color: var(--ok-ink); line-height: 1.45; }
        .rhp-ok { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 13px; color: var(--ok-ink); }
        .rhp-group { display: flex; flex-direction: column; gap: 8px; }
        .rhp-group-head {
          display: flex; align-items: center; gap: 6px; margin: 0;
          font-size: 13px; font-weight: 600; color: var(--ink);
        }
        .rhp-warn {
          display: flex; align-items: flex-start; gap: 6px; margin: 0;
          padding: 8px 10px; border-radius: var(--r-sm);
          background: var(--warn-wash); color: var(--warn-ink);
          font-size: 12px; line-height: 1.5;
        }
        .rhp-warn svg { flex-shrink: 0; margin-top: 2px; }
        .rhp-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .rhp-count { font-size: 12px; color: var(--ink-faint); }
        .rhp-all {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 4px 9px; border-radius: var(--r-sm); cursor: pointer;
          font-size: 12px; font-weight: 600;
          border: 1px solid var(--line); background: var(--paper); color: var(--ink-soft);
        }
        .rhp-all:hover { border-color: var(--accent); color: var(--accent); }
        .rhp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .rhp-item {
          display: flex; flex-direction: column; gap: 4px;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); padding: 9px 11px;
        }
        .rhp-on { border-color: var(--accent); background: var(--accent-wash); }
        .rhp-pick { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .rhp-pick input { flex-shrink: 0; }
        .rhp-merge { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; }
        .rhp-merge svg { color: var(--ink-faint); flex-shrink: 0; }
        .rhp-drop { text-decoration: line-through; color: var(--err-ink); }
        .rhp-keep { font-weight: 600; color: var(--ink); }
        .rhp-cat { font-weight: 600; color: var(--secondary-ink-text); }
        .rhp-kind, .rhp-new {
          font-size: 10.5px; font-weight: 600; border-radius: 999px; padding: 0 6px;
          border: 1px solid var(--line); color: var(--ink-faint);
        }
        .rhp-new { color: var(--secondary-ink-text); border-color: var(--secondary-line); background: var(--secondary-tint); }
        .rhp-impact { margin: 0 0 0 24px; font-size: 12px; color: var(--ink-soft); line-height: 1.45; }
        .rhp-reason { margin: 0 0 0 24px; font-size: 12px; font-style: italic; color: var(--ink-faint); line-height: 1.45; }
        .rhp-actions { display: flex; gap: 8px; }
        .rhp-apply, .rhp-discard {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--line); background: var(--paper);
        }
        .rhp-apply { background: var(--accent); color: #fff; border-color: var(--accent); }
        .rhp-apply:hover:not(:disabled) { background: var(--accent-bright); }
        .rhp-apply:disabled { opacity: .55; cursor: default; }
        .rhp-discard:hover { border-color: var(--line-strong); }
        .rhp-dropped { font-size: 11.5px; color: var(--ink-faint); }
        .rhp-dropped summary { cursor: pointer; }
        .rhp-dropped ul { margin: 6px 0 0; padding-left: 18px; }
      `}</style>
    </AdvancedAssistCard>
  )
}
