import type { ResumeStore } from '../types'

// ─── Auth token (session-scoped) ──────────────────────────────────────────────

const TOKEN_KEY = 'resumestudio-api-token'

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setStoredToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token.trim())
}

export function clearStoredToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

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

  const token = getStoredToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, {
    method,
    headers,
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
}

export interface SnapshotMeta {
  id: number
  saved_at: string
  size: number
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
}
