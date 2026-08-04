/**
 * Sync & backup — the cloud-synced folder (desktop only; it's a server setting)
 * plus the always-available one-off "save this resume to a file".
 *
 * Two different backup concepts share this tab because that's how a user thinks
 * about them ("where do my CVs live?"), but they are NOT the same thing — see
 * the note in sections.tsx and CLAUDE.md §14.
 */

import { useState } from 'react'
import { FolderSync, FolderSearch } from 'lucide-react'
import { useSettingsForm } from './context'
import { SaveToFileSection } from './sections'
import { FolderPicker } from './FolderPicker'

export function SyncTab() {
  const { managed, backupDir, setBackupDir } = useSettingsForm()
  const [browsing, setBrowsing] = useState(false)

  return (
    <>
      {managed && (
        <section className="sm-sec">
          <div className="sm-sec-head"><FolderSync size={15} /> Backup &amp; sync folder</div>
          <p className="sm-help">
            Point Resume Studio at a cloud-synced folder (Google Drive / Dropbox /
            OneDrive). It keeps <strong>one file per resume</strong> there and,
            while running, writes your edits out and merges newer content back in
            — so pointing a second computer at the <strong>same</strong> folder
            shares your CVs across both. One file per person means a single CV can
            be handed over, or removed, on its own. Leave blank to turn sync off.
          </p>
          <div className="sm-field-row">
            <input
              className="sm-input" placeholder="e.g. C:\Users\you\Google Drive\ResumeStudio"
              value={backupDir} onChange={(e) => setBackupDir(e.target.value)} aria-label="Backup folder"
            />
            <button type="button" className="sm-btn" onClick={() => setBrowsing((b) => !b)}
              aria-expanded={browsing} title="Browse for a folder">
              <FolderSearch size={13} /> Browse…
            </button>
          </div>
          <p className="sm-help">
            Type or paste a path, or <strong>Browse…</strong> to navigate to it. The
            folder must already exist (create it in your cloud app first).
          </p>
          {browsing && (
            <FolderPicker
              initialPath={backupDir}
              onSelect={(p) => setBackupDir(p)}
              onClose={() => setBrowsing(false)}
            />
          )}
        </section>
      )}
      <SaveToFileSection />
    </>
  )
}
