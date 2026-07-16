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

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Sparkles, Loader2, AlertTriangle, Info, ShieldCheck, ChevronDown } from 'lucide-react'
import { api, type AssistStatus, ASSIST_OFF } from '../../lib/api'
import { getAssistStatus } from '../../lib/summarizeClient'
import { providerBlurb, sizeHint, isRemote, MANUAL_BLURB } from '../../lib/llmAssist'
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
  /** Built lazily — only when the user actually runs (or reveals the manual path). */
  buildPrompt: () => string
  /** The model's raw reply. The caller validates it exactly as it validates a paste. */
  onResult: (text: string) => void
  /** True when the prompt carries the whole CV — gates the once-per-session confirm. */
  wholeCv?: boolean
  disabled?: boolean
  /** Verb on the button, e.g. "Tailor this view". */
  label?: string
  /** Max reply tokens, for tasks that return a lot (a full CV import). */
  maxTokens?: number
  /** The caller's existing copy/paste steps, revealed by "do it manually". */
  children?: ReactNode
}

export function AssistRun({
  buildPrompt, onResult, wholeCv = false, disabled = false,
  label = 'Run with my AI', maxTokens, children,
}: Props) {
  const [status, setStatus] = useState<AssistStatus>(ASSIST_OFF)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Manual is the only path with no model, so it starts open in that case.
  const [manualOpen, setManualOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void getAssistStatus().then((s) => { if (alive) { setStatus(s); setLoaded(true) } })
    return () => { alive = false }
  }, [])

  const run = useCallback(async () => {
    setErr(null)
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

    setBusy(true)
    try {
      onResult(await api.llmComplete(prompt, maxTokens))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [buildPrompt, onResult, wholeCv, status, maxTokens])

  // Don't flash the manual-only state before the probe lands.
  if (!loaded) return null

  const configured = status.configured
  const hint = configured ? sizeHint(buildPrompt().length, status) : null
  const remote = isRemote(status)
  const showManual = !configured || manualOpen

  return (
    <div className="ar-wrap">
      {configured && (
        <>
          <div className="ar-run-row">
            <button className="ar-run" onClick={() => void run()} disabled={disabled || busy}>
              {busy ? <Loader2 size={14} className="ar-spin" /> : <Sparkles size={14} />}
              {busy ? 'Working…' : `${label}${status.model ? ` (${status.model})` : ''}`}
            </button>
          </div>

          <p className={`ar-blurb ${remote ? 'ar-remote' : 'ar-local'}`}>
            {remote ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
            {providerBlurb(status)}
          </p>

          {hint && <p className="ar-blurb ar-hint"><Info size={12} />{hint}</p>}
          {err && <p className="ar-blurb ar-err" role="alert"><AlertTriangle size={12} />{err}</p>}
        </>
      )}

      {!configured && <p className="ar-blurb ar-hint"><Info size={12} />{providerBlurb(status)}</p>}

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
        .ar-run-row { display: flex; }
        .ar-run {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 14px; border-radius: var(--r-sm); font-size: 13.5px; font-weight: 600;
          background: var(--accent); color: #fff; border: 1px solid var(--accent);
          cursor: pointer; transition: background .12s, opacity .12s;
        }
        .ar-run:hover:not(:disabled) { background: var(--accent-bright); }
        .ar-run:disabled { opacity: .55; cursor: default; }
        .ar-blurb {
          display: flex; align-items: flex-start; gap: 6px;
          font-size: 12px; line-height: 1.45; margin: 0; color: var(--ink-soft);
        }
        .ar-blurb svg { flex-shrink: 0; margin-top: 2px; }
        .ar-local { color: var(--ok-ink); }
        .ar-remote { color: var(--warn-ink); }
        .ar-err { color: var(--err-ink); }
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
