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

// ─── HTTP base ────────────────────────────────────────────────────────────────

async function request(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const token = getStoredToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) throw new UnauthorizedError()
  return res
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

  /**
   * Load the stored resume from the server.
   * Returns null if no resume has been saved yet (server returns 404).
   * Throws UnauthorizedError if the token is missing/wrong.
   */
  async load(): Promise<ResumeStore | null> {
    const res = await request('GET', '/api/resume')
    if (res.status === 404) return null
    if (!res.ok) throw new ServerError(res.status, `Load failed: ${res.statusText}`)
    const json = await res.json() as { data: ResumeStore }
    return json.data
  },

  /**
   * Persist the current store to the server.
   * Throws UnauthorizedError or ServerError on failure.
   */
  async save(data: ResumeStore): Promise<void> {
    const res = await request('PUT', '/api/resume', data)
    if (!res.ok) throw new ServerError(res.status, `Save failed: ${res.statusText}`)
  },
}
