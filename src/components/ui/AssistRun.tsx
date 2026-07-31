/**
 * The ONE control behind every "Run with my AI" affordance.
 *
 * It exists so the two promises the app makes about AI are made in exactly one
 * place: where your content goes, and that the manual path is always yours to
 * take. Every assist (tailoring, AI import, bulk add, skill extraction, key
 * points, anonymisation check, page fitting) renders this rather than rolling
 * its own button + disclaimer, because a per-feature disclaimer is a
 * per-feature chance to get the privacy story wrong.
 *
 * Behaviour:
 *  - Configured  → Run button labelled with the model + a provenance line.
 *  - Remote      → the provenance line says so; a `wholeCv` task additionally
 *                  confirms ONCE per session before its first send.
 *  - Too long    → a hint, but Run stays enabled (the user's call).
 *  - Unconfigured→ no Run at all; the manual path is the only path.
 *  - Always      → "do it manually instead" reveals the caller's own
 *                  copy-prompt / paste-result steps.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkles, Loader2, AlertTriangle, Info, ShieldCheck, ChevronDown } from 'lucide-react'
import { api } from '../../lib/api'
import { useAssistStatus } from './AdvancedAssistCard'
import {
  providerBlurb, sizeHint, isRemote, backendName, looksWeakForWriting, MANUAL_BLURB,
} from '../../lib/llmAssist'
import { selectRun, startAdvisor, useAdvisors, type AdvisorRef } from '../../store/useAdvisors'
import { confirmDialog } from './ConfirmDialog'

/**
 * Remote whole-CV sends confirm once per session, then stay quiet. Module-level
 * so it spans modals (you shouldn't re-confirm per dialog), and reset alongside
 * the memoized status so changing provider in Settings re-asks — consenting to
 * send to a local box is not consent to send to OpenAI.
 */
let remoteConsent = false
export function resetAssistConsent(): void { remoteConsent = false }

interface Props {
  /**
   * Called on every render while a model is configured (the size hint tracks
   * the prompt live as the user types/pastes) — keep it cheap-ish and pure.
   */
  buildPrompt: () => string
  /**
   * The model's raw reply. The caller validates it exactly as it validates a
   * paste. Not used when `advisor` is set — the reply goes to the advisor store
   * instead, and the panel reads it from there.
   */
  onResult?: (text: string) => void
  /**
   * Run through the advisor store rather than local state, so the request
   * survives the user navigating away mid-flight and the reply is still there
   * when they come back. See `store/useAdvisors.ts` — this is what stops a
   * minute-long, paid-for run being thrown away by a click.
   */
  advisor?: AdvisorRef
  /**
   * What the user typed for this run (a pasted posting, a brief), stored with
   * it so a panel can restore the input its results are read against. See
   * `AdvisorRun.input`.
   */
  advisorInput?: string
  /**
   * In-item placement: the button sits under the field it applies to, styled
   * like the Copy/Draft/Summarize chips beside it, with the provenance and
   * model warnings laid out to its RIGHT rather than stacked underneath. Six
   * of these down a project card is a lot of vertical space to spend on the
   * same sentence.
   */
  compact?: boolean
  /**
   * Warn that a small model will struggle with this particular task. Writing
   * assists set it; structural ones (extract these skills) don't need to.
   */
  warnWeakModel?: boolean
  /** True when the prompt carries the whole CV — gates the once-per-session confirm. */
  wholeCv?: boolean
  disabled?: boolean
  /** Verb on the button, e.g. "Tailor this view". */
  label?: string
  /** Max reply tokens, for tasks that return a lot (a full CV import). */
  maxTokens?: number
  /**
   * An ADVANCED task (whole-CV review, positioning, …): asks the server for the
   * high-end budget — bigger prompt, longer reply, longer timeout — which it
   * grants only if the model is declared high-end. Callers gate their own UI on
   * `supportsAdvanced` too; this flag is what makes the server agree.
   */
  advanced?: boolean
  /**
   * Does this screen offer a copy-prompt / paste-result path at all? It decides
   * the wording when no model is configured — pointing at "the manual path"
   * when there is none is a dead end.
   *
   * REQUIRED, and deliberately not inferred from `children`. `children` only
   * says whether AssistRun renders the steps *itself*: the tailor modal passes
   * them here, but the AI-import and bulk-add modals lay their own steps out as
   * numbered stages beside this control. Inferring from `children` therefore
   * told those two there was no manual path while one was on screen — the same
   * bug as before, pointing the other way. So each caller states the truth and
   * the compiler asks the question.
   */
  hasManualPath: boolean
  /** The caller's existing copy/paste steps, revealed by "do it manually". */
  children?: ReactNode
}

export function AssistRun({
  buildPrompt, onResult, wholeCv = false, disabled = false,
  label = 'Run with my AI', maxTokens, advanced = false, advisor, advisorInput,
  compact = false, warnWeakModel = false, hasManualPath, children,
}: Props) {
  const status = useAssistStatus()
  const [localBusy, setLocalBusy] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  // With an advisor, busy/error are properties of the RUN, not of this
  // component — that's the whole point: unmounting must not lose them.
  const storedRun = useAdvisors((s) =>
    (advisor ? selectRun(s.runs, advisor.id, advisor.resumeId, advisor.scope) : undefined))
  const busy = advisor ? storedRun?.status === 'running' : localBusy
  const err = advisor ? (storedRun?.status === 'error' ? storedRun.error ?? null : null) : localErr
  // Manual is the only path with no model, so it starts open in that case.
  const [manualOpen, setManualOpen] = useState(false)

  const run = useCallback(async () => {
    setLocalErr(null)
    const prompt = buildPrompt()
    if (!prompt.trim()) return

    if (wholeCv && isRemote(status) && !remoteConsent) {
      const ok = await confirmDialog({
        title: 'Send this to your AI provider?',
        message:
          `This sends your CV content to ${status.provider}${status.model ? ` (${status.model})` : ''} over the internet. ` +
          'A local model would keep it on this computer. Asked once per session.',
        confirmLabel: 'Send',
      })
      if (!ok) return
      remoteConsent = true
    }

    if (advisor) {
      // Fire and forget: the store owns the request from here, so this
      // component can unmount without cancelling anything.
      void startAdvisor(advisor, prompt, { maxTokens, advanced, input: advisorInput })
      return
    }

    setLocalBusy(true)
    try {
      onResult?.(await api.llmComplete(prompt, maxTokens, advanced))
    } catch (e) {
      setLocalErr((e as Error).message)
    } finally {
      setLocalBusy(false)
    }
  }, [buildPrompt, onResult, wholeCv, status, maxTokens, advanced, advisor, advisorInput])

  /**
   * Announce start and completion to assistive tech.
   *
   * The button's label flips to "Working…", but a label change on a control
   * that is simultaneously disabled is not reliably announced — and the RESULTS
   * render in a sibling panel with no live region of its own. So a run that can
   * take up to three minutes (the advanced budget) finished in silence.
   *
   * The five Overview advisors already had `AdvisorToast` for this; the panels
   * that hold their results locally (D1/D2/D3, B4, B5, C4) had nothing. Putting
   * it here covers every assist, present and future, from the one control they
   * all render.
   *
   * Errors are deliberately NOT repeated here — they already have role="alert"
   * below, and announcing both would say it twice.
   */
  const [announcement, setAnnouncement] = useState('')
  const wasBusy = useRef(false)
  useEffect(() => {
    if (busy && !wasBusy.current) setAnnouncement(`${label} started…`)
    else if (!busy && wasBusy.current) {
      setAnnouncement(err ? '' : `${label} finished. Review the results below.`)
    }
    wasBusy.current = busy
  }, [busy, err, label])

  const configured = status.configured
  const hint = configured ? sizeHint(buildPrompt().length, status) : null
  const remote = isRemote(status)
  const showManual = !configured || manualOpen

  const weak = warnWeakModel && looksWeakForWriting(status)

  return (
    <div className={compact ? 'ar-wrap ar-compact' : 'ar-wrap'}>
      {/* Persistent live region — never conditionally unmounted, so the
          announcement is heard (CLAUDE.md §6, same rule as SaveStatus). */}
      <p className="sr-only" role="status">{announcement}</p>
      {configured && (
        <>
          <div className="ar-run-row">
            <button className="ar-run" onClick={() => void run()} disabled={disabled || busy}>
              {busy ? <Loader2 size={14} className="ar-spin" /> : <Sparkles size={14} />}
              {/* No model name here: it's in the provenance line beside the
                  button, where it's only worth reading if you care. */}
              {busy ? 'Working…' : label}
            </button>

            {/* Beside the button in compact mode, under it otherwise. */}
            <div className="ar-notes">
              <p className={`ar-blurb ${remote ? 'ar-remote' : 'ar-local'}`}>
                {remote ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
                {providerBlurb(status, hasManualPath)}
              </p>
              {weak && (
                <p className="ar-blurb ar-weak">
                  <AlertTriangle size={12} />
                  {backendName(status)} is a small model — expect thin results on a
                  writing task. A larger one does this much better.
                </p>
              )}
              {hint && <p className="ar-blurb ar-hint"><Info size={12} />{hint}</p>}
              {err && <p className="ar-blurb ar-err" role="alert"><AlertTriangle size={12} />{err}</p>}
            </div>
          </div>
        </>
      )}

      {!configured && <p className="ar-blurb ar-hint"><Info size={12} />{providerBlurb(status, hasManualPath)}</p>}

      {children && (
        <div className="ar-manual">
          {configured && (
            <button
              type="button"
              className="ar-manual-toggle"
              aria-expanded={manualOpen}
              onClick={() => setManualOpen((o) => !o)}
            >
              <ChevronDown size={13} className={manualOpen ? 'ar-open' : ''} />
              Do it manually instead — paste into another AI
            </button>
          )}
          {showManual && (
            <div className="ar-manual-body">
              <p className="ar-blurb ar-hint"><Info size={12} />{MANUAL_BLURB}</p>
              {children}
            </div>
          )}
        </div>
      )}

      <style>{`
        .ar-wrap { display: flex; flex-direction: column; gap: 8px; }
        /* Default: button on its own row, notes stacked beneath it. */
        .ar-run-row { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
        .ar-notes { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

        /* Compact (in-item): notes sit to the RIGHT of the button. Six of these
           down a project card stacked vertically is a screenful of the same
           sentence. Wraps under on a narrow column rather than squeezing. */
        .ar-compact .ar-run-row {
          flex-direction: row; align-items: center; gap: 10px; flex-wrap: wrap;
        }
        .ar-compact .ar-notes { flex: 1 1 260px; }
        .ar-compact .ar-blurb { font-size: 11.5px; }
        .ar-run {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 14px; border-radius: var(--r-sm); font-size: 13.5px; font-weight: 600;
          background: var(--accent); color: #fff; border: 1px solid var(--accent);
          cursor: pointer; transition: background .12s, opacity .12s;
        }
        .ar-run:hover:not(:disabled) { background: var(--accent-bright); }
        .ar-run:disabled { opacity: .55; cursor: default; }
        /* Matches the Copy / Draft / Summarize chips beside it, a shade larger
           so it reads as the heavier action of the group. */
        .ar-compact .ar-run {
          padding: 6px 12px; font-size: 12.5px; font-weight: 600;
          background: var(--paper); color: var(--accent);
          border: 1px solid var(--accent);
        }
        .ar-compact .ar-run:hover:not(:disabled) { background: var(--accent-wash); }
        .ar-blurb {
          display: flex; align-items: flex-start; gap: 6px;
          font-size: 12px; line-height: 1.45; margin: 0; color: var(--ink-soft);
        }
        .ar-blurb svg { flex-shrink: 0; margin-top: 2px; }
        .ar-local { color: var(--ok-ink); }
        .ar-remote { color: var(--warn-ink); }
        .ar-err { color: var(--err-ink); }
        .ar-weak { color: var(--warn-ink); }
        .ar-hint { color: var(--ink-faint); }
        .ar-manual { display: flex; flex-direction: column; gap: 8px; }
        .ar-manual-toggle {
          display: inline-flex; align-items: center; gap: 5px; align-self: flex-start;
          background: none; border: none; padding: 2px 0; cursor: pointer;
          font-size: 12.5px; font-weight: 500; color: var(--ink-soft);
        }
        .ar-manual-toggle:hover { color: var(--accent); }
        .ar-manual-toggle .ar-open { transform: rotate(180deg); }
        .ar-manual-body { display: flex; flex-direction: column; gap: 10px; }
        .ar-spin { animation: ar-spin 1s linear infinite; }
        @keyframes ar-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
