import { useCallback, useEffect, useState } from 'react'
import {
  FileText, Plus, Trash2, Loader2, Pencil, Check, X, Settings, CloudOff, Users, Lock,
} from 'lucide-react'
import {
  api, canWriteResume, type MeInfo, type ResumeMeta, type TeamUser,
  UnauthorizedError, ServerError,
} from '../lib/api'
import { fmtBytes, weightLevel, type ResumeStorageStats, type StorageStats } from '../lib/storage'
import { isResumeStale } from '../lib/freshness'
import { fmtRelativeTime, detectLocalesInData } from '../lib/locales'
import { freshStore } from '../lib/freshStore'
import { listDirty, listCached, type CachedResume } from '../lib/localCache'
import { navigate, Link } from '../lib/router'
import { ImportScreen } from './ImportScreen'
import { SyncPanel } from './SyncPanel'
import { WhoKnowsWhatPanel } from './WhoKnowsWhatPanel'
import { SettingsModal } from './SettingsModal'
import { UpdateBanner } from './UpdateBanner'
import { AccountMenu } from './account/AccountMenu'
import { SetupNotice } from './account/SetupNotice'
import { OwnerControl } from './account/OwnerControl'
import { ownerLabel } from './account/owners'
import { confirmDialog } from './ui/ConfirmDialog'
import type { ResumeStore } from '../types'

const YEAR = new Date().getFullYear()

/**
 * Inline payload-weight warning for one picker card. Renders nothing while the
 * resume is under the "large" threshold — the readout is an alert, not a stat
 * the user must parse on every visit.
 */
function WeightNote({ stat }: { stat: ResumeStorageStats | undefined }) {
  if (!stat) return null
  const level = weightLevel(stat.bytes)
  if (level === 'ok') return null
  const detail = stat.image_bytes > 0 ? ` (${fmtBytes(stat.image_bytes)} images)` : ''
  const title = level === 'risk'
    ? 'This resume is approaching the browser’s offline-cache quota (~5 MB) — consider smaller images.'
    : 'This resume’s payload is large — every save re-sends all of it, mostly embedded images.'
  return (
    <span className={level === 'risk' ? 'rl-weight rl-weight-risk' : 'rl-weight'} title={title}>
      {' · '}≈{fmtBytes(stat.bytes)}{detail}
      {/* The tooltip explanation, for keyboard/touch/AT users who never see `title`. */}
      <span className="sr-only"> — {title}</span>
    </span>
  )
}

/**
 * The per-resume sharing control, and the badge that says what the current
 * setting means.
 *
 * The consequence is spelled out rather than left to the word "shared": an
 * instance-visible resume can be READ by every member and written by nobody but
 * its owner (`server/access.ts`). That asymmetry is what makes the switch safe
 * to flip, and it is not something a toggle label conveys on its own.
 *
 * Renders nothing at all where sharing has no meaning: an instance without
 * accounts, a service credential, or a resume this viewer does not own.
 */
function ShareControl({ resume, me, onChanged }: {
  resume: ResumeMeta
  me: MeInfo | null
  onChanged: (visibility: 'private' | 'instance') => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!me || me.service || me.mode !== 'accounts') return null
  // Sharing is the owner's decision, so the control appears only for someone
  // who could also edit the resume.
  if (!canWriteResume(resume, me)) return null

  const shared = resume.visibility === 'instance'

  const toggle = async () => {
    setError('')
    setBusy(true)
    const next = shared ? 'private' : 'instance'
    try {
      await api.setResumeVisibility(resume.id, next)
      onChanged(next)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        className="rl-icon-btn"
        onClick={() => void toggle()}
        disabled={busy}
        title={shared
          ? 'Shared with the team — every member can read it. Click to make it private again.'
          : 'Private to you. Click to let other members read it (they can never edit it).'}
        aria-pressed={shared}
        aria-label={`Share ${resume.name} with the team`}
      >
        {shared ? <Users size={14} /> : <Lock size={14} />}
      </button>
      {error && <span role="alert" className="sr-only">{error}</span>}
    </>
  )
}

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
  const [showSettings, setShowSettings] = useState(false)
  // Bumped after a settings change so the SyncPanel remounts and re-reads the
  // (possibly newly-configured) backup folder status.
  const [syncRefreshKey, setSyncRefreshKey] = useState(0)
  // Ids with unsynced local edits — read once on mount (the queue only changes
  // from the editor, which isn't mounted while the picker is shown).
  const [dirtyIds] = useState<Set<string>>(() => new Set(listDirty().map((d) => d.id)))
  // The running app version, shown in the footer. From the update status
  // endpoint (never throws); hidden when unknown ('0.0.0').
  const [appVersion, setAppVersion] = useState<string | null>(null)
  // Payload-weight readout (never throws; null = unavailable, readout hidden).
  const [storage, setStorage] = useState<StorageStats | null>(null)
  // Locally cached resumes, shown ONLY when the server could not answer. Null
  // whenever the server did, so a cache that exists never dilutes the truth.
  const [cached, setCached] = useState<CachedResume[] | null>(null)
  // Who is looking — decides whether a row is theirs to share, and whether a
  // colleague's shared CV is marked as read-only before it is opened. Null on
  // an instance without accounts, which is every desktop build.
  const [me, setMe] = useState<MeInfo | null>(null)
  // The accounts an owner can hand a resume to. Null wherever ownership has no
  // meaning (no accounts) or the list can't be had (a member — /api/users 403s),
  // and that null is what hides the owner readout and the transfer control.
  const [owners, setOwners] = useState<TeamUser[] | null>(null)

  const reload = useCallback(() => {
    setError(null)
    api.listResumes()
      .then((list) => { setItems(list); setCached(null) })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) { onUnauthorized(); return }
        const local = listCached()
        setCached(local.length > 0 ? local : null)
        // With cached copies on screen the offline banner already answers "is
        // the server reachable?"; the error is what's left when there is
        // nothing at all to show.
        setError(local.length > 0 ? null : 'Could not load your resumes. Is the server reachable?')
        setItems([])
      })
  }, [onUnauthorized])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    api.updateStatus()
      .then((s) => setAppVersion(
        s.versionLabel || (s.currentVersion && s.currentVersion !== '0.0.0' ? `v${s.currentVersion}` : null),
      ))
      .catch(() => setAppVersion(null))
  }, [])

  useEffect(() => {
    void api.storageStats().then(setStorage)
  }, [])

  useEffect(() => {
    let cancelled = false
    void api.me().then((m) => { if (!cancelled) setMe(m) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (me?.mode !== 'accounts' || me.role !== 'owner') return
    let cancelled = false
    api.listUsers()
      .then((u) => { if (!cancelled) setOwners(u) })
      .catch(() => { if (!cancelled) setOwners(null) })
    return () => { cancelled = true }
  }, [me])

  const statsById = new Map<string, ResumeStorageStats>(
    (storage?.resumes ?? []).map((s) => [s.id, s]),
  )

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

  // A backup that carried resume ids was merged server-side — nothing to create
  // and nowhere to navigate to; just show the picker's new truth.
  const onRestored = useCallback(() => {
    setShowAdd(false)
    reload()
  }, [reload])

  const onDelete = useCallback(async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `Delete "${name}"?`,
      message: 'This deletes the resume and all its snapshots. Export a backup first if unsure. This cannot be undone.',
      confirmLabel: 'Delete', danger: true,
    })
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
    if (!name || name === prev) return
    setItems((curr) => curr?.map((r) => (r.id === id ? { ...r, name } : r)) ?? [])
    try {
      await api.patchResume(id, { name })
    } catch (err) {
      if (err instanceof UnauthorizedError) { onUnauthorized(); return }
      setError(`Could not rename: ${(err as Error).message}`)
      // Revert the optimistic rename to the server's truth.
      reload()
    }
  }, [draftName, items, onUnauthorized, reload])

  const onSettingsChanged = useCallback(() => {
    // Remounts SyncPanel so it re-reads sync status.
    setSyncRefreshKey((k) => k + 1)
    reload()
  }, [reload])

  // Settings gear + modal — rendered in every non-loading picker state so the
  // user can configure translation / the sync folder even with zero resumes.
  const settingsOverlay = (
    <>
      <button
        className="rl-settings-fab"
        onClick={() => setShowSettings(true)}
        title="Settings"
        aria-label="Settings"
      >
        <Settings size={18} />
      </button>
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onChanged={onSettingsChanged}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  )

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

  // Empty → full-bleed import screen. The backup panel renders above it (null
  // unless a folder is configured), so a freshly-set-up second machine can pull
  // its resumes from the folder.
  if (items.length === 0 && !error && !cached) {
    return (
      <>
        {settingsOverlay}
        <div className="rl-prelude">
          {/* A fresh instance has no resumes, so this branch is exactly where a
              first-time operator lands — and where these most need to be. An
              owner who has just finished setup, and a member who has just
              accepted an invite, both arrive here: without the menu they had no
              "signed in as" and no way to sign out. */}
          <SetupNotice />
          <div className="rl-prelude-account"><AccountMenu /></div>
          <UpdateBanner onUnauthorized={onUnauthorized} />
        </div>
        <SyncPanel key={syncRefreshKey} standalone onRestored={reload} onUnauthorized={onUnauthorized} />
        <ImportScreen onStartFresh={onStartFresh} onImported={onImported} onRestored={onRestored} />
        <style>{`
          .rl-prelude { max-width: 720px; margin: 40px auto 0; width: calc(100% - 80px); }
          .rl-prelude-account { display: flex; justify-content: flex-end; margin-bottom: 12px; }
          .rl-prelude-account:empty { display: none; }
          .rl-prelude .ub-banner { margin-bottom: 0; }
        `}</style>
      </>
    )
  }

  return (
    <div className="rl-screen">
      {settingsOverlay}
      <div className="rl-wrap">
        <SetupNotice />
        <header className="rl-head">
          <div className="rl-brand">
            <img src="/cartavio-symbol.png" alt="Cartavio" className="rl-symbol" />
            <h1 className="rl-title">Your resumes</h1>
          </div>
          <div className="rl-head-actions">
            <AccountMenu />
            {/* Creating a resume is a POST. Hidden rather than disabled offline,
                as everywhere else a backend is missing. */}
            {!cached && (
              <button className="rl-add" onClick={() => setShowAdd((v) => !v)}>
                <Plus size={16} /> {showAdd ? 'Cancel' : 'Add resume'}
              </button>
            )}
          </div>
        </header>

        {error && <div className="rl-error" role="alert">{error}</div>}

        <UpdateBanner onUnauthorized={onUnauthorized} />

        <SyncPanel key={syncRefreshKey} onRestored={reload} onUnauthorized={onUnauthorized} />

        {dirtyIds.size > 0 && (
          <div className="rl-unsynced-note" role="status">
            {dirtyIds.size} resume{dirtyIds.size > 1 ? 's have' : ' has'} unsynced changes —
            they'll sync next time you open {dirtyIds.size > 1 ? 'them' : 'it'} online.
          </div>
        )}

        {cached && (
          <>
            <div className="rl-offline-note" role="status">
              <CloudOff size={15} aria-hidden="true" />
              <span>
                The server is unreachable. {cached.length === 1
                  ? 'One copy is'
                  : `${cached.length} copies are`}
                {' '}stored in this browser and may be behind the server. Editing still works and
                queues until it is back; renaming, deleting, creating and exporting need it now.
              </span>
            </div>
            <ul className="rl-list">
              {cached.map((c) => (
                <li key={c.id} className="rl-row">
                  <Link to={{ name: 'editor', id: c.id }} className="rl-link">
                    <div className="rl-icon rl-icon-offline"><CloudOff size={18} /></div>
                    <div className="rl-info">
                      <div className="rl-name">
                        {c.name ?? 'Untitled resume'}
                        <span className="rl-offline-tag">Offline copy</span>
                      </div>
                      <div className="rl-meta">
                        {c.dirty ? 'Unsynced changes' : `Cached ${fmtRelativeTime(c.saved_at)}`}
                        {' · '}
                        {c.locales.primary.toUpperCase()}
                        {c.locales.secondary && ` / ${c.locales.secondary.toUpperCase()}`}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {showAdd && (
          <div className="rl-add-panel">
            <ImportScreen compact onStartFresh={onStartFresh} onImported={onImported} onRestored={onRestored} />
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
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- appears only after the user clicks the edit affordance; not focusing what they just asked for costs a keystroke
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
                      {/* Say it before it is opened: an editor that silently
                          refuses everything typed into it is worse found out
                          than announced. */}
                      {!canWriteResume(r, me) && (
                        <span className="rl-share-tag rl-share-theirs">Shared with you · read only</span>
                      )}
                      {canWriteResume(r, me) && r.visibility === 'instance' && (
                        <span className="rl-share-tag">Shared with the team</span>
                      )}
                    </div>
                    <div className="rl-meta">
                      {dirtyIds.has(r.id)
                        ? 'Unsynced changes'
                        : `Last saved ${fmtRelativeTime(r.saved_at)}${r.saved_by ? ` by ${r.saved_by}` : ''}`}
                      {' · '}
                      {r.primary_locale.toUpperCase()}
                      {r.secondary_locale && ` / ${r.secondary_locale.toUpperCase()}`}
                      {owners && (
                        <span className={r.owner_id ? undefined : 'rl-unowned'}>
                          {' · '}
                          {r.owner_id ? `Owned by ${ownerLabel(r.owner_id, owners)}` : 'Unowned'}
                        </span>
                      )}
                      <WeightNote stat={statsById.get(r.id)} />
                      {!dirtyIds.has(r.id) && isResumeStale(r.saved_at) && (
                        <span className="rl-stale" title="Not updated in over 6 months — may be worth a review">
                          {' · '}needs review
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )}
              {editingId !== r.id && (
                <div className="rl-actions">
                  <ShareControl
                    resume={r}
                    me={me}
                    onChanged={(visibility) => setItems((curr) =>
                      curr?.map((x) => (x.id === r.id ? { ...x, visibility } : x)) ?? [])}
                  />
                  {owners && (
                    <OwnerControl
                      resume={r}
                      users={owners}
                      onChanged={(owner_id) => setItems((curr) =>
                        curr?.map((x) => (x.id === r.id ? { ...x, owner_id } : x)) ?? [])}
                    />
                  )}
                  {/* Renaming and deleting a colleague's shared CV are refused
                      server-side as "not found", so offering them would only
                      produce an error that reads as data loss. */}
                  {canWriteResume(r, me) && (
                    <>
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
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <WhoKnowsWhatPanel items={items} onUnauthorized={onUnauthorized} />
      </div>

      <footer className="rl-page-footer">
        <span>© {YEAR} Cartavio AS</span>
        <span className="rl-footer-dot">·</span>
        <a href="https://cartavio.no" target="_blank" rel="noopener noreferrer">cartavio.no</a>
        {appVersion && (
          <>
            <span className="rl-footer-dot">·</span>
            <span title="Installed version">{appVersion}</span>
          </>
        )}
        {storage && (
          <>
            <span className="rl-footer-dot">·</span>
            <span title="Server database size (resumes + snapshot history)">
              DB {fmtBytes(storage.db_bytes)}
            </span>
          </>
        )}
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
        .rl-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
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

        .rl-settings-fab {
          position: fixed; top: 18px; right: 18px; z-index: 20;
          display: grid; place-items: center; width: 38px; height: 38px;
          border-radius: var(--r-md); background: var(--paper-raised);
          border: 1px solid var(--line); color: var(--ink-soft);
          box-shadow: var(--shadow-sm);
          transition: color .12s, border-color .12s;
        }
        .rl-settings-fab:hover { color: var(--accent); border-color: var(--accent); }

        .rl-error {
          margin-bottom: 16px; padding: 10px 14px;
          background: var(--err-wash); color: var(--err-ink);
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
        .rl-weight { color: var(--warn-ink); }
        .rl-weight-risk { color: var(--err-ink); font-weight: 600; }
        .rl-stale { color: var(--warn-ink); }
        /* Unowned is a state with consequences (owner-role accounts only), not
           a missing value, so it doesn't read as absence. */
        .rl-unowned { color: var(--warn-ink); }
        .rl-unsynced-note {
          margin-bottom: 16px; padding: 9px 14px; font-size: 12.5px;
          background: var(--warn-wash); color: var(--warn-ink); border-radius: var(--r-sm);
        }
        .rl-offline-note {
          display: flex; align-items: flex-start; gap: 9px;
          margin-bottom: 16px; padding: 10px 14px; font-size: 12.5px; line-height: 1.5;
          background: var(--warn-wash); color: var(--warn-ink); border-radius: var(--r-sm);
        }
        .rl-offline-note svg { flex-shrink: 0; margin-top: 2px; }
        .rl-icon-offline { background: var(--warn-wash); color: var(--warn-ink); }
        .rl-offline-tag {
          margin-left: 8px; padding: 1px 7px; flex-shrink: 0;
          border-radius: 999px; font-size: 11px; font-weight: 600;
          background: var(--warn-wash); color: var(--warn-ink);
        }
        .rl-share-tag {
          margin-left: 8px; padding: 1px 7px; flex-shrink: 0;
          border-radius: 999px; font-size: 11px; font-weight: 600;
          background: var(--accent-wash); color: var(--accent);
        }
        .rl-share-theirs { background: var(--paper-sunken); color: var(--ink-soft); }
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
