import type { ResumeStore, LocalizedString, RegistryEntry, RegistryKind } from '../types'
import type { StorageStats } from './storage'
import type { InstalledModel } from './ollamaCatalog'
import type { GlossaryPayload } from './glossary'

// ─── Auth ──────────────────────────────────────────────────────────────────────
//
// The API token is NOT stored in JS-readable storage. The client POSTs it once
// to /api/auth/login, which sets an HttpOnly + SameSite=Strict session cookie;
// every subsequent request carries that cookie automatically (same-origin
// fetch). This means an XSS bug can no longer read or exfiltrate the token.
// `api.login` / `api.logout` below drive that exchange.

// ─── Error types ──────────────────────────────────────────────────────────────

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized — API token required')
    this.name = 'UnauthorizedError'
  }
}

export class ServerError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ServerError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Resource not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

/**
 * Thrown by `saveResume` on a 409: the resume's server version moved on since
 * the base version we sent (another tab/device wrote in between). Carries the
 * live server state so the caller can diff and offer keep/discard.
 */
export class ConflictError extends Error {
  constructor(public current: { data: ResumeStore; meta: ResumeMeta }) {
    super('Resume changed elsewhere')
    this.name = 'ConflictError'
  }
}

/** A registry entry moved on the server since the client's `base_version`. */
export class RegistryConflictError extends Error {
  constructor(public current: RegistryEntry | null) {
    super('Registry entry changed elsewhere')
    this.name = 'RegistryConflictError'
  }
}

// ─── HTTP base ────────────────────────────────────────────────────────────────

async function request(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    // Send the HttpOnly session cookie (same-origin). Auth is carried by the
    // cookie set at /api/auth/login — no token is attached from JS.
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })

  if (res.status === 401) throw new UnauthorizedError()
  return res
}

/**
 * True when the given error is a fetch abort (caller cancelled via
 * AbortController). Callers typically want to ignore these silently — an
 * abort means the work was superseded, not failed.
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/**
 * The server's `{ error }` message for a failed response, or `fallback` when
 * the body is missing/unparseable/has no message.
 *
 * Every failing endpoint below wants this exact "prefer the server's wording,
 * else say something sensible" behaviour; it was hand-inlined eleven times.
 */
async function serverMessage(res: Response, fallback: string): Promise<string> {
  try {
    const json = await res.json() as { error?: string }
    if (json.error) return json.error
  } catch { /* no/!json body — use the fallback */ }
  return fallback
}

/** Throw a ServerError carrying the server's message (or `fallback`). */
async function fail(res: Response, fallback: string): Promise<never> {
  throw new ServerError(res.status, await serverMessage(res, `${fallback} (${res.status})`))
}

/**
 * Run a request that must never throw, returning `fallback` on any failure.
 *
 * Used by the status/probe endpoints: an unreachable or unhappy server should
 * make a feature quietly hide, not break the page. Deliberately swallows
 * everything — callers that need to distinguish failures don't use this.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface ResumeMeta {
  id: string
  name: string
  primary_locale: string
  secondary_locale: string | null
  saved_at: string
  created_at: string
  /** Optimistic-concurrency token; echo it back as `baseVersion` on save. */
  version: number
  /** Who last saved (named-token attribution). Absent/null on older servers or the anonymous token. */
  saved_by?: string | null
}

export interface SnapshotMeta {
  id: number
  saved_at: string
  size: number
  /** Who made this save (named-token attribution). */
  saved_by?: string | null
}

export interface CreateResumeInput {
  name: string
  data?: ResumeStore
  primary_locale?: string
  secondary_locale?: string | null
}

export interface LocaleUpdate {
  primary_locale: string
  secondary_locale: string | null
}

/** Whole-store sync/backup status (desktop build). */
export type BackupStatus =
  | { configured: false }
  | {
      configured: true
      /** The configured sync folder (e.g. a Google Drive path). */
      dir: string
      /** Absolute path of the backup file inside `dir`. */
      file: string
      /** Whether the backup file exists yet. */
      exists: boolean
      /** ISO timestamp of the file's last write, or null if it doesn't exist. */
      lastBackupAt: string | null
      /** True when the on-disk backup matches the live store. */
      upToDate: boolean
      /** Resumes currently in this machine's DB. */
      resumeCount: number
      /** Resumes in the backup file, or null if it doesn't exist. */
      backupResumeCount: number | null
    }

/** Result of merging the synced backup into this DB. */
export interface RestoreSummary {
  inserted: number
  updated: number
  skipped: number
  deleted: number
}

/** `llm` reuses the app's configured AI model — see server/translate.ts. */
export type TranslateProvider = 'off' | 'libretranslate' | 'deepl' | 'google' | 'azure' | 'llm'

/**
 * Whether an LLM is configured, where it runs, and what it's rated for.
 * `local` is what the UI's privacy line is built on and `highEnd` is what the
 * advanced assists are gated on, so both are only ever true when the server
 * said so.
 */
export interface AssistStatus {
  configured: boolean
  provider: string
  model: string
  local: boolean
  /** The operator declared this model strong enough for the advanced assists. */
  highEnd: boolean
}

export const ASSIST_OFF: AssistStatus = { configured: false, provider: '', model: '', local: false, highEnd: false }
export type LlmProvider =
  | 'off' | 'ollama' | 'openai' | 'compat' | 'anthropic' | 'gemini' | 'mistral'

/** Editable settings as returned to the client (API keys masked to booleans). */
export interface SettingsView {
  translate_provider: TranslateProvider
  libretranslate_url: string
  libretranslate_api_key_set: boolean
  translate_docker: boolean
  deepl_api_key_set: boolean
  google_api_key_set: boolean
  azure_api_key_set: boolean
  azure_region: string
  /** App locale codes installed in the Docker LibreTranslate (LT_LOAD_ONLY). */
  translate_languages: string[]
  backup_dir: string
  backup_interval_ms: number
  llm_provider: LlmProvider
  llm_ollama_url: string
  llm_docker: boolean
  llm_openai_api_key_set: boolean
  llm_compat_url: string
  llm_compat_api_key_set: boolean
  llm_anthropic_api_key_set: boolean
  llm_gemini_api_key_set: boolean
  llm_mistral_api_key_set: boolean
  llm_model: string
  llm_high_end: boolean
}

/** One subdirectory in the folder-picker listing. */
export interface FolderEntry { name: string; path: string }

/** POST /api/settings/folders response — a folder + its immediate subfolders. */
export interface FolderListing {
  path: string
  parent: string | null
  home: string
  sep: string
  entries: FolderEntry[]
}

/** GET /api/settings response. `managed` is false on env-driven (VPS) builds. */
export interface SettingsStatus {
  managed: boolean
  settings: SettingsView
  translate: { configured: boolean }
  llm: { configured: boolean }
}

/** Partial settings update (only sent keys change; api keys omitted = unchanged). */
export interface SettingsUpdate {
  translate_provider?: TranslateProvider
  libretranslate_url?: string
  libretranslate_api_key?: string
  translate_docker?: boolean
  deepl_api_key?: string
  google_api_key?: string
  azure_api_key?: string
  azure_region?: string
  translate_languages?: string[]
  backup_dir?: string
  backup_interval_ms?: number
  llm_provider?: LlmProvider
  llm_ollama_url?: string
  llm_docker?: boolean
  llm_openai_api_key?: string
  llm_compat_url?: string
  llm_compat_api_key?: string
  llm_anthropic_api_key?: string
  llm_gemini_api_key?: string
  llm_mistral_api_key?: string
  llm_model?: string
  llm_high_end?: boolean
}

export interface TranslateTestResult { reachable: boolean; languages?: number; message: string }
export interface DockerActionResult { ok?: boolean; available: boolean; reachable?: boolean; message: string }

export type UpdateState =
  | 'idle' | 'checking' | 'available' | 'uptodate' | 'downloading' | 'staged' | 'applying' | 'error'

/** Auto-update status (desktop build). `supported:false` on web/VPS builds. */
export interface UpdateStatus {
  supported: boolean
  state: UpdateState
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  /** True only when a per-platform build exists to install in place. An update
   *  can be available but not downloadable (no matching asset) — then the UI
   *  links to the release page instead of offering Install. */
  downloadable: boolean
  /** Download progress 0..1 while state === 'downloading'. */
  progress: number
  lastCheckedAt: string | null
  notes: string
  htmlUrl: string | null
  error: string | null
}

const UPDATE_UNSUPPORTED: UpdateStatus = {
  supported: false, state: 'idle', currentVersion: '0.0.0', latestVersion: null,
  updateAvailable: false, downloadable: false, progress: 0, lastCheckedAt: null,
  notes: '', htmlUrl: null, error: null,
}

// ─── API surface ──────────────────────────────────────────────────────────────

export const api = {
  /**
   * Check that the server is reachable. Returns true/false — never throws.
   * No auth required (health endpoint is always public).
   */
  async health(): Promise<boolean> {
    return safe(async () => {
      const res = await fetch('/api/health')
      return res.ok
    }, false)
  },

  // ── Auth (cookie session) ─────────────────────────────────────────────────

  /**
   * Exchange the API token for an HttpOnly session cookie. On success the
   * cookie is set by the server and subsequent requests are authenticated
   * automatically. Throws UnauthorizedError on a wrong token, ServerError
   * otherwise.
   */
  async login(token: string): Promise<void> {
    const res = await request('POST', '/api/auth/login', { token })
    if (!res.ok) throw new ServerError(res.status, `Login failed: ${res.statusText}`)
  },

  /** Clear the session cookie. Best-effort — never throws. */
  async logout(): Promise<void> {
    return safe(async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    }, undefined)
  },

  // ── Resume collection ────────────────────────────────────────────────────

  /** List every resume's metadata, newest-saved first. */
  async listResumes(): Promise<ResumeMeta[]> {
    const res = await request('GET', '/api/resumes')
    if (!res.ok) throw new ServerError(res.status, `Could not list resumes: ${res.statusText}`)
    const json = await res.json() as { resumes: ResumeMeta[] }
    return json.resumes
  },

  /** Create a new resume. Returns its metadata (incl. server-generated id). */
  async createResume(input: CreateResumeInput): Promise<ResumeMeta> {
    const res = await request('POST', '/api/resumes', input)
    if (!res.ok) throw new ServerError(res.status, `Could not create resume: ${res.statusText}`)
    const json = await res.json() as { resume: ResumeMeta }
    return json.resume
  },

  /**
   * Load one resume's full data + metadata. Returns null if the id doesn't
   * exist (server 404). Throws UnauthorizedError if the token is missing/wrong.
   */
  async loadResume(id: string): Promise<{ data: ResumeStore; meta: ResumeMeta } | null> {
    const res = await request('GET', `/api/resumes/${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    if (!res.ok) throw new ServerError(res.status, `Load failed: ${res.statusText}`)
    const json = await res.json() as { data: ResumeStore; meta: ResumeMeta }
    return json
  },

  /**
   * Persist resume data (and optionally locales) to a specific resume id.
   * Returns the new server `version` (and `saved_at`).
   *
   * Pass `baseVersion` to enable optimistic concurrency: if the server's
   * version has moved on, the save is refused and this throws `ConflictError`
   * with the live server state. Omit it to force-write (e.g. after the user
   * resolves a conflict "keep mine").
   *
   * Pass an `AbortSignal` to cancel an in-flight save when a newer one fires —
   * the resulting AbortError can be detected with `isAbortError()`.
   *
   * Throws NotFoundError (404), ConflictError (409), UnauthorizedError (401),
   * or ServerError otherwise.
   */
  async saveResume(
    id: string,
    data: ResumeStore,
    locales?: LocaleUpdate,
    baseVersion?: number,
    signal?: AbortSignal,
  ): Promise<{ saved_at: string; version: number }> {
    const body: Record<string, unknown> = { data }
    if (locales) {
      body.primary_locale = locales.primary_locale
      body.secondary_locale = locales.secondary_locale
    }
    if (baseVersion !== undefined) body.base_version = baseVersion

    const res = await request('PUT', `/api/resumes/${encodeURIComponent(id)}`, body, signal)
    if (res.status === 404) throw new NotFoundError('Resume not found')
    if (res.status === 409) {
      const json = await res.json() as { current: { data: ResumeStore; meta: ResumeMeta } }
      throw new ConflictError(json.current)
    }
    if (!res.ok) throw new ServerError(res.status, `Save failed: ${res.statusText}`)
    const json = await res.json() as { saved_at: string; version: number }
    return { saved_at: json.saved_at, version: json.version }
  },

  /** Rename a resume. Throws NotFoundError if the id is unknown. */
  async patchResume(id: string, patch: { name: string }): Promise<void> {
    const res = await request('PATCH', `/api/resumes/${encodeURIComponent(id)}`, patch)
    if (res.status === 404) throw new NotFoundError('Resume not found')
    if (!res.ok) throw new ServerError(res.status, `Rename failed: ${res.statusText}`)
  },

  /** Hard-delete a resume. Snapshots cascade. */
  async deleteResume(id: string): Promise<void> {
    const res = await request('DELETE', `/api/resumes/${encodeURIComponent(id)}`)
    if (res.status === 404) throw new NotFoundError('Resume not found')
    if (!res.ok) throw new ServerError(res.status, `Delete failed: ${res.statusText}`)
  },

  /**
   * Per-resume payload weights + DB size (the A4 storage readout). Best-effort
   * decoration for the picker: returns null on any failure rather than
   * throwing, so a stats hiccup never blocks listing resumes.
   */
  async storageStats(): Promise<StorageStats | null> {
    return safe(async () => {
      const res = await request('GET', '/api/resumes/storage')
      if (!res.ok) return null
      return await res.json() as StorageStats
    }, null)
  },

  // ── Snapshot history (per resume) ────────────────────────────────────────

  /** List saved snapshots for a resume (newest first, metadata only). */
  async listSnapshots(resumeId: string): Promise<SnapshotMeta[]> {
    const res = await request('GET', `/api/resumes/${encodeURIComponent(resumeId)}/snapshots`)
    if (!res.ok) throw new ServerError(res.status, `Could not list snapshots: ${res.statusText}`)
    const json = await res.json() as { snapshots: SnapshotMeta[] }
    return json.snapshots
  },

  /** Fetch one snapshot's full resume data. */
  async getSnapshot(resumeId: string, snapshotId: number): Promise<ResumeStore> {
    const res = await request(
      'GET',
      `/api/resumes/${encodeURIComponent(resumeId)}/snapshots/${snapshotId}`,
    )
    if (!res.ok) throw new ServerError(res.status, `Could not load snapshot: ${res.statusText}`)
    const json = await res.json() as { data: ResumeStore }
    return json.data
  },

  // ── Instance registry (cross-resume shared registries) ────────────────────

  /** List the instance-level canonical registry entries, optionally one kind. */
  async listRegistry(kind?: RegistryKind): Promise<RegistryEntry[]> {
    const q = kind ? `?kind=${encodeURIComponent(kind)}` : ''
    const res = await request('GET', `/api/registry${q}`)
    if (!res.ok) throw new ServerError(res.status, `Could not list registry: ${res.statusText}`)
    const json = await res.json() as { entries: RegistryEntry[] }
    return json.entries
  },

  /** Create a canonical registry entry. Returns the created entry (version 1). */
  async createRegistryEntry(input: { kind: RegistryKind; name: LocalizedString; extra?: RegistryEntry['extra'] }): Promise<RegistryEntry> {
    const res = await request('POST', '/api/registry', input)
    if (!res.ok) throw new ServerError(res.status, `Could not create registry entry: ${res.statusText}`)
    const json = await res.json() as { entry: RegistryEntry }
    return json.entry
  },

  /**
   * Update a canonical entry (rename / re-classify). Pass `base_version` for
   * optimistic concurrency — a stale token throws ConflictError with the current
   * entry, mirroring the resume save contract.
   */
  async updateRegistryEntry(
    id: string,
    input: { name: LocalizedString; extra?: RegistryEntry['extra']; base_version?: number },
  ): Promise<RegistryEntry> {
    const res = await request('PUT', `/api/registry/${encodeURIComponent(id)}`, input)
    if (res.status === 409) {
      const json = await res.json().catch(() => ({})) as { current?: RegistryEntry }
      throw new RegistryConflictError(json.current ?? null)
    }
    if (!res.ok) throw new ServerError(res.status, `Could not update registry entry: ${res.statusText}`)
    const json = await res.json() as { entry: RegistryEntry }
    return json.entry
  },

  /** Delete a canonical entry. Returns whether a row was removed. */
  async deleteRegistryEntry(id: string): Promise<boolean> {
    const res = await request('DELETE', `/api/registry/${encodeURIComponent(id)}`)
    if (!res.ok) throw new ServerError(res.status, `Could not delete registry entry: ${res.statusText}`)
    const json = await res.json() as { deleted: boolean }
    return json.deleted
  },

  // ── Translation assist ──────────────────────────────────────────────────

  /**
   * Whether the server has a LibreTranslate instance configured. Never
   * throws — returns false on any error so the UI just hides the feature.
   */
  async translateStatus(): Promise<boolean> {
    return safe(async () => {
      const res = await request('GET', '/api/translate/status')
      if (!res.ok) return false
      const json = await res.json() as { configured?: boolean }
      return json.configured === true
    }, false)
  },

  /**
   * Draft-translate a single field. `source`/`target` are app locale codes
   * (e.g. 'en', 'no'). Throws ServerError with a user-safe message on failure.
   */
  async translate(
    text: string, source: string, target: string, glossary?: GlossaryPayload,
  ): Promise<string> {
    const res = await request('POST', '/api/translate', { text, source, target, glossary })
    if (!res.ok) {
      await fail(res, 'Translation failed')
    }
    const json = await res.json() as { translation: string }
    return json.translation
  },

  // ── Store backup / sync (desktop build) ──────────────────────────────────

  /**
   * Where/whether the synced store-backup is configured, and whether it's
   * current. Never throws — returns `{ configured: false }` on any error so a
   * web/VPS deployment (no sync folder) simply hides the feature.
   */
  async backupStatus(): Promise<BackupStatus> {
    return safe(async () => {
      const res = await request('GET', '/api/backup/status')
      if (!res.ok) return { configured: false }
      return await res.json() as BackupStatus
    }, { configured: false })
  },

  /** Write the whole store to the sync folder now. Throws ServerError on failure. */
  async backupNow(): Promise<{ file: string; bytes: number; resumeCount: number }> {
    const res = await request('POST', '/api/backup/now')
    if (!res.ok) {
      await fail(res, 'Backup failed')
    }
    return await res.json() as { file: string; bytes: number; resumeCount: number }
  },

  /**
   * Merge the synced backup into this machine's DB. 'merge' (default) is
   * newest-wins per resume and never deletes; 'replace' also drops local
   * resumes absent from the backup. Throws ServerError on failure.
   */
  async restoreBackup(mode: 'merge' | 'replace' = 'merge'): Promise<RestoreSummary> {
    const res = await request('POST', '/api/backup/restore', { mode })
    if (!res.ok) {
      await fail(res, 'Restore failed')
    }
    return await res.json() as RestoreSummary
  },

  // ── Settings (desktop build) ─────────────────────────────────────────────

  /** Current settings + whether they're editable here (`managed`). */
  async getSettings(): Promise<SettingsStatus> {
    const res = await request('GET', '/api/settings')
    if (!res.ok) throw new ServerError(res.status, `Could not load settings: ${res.statusText}`)
    return await res.json() as SettingsStatus
  },

  /**
   * List a folder's subdirectories for the backup-folder picker (desktop only).
   * Pass no path (or '') for the user's home directory. Throws on failure so the
   * picker can show the reason (e.g. an unreadable folder).
   */
  async browseFolders(path?: string): Promise<FolderListing> {
    const res = await request('POST', '/api/settings/folders', { path: path ?? '' })
    if (!res.ok) {
      if (res.status === 401) throw new UnauthorizedError()
      await fail(res, 'Could not list that folder')
    }
    return await res.json() as FolderListing
  },

  /** Persist a settings change; returns the refreshed status. */
  async saveSettings(update: SettingsUpdate): Promise<SettingsStatus> {
    const res = await request('PUT', '/api/settings', update)
    if (!res.ok) {
      await fail(res, 'Could not save settings')
    }
    return await res.json() as SettingsStatus
  },

  /**
   * Test a translation config by drafting one short phrase. Pass the pending
   * form values (provider + any typed keys/url/region); anything omitted falls
   * back to the saved config server-side, so a masked (un-retyped) key still
   * works. Never throws.
   */
  async testTranslate(input?: SettingsUpdate): Promise<TranslateTestResult> {
    return safe(async () => {
      const res = await request('POST', '/api/settings/translate/test', input ?? {})
      if (!res.ok) return { reachable: false, message: `Test failed (${res.status})` }
      return await res.json() as TranslateTestResult
    }, { reachable: false, message: 'Test request failed.' })
  },

  /** Start/stop/status the managed Docker LibreTranslate. Never throws. */
  async translateDocker(action: 'start' | 'stop' | 'status'): Promise<DockerActionResult> {
    return safe(async () => {
      const res = await request('POST', '/api/settings/docker', { action })
      if (!res.ok) {
        return { available: false, message: await serverMessage(res, `Docker ${action} failed (${res.status})`) }
      }
      return await res.json() as DockerActionResult
    }, { available: false, message: `Docker ${action} request failed.` })
  },

  // ── The AI model behind every assist ──────────────────────────────────────

  /**
   * Whether an LLM backend is configured, WHERE it runs, and whether it's rated
   * high-end. Never throws — an unreachable server reads as "not configured",
   * which hides the AI affordances rather than showing broken ones.
   */
  async llmStatus(): Promise<AssistStatus> {
    return safe(async () => {
      const res = await request('GET', '/api/llm/status')
      if (!res.ok) return ASSIST_OFF
      const json = await res.json() as Partial<AssistStatus> & { high_end?: boolean }
      if (json.configured !== true) return ASSIST_OFF
      return {
        configured: true,
        provider: json.provider ?? '',
        model: json.model ?? '',
        // Fail CLOSED on both flags: if the server didn't say it's local, assume
        // it isn't (getting that wrong promises privacy we don't have); if it
        // didn't say high-end, assume it isn't (getting that wrong runs a
        // whole-CV review on a 3B model and presents the result as advice).
        local: json.local === true,
        highEnd: json.high_end === true,
      }
    }, ASSIST_OFF)
  },

  /**
   * Run one assist prompt against the configured model. Throws on failure.
   * `advanced` asks for the high-end budget (bigger prompt, longer reply and
   * timeout) and is refused server-side unless the model is declared high-end.
   */
  async llmComplete(prompt: string, maxTokens?: number, advanced?: boolean): Promise<string> {
    const res = await request('POST', '/api/llm/complete', { prompt, max_tokens: maxTokens, advanced })
    if (!res.ok) {
      if (res.status === 401) throw new UnauthorizedError()
      // A plain Error, not ServerError: the assist UIs surface `.message`
      // directly and don't branch on the status.
      throw new Error(await serverMessage(res, `The AI model could not complete that request (${res.status})`))
    }
    const json = await res.json() as { text?: string }
    if (typeof json.text !== 'string' || !json.text.trim()) throw new Error('The AI model returned no text')
    return json.text
  },

  /** Summarize a long description into one line in `locale`'s language. Throws on failure. */
  async summarize(text: string, locale: string): Promise<string> {
    const res = await request('POST', '/api/summarize', { text, locale })
    if (!res.ok) {
      await fail(res, 'Summarize failed')
    }
    const json = await res.json() as { summary: string }
    return json.summary
  },

  /** Test the AI-assist config with one tiny request. Never throws. */
  async testLlm(input?: SettingsUpdate): Promise<TranslateTestResult> {
    return safe(async () => {
      const res = await request('POST', '/api/settings/llm/test', input ?? {})
      if (!res.ok) return { reachable: false, message: `Test failed (${res.status})` }
      return await res.json() as TranslateTestResult
    }, { reachable: false, message: 'Test request failed.' })
  },

  /** Start/stop/status the managed Docker Ollama. `model` used on start. Never throws. */
  async ollamaDocker(action: 'start' | 'stop' | 'status', model?: string): Promise<DockerActionResult> {
    return safe(async () => {
      const res = await request('POST', '/api/settings/llm/docker', { action, model })
      if (!res.ok) {
        return { available: false, message: await serverMessage(res, `Docker ${action} failed (${res.status})`) }
      }
      return await res.json() as DockerActionResult
    }, { available: false, message: `Docker ${action} request failed.` })
  },

  /**
   * Models the configured Ollama has pulled, for the settings model picker.
   * Never throws — an empty list just means "nothing to merge with the curated
   * catalog" (instance down, or a provider we can't enumerate).
   */
  async ollamaModels(): Promise<InstalledModel[]> {
    return safe(async () => {
      const res = await request('GET', '/api/llm/models')
      if (!res.ok) return []
      const json = await res.json() as { models?: InstalledModel[] }
      return Array.isArray(json.models) ? json.models : []
    }, [])
  },

  // ── Auto-update (desktop build) ──────────────────────────────────────────

  /**
   * Current update status. Never throws — returns an `unsupported` snapshot on
   * any error, so web/VPS builds (and an unreachable server) simply hide the UI.
   */
  async updateStatus(): Promise<UpdateStatus> {
    return safe(async () => {
      const res = await request('GET', '/api/update/status')
      if (!res.ok) return UPDATE_UNSUPPORTED
      return await res.json() as UpdateStatus
    }, UPDATE_UNSUPPORTED)
  },

  /** Force a GitHub check now; returns the refreshed status. Throws on failure. */
  async checkForUpdate(): Promise<UpdateStatus> {
    const res = await request('POST', '/api/update/check')
    if (!res.ok) {
      await fail(res, 'Update check failed')
    }
    return await res.json() as UpdateStatus
  },

  /**
   * Begin downloading + installing the available update. Resolves on the 202
   * accept; the app then swaps files and restarts. Throws ServerError on 409
   * (nothing to install) / 403 (not the desktop build).
   */
  async installUpdate(): Promise<void> {
    const res = await request('POST', '/api/update/install')
    if (!res.ok) {
      await fail(res, 'Could not start the update')
    }
  },
}
