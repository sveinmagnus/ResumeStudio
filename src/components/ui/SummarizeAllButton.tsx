import { useState, useMemo, useRef, useCallback } from 'react'
import { Sparkles, Loader2, CircleStop } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useSummarizeAvailable } from '../../store/useTranslation'
import { api } from '../../lib/api'
import {
  emptySummaryTargets, applySummaries, summaryFields, type SummaryResult,
} from '../../lib/summarizeBatch'

/**
 * "Summarize all empty" — the section-level batch version of DualField's
 * per-column Summarize button, sitting in the section bar next to Bulk add.
 *
 * Shown only when a summarize backend is configured AND there is something to
 * fill, with the count in the label. The work list is every (item, visible
 * locale) whose short description is empty but whose long description has text
 * — the same rule the per-field buttons use, so the count can't lie.
 *
 * Requests run SEQUENTIALLY: the first-class backend is a local Ollama, and
 * firing twenty at once would swamp it (each request already has a 45 s server
 * timeout). Results are collected and applied in ONE `replaceData` at the end
 * — including when the run is stopped or hits an error partway, so no
 * completed work is thrown away — which also makes the whole batch a single
 * undo step.
 */
export function SummarizeAllButton({ section }: { section: string }) {
  const data = useStore((s) => s.data)
  const primaryLocale = useStore((s) => s.primaryLocale)
  const secondaryLocale = useStore((s) => s.secondaryLocale)
  const replaceData = useStore((s) => s.replaceData)
  const available = useSummarizeAvailable()

  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)

  // Only the columns on screen — filling a language the user can't see would
  // be a surprise; switching columns and re-running fills the rest.
  const locales = useMemo(
    () => (secondaryLocale ? [primaryLocale, secondaryLocale] : [primaryLocale]),
    [primaryLocale, secondaryLocale],
  )

  const targets = useMemo(
    () => emptySummaryTargets(data, section, locales),
    [data, section, locales],
  )

  const run = useCallback(async () => {
    if (running || targets.length === 0) return
    cancelled.current = false
    setRunning(true)
    setDone(0)
    setError(null)

    const results: SummaryResult[] = []
    let failure: string | null = null
    try {
      for (const t of targets) {
        if (cancelled.current) break
        try {
          const text = await api.summarize(t.source, t.locale)
          if (text.trim()) results.push({ id: t.id, locale: t.locale, text })
        } catch (e) {
          // Stop on the first failure — if the backend is down or the model is
          // gone, the next nineteen calls fail the same way. Keep what landed.
          failure = (e as Error).message || 'Summarize failed'
          break
        }
        setDone((n) => n + 1)
      }
    } finally {
      // Apply once: one undo step, and a stopped/failed run keeps its work.
      // Re-read the store — an edit during the run must not be clobbered.
      if (results.length) {
        replaceData(applySummaries(useStore.getState().data, section, results))
      }
      if (failure) {
        setError(results.length
          ? `${failure} — kept the ${results.length} that succeeded.`
          : failure)
      }
      setRunning(false)
    }
  }, [running, targets, section, replaceData])

  if (!summaryFields(section)) return null
  if (!available) return null
  if (!running && targets.length === 0) return null

  return (
    <>
      <button
        className="sab-btn"
        onClick={running ? () => { cancelled.current = true } : () => void run()}
        title={running
          ? 'Stop after the current one'
          : `Draft a one-line summary from the description for ${targets.length} empty ${
            targets.length === 1 ? 'field' : 'fields'
          } (${locales.map((l) => l.toUpperCase()).join(' + ')}). Review each afterwards.`}
      >
        {running
          ? <><Loader2 size={13} className="sab-spin" /> Summarizing {done + 1} of {targets.length}… <CircleStop size={13} /></>
          : <><Sparkles size={13} /> Summarize all empty ({targets.length})</>}
      </button>
      {error && <span className="sab-error" role="alert">{error}</span>}
      <style>{`
        .sab-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px; border-radius: var(--r-sm);
          border: 1px solid var(--line-strong); background: var(--paper);
          font-size: 12px; font-weight: 600; color: var(--ink-soft);
          transition: color .13s, background .13s, border-color .13s;
        }
        .sab-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
        .sab-spin { animation: sab-rot 1s linear infinite; }
        @keyframes sab-rot { to { transform: rotate(360deg); } }
        .sab-error { font-size: 11.5px; color: var(--err-ink); }
      `}</style>
    </>
  )
}
