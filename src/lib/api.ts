import type { ResumeStore } from '../types'
import type { StorageStats } from './storage'
import type { InstalledModel } from './ollamaCatalog'

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

/** `llm` reuses the model configured for Summarize — see server/translate.ts. */
export type TranslateProvider = 'off' | 'libretranslate' | 'deepl' | 'google' | 'azure' | 'llm'

/**
 * Whether an LLM is configured and where it runs. `local` is what the UI's
 * privacy line is built on, so it is only ever true when the server said so.
 */
export interface AssistStatus {
  configured: boolean
  provider: string
  model: string
  local: boolean
}

export const ASSIST_OFF: AssistStatus = { configured: false, provider: '', model: '', local: false }
export type SummarizeProvider = 'off' | 'ollama' | 'openai' | 'compat'

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
  summarize_provider: SummarizeProvider
  summarize_ollama_url: string
  summarize_docker: boolean
  summarize_openai_api_key_set: boolean
  summarize_compat_url: string
  summarize_compat_api_key_set: boolean
  summarize_model: string
}

/** GET /api/settings response. `managed` is false on env-driven (VPS) builds. */
export interface SettingsStatus {
  managed: boolean
  settings: SettingsView
  translate: { configured: boolean }
  summarize: { configured: boolean }
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
  summarize_provider?: SummarizeProvider
  summarize_ollama_url?: string
  summarize_docker?: boolean
  summarize_openai_api_key?: string
  summarize_compat_url?: string
  summarize_compat_api_key?: string
  summarize_model?: string
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
    try {
      const res = await fetch('/api/health')
      return res.ok
    } catch {
      return false
    }
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
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      /* best-effort */
    }
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
    try {
      const res = await request('GET', '/api/resumes/storage')
      if (!res.ok) return null
      return await res.json() as StorageStats
    } catch {
      return null
    }
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

  // ── Translation assist ──────────────────────────────────────────────────

  /**
   * Whether the server has a LibreTranslate instance configured. Never
   * throws — returns false on any error so the UI just hides the feature.
   */
  async translateStatus(): Promise<boolean> {
    try {
      const res = await request('GET', '/api/translate/status')
      if (!res.ok) return false
      const json = await res.json() as { configured?: boolean }
      return json.configured === true
    } catch {
      return false
    }
  },

  /**
   * Draft-translate a single field. `source`/`target` are app locale codes
   * (e.g. 'en', 'no'). Throws ServerError with a user-safe message on failure.
   */
  async translate(text: string, source: string, target: string): Promise<string> {
    const res = await request('POST', '/api/translate', { text, source, target })
    if (!res.ok) {
      let message = `Translation failed (${res.status})`
      try {
        const json = await res.json() as { error?: string }
        if (json.error) message = json.error
      } catch { /* keep default */ }
      throw new ServerError(res.status, message)
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
    try {
      const res = await request('GET', '/api/backup/status')
      if (!res.ok) return { configured: false }
      return await res.json() as BackupStatus
    } catch {
      return { configured: false }
    }
  },

  /** Write the whole store to the sync folder now. Throws ServerError on failure. */
  async backupNow(): Promise<{ file: string; bytes: number; resumeCount: number }> {
    const res = await request('POST', '/api/backup/now')
    if (!res.ok) {
      let message = `Backup failed (${res.status})`
      try {
        const json = await res.json() as { error?: string }
        if (json.error) message = json.error
      } catch { /* keep default */ }
      throw new ServerError(res.status, message)
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
      let message = `Restore failed (${res.status})`
      try {
        const json = await res.json() as { error?: string }
        if (json.error) message = json.error
      } catch { /* keep default */ }
      throw new ServerError(res.status, message)
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

  /** Persist a settings change; returns the refreshed status. */
  async saveSettings(update: SettingsUpdate): Promise<SettingsStatus> {
    const res = await request('PUT', '/api/settings', update)
    if (!res.ok) {
      let message = `Could not save settings (${res.status})`
      try {
        const json = await res.json() as { error?: string }
        if (json.error) message = json.error
      } catch { /* keep default */ }
      throw new ServerError(res.status, message)
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
    try {
      const res = await request('POST', '/api/settings/translate/test', input ?? {})
      if (!res.ok) return { reachable: false, message: `Test failed (${res.status})` }
      return await res.json() as TranslateTestResult
    } catch {
      return { reachable: false, message: 'Test request failed.' }
    }
  },

  /** Start/stop/status the managed Docker LibreTranslate. Never throws. */
  async translateDocker(action: 'start' | 'stop' | 'status'): Promise<DockerActionResult> {
    try {
      const res = await request('POST', '/api/settings/docker', { action })
      if (!res.ok) {
        let message = `Docker ${action} failed (${res.status})`
        try {
          const json = await res.json() as { error?: string }
          if (json.error) message = json.error
        } catch { /* keep default */ }
        return { available: false, message }
      }
      return await res.json() as DockerActionResult
    } catch {
      return { available: false, message: `Docker ${action} request failed.` }
    }
  },

  // ── Summarize (AI short descriptions) ─────────────────────────────────────

  /** Is an LLM summarize backend configured? Never throws. */
  /**
   * Whether an LLM backend is configured and WHERE it runs. Never throws — an
   * unreachable server reads as "not configured", which hides the AI affordances
   * rather than showing broken ones.
   */
  async summarizeStatus(): Promise<AssistStatus> {
    try {
      const res = await request('GET', '/api/summarize/status')
      if (!res.ok) return ASSIST_OFF
      const json = await res.json() as Partial<AssistStatus>
      if (json.configured !== true) return ASSIST_OFF
      return {
        configured: true,
        provider: json.provider ?? '',
        model: json.model ?? '',
        // Fail CLOSED: if the server didn't say it's local, assume it isn't.
        // Getting this wrong the other way would promise privacy we don't have.
        local: json.local === true,
      }
    } catch {
      return ASSIST_OFF
    }
  },

  /** Run one assist prompt against the configured model. Throws on failure. */
  async llmComplete(prompt: string, maxTokens?: number): Promise<string> {
    const res = await request('POST', '/api/llm/complete', { prompt, max_tokens: maxTokens })
    if (!res.ok) {
      if (res.status === 401) throw new UnauthorizedError()
      let message = `The AI model could not complete that request (${res.status})`
      try {
        const json = await res.json() as { error?: string }
        if (json.error) message = json.error
      } catch { /* keep default */ }
      throw new Error(message)
    }
    const json = await res.json() as { text?: string }
    if (typeof json.text !== 'string' || !json.text.trim()) throw new Error('The AI model returned no text')
    return json.text
  },

  /** Summarize a long description into one line in `locale`'s language. Throws on failure. */
  async summarize(text: string, locale: string): Promise<string> {
    const res = await request('POST', '/api/summarize', { text, locale })
    if (!res.ok) {
      let message = `Summarize failed (${res.status})`
      try {
        const json = await res.json() as { error?: string }
        if (json.error) message = json.error
      } catch { /* keep default */ }
      throw new ServerError(res.status, message)
    }
    const json = await res.json() as { summary: string }
    return json.summary
  },

  /** Test a summarize config with one tiny request. Never throws. */
  async testSummarize(input?: SettingsUpdate): Promise<TranslateTestResult> {
    try {
      const res = await request('POST', '/api/settings/summarize/test', input ?? {})
      if (!res.ok) return { reachable: false, message: `Test failed (${res.status})` }
      return await res.json() as TranslateTestResult
    } catch {
      return { reachable: false, message: 'Test request failed.' }
    }
  },

  /** Start/stop/status the managed Docker Ollama. `model` used on start. Never throws. */
  async summarizeDocker(action: 'start' | 'stop' | 'status', model?: string): Promise<DockerActionResult> {
    try {
      const res = await request('POST', '/api/settings/summarize/docker', { action, model })
      if (!res.ok) {
        let message = `Docker ${action} failed (${res.status})`
        try {
          const json = await res.json() as { error?: string }
          if (json.error) message = json.error
        } catch { /* keep default */ }
        return { available: false, message }
      }
      return await res.json() as DockerActionResult
    } catch {
      return { available: false, message: `Docker ${action} request failed.` }
    }
  },

  /**
   * Models the configured Ollama has pulled, for the settings model picker.
   * Never throws — an empty list just means "nothing to merge with the curated
   * catalog" (instance down, or a provider we can't enumerate).
   */
  async summarizeModels(): Promise<InstalledModel[]> {
    try {
      const res = await request('GET', '/api/summarize/models')
      if (!res.ok) return []
      const json = await res.json() as { models?: InstalledModel[] }
      return Array.isArray(json.models) ? json.models : []
    } catch {
      return []
    }
  },

  // ── Auto-update (desktop build) ──────────────────────────────────────────

  /**
   * Current update status. Never throws — returns an `unsupported` snapshot on
   * any error, so web/VPS builds (and an unreachable server) simply hide the UI.
   */
  async updateStatus(): Promise<UpdateStatus> {
    try {
      const res = await request('GET', '/api/update/status')
      if (!res.ok) return UPDATE_UNSUPPORTED
      return await res.json() as UpdateStatus
    } catch {
      return UPDATE_UNSUPPORTED
    }
  },

  /** Force a GitHub check now; returns the refreshed status. Throws on failure. */
  async checkForUpdate(): Promise<UpdateStatus> {
    const res = await request('POST', '/api/update/check')
    if (!res.ok) {
      let message = `Update check failed (${res.status})`
      try {
        const json = await res.json() as { error?: string }
        if (json.error) message = json.error
      } catch { /* keep default */ }
      throw new ServerError(res.status, message)
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
      let message = `Could not start the update (${res.status})`
      try {
        const json = await res.json() as { error?: string }
        if (json.error) message = json.error
      } catch { /* keep default */ }
      throw new ServerError(res.status, message)
    }
  },
}
