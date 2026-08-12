/**
 * Per-resume sync-file layout for the backup folder.
 *
 * This REPLACES the single `resume-studio-backup.json` monolith (still read —
 * see `scanBackupDir` — so an existing folder keeps working). The folder now
 * holds:
 *
 *   <slug>__<resume-id>.json   one file per resume  (`resumestudio-resume/v1`)
 *   resume-studio-registry.json  the instance registry (`resumestudio-registry/v1`)
 *   deleted-resumes.json         erasure tombstones   (`resumestudio-tombstones/v1`)
 *
 * WHY one file per person. Every resume is one identified person's personal
 * data, and GDPR Art. 17 erasure has to be actionable at that granularity — on
 * disk, not just in the DB. With a monolith, "delete this person from the
 * backups" meant rewriting a file containing everyone else, and "give me this
 * person's CV" meant hand-extracting it from a 20-resume blob. One file per
 * resume makes both a file operation.
 *
 * ── Identity, and why the filename is not it ────────────────────────────────
 *
 * The resume's UUID is the identity, and it lives INSIDE the file. The filename
 * merely carries it so a human can find the right file without opening it. Two
 * machines therefore converge on one resume even if they briefly disagree about
 * the name (a rename on machine A hasn't reached B yet): `scanBackupDir` keys on
 * the embedded `resume.id`, newest `saved_at` wins, and the writer deletes any
 * stale-named file it finds for an id it just wrote.
 *
 * This is the bug that made a two-machine setup grow duplicates: the ONLY
 * identity-preserving inbound path was the sync folder, while dropping the same
 * backup on the picker (the obvious thing to do when setting up a second
 * computer) ran through `api.createResume` and minted a NEW id for every
 * resume — which then synced back and duplicated the first machine too. Every
 * inbound path now merges by id (see `routes/backup.ts → POST /import`).
 *
 * The `__` separator is the parse point: a slug never contains one (it is
 * `[a-z0-9-]` only), so `<slug>__<id>.json` splits unambiguously. The filename
 * is a HINT — a file whose name doesn't parse is still read, and its embedded
 * id still wins.
 *
 * ── Registries ─────────────────────────────────────────────────────────────
 *
 * The full instance registry syncs as its own `resume-studio-registry.json`,
 * AND each resume file embeds the canonical entries that resume actually
 * references (id + kind + full localized name + extra). So a single resume file
 * lifted out of the folder and imported into a fresh instance can recreate the
 * registry entries it depends on, with no access to the registry file.
 *
 * Pure + filesystem helpers only — no Express, no DB handle.
 */

import fs from 'fs'
import path from 'path'
import type { ResumeBackupEntry } from './db.js'
import type { RegistryEntry } from './registryDb.js'
import {
  isStoreBackup, parseStoreBackup, parseStoreRegistry, UnreadableBackupError,
} from './backup.js'

/**
 * The configured sync folder, or null when sync is off. Read lazily per call —
 * the desktop settings screen can change it at runtime and push the new value
 * onto `process.env` (see `settings.ts → applyToEnv`).
 */
export function configuredBackupDir(): string | null {
  const dir = process.env.RESUME_BACKUP_DIR?.trim()
  return dir ? dir : null
}

// ─── Formats ────────────────────────────────────────────────────────────────

export const RESUME_FILE_SCHEMA = 'resumestudio-resume/v1'
export const REGISTRY_FILE_SCHEMA = 'resumestudio-registry/v1'
export const TOMBSTONE_FILE_SCHEMA = 'resumestudio-tombstones/v1'

/** Fixed names for the two non-per-resume files. */
export const REGISTRY_FILENAME = 'resume-studio-registry.json'
/**
 * What this file was called before. The sync folder is usually a shared cloud
 * folder that may hold other applications' files, and a bare `registry.json`
 * says nothing about whose registry it is.
 *
 * Renaming is safe because reading is driven by `$schema`, not by filename
 * (see `reconcileSources`): a folder still holding the old name keeps merging
 * exactly as before. The old file is deleted once the new one is written, so
 * the folder does not end up with two registries — the same retirement the
 * pre-split monolith gets.
 */
export const LEGACY_REGISTRY_FILENAME = 'registry.json'
export const TOMBSTONE_FILENAME = 'deleted-resumes.json'

/** One resume, standalone and portable. The unit of extraction AND of erasure. */
export interface ResumeFileV1 {
  $schema: typeof RESUME_FILE_SCHEMA
  format_version: 1
  exported_at: string
  generator: 'resume-studio'
  resume: ResumeBackupEntry
  /**
   * The canonical registry entries this resume's `canonical_id` links point at,
   * in full (id, kind, localized name, extra). Present so this file alone is
   * enough to recreate the relevant registry in a different instance. Empty when
   * the resume links to nothing shared.
   */
  registry: RegistryEntry[]
}

/** The whole instance registry, so shared entries sync even when unreferenced. */
export interface RegistryFileV1 {
  $schema: typeof REGISTRY_FILE_SCHEMA
  format_version: 1
  exported_at: string
  generator: 'resume-studio'
  registry: RegistryEntry[]
}

/**
 * A deletion marker. Carries an id and a timestamp and NOTHING else — no name,
 * no content — so the record that propagates an erasure is not itself personal
 * data. Without this, deleting a resume on one machine would simply see it
 * restored from the next machine that syncs.
 */
export interface Tombstone {
  id: string
  deleted_at: string
}

export interface TombstoneFileV1 {
  $schema: typeof TOMBSTONE_FILE_SCHEMA
  format_version: 1
  exported_at: string
  generator: 'resume-studio'
  tombstones: Tombstone[]
}

// ─── Naming ─────────────────────────────────────────────────────────────────

/** Longest slug we put in front of the id — keeps paths well under any limit. */
const MAX_SLUG = 60

/**
 * Latin letters NFKD does NOT decompose, because they are letters in their own
 * right rather than a base plus an accent. Without these, the Nordic names this
 * app exists for slug as `bj-rn-dega-rd` instead of `bjorn-odegard` — which
 * defeats the point of putting a name in the filename at all.
 *
 * Built from char codes so this source file stays pure ASCII and cannot be
 * broken by an encoding mishap somewhere in the toolchain.
 */
const TRANSLITERATE = new Map<string, string>([
  [String.fromCharCode(0xF8), 'o'],   // o-slash
  [String.fromCharCode(0xE6), 'ae'],  // ae ligature
  [String.fromCharCode(0xDF), 'ss'],  // sharp s
  [String.fromCharCode(0xFE), 'th'],  // thorn
  [String.fromCharCode(0xF0), 'd'],   // eth
  [String.fromCharCode(0x111), 'd'],  // d with stroke
  [String.fromCharCode(0x142), 'l'],  // l with stroke
  [String.fromCharCode(0x153), 'oe'], // oe ligature
])

/**
 * Combining diacritics (U+0300–U+036F). NFKD splits an accented letter into a
 * base plus one of these; they must be DELETED, not swept into the
 * non-alphanumeric replacement, or `Odegard` slugs to `odega-rd`. Built with
 * char codes to keep this file ASCII (a literal escape here has a habit of being
 * rewritten as the character itself).
 */
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36F)}]`, 'g',
)

/**
 * A filesystem-safe, cross-platform, cross-machine-deterministic slug for a
 * resume name. ASCII-only on purpose: the same name must produce byte-identical
 * filenames on Windows, macOS (which normalizes Unicode in filenames) and Linux,
 * or two machines would write two files for one resume.
 */
export function slugForResume(name: string): string {
  const folded = Array.from((name || '').toLowerCase())
    .map((ch) => TRANSLITERATE.get(ch) ?? ch)
    .join('')
  const slug = folded
    .normalize('NFKD')                  // splits accents off their base letter
    .replace(COMBINING_MARKS, '')       // …then drop the accents themselves
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
  return slug || 'resume'
}

/** The file a resume is stored as: `<slug>__<id>.json`. Stable for a given (name, id). */
export function resumeFileName(id: string, name: string): string {
  return `${slugForResume(name)}__${id}.json`
}

/**
 * The resume id a filename claims, or null. A HINT only — `scanBackupDir`
 * always trusts the id inside the file. Used to spot stale-named leftovers for
 * an id we just wrote under a new name.
 */
export function resumeIdFromFileName(filename: string): string | null {
  const m = /__([^_/\\]+)\.json$/i.exec(filename)
  return m ? m[1] : null
}

// ─── Referenced-registry extraction ─────────────────────────────────────────

/** Registry-bearing collections on a `ResumeStore`, in `data`. */
const LINKED_COLLECTIONS = ['skills', 'roles', 'industries', 'skill_categories'] as const

/**
 * The `canonical_id`s a resume's data references. Server mirror of the client's
 * `referencedCanonicalIds` (src/lib/registryReintern.ts) — kept here rather than
 * imported because server/ must not reach into src/.
 */
export function referencedCanonicalIds(data: Record<string, unknown>): Set<string> {
  const ids = new Set<string>()
  for (const key of LINKED_COLLECTIONS) {
    const arr = data[key]
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      const cid = (item as { canonical_id?: unknown } | null)?.canonical_id
      if (typeof cid === 'string' && cid) ids.add(cid)
    }
  }
  return ids
}

/** The subset of `registry` this resume links to — what gets embedded in its file. */
export function collectReferencedRegistry(
  data: Record<string, unknown>,
  registry: RegistryEntry[],
): RegistryEntry[] {
  const refs = referencedCanonicalIds(data)
  if (!refs.size) return []
  return registry.filter((e) => refs.has(e.id))
}

// ─── Builders ───────────────────────────────────────────────────────────────

export function buildResumeFile(entry: ResumeBackupEntry, registry: RegistryEntry[]): ResumeFileV1 {
  return {
    $schema: RESUME_FILE_SCHEMA,
    format_version: 1,
    exported_at: new Date().toISOString(),
    generator: 'resume-studio',
    resume: entry,
    registry: collectReferencedRegistry(entry.data, registry),
  }
}

export function buildRegistryFile(registry: RegistryEntry[]): RegistryFileV1 {
  return {
    $schema: REGISTRY_FILE_SCHEMA,
    format_version: 1,
    exported_at: new Date().toISOString(),
    generator: 'resume-studio',
    registry,
  }
}

export function buildTombstoneFile(tombstones: Tombstone[]): TombstoneFileV1 {
  return {
    $schema: TOMBSTONE_FILE_SCHEMA,
    format_version: 1,
    exported_at: new Date().toISOString(),
    generator: 'resume-studio',
    tombstones,
  }
}

// ─── Parsers (lenient by design) ────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function schemaOf(json: unknown): string {
  return isObj(json) && typeof json.$schema === 'string' ? json.$schema : ''
}

/** Is this a valid-enough resume entry to merge? Mirrors `parseStoreBackup`'s row check. */
function isResumeEntry(e: unknown): e is ResumeBackupEntry {
  return isObj(e) &&
    typeof e.id === 'string' && !!e.id &&
    typeof e.saved_at === 'string' &&
    isObj(e.data)
}

export function isResumeFile(json: unknown): json is ResumeFileV1 {
  return schemaOf(json).startsWith('resumestudio-resume/') &&
    isObj(json) && isResumeEntry(json.resume)
}

export function isRegistryFile(json: unknown): json is RegistryFileV1 {
  return schemaOf(json).startsWith('resumestudio-registry/') &&
    isObj(json) && Array.isArray(json.registry)
}

export function isTombstoneFile(json: unknown): json is TombstoneFileV1 {
  return schemaOf(json).startsWith('resumestudio-tombstones/') &&
    isObj(json) && Array.isArray(json.tombstones)
}

/** Registry entries out of any file that carries them, dropping malformed rows. */
export function parseRegistryEntries(value: unknown): RegistryEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((e): e is RegistryEntry =>
    isObj(e) && typeof e.id === 'string' && typeof e.key === 'string' && typeof e.kind === 'string')
}

export function parseTombstones(value: unknown): Tombstone[] {
  if (!Array.isArray(value)) return []
  return value.filter((t): t is Tombstone =>
    isObj(t) && typeof t.id === 'string' && !!t.id && typeof t.deleted_at === 'string')
}

// ─── Atomic write ───────────────────────────────────────────────────────────

export interface WrittenFile {
  file: string
  bytes: number
}

/**
 * Write `value` as pretty JSON to `<dir>/<filename>` via a temp file + rename,
 * so a sync client never uploads a half-written file and a crash leaves the
 * previous good copy intact. Creates `dir`; tightens the file to 0600 (these
 * hold a person's CV in plaintext) — best-effort, a no-op on Windows.
 */
export function writeJsonAtomic(dir: string, filename: string, value: unknown): WrittenFile {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, filename)
  const json = JSON.stringify(value, null, 2)
  const tmp = path.join(dir, `.${filename}.${process.pid}.${Date.now()}.tmp`)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, json)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* ignore */ }
  return { file, bytes: Buffer.byteLength(json) }
}

// ─── Folder scan ────────────────────────────────────────────────────────────

/** Skip anything implausibly large before parsing — a stray 500 MB file isn't ours. */
const MAX_FILE_BYTES = 64 * 1024 * 1024

export interface ScannedFolder {
  /** One entry per resume id, newest `saved_at` where several sources hold it. */
  resumes: ResumeBackupEntry[]
  /** Union of `resume-studio-registry.json` and every resume file's embedded subset. */
  registry: RegistryEntry[]
  tombstones: Tombstone[]
  /** Every file we read a resume out of, by id — several when a rename left a stale name. */
  filesByResumeId: Map<string, string[]>
  /** Name of the legacy combined backup, when the source still has one. */
  legacyFile: string | null
  /** Names of files we could not read, for the status readout. Never fatal. */
  unreadable: string[]
}

/** One already-parsed candidate file: its name and its JSON. */
export interface ParsedSource {
  name: string
  json: unknown
}

/**
 * Reconcile a set of parsed files into one view of the data they carry.
 *
 * Accepts four shapes: the per-resume files, `resume-studio-registry.json`, the tombstone
 * file, and the LEGACY `resume-studio-backup.json` monolith (so upgrading a
 * folder in place loses nothing — its resumes merge in exactly like any other
 * source, newest `saved_at` wins). Anything else is ignored, so the sync folder
 * can hold the user's own files without the app choking on them.
 *
 * Shared by the folder scan and the manual zip import, so a zip and a folder
 * containing the same files produce identical results — which is what makes
 * "export a zip here, import it there" and "sync the folder" the same operation.
 */
export function reconcileSources(sources: ParsedSource[]): ScannedFolder {
  const out: ScannedFolder = {
    resumes: [], registry: [], tombstones: [],
    filesByResumeId: new Map(), legacyFile: null, unreadable: [],
  }

  // Newest-wins reconciliation across however many sources claim the same id.
  const byId = new Map<string, ResumeBackupEntry>()
  const registryById = new Map<string, RegistryEntry>()
  const tombById = new Map<string, Tombstone>()

  const addResume = (entry: ResumeBackupEntry) => {
    const seen = byId.get(entry.id)
    if (!seen || entry.saved_at > seen.saved_at) byId.set(entry.id, entry)
  }
  const addRegistry = (entries: RegistryEntry[]) => {
    for (const e of entries) {
      const seen = registryById.get(e.id)
      if (!seen || (e.updated_at ?? '') > (seen.updated_at ?? '')) registryById.set(e.id, e)
    }
  }

  for (const { name, json } of sources) {
    if (isResumeFile(json)) {
      addResume(json.resume)
      const list = out.filesByResumeId.get(json.resume.id)
      if (list) list.push(name)
      else out.filesByResumeId.set(json.resume.id, [name])
      addRegistry(parseRegistryEntries(json.registry))
      continue
    }

    if (isRegistryFile(json)) {
      addRegistry(parseRegistryEntries(json.registry))
      continue
    }

    if (isTombstoneFile(json)) {
      for (const t of parseTombstones(json.tombstones)) {
        const seen = tombById.get(t.id)
        if (!seen || t.deleted_at > seen.deleted_at) tombById.set(t.id, t)
      }
      continue
    }

    if (isStoreBackup(json)) {
      out.legacyFile = name
      try {
        for (const entry of parseStoreBackup(json)) addResume(entry)
        addRegistry(parseStoreRegistry(json))
      } catch (err) {
        if (!(err instanceof UnreadableBackupError)) throw err
        out.unreadable.push(name)
      }
      continue
    }
    // Anything else: not ours, silently left alone.
  }

  out.resumes = [...byId.values()]
  out.registry = [...registryById.values()]
  out.tombstones = [...tombById.values()]
  return out
}

/**
 * Read every compatible file in `dir` and reconcile them (see
 * `reconcileSources`). Never throws for a bad file: an unreadable one is
 * recorded in `unreadable` and skipped, because a folder being synced WILL
 * sometimes be observed mid-write.
 */
export function scanBackupDir(dir: string): ScannedFolder {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return reconcileSources([]) // folder absent — treated as empty, not an error
  }

  const sources: ParsedSource[] = []
  const unreadable: string[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue
    if (name.startsWith('.')) continue // our own temp files
    try {
      const full = path.join(dir, name)
      if (fs.statSync(full).size > MAX_FILE_BYTES) continue
      sources.push({ name, json: JSON.parse(fs.readFileSync(full, 'utf8')) })
    } catch {
      unreadable.push(name)
    }
  }
  const out = reconcileSources(sources)
  out.unreadable.push(...unreadable)
  return out
}

/**
 * A change fingerprint for the whole folder — the split-file replacement for
 * watching one file's mtime. Name + size + mtime of every JSON file, sorted, so
 * any add / remove / rewrite moves it. Cheap: `stat` per file, no reads.
 */
export function folderFingerprint(dir: string): string {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return ''
  }
  const parts: string[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json') || name.startsWith('.')) continue
    try {
      const st = fs.statSync(path.join(dir, name))
      parts.push(`${name}:${st.size}:${st.mtimeMs}`)
    } catch { /* vanished mid-scan — the next tick sees the settled state */ }
  }
  return parts.sort().join('|')
}

/** Newest mtime across the folder's JSON files (ISO), or null when empty. */
export function folderLastWrite(dir: string): string | null {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  let newest = 0
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json') || name.startsWith('.')) continue
    try {
      const { mtimeMs } = fs.statSync(path.join(dir, name))
      if (mtimeMs > newest) newest = mtimeMs
    } catch { /* vanished mid-scan */ }
  }
  return newest ? new Date(newest).toISOString() : null
}

// ─── Write pass ─────────────────────────────────────────────────────────────

export interface WritePassResult {
  written: number
  bytes: number
  /** Stale-named files removed after a rename, plus a superseded legacy monolith. */
  removed: string[]
}

/**
 * Publish every resume as its own file, refresh `resume-studio-registry.json`, and clean up
 * after itself.
 *
 * Deliberately does NOT delete files for ids that aren't in `entries`: another
 * machine may have just published a resume this one hasn't merged yet, and
 * treating "not in my DB" as "delete" would make two machines erase each
 * other's new work. Removal is an explicit act — see `recordDeletion`.
 */
export function writeResumeFiles(
  dir: string,
  entries: ResumeBackupEntry[],
  registry: RegistryEntry[],
): WritePassResult {
  fs.mkdirSync(dir, { recursive: true })
  const result: WritePassResult = { written: 0, bytes: 0, removed: [] }

  const existing = scanBackupDir(dir)
  const wantedNames = new Set<string>()

  for (const entry of entries) {
    const filename = resumeFileName(entry.id, entry.name)
    wantedNames.add(filename)
    const { bytes } = writeJsonAtomic(dir, filename, buildResumeFile(entry, registry))
    result.written++
    result.bytes += bytes

    // A rename changed the slug → drop the file written under the old name, so
    // the folder never accumulates one file per name a resume ever had.
    for (const stale of existing.filesByResumeId.get(entry.id) ?? []) {
      if (stale === filename) continue
      try {
        fs.unlinkSync(path.join(dir, stale))
        result.removed.push(stale)
      } catch { /* already gone */ }
    }
  }

  const reg = writeJsonAtomic(dir, REGISTRY_FILENAME, buildRegistryFile(registry))
  result.bytes += reg.bytes

  // Retire the old `resume-studio-registry.json` now its replacement is on disk. Both parse
  // (matching is by `$schema`), so leaving it would be harmless but would put
  // two registry files side by side — which is exactly the confusion the rename
  // set out to remove. Written first, deleted second: a crash between the two
  // leaves the folder with a registry either way, never with none.
  const legacyRegistry = path.join(dir, LEGACY_REGISTRY_FILENAME)
  if (fs.existsSync(legacyRegistry)) {
    try {
      fs.unlinkSync(legacyRegistry)
      result.removed.push(LEGACY_REGISTRY_FILENAME)
    } catch { /* already gone */ }
  }

  // Retire the legacy monolith once every resume it held has its own file.
  // Leaving it would defeat the whole point: a single file with every person's
  // CV in it, which per-person erasure cannot touch.
  if (existing.legacyFile && existing.resumes.length > 0) {
    const ids = new Set(entries.map((e) => e.id))
    if (existing.resumes.every((e) => ids.has(e.id))) {
      try {
        fs.unlinkSync(path.join(dir, existing.legacyFile))
        result.removed.push(existing.legacyFile)
      } catch { /* ignore */ }
    }
  }

  return result
}

// ─── Erasure ────────────────────────────────────────────────────────────────

/** Read the folder's tombstones (empty when there are none / the file is bad). */
export function readTombstones(dir: string): Tombstone[] {
  try {
    const json: unknown = JSON.parse(fs.readFileSync(path.join(dir, TOMBSTONE_FILENAME), 'utf8'))
    return isTombstoneFile(json) ? parseTombstones(json.tombstones) : []
  } catch {
    return []
  }
}

/** How long a tombstone is kept before it is pruned (a year of offline machines). */
export const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000

/**
 * Erase a resume from the sync folder: delete its file(s) and record the
 * tombstone that tells other machines to do the same.
 *
 * Best-effort and never throws — the DB row is already gone by the time this
 * runs, and a sync folder that is temporarily unwritable (offline network
 * share) must not turn a successful delete into an error.
 */
export function recordDeletion(dir: string, id: string, now = new Date()): void {
  try {
    const scan = scanBackupDir(dir)
    for (const name of scan.filesByResumeId.get(id) ?? []) {
      try { fs.unlinkSync(path.join(dir, name)) } catch { /* already gone */ }
    }
    const cutoff = now.getTime() - TOMBSTONE_TTL_MS
    const kept = scan.tombstones
      .filter((t) => t.id !== id && Date.parse(t.deleted_at) >= cutoff)
    kept.push({ id, deleted_at: now.toISOString() })
    writeJsonAtomic(dir, TOMBSTONE_FILENAME, buildTombstoneFile(kept))
  } catch {
    // Swallowed on purpose: see the doc comment.
  }
}
