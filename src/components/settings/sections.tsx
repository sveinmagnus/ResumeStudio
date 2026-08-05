/**
 * Small settings sections that aren't server settings and so appear on every
 * build (desktop and env-managed alike). Kept together because each is a few
 * lines and neither owns a tab of its own.
 */

import { useState } from 'react'
import { Download, Type, Archive, Loader2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { downloadBackup } from '../../lib/backup'
import { api, UnauthorizedError } from '../../lib/api'
import { fontOptions, fontInstallInfo, type GlobalFonts } from '../../lib/fonts'
import { getDefaultFonts, setDefaultFonts } from '../../lib/appPrefs'

/**
 * The two manual backup actions, which answer different questions.
 *
 * "Save this resume" is a COPY tool: one JSON of the open resume, no identity,
 * re-importing it creates a new resume. That's the point — it's how you fork a
 * CV or hand one to someone.
 *
 * "Export all resumes" is the BACKUP: a zip holding one file per resume plus the
 * shared registry, in exactly the layout the sync folder uses. Each person is
 * their own file inside it, so a single CV can be pulled out (or a single
 * person's data deleted) without touching anyone else's — the erasure story that
 * a single combined file made impossible. Re-importing it merges by resume id,
 * so it restores your resumes rather than duplicating them.
 */
export function SaveToFileSection() {
  const resume = useStore((s) => s.data.resume)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const exportAll = async () => {
    setBusy(true); setErr(null)
    try {
      await api.exportBackupZip()
    } catch (e) {
      setErr(e instanceof UnauthorizedError ? 'Your session expired — reload and try again.' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sm-sec">
      <div className="sm-sec-head"><Download size={15} /> Backup &amp; export</div>
      <p className="sm-help">
        <strong>Export all resumes</strong> downloads a .zip holding one file per
        resume plus the shared skill/role registry — the same layout as the sync
        folder, so a single person's CV can be lifted out or removed on its own.
        Import it from the resume picker to restore: resumes are matched by
        identity and updated in place, never duplicated.
      </p>
      <div className="sm-btn-row">
        <button className="sm-btn" onClick={() => void exportAll()} disabled={busy}>
          {busy ? <Loader2 size={13} className="sm-spin" /> : <Archive size={13} />}
          Export all resumes (.zip)
        </button>
      </div>
      {err && <div className="sm-msg sm-err" role="alert">{err}</div>}

      <p className="sm-help" style={{ marginTop: 14 }}>
        <strong>Save this resume</strong> downloads a portable JSON copy of the
        resume you're editing. Loading it from the picker creates a <em>new</em>
        {' '}resume — it's a way to fork or hand over one CV, not a backup.
      </p>
      <div className="sm-btn-row">
        <button
          className="sm-btn"
          onClick={() => void downloadBackup(useStore.getState().data)}
          disabled={!resume}
        >
          <Download size={13} /> Save this resume to a file
        </button>
      </div>

      <style>{`
        .sm-spin { animation: sm-spin 1s linear infinite; }
        @keyframes sm-spin { to { transform: rotate(360deg); } }
      `}</style>
    </section>
  )
}

/**
 * App-wide default fonts new views inherit (client preference, localStorage —
 * see lib/appPrefs). A view can still override in its own styling. Shown on
 * every build since it isn't a server/env setting.
 */
export function DefaultFontsSection() {
  const [fonts, setFonts] = useState<GlobalFonts>(getDefaultFonts)
  const opts = fontOptions()
  const update = (patch: Partial<GlobalFonts>) => {
    const next = { ...fonts, ...patch }
    setFonts(next)
    // Persists to appPrefs AND notifies any open preview panes.
    setDefaultFonts(next)
  }
  const seen = new Set<string>()
  const installs = [fontInstallInfo(fonts.heading), fontInstallInfo(fonts.body)]
    .filter((x): x is { label: string; url: string } => !!x && !seen.has(x.url) && (seen.add(x.url), true))
  return (
    <section className="sm-sec">
      <div className="sm-sec-head"><Type size={15} /> Default fonts</div>
      <p className="sm-help">
        The heading and body fonts new resume views inherit. Any view can override
        these in its own styling. Fonts render on-screen and in PDF; Word matches
        only if the reader has the font — install links appear when needed.
      </p>
      <label className="sm-field-label" htmlFor="sm-heading-font">Heading font</label>
      <select id="sm-heading-font" className="sm-input" value={fonts.heading}
        onChange={(e) => update({ heading: e.target.value })} aria-label="Default heading font">
        {opts.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      <label className="sm-field-label" htmlFor="sm-body-font" style={{ marginTop: 8 }}>Body font</label>
      <select id="sm-body-font" className="sm-input" value={fonts.body}
        onChange={(e) => update({ body: e.target.value })} aria-label="Default body font">
        {opts.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      {installs.map((f) => (
        <a key={f.url} className="sm-inline sm-fontlink" href={f.url} target="_blank" rel="noopener noreferrer">
          <Download size={13} /> Install “{f.label}” so Word/PDF match
        </a>
      ))}
    </section>
  )
}
