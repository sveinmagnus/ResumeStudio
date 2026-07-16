/**
 * Sync & backup — the cloud-synced folder (desktop only; it's a server setting)
 * plus the always-available one-off "save this resume to a file".
 *
 * Two different backup concepts share this tab because that's how a user thinks
 * about them ("where do my CVs live?"), but they are NOT the same thing — see
 * the note in sections.tsx and CLAUDE.md §14.
 */

import { FolderSync } from 'lucide-react'
import { useSettingsForm } from './context'
import { SaveToFileSection } from './sections'

export function SyncTab() {
  const { managed, backupDir, setBackupDir } = useSettingsForm()

  return (
    <>
      {managed && (
        <section className="sm-sec">
          <div className="sm-sec-head"><FolderSync size={15} /> Backup &amp; sync folder</div>
          <p className="sm-help">
            Paste the path to a cloud-synced folder (Google Drive / Dropbox /
            OneDrive). Resume Studio keeps one backup file there and merges
            newer content from it on launch — point a second computer at the
            same folder to share your CVs. Leave blank to turn sync off.
          </p>
          <input
            className="sm-input" placeholder="e.g. C:\Users\you\Google Drive\ResumeStudio"
            value={backupDir} onChange={(e) => setBackupDir(e.target.value)} aria-label="Backup folder"
          />
        </section>
      )}
      <SaveToFileSection />
    </>
  )
}
