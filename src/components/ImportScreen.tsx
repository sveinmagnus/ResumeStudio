import { useRef, useState } from 'react'
import { Upload, FileJson, Sparkles, FilePlus, Wand2 } from 'lucide-react'
import {
  isBackupFormat, importFromBackup, isMergeableBackupFormat,
  normalizeStoreShape, looksLikeResumeStore,
  UnsupportedBackupVersionError, InvalidBackupError,
} from '../lib/backup'
import { reinternBackupLinks } from '../lib/registryReintern'
import { api, ServerError, type RestoreSummary } from '../lib/api'
import { importFromCVPartner, isCVPartnerFormat } from '../lib/importer'
import {
  isAIImportFormat, validateAIImport, importFromAIDraft, InvalidAIImportError,
} from '../lib/aiImport'
import { isLinkedInExport, importFromLinkedIn } from '../lib/importerLinkedIn'
import {
  isEuropassJson, isEuropassXml, importFromEuropassJson, importFromEuropassXml,
} from '../lib/importerEuropass'
import { AIImportModal } from './AIImportModal'
import { loadSkillTaxonomy, loadSkillClassifications } from '../lib/skillTaxonomy'
import { normalizeImportedSkills } from '../lib/skillNormalize'
import type { ResumeStore, CanonicalSnapshot } from '../types'

const YEAR = new Date().getFullYear()

/**
 * Canonicalize a freshly-imported store's skill names against the Quadim
 * library (F12 pt2) and stamp authoritative classifications (F12 pt4). Skipped
 * for backups, whose names are intentional. The taxonomy/classifications are
 * the same lazy-loaded data the editor uses (memoized).
 */
async function normalizeImported(store: ResumeStore): Promise<ResumeStore> {
  try {
    const [taxonomy, classifications] = await Promise.all([
      loadSkillTaxonomy(), loadSkillClassifications(),
    ])
    return normalizeImportedSkills(store, taxonomy, classifications).store
  } catch {
    // A taxonomy hiccup must never block an import.
    return store
  }
}

export interface ImportScreenProps {
  /** Render in compact mode (inside the picker panel — no brand block, no footer). */
  compact?: boolean
  /** Called when the user starts with an empty resume. */
  onStartFresh: () => void | Promise<void>
  /** Called with the parsed store + a suggested name derived from the file. */
  onImported: (store: ResumeStore, suggestedName: string) => void | Promise<void>
  /**
   * Called after an identity-bearing backup (a sync file, an export zip, a
   * legacy combined backup) has been MERGED server-side. Separate from
   * `onImported` because nothing new was created: existing resumes were updated
   * in place by id, which is what stops a re-import duplicating them.
   */
  onRestored?: (summary: RestoreSummary) => void | Promise<void>
}

function deriveName(store: ResumeStore, fallback: string): string {
  const full = store.resume?.full_name?.trim()
  return full ? `${full} — CV` : fallback
}

/**
 * Import Resume Studio's OWN content that carries NO resume identity — the
 * dispatcher's default target. These files describe a resume's contents, not
 * which resume it is, so each one legitimately becomes a NEW resume:
 *   - a per-resume backup envelope (`resumestudio/…`, the "Save this resume to
 *     a file" download — explicitly a copy-making tool);
 *   - a bare/legacy `ResumeStore` object (an older self-export without an
 *     envelope).
 * Shared-registry links are re-interned against THIS instance from the backup's
 * embedded `canonical_registry` snapshots. Anything that isn't recognisable as
 * our content throws a clear error — we never silently create an empty resume.
 *
 * Files that DO carry identity (the sync folder's per-resume files, an export
 * zip, a legacy combined backup) never reach here: `handleFile` routes them to
 * the server's merge-by-id endpoint instead. See `isMergeableBackupFormat`.
 */
async function importResumeStudio(
  json: unknown,
  onImported: (store: ResumeStore, name: string) => void | Promise<void>,
): Promise<void> {
  if (isBackupFormat(json)) {
    // importFromBackup validates the structure and throws InvalidBackupError
    // (with a field path) on anything malformed.
    const store = importFromBackup(json)
    const embedded = (json as { canonical_registry?: CanonicalSnapshot[] }).canonical_registry
    const reinterned = await reinternBackupLinks(store, embedded, api).catch(() => store)
    await onImported(reinterned, deriveName(reinterned, 'Imported resume'))
    return
  }
  if (looksLikeResumeStore(json)) {
    // Older self-export dumped as the raw internal store (no envelope). Normalize
    // the shape so a previous-version store restores fully; migrateStore finishes
    // the upgrade at load.
    const store = normalizeStoreShape(json as Record<string, unknown>)
    const reinterned = await reinternBackupLinks(store, undefined, api).catch(() => store)
    await onImported(reinterned, deriveName(reinterned, 'Imported resume'))
    return
  }
  throw new Error(
    'this file is not a recognised resume format (expected a Resume Studio backup, ' +
    'or a CVpartner, LinkedIn, Europass, or AI-import file).',
  )
}

export function ImportScreen({ compact = false, onStartFresh, onImported, onRestored }: ImportScreenProps) {
  const [error, setError]       = useState<string | null>(null)
  const [notice, setNotice]     = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [showAI, setShowAI]     = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * Hand an identity-bearing backup to the server, which merges it BY RESUME ID
   * (newest save wins) and unions the shared registry. The whole file goes over
   * the wire untouched — the server already owns this format for folder sync, so
   * there is exactly one merge implementation rather than a second, subtly
   * different one in the browser.
   */
  const restoreFromFile = async (file: File) => {
    const summary = await api.importBackupFile(file)
    const parts: string[] = []
    if (summary.inserted) parts.push(`${summary.inserted} added`)
    if (summary.updated) parts.push(`${summary.updated} updated`)
    if (summary.deleted) parts.push(`${summary.deleted} removed`)
    // "Already up to date" is a SUCCESS, and the most likely outcome of
    // re-importing a backup. Saying so is what tells the user their resumes were
    // recognised rather than silently ignored.
    setNotice(`Restored from ${file.name} — ${parts.length ? parts.join(', ') : 'everything was already up to date'}.`)
    await onRestored?.(summary)
  }

  const handleFile = async (file: File) => {
    setError(null)
    setNotice(null)
    try {
      if (/\.zip$/i.test(file.name)) {
        // Two kinds of zip arrive here: a LinkedIn data export (CSVs) and our own
        // "export all resumes" archive (per-resume JSON). LinkedIn has a positive
        // detector, so check that first and treat everything else as ours — the
        // server gives a precise error if it isn't.
        // fflate is lazy-loaded so the unzip code only ships when someone
        // actually drops a .zip.
        const { unzipSync, strFromU8 } = await import('fflate')
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
        const files: Record<string, string> = {}
        for (const [name, bytes] of Object.entries(entries)) {
          if (/\.csv$/i.test(name)) files[name] = strFromU8(bytes)
        }
        if (isLinkedInExport(files)) {
          const store = await normalizeImported(importFromLinkedIn(files))
          await onImported(store, deriveName(store, 'LinkedIn import'))
          return
        }
        await restoreFromFile(file)
        return
      }

      const text = await file.text()

      // Europass XML (SkillsPassport) — the classic europa.eu CV download.
      if (/\.xml$/i.test(file.name) || isEuropassXml(text)) {
        const store = await normalizeImported(importFromEuropassXml(text))
        await onImported(store, deriveName(store, 'Europass import'))
        return
      }

      const json = JSON.parse(text) as unknown

      // Our identity-bearing files go to the server's merge-by-id endpoint FIRST,
      // ahead of every other detector: they name the resumes they carry, so
      // re-importing one must update those resumes rather than clone them.
      if (isMergeableBackupFormat(json)) {
        await restoreFromFile(file)
        return
      }

      // Third-party formats each have a POSITIVE detector that routes to their
      // own importer. Anything NOT matched here defaults to the Resume Studio
      // path (`importResumeStudio`) — so a self-created backup, current OR older
      // version, is the safe fallback and is never misrouted into a foreign
      // importer, which maps none of its fields and yields an EMPTY resume.
      // Importing our own content is the priority; third-party formats are the
      // value-add layered on top.
      if (isEuropassJson(json)) {
        const store = await normalizeImported(importFromEuropassJson(json))
        await onImported(store, deriveName(store, 'Europass import'))
      } else if (isAIImportFormat(json)) {
        // AI-import drafts get validated up-front; the field-pathed message is
        // far more useful than a generic parse failure. (The guided AI modal
        // shows the full issue list — here we surface the first problem.)
        const store = await normalizeImported(importFromAIDraft(validateAIImport(json)))
        await onImported(store, deriveName(store, 'AI-imported resume'))
      } else if (isCVPartnerFormat(json)) {
        // CVpartner export — a large, real-world-messy third-party object.
        const store = await normalizeImported(importFromCVPartner(json as Record<string, unknown>))
        await onImported(store, deriveName(store, 'Imported CV'))
      } else {
        await importResumeStudio(json, onImported)
      }
    } catch (e) {
      const msg = e instanceof UnsupportedBackupVersionError
        || e instanceof InvalidAIImportError
        || e instanceof InvalidBackupError
        // The server's import errors are already written for a human ("No
        // Resume Studio backup files found in that upload.") — don't bury them
        // under a parse-failure prefix that misdescribes them.
        || e instanceof ServerError
        ? e.message
        : `Could not parse file: ${(e as Error).message}`
      setError(msg)
    }
  }

  const innerClass = compact ? 'is-inner is-inner-compact' : 'is-inner'

  return (
    <div className={compact ? 'import-screen is-compact' : 'import-screen'}>
      <div className={innerClass}>

        {!compact && (
          <>
            <div className="is-brand">
              <img src="/cartavio-symbol.png" alt="Cartavio" className="is-symbol" />
              <h1 className="is-title">Cartavio Resume Studio</h1>
            </div>
            <p className="is-lede">
              Maintain one master consultant resume across multiple languages, then extract
              targeted CVs for any skill area.
            </p>
          </>
        )}

        <div
          className={`is-drop ${dragging ? 'drag' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Choose a resume file to import (or drop one here)"
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) void handleFile(f)
          }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            // The hidden file input is unreachable by Tab — the zone itself is
            // the keyboard affordance (WCAG 2.1.1).
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
        >
          <div className="is-drop-icon"><Upload size={28} /></div>
          <div className="is-drop-title">Drop your resume file here</div>
          <div className="is-drop-sub">or click to browse — Resume Studio backups (.json or .zip), CVpartner exports, LinkedIn data exports (.zip), Europass (.xml/.json), or AI import files</div>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json,.zip,application/zip,.xml,text/xml"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          />
        </div>

        {error && <div className="is-error" role="alert">{error}</div>}
        {notice && <div className="is-notice" role="status">{notice}</div>}

        {!compact && (
          <div className="is-features">
            <div className="is-feat"><FileJson size={16} /> Resume Studio backup (.json or .zip) — restores your resumes in place, without duplicating them</div>
            <div className="is-feat"><FileJson size={16} /> CVpartner export (.json) — import projects, employment, education, skills &amp; more</div>
            <div className="is-feat"><FileJson size={16} /> LinkedIn data export (.zip) and Europass CV (.xml / .json)</div>
            <div className="is-feat"><Wand2 size={16} /> Start from a PDF/Word CV with your own AI — no account or API key needed</div>
            <div className="is-feat"><Sparkles size={16} /> Side-by-side dual-language editing in any two locales</div>
          </div>
        )}

        <div className="is-divider"><span>or</span></div>

        <button className="is-ai" onClick={() => setShowAI(true)}>
          <Wand2 size={16} />
          Start from a PDF/Word file with AI
        </button>

        <button className="is-fresh" onClick={() => void onStartFresh()}>
          <FilePlus size={16} />
          Start with an empty resume
        </button>
      </div>

      {showAI && (
        <AIImportModal
          onClose={() => setShowAI(false)}
          onImported={onImported}
        />
      )}

      {!compact && (
        <footer className="is-page-footer">
          <span>© {YEAR} Cartavio AS</span>
          <span className="is-footer-dot">·</span>
          <a href="https://cartavio.no" target="_blank" rel="noopener noreferrer">
            cartavio.no
          </a>
        </footer>
      )}

      <style>{`
        .import-screen {
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 60px 40px 80px; position: relative; z-index: 1;
        }
        .import-screen.is-compact { min-height: 0; padding: 0; }
        .is-inner { max-width: 540px; width: 100%; text-align: center; animation: fadeUp .5s ease; }
        .is-inner-compact { animation: none; }

        /* Brand block */
        .is-brand {
          display: flex; align-items: center; justify-content: center;
          gap: 16px; margin-bottom: 14px;
        }
        .is-symbol { width: 52px; height: 52px; object-fit: contain; flex-shrink: 0; }
        .is-title {
          font-size: 44px; letter-spacing: -.01em;
          color: var(--accent); text-align: left;
        }
        .is-lede { color: var(--ink-soft); font-size: 15px; line-height: 1.6; margin-bottom: 32px; }

        /* Drop zone */
        .is-drop {
          border: 2px dashed var(--line-strong); border-radius: var(--r-lg);
          padding: 40px 30px; cursor: pointer; transition: color .2s, background .2s, border-color .2s, box-shadow .2s, transform .2s; background: var(--paper-raised);
        }
        .is-drop:hover, .is-drop.drag, .is-drop:focus-visible {
          border-color: var(--accent); background: var(--accent-wash);
          transform: translateY(-2px); box-shadow: var(--shadow-md);
        }
        .is-drop:focus-visible {
          outline: 2px solid var(--accent); outline-offset: 2px;
        }
        .is-drop-icon {
          width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%;
          background: var(--paper-sunken); color: var(--accent); display: grid; place-items: center;
        }
        .is-drop.drag .is-drop-icon { background: var(--accent); color: #fff; }
        .is-drop-title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
        .is-drop-sub { color: var(--ink-faint); font-size: 13px; }

        /* Error */
        .is-error {
          margin-top: 14px; padding: 10px 14px; background: var(--accent-wash);
          color: var(--accent); border-radius: var(--r-sm); font-size: 13px; text-align: left;
        }
        .is-notice {
          margin-top: 14px; padding: 10px 14px; background: var(--ok-wash);
          color: var(--ok-ink); border-radius: var(--r-sm); font-size: 13px; text-align: left;
        }

        /* Feature list */
        .is-features {
          margin-top: 28px; display: flex; flex-direction: column; gap: 10px;
          align-items: flex-start; text-align: left;
        }
        .is-feat { display: flex; align-items: center; gap: 10px; color: var(--ink-soft); font-size: 13.5px; }
        .is-feat svg { color: var(--accent); flex-shrink: 0; }

        /* Or divider */
        .is-divider {
          display: flex; align-items: center; gap: 12px; margin: 24px 0 18px;
          color: var(--ink-faint); font-size: 11px; font-weight: 600;
          letter-spacing: .08em; text-transform: uppercase;
        }
        .is-divider::before, .is-divider::after {
          content: ''; flex: 1; height: 1px; background: var(--line);
        }

        /* AI-assisted import button — prominent (accent outline) */
        .is-ai {
          display: inline-flex; align-items: center; gap: 8px; width: 100%;
          justify-content: center; padding: 11px 22px; border-radius: var(--r-md);
          border: 1.5px solid var(--accent); background: var(--accent-wash);
          font-size: 14px; font-weight: 600; color: var(--accent);
          transition: color .15s, background .15s, border-color .15s, box-shadow .15s; margin-bottom: 10px;
        }
        .is-ai:hover { background: var(--accent); color: #fff; }
        .is-ai svg { flex-shrink: 0; }

        /* Start fresh button */
        .is-fresh {
          display: inline-flex; align-items: center; gap: 8px; width: 100%;
          justify-content: center; padding: 11px 22px; border-radius: var(--r-md);
          border: 1.5px solid var(--line-strong);
          font-size: 14px; font-weight: 600; color: var(--ink-soft);
          transition: color .15s, background .15s, border-color .15s, box-shadow .15s;
        }
        .is-fresh:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
        .is-fresh svg { flex-shrink: 0; }

        /* Page footer */
        .is-page-footer {
          position: fixed; bottom: 0; left: 0; right: 0;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 12px 24px; font-size: 11px; color: var(--ink-faint);
          background: linear-gradient(to top, var(--paper) 70%, transparent);
          pointer-events: none;
        }
        .is-page-footer a {
          color: var(--ink-faint); text-decoration: none; pointer-events: all;
          transition: color .15s;
        }
        .is-page-footer a:hover { color: var(--accent); }
        .is-footer-dot { opacity: .5; }
      `}</style>
    </div>
  )
}
