/**
 * Zip packaging for the MANUAL backup — the same per-resume files the sync
 * folder holds, bundled into one archive.
 *
 * The manual backup used to be one JSON per click, so "back up everything"
 * meant N downloads and N drag-and-drops to restore. A zip keeps the split-file
 * layout (one file per person, extractable and deletable on its own) while
 * staying a single artifact to hand around. Deliberately IDENTICAL in content to
 * the sync folder, so the two are interchangeable: unzip a backup into a sync
 * folder, or zip a sync folder and import it, and both work.
 *
 * `fflate` is already a dependency (the LinkedIn .zip importer uses it in the
 * browser); `zipSync`/`unzipSync` are its synchronous Node-friendly halves. Zips
 * of a few resumes are small and this runs on an explicit user action, so the
 * synchronous form is the right trade for the simplicity.
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { ResumeBackupEntry } from './db.js'
import type { RegistryEntry } from './registryDb.js'
import {
  REGISTRY_FILENAME, buildRegistryFile, buildResumeFile, resumeFileName,
  reconcileSources, type ParsedSource, type ScannedFolder,
} from './backupFiles.js'

/** Suggested download name, e.g. `resume-studio-backup-2026-08-04.zip`. */
export function zipFileName(now = new Date()): string {
  return `resume-studio-backup-${now.toISOString().slice(0, 10)}.zip`
}

/**
 * Bundle every resume (one file each) plus `registry.json` into a zip. Flat —
 * no top-level directory — so extracting it straight into a sync folder yields
 * exactly the layout the folder expects.
 */
export function buildBackupZip(entries: ResumeBackupEntry[], registry: RegistryEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  // A duplicate name would silently overwrite. Ids are unique and the name
  // carries the id, so this only ever fires on corrupt input — but a backup
  // that quietly drops a person is exactly the failure worth ruling out.
  const used = new Set<string>()
  for (const entry of entries) {
    let name = resumeFileName(entry.id, entry.name)
    while (used.has(name)) name = name.replace(/\.json$/, '-dup.json')
    used.add(name)
    files[name] = strToU8(JSON.stringify(buildResumeFile(entry, registry), null, 2))
  }
  files[REGISTRY_FILENAME] = strToU8(JSON.stringify(buildRegistryFile(registry), null, 2))
  return zipSync(files, { level: 6 })
}

/**
 * Cap on a single entry's DECLARED uncompressed size. Applied in `unzipSync`'s
 * filter, i.e. BEFORE the entry is inflated — a cap checked afterwards would
 * already have paid the memory cost it exists to avoid. Generous, because one
 * resume with embedded images is legitimately several MB.
 */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024

/** Only our own JSON is ever parsed; anything else in the archive is skipped. */
function wantedEntry(name: string): boolean {
  const base = name.split('/').pop() ?? name
  return base.toLowerCase().endsWith('.json') && !base.startsWith('.')
}

/**
 * Read a backup zip back into the same reconciled view `scanBackupDir` produces,
 * so the import path and the sync path share every downstream decision. Entries
 * that aren't readable JSON are recorded in `unreadable` rather than throwing —
 * one bad file must not cost the user the rest of the archive.
 *
 * Throws only when the buffer isn't a zip at all, which the caller reports as a
 * bad upload. `maxEntryBytes` is an override for tests; production uses the
 * module default.
 */
export function readBackupZip(buf: Uint8Array, maxEntryBytes = MAX_ENTRY_BYTES): ScannedFolder {
  const oversized: string[] = []
  const entries = unzipSync(buf, {
    filter: (file) => {
      if (!wantedEntry(file.name)) return false
      // `originalSize` is the zip header's claim, so it is not proof — but it is
      // the only thing available before inflating, and it is what makes a
      // declared-huge entry cost nothing. The route's request-size limit bounds
      // the other direction (a lying header still can't smuggle in more bytes
      // than were uploaded).
      if (file.originalSize !== undefined && file.originalSize > maxEntryBytes) {
        oversized.push(file.name.split('/').pop() ?? file.name)
        return false
      }
      return true
    },
  })

  const sources: ParsedSource[] = []
  const unreadable: string[] = [...oversized]
  for (const [rawName, bytes] of Object.entries(entries)) {
    // Zips can carry directory paths; we only care about the basename. The path
    // is never trusted and never used — nothing here is written to disk, so a
    // `../../` entry name has nowhere to go. Keep it that way.
    const name = rawName.split('/').pop() ?? rawName
    try {
      sources.push({ name, json: JSON.parse(strFromU8(bytes)) })
    } catch {
      unreadable.push(name)
    }
  }
  const out = reconcileSources(sources)
  out.unreadable.push(...unreadable)
  return out
}
