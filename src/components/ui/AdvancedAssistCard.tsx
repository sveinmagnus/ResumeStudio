/**
 * The shell every ADVANCED assist renders inside, and the ONE place the
 * high-end gate is applied on the client.
 *
 * It renders nothing at all when the configured model isn't declared high-end —
 * the same rule the rest of the AI surface already follows (no model, no
 * buttons). A disabled control would be worse: it advertises a feature while
 * refusing it, and the fix lives three screens away in Settings.
 *
 * The gate is checked here rather than in each advisor because seven copies of
 * "should this be visible?" is seven chances for one of them to be wrong, and
 * the wrong direction — showing a whole-CV review to a 3B model — produces
 * fluent, confident, wrong advice rather than an error the user would notice.
 * The server enforces the same flag independently (see routes/llm.ts).
 */

import { useSyncExternalStore, type ReactNode } from 'react'
import { Gauge } from 'lucide-react'
import { assistStatusSnapshot, subscribeAssistStatus } from '../../lib/llmClient'
import { supportsAdvanced } from '../../lib/llmAssist'
import type { AssistStatus } from '../../lib/api'

/**
 * The live backend status. Subscribed rather than fetched-once, so saving a
 * model or ticking "high-end" lights the AI surfaces up in place instead of
 * waiting for a remount.
 */
export function useAssistStatus(): AssistStatus {
  return useSyncExternalStore(subscribeAssistStatus, assistStatusSnapshot, assistStatusSnapshot)
}

/**
 * Resolve whether the advanced assists are available. Shared so a page can hide
 * a whole section (heading and all) rather than leave an empty frame.
 */
export function useAdvancedAssist(): { loaded: boolean; enabled: boolean; status: AssistStatus } {
  const status = useAssistStatus()
  // `configured` is the probe's own signal that it has answered — an
  // unconfigured backend and an unprobed one look the same and are treated the
  // same, which is the right (closed) default either way.
  return { loaded: true, enabled: supportsAdvanced(status), status }
}

interface Props {
  title: string
  icon: ReactNode
  /** One or two sentences on what this pass does — shown above the Run button. */
  blurb: ReactNode
  children: ReactNode
}

export function AdvancedAssistCard({ title, icon, blurb, children }: Props) {
  const { enabled } = useAdvancedAssist()
  if (!enabled) return null

  return (
    <section className="aac">
      <h3 className="aac-head">
        {icon} {title}
        <span className="aac-badge" title="Available because your model is marked high-end in Settings">
          <Gauge size={11} /> high-end
        </span>
      </h3>
      <p className="aac-blurb">{blurb}</p>
      {children}

      <style>{`
        .aac {
          display: flex; flex-direction: column; gap: 10px;
          padding: 14px; border: 1px solid var(--secondary-line); border-radius: var(--r-md);
          background: var(--paper-raised);
        }
        .aac-head {
          display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
          margin: 0; font-family: var(--serif); font-size: 16px; font-weight: 400; color: var(--ink);
        }
        .aac-head svg { color: var(--secondary-ink); flex-shrink: 0; }
        .aac-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
          font-family: var(--sans);
          color: var(--secondary-ink-text); background: var(--secondary-tint);
          border: 1px solid var(--secondary-line);
        }
        .aac-blurb { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
      `}</style>
    </section>
  )
}
