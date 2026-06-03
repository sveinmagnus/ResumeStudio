import { useCallback, useEffect, useState } from 'react'
import { FileText, Plus, Trash2, Loader2, Pencil, Check, X } from 'lucide-react'
import { api, type ResumeMeta, UnauthorizedError, ServerError } from '../lib/api'
import { fmtRelativeTime, detectLocalesInData } from '../lib/locales'
import { freshStore } from '../lib/freshStore'
import { listDirty } from '../lib/localCache'
import { navigate, Link } from '../lib/router'
import { ImportScreen } from './ImportScreen'
import type { ResumeStore } from '../types'

const YEAR = new Date().getFullYear()

interface ResumeListProps {
  onUnauthorized: () => void
}

/**
 * Picker route (`/`): list of resumes + "Add resume" affordance. On an empty
 * list the picker mounts the import screen full-bleed instead. Owns the
 * create flow: POST /api/resumes → navigate(/r/:id).
 */
export function ResumeList({ onUnauthorized }: ResumeListProps) {
  const [items, setItems] = useState<ResumeMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  // Ids with unsynced local edits — read once on mount (the queue only changes
  // from the editor, which isn't mounted while the picker is shown).
  const [dirtyIds] = useState<Set<string>>(() => new Set(listDirty().map((d) => d.id)))

  const reload = useCallback(() => {
    setError(null)
    api.listResumes()
      .then(setItems)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) { onUnauthorized(); return }
        setError('Could not load your resumes. Is the server reachable?')
        setItems([])
      })
  }, [onUnauthorized])

  useEffect(() => { reload() }, [reload])

  // ── Create flow: store → API → navigate ────────────────────────────────
  const create = useCallback(async (name: string, data: ResumeStore) => {
    // Pick sensible default locales from the imported data. The user can
    // change them inside the editor.
    const detected = detectLocalesInData(data)
    const supported = data.resume?.supported_locales ?? []
    const all = Array.from(new Set([...supported, ...detected, 'en']))
    const primary = all.includes('no') ? 'no' : (all[0] ?? 'en')
    const secondary = all.includes('en') && primary !== 'en'
      ? 'en'
      : (all.find((l) => l !== primary) ?? null)
    try {
      const meta = await api.createResume({
        name, data,
        primary_locale: primary, secondary_locale: secondary,
      })
      navigate({ name: 'editor', id: meta.id })
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return }
      const msg = err instanceof ServerError ? err.message : (err as Error).message
      setError(`Could not create the resume: ${msg}`)
    }
  }, [onUnauthorized])

  const onStartFresh = useCallback(async () => {
    await create('My resume', freshStore())
  }, [create])

  const onImported = useCallback(async (store: ResumeStore, suggested: string) => {
    await create(suggested, store)
  }, [create])

  const onDelete = useCallback(async (id: string, name: string) => {
    const ok = window.confirm(
      `Delete "${name}"?\n\nThis deletes all snapshots too — export a backup first if unsure.\nThis cannot be undone.`
    )
    if (!ok) return
    setDeleting(id)
    try {
      await api.deleteResume(id)
      setItems((curr) => curr?.filter((r) => r.id !== id) ?? [])
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return }
      setError(`Could not delete: ${(err as Error).message}`)
    } finally {
      setDeleting(null)
    }
  }, [onUnauthorized])

  // ── Rename flow: inline edit → PATCH (optimistic, revert on failure) ─────
  const startRename = useCallback((r: ResumeMeta) => {
    setError(null)
    setEditingId(r.id)
    setDraftName(r.name)
  }, [])

  const commitRename = useCallback(async (id: string) => {
    const name = draftName.trim()
    const prev = items?.find((r) => r.id === id)?.name
    setEditingId(null)
    if (!name || name === prev) return // empty or unchanged → no-op
    setItems((curr) => curr?.map((r) => (r.id === id ? { ...r, name } : r)) ?? [])
    try {
      await api.patchResume(id, { name })
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return }
      setError(`Could not rename: ${(err as Error).message}`)
      reload() // revert to the server's truth
    }
  }, [draftName, items, onUnauthorized, reload])

  // ── Render states ──────────────────────────────────────────────────────

  if (items === null) {
    return (
      <div className="rl-loading">
        <Loader2 size={20} className="rl-spin" />
        <span>Loading your resumes…</span>
        <style>{`
          .rl-loading {
            min-height: 100vh; display: flex; align-items: center;
            justify-content: center; gap: 10px;
            color: var(--ink-faint); font-size: 14px;
          }
          .rl-spin { animation: rl-spin 1s linear infinite; }
          @keyframes rl-spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    )
  }

  // Empty → full-bleed import screen.
  if (items.length === 0 && !error) {
    return <ImportScreen onStartFresh={onStartFresh} onImported={onImported} />
  }

  return (
    <div className="rl-screen">
      <div className="rl-wrap">
        <header className="rl-head">
          <div className="rl-brand">
            <img src="/cartavio-symbol.png" alt="Cartavio" className="rl-symbol" />
            <h1 className="rl-title">Your resumes</h1>
          </div>
          <button className="rl-add" onClick={() => setShowAdd((v) => !v)}>
            <Plus size={16} /> {showAdd ? 'Cancel' : 'Add resume'}
          </button>
        </header>

        {error && <div className="rl-error">{error}</div>}

        {dirtyIds.size > 0 && (
          <div className="rl-unsynced-note">
            {dirtyIds.size} resume{dirtyIds.size > 1 ? 's have' : ' has'} unsynced changes —
            they'll sync next time you open {dirtyIds.size > 1 ? 'them' : 'it'} online.
          </div>
        )}

        {showAdd && (
          <div className="rl-add-panel">
            <ImportScreen compact onStartFresh={onStartFresh} onImported={onImported} />
          </div>
        )}

        <ul className="rl-list">
          {items.map((r) => (
            <li key={r.id} className="rl-row">
              {editingId === r.id ? (
                <div className="rl-link rl-editing">
                  <div className="rl-icon"><FileText size={18} /></div>
                  <input
                    className="rl-rename-input"
                    value={draftName}
                    autoFocus
                    aria-label="Resume name"
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(r.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    onBlur={() => void commitRename(r.id)}
                  />
                  <button className="rl-icon-btn" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void commitRename(r.id)} title="Save name" aria-label="Save name">
                    <Check size={15} />
                  </button>
                  <button className="rl-icon-btn" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setEditingId(null)} title="Cancel" aria-label="Cancel rename">
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <Link to={{ name: 'editor', id: r.id }} className="rl-link">
                  <div className="rl-icon"><FileText size={18} /></div>
                  <div className="rl-info">
                    <div className="rl-name">
                      {r.name}
                      {dirtyIds.has(r.id) && (
                        <span className="rl-unsynced-dot" title="Has unsynced local changes" aria-label="unsynced" />
                      )}
                    </div>
                    <div className="rl-meta">
                      {dirtyIds.has(r.id)
                        ? 'Unsynced changes'
                        : `Last saved ${fmtRelativeTime(r.saved_at)}`}
                      {' · '}
                      {r.primary_locale.toUpperCase()}
                      {r.secondary_locale && ` / ${r.secondary_locale.toUpperCase()}`}
                    </div>
                  </div>
                </Link>
              )}
              {editingId !== r.id && (
                <div className="rl-actions">
                  <button
                    className="rl-icon-btn"
                    onClick={() => startRename(r)}
                    title="Rename this resume"
                    aria-label={`Rename ${r.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="rl-del"
                    onClick={() => void onDelete(r.id, r.name)}
                    disabled={deleting !== null}
                    title="Delete this resume"
                    aria-label={`Delete ${r.name}`}
                  >
                    {deleting === r.id
                      ? <Loader2 size={14} className="rl-spin" />
                      : <Trash2 size={14} />}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <footer className="rl-page-footer">
        <span>© {YEAR} Cartavio AS</span>
        <span className="rl-footer-dot">·</span>
        <a href="https://cartavio.no" target="_blank" rel="noopener noreferrer">cartavio.no</a>
      </footer>

      <style>{`
        .rl-screen {
          min-height: 100vh; padding: 60px 40px 80px;
          display: flex; flex-direction: column; align-items: center;
        }
        .rl-wrap { width: 100%; max-width: 720px; }
        .rl-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; margin-bottom: 28px;
        }
        .rl-brand { display: flex; align-items: center; gap: 14px; }
        .rl-symbol { width: 38px; height: 38px; object-fit: contain; }
        .rl-title { font-size: 28px; color: var(--accent); letter-spacing: -.005em; }

        .rl-add {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 16px; border-radius: var(--r-md);
          background: var(--accent); color: #fff;
          font-weight: 600; font-size: 13px;
          transition: background .15s;
        }
        .rl-add:hover { background: var(--accent-bright); }

        .rl-error {
          margin-bottom: 16px; padding: 10px 14px;
          background: #fef2f2; color: #b91c1c;
          border-radius: var(--r-sm); font-size: 13px;
        }

        .rl-add-panel {
          margin-bottom: 28px; padding: 20px;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-lg);
        }

        .rl-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
        .rl-row {
          display: flex; align-items: stretch;
          background: var(--paper-raised);
          border: 1px solid var(--line); border-radius: var(--r-md);
          transition: border-color .12s, transform .12s;
        }
        .rl-row:hover { border-color: var(--accent); }
        .rl-link {
          display: flex; align-items: center; gap: 14px; flex: 1;
          padding: 14px 18px; text-decoration: none; color: inherit;
          min-width: 0;
        }
        .rl-icon {
          display: grid; place-items: center; width: 40px; height: 40px;
          background: var(--accent-wash); color: var(--accent); border-radius: var(--r-sm);
          flex-shrink: 0;
        }
        .rl-info { min-width: 0; flex: 1; }
        .rl-name { font-size: 15px; font-weight: 600; color: var(--ink);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          display: flex; align-items: center; }
        .rl-unsynced-dot {
          display: inline-block; width: 8px; height: 8px; margin-left: 8px;
          border-radius: 50%; background: #b87900; flex-shrink: 0;
        }
        .rl-meta { font-size: 12px; color: var(--ink-faint); margin-top: 2px; }
        .rl-unsynced-note {
          margin-bottom: 16px; padding: 9px 14px; font-size: 12.5px;
          background: #fff7e6; color: #b87900; border-radius: var(--r-sm);
        }
        .rl-actions { display: flex; align-items: stretch; }
        .rl-icon-btn {
          display: grid; place-items: center; width: 40px;
          color: var(--ink-faint); transition: color .12s, background .12s;
        }
        .rl-icon-btn:hover { color: var(--accent); background: var(--accent-wash); }
        .rl-editing { gap: 10px; }
        .rl-rename-input {
          flex: 1; min-width: 0; font-size: 15px; font-weight: 600;
          padding: 6px 10px; border: 1.5px solid var(--accent);
          border-radius: var(--r-sm); background: var(--paper); color: var(--ink);
        }
        .rl-del {
          display: grid; place-items: center; width: 44px;
          color: var(--ink-faint); border-left: 1px solid var(--line);
          transition: color .12s, background .12s;
          border-top-right-radius: var(--r-md);
          border-bottom-right-radius: var(--r-md);
        }
        .rl-del:hover:not(:disabled) {
          color: #b91c1c; background: #fef2f2;
        }
        .rl-del:disabled { opacity: .4; cursor: default; }

        .rl-spin { animation: rl-spin 1s linear infinite; }
        @keyframes rl-spin { to { transform: rotate(360deg); } }

        .rl-page-footer {
          position: fixed; bottom: 0; left: 0; right: 0;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 12px 24px; font-size: 11px; color: var(--ink-faint);
          background: linear-gradient(to top, var(--paper) 70%, transparent);
          pointer-events: none;
        }
        .rl-page-footer a {
          color: var(--ink-faint); text-decoration: none; pointer-events: all;
          transition: color .15s;
        }
        .rl-page-footer a:hover { color: var(--accent); }
        .rl-footer-dot { opacity: .5; }
      `}</style>
    </div>
  )
}
