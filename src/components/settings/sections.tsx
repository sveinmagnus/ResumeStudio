/**
 * Small settings sections that aren't server settings and so appear on every
 * build (desktop and env-managed alike). Kept together because each is a few
 * lines and neither owns a tab of its own.
 */

import { useState } from 'react'
import { Download, Type } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { downloadBackup } from '../../lib/backup'
import { fontOptions, fontInstallInfo, type GlobalFonts } from '../../lib/fonts'
import { getDefaultFonts, setDefaultFonts } from '../../lib/appPrefs'

/**
 * Download a portable JSON backup of the CURRENT resume. Moved here from the
 * top bar (it's an occasional action, not something done every session).
 * Distinct from the auto-sync backup FOLDER: this is a manual, one-off copy of
 * the open resume that can be re-imported from the picker as a new resume.
 */
export function SaveToFileSection() {
  const resume = useStore((s) => s.data.resume)
  return (
    <section className="sm-sec">
      <div className="sm-sec-head"><Download size={15} /> Save this resume to a file</div>
      <p className="sm-help">
        Download a portable JSON copy of the resume you're editing. Load it later
        from the resume picker — it creates a new resume. This is a manual, one-off
        copy, separate from the auto-synced backup folder.
      </p>
      <div className="sm-btn-row">
        <button
          className="sm-btn"
          onClick={() => downloadBackup(useStore.getState().data)}
          disabled={!resume}
        >
          <Download size={13} /> Save to file
        </button>
      </div>
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
    setDefaultFonts(next) // persists + notifies open previews
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
