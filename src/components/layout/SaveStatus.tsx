import { Check, CloudOff, Loader2, RefreshCw, HardDrive, type LucideIcon } from 'lucide-react'

export type SaveState =
  | 'idle'        // nothing to report
  | 'saving'      // server save in flight
  | 'saved'       // last server save succeeded
  | 'error'       // last server save failed; local cache holds the work
  | 'offline'     // initial server load failed; cache is the source of truth

interface Props {
  state: SaveState
  /** ISO timestamp of the last successful local cache write, for the tooltip. */
  cacheSavedAt?: string | null
  /** Retry the pending save (only shown when state === 'error'). */
  onRetry?: () => void
}

interface Variant {
  icon: LucideIcon
  label: string
  className: string
  spin?: boolean
  tooltip: (cacheNote: string) => string
}

const VARIANTS: Record<Exclude<SaveState, 'idle'>, Variant> = {
  saving:  { icon: Loader2,    label: 'Saving…',     className: 'ss-saving', spin: true,
             tooltip: () => 'Saving to server…' },
  saved:   { icon: Check,      label: 'Saved',       className: 'ss-ok',
             tooltip: () => 'Saved to server' },
  offline: { icon: HardDrive,  label: 'Local only',  className: 'ss-warn',
             tooltip: (n) => `Server unreachable. ${n}` },
  error:   { icon: CloudOff,   label: 'Save failed', className: 'ss-err',
             tooltip: (n) => `Server save failed. ${n}` },
}

export function SaveStatus({ state, cacheSavedAt, onRetry }: Props) {
  if (state === 'idle') return null
  const v = VARIANTS[state]
  const Icon = v.icon
  const cacheNote = cacheSavedAt
    ? `Local backup saved ${new Date(cacheSavedAt).toLocaleTimeString()}.`
    : 'Local backup is up to date.'

  return (
    <span className={`ss ${v.className}`} title={v.tooltip(cacheNote)}>
      <Icon size={13} className={v.spin ? 'ss-spin' : undefined} />
      {v.label}
      {state === 'error' && onRetry && (
        <button className="ss-retry" onClick={onRetry} title="Retry save">
          <RefreshCw size={12} /> Retry
        </button>
      )}
      <Style />
    </span>
  )
}

function Style() {
  return (
    <style>{`
      .ss {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; font-weight: 600;
        padding: 4px 9px; border-radius: 12px;
        animation: fadeIn .2s ease;
      }
      .ss-spin { animation: spin 1s linear infinite; }
      .ss-saving { color: var(--ink-soft); background: var(--paper-sunken); }
      .ss-ok     { color: #27ae60; background: #e8f7ef; }
      .ss-warn   { color: #b87900; background: #fff7e6; }
      .ss-err    { color: #c0392b; background: #fdf0ef; }
      .ss-retry {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 11px; font-weight: 700; color: #c0392b;
        text-decoration: underline; padding: 0 4px; margin-left: 4px;
      }
      .ss-retry:hover { color: #922b21; }
      @keyframes spin { to { transform: rotate(360deg) } }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(2px) } to { opacity: 1; transform: none } }
    `}</style>
  )
}
