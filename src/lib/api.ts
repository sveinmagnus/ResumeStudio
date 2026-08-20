import type { ResumeStore, LocalizedString, RegistryEntry, RegistryKind } from '../types'
import type { StorageStats } from './storage'
import type { LiveModel } from './modelPicker'
import type { GlossaryPayload } from './glossary'
import { downloadBlob } from './download'

// ─── Auth ──────────────────────────────────────────────────────────────────────
//
// The credential is NOT stored in JS-readable storage. The client POSTs it once
// to /api/auth/login, which sets an HttpOnly + SameSite=Strict session cookie
// carrying an opaque session id; every subsequent request carries that cookie
// automatically (same-origin fetch), so an XSS bug cannot read or exfiltrate it.
// `api.login` / `api.loginWithPassword` / `api.logout` below drive that exchange.
//
// The `rs_csrf` cookie is the deliberate opposite: readable by design, because
// echoing it in a header is the whole double-submit mechanism (server/csrf.ts).
// It is not a credential — it grants nothing without the session cookie.

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

/** Methods the server's CSRF middleware protects. GET/HEAD are not. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const CSRF_COOKIE = 'rs_csrf'
const CSRF_HEADER = 'x-csrf-token'

/**
 * The double-submit token the server put in a readable cookie.
 *
 * Empty when there is none — an instance running without accounts never sets
 * it, and the middleware only enforces the header on requests that carry a
 * session cookie, so sending nothing is correct rather than merely tolerated.
 */
function csrfToken(): string {
  if (typeof document === 'undefined') return ''
  const match = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`).exec(document.cookie)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    // A malformed escape means the cookie is unusable; an empty header is a
    // clean 403 rather than a decode exception thrown into every save.
    return ''
  }
}

/** Headers for one request: JSON content type + the CSRF echo where it applies. */
function headersFor(method: string, hasBody: boolean, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (hasBody) headers['Content-Type'] = contentType ?? 'application/json'
  if (UNSAFE_METHODS.has(method)) {
    const token = csrfToken()
    if (token) headers[CSRF_HEADER] = token
  }
  return headers
}

/**
 * One request, with no interpretation of the response.
 *
 * The auth and account endpoints answer 401 with a message the user must read
 * ("Wrong username or password."), so they go through this rather than
 * `request` — turning that into an `UnauthorizedError` would replace the
 * server's wording with a generic one and re-open the login screen the user is
 * already looking at.
 */
async function send(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: headersFor(method, body !== undefined),
    // Send the HttpOnly session cookie (same-origin). Auth is carried by the
    // cookie set at /api/auth/login — no token is attached from JS.
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })
}

async function request(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await send(method, url, body, signal)
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
  /**
   * The account that created it. Absent on a server without accounts, null for
   * a service credential and for rows that predate them. Compared against
   * `MeInfo.user_id` to decide whether this editor can write (see
   * `canWriteResume`).
   */
  owner_id?: string | null
  /** Who else may read it. Absent reads as `private` — the safe direction. */
  visibility?: Visibility
}

/** Who else may read a resume. Mirrors `server/access.ts`. */
export type Visibility = 'private' | 'instance'

export type Role = 'owner' | 'member'

/** How the server decides who may in. Mirrors `server/auth.ts → AuthMode`. */
export type AuthMode = 'open' | 'token' | 'accounts'

/** GET /api/auth/status — everything the sign-in screen may know before signing in. */
export interface AuthStatus {
  mode: AuthMode
  auth_required: boolean
  /** A first account can be created with the one-time code from the server log. */
  bootstrap_available: boolean
  /**
   * Whether this server can send a reset email. Absent on a server that does
   * not report it, which reads as "no" — so "Forgot password?" stays hidden
   * rather than offering a link that will never arrive.
   */
  mail_configured?: boolean
}

/** GET /api/auth/me — the identity the client could not previously ask for. */
export interface MeInfo {
  user_id: string | null
  name: string | null
  role: Role
  /** A shared service credential: authenticates, but is nobody. No profile. */
  service: boolean
  mode: AuthMode
}

/** GET /api/users/me — the signed-in person's own account. */
export interface AccountProfile {
  id: string
  username: string
  display_name: string
  email: string | null
  /** Only a verified address can receive a password reset. */
  email_verified: boolean
  role: Role
  recovery_codes_left: number
  mail_configured: boolean
}

/** One row of the owner's user list (GET /api/users). */
export interface TeamUser {
  id: string
  username: string
  display_name: string
  email: string | null
  email_verified_at: string | null
  role: Role
  created_at: string
  last_login_at: string | null
  disabled_at: string | null
}

/** The account a bootstrap/invite redemption created. */
export interface AccountSummary {
  id: string
  username: string
  display_name: string
  role: Role
}

/** POST /api/auth/bootstrap — the one-time first-run result. */
export interface BootstrapResult {
  user: AccountSummary
  /** Existing resumes that had no owner and now belong to this account. */
  claimed_resumes: number
  /** Shown ONCE. There is no second chance to read these. */
  recovery_codes: string[]
  /** Legacy named tokens turned into accounts; each needs a reset link. */
  converted_tokens: string[]
}

/** POST /api/users/accept — the invitee's new account, already signed in. */
export interface AcceptResult {
  user: AccountSummary
  recovery_codes: string[]
}

/** GET /api/users/invite/:token — what an invitation is for, unspent. */
export interface InviteInfo {
  role: Role
  email: string | null
}

/** Fields a profile edit may change. `email: ''` clears the address. */
export interface ProfileUpdate {
  display_name?: string
  username?: string
  email?: string
  /** Required by the server for a username or email change. */
  current_password?: string
}

/**
 * May this viewer change this resume?
 *
 * The client's copy of `server/access.ts → canWrite`, and it must stay a copy
 * of that rule rather than an approximation: the server answers a refused write
 * with 404 (so a member cannot enumerate ids), which the persistence layer
 * would otherwise show as "this resume was deleted" on somebody else's CV.
 *
 * Unknown either way (`meta.owner_id` absent, or no identity) reads as
 * writable, which is what every pre-accounts server and the desktop build are.
 */
export function canWriteResume(meta: Pick<ResumeMeta, 'owner_id'>, me: MeInfo | null): boolean {
  if (!me || me.role === 'owner') return true
  if (meta.owner_id === undefined) return true
  return meta.owner_id !== null && meta.owner_id === me.user_id
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

/** Sync-folder status. The folder holds one file per resume. */
export type BackupStatus =
  | { configured: false }
  | {
      configured: true
      /** The configured sync folder (e.g. a Google Drive path). */
      dir: string
      /**
       * Whether anything is polling to push edits out and watching to pull
       * other machines' in. Only the desktop launcher runs those; everywhere
       * else the manual routes work and nothing else does, so a UI that assumes
       * a background service promises one that isn't there.
       *
       * Absent (a server that predates the flag) reads as false — the honest
       * direction, since the copy it selects claims nothing.
       */
      continuous: boolean
      /** Whether the folder holds any resume files yet. */
      exists: boolean
      /** ISO timestamp of the folder's most recent write, or null if empty. */
      lastBackupAt: string | null
      /** True when every resume this machine holds is current in the folder. */
      upToDate: boolean
      /** Resumes currently in this machine's DB. */
      resumeCount: number
      /** Resumes across the folder's files, or null when the folder is empty. */
      backupResumeCount: number | null
      /** Resume files found in the folder. */
      fileCount: number
      /**
       * Name of the pre-split combined backup file, when the folder still has
       * one. It is retired automatically on the next write.
       */
      legacyFile: string | null
      /** Files that couldn't be read (mid-sync writes) — informational. */
      unreadable: string[]
    }

/** Result of merging a backup (folder or upload) into this DB. */
export interface RestoreSummary {
  inserted: number
  updated: number
  skipped: number
  deleted: number
  /** Shared-registry entries added/updated by the same merge. */
  registry?: { added: number; updated: number }
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
  /** Name this machine reaches the app at instead of 127.0.0.1 (empty = the IP). */
  local_hostname: string
  /** Preferred port; 0 = the automatic 80-then-1923 ladder. */
  local_port: number
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
  local_hostname?: string
  local_port?: number
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

/** What the server knows about one candidate local name for this machine. */
export interface HostnameStatus {
  hostname: string
  /** Path of the system hosts file, shown so the user can edit it themselves. */
  file: string
  /** Resolves with no setup at all (any `.localhost` name). */
  automatic: boolean
  installed: boolean
  /** The entry sits in this app's own block, so we can offer to remove it. */
  managed: boolean
  writable: boolean
  manualCommand: string
  note: string | null
}

export interface HostnameActionResult { ok: boolean; message: string; status: HostnameStatus }

export type UpdateState =
  | 'idle' | 'checking' | 'available' | 'uptodate' | 'downloading' | 'staged' | 'applying' | 'error'

/** Auto-update status (desktop build). `supported:false` on web/VPS builds. */
export interface UpdateStatus {
  supported: boolean
  state: UpdateState
  currentVersion: string
  /** The version as a HUMAN reads it, formatted by the server and rendered
   *  verbatim: `v0.10.2` for a released build, `Dev-<commit>` for anything
   *  else. Display sites must not re-prefix it — only a release build has a
   *  version number to put a `v` in front of. `currentVersion` stays the bare
   *  semver the updater compares. */
  versionLabel: string
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

/**
 * The version comparison alone, with nothing staged or downloaded. Available on
 * every build, which is the point: installing is desktop-only, so on a hosted
 * instance this is the only way to learn a release exists.
 */
export interface UpdateCheck {
  current: string
  latest: string
  update_available: boolean
  /** Release notes, already truncated by the server. */
  notes: string
  /** Whether this build can apply it itself. False on every hosted instance. */
  installable: boolean
}

const UPDATE_UNSUPPORTED: UpdateStatus = {
  supported: false, state: 'idle', currentVersion: '0.0.0', versionLabel: '', latestVersion: null,
  updateAvailable: false, downloadable: false, progress: 0, lastCheckedAt: null,
  notes: '', htmlUrl: null, error: null,
}

/**
 * What an unanswerable `/api/auth/status` reads as. `accounts` rather than
 * `open`, because assuming a server needs no credential is the failure that
 * shows an editor to whoever is at the keyboard.
 */
const AUTH_STATUS_UNKNOWN: AuthStatus = {
  mode: 'accounts', auth_required: true, bootstrap_available: false,
}

/**
 * The memoized answer to "who am I". One in-flight promise, shared, so the boot
 * path can ask from several places without a request each.
 */
let identity: Promise<MeInfo | null> | null = null

/**
 * Drop the memoized identity. Called wherever the session changes — sign in,
 * sign out, a redemption, a profile edit — because a stale answer here is what
 * decides whether the editor is read-only.
 */
export function forgetIdentity(): void {
  identity = null
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
    forgetIdentity()
  },

  /**
   * Sign in with an account. `login` is a username OR an email address — the
   * server accepts either and deliberately does not say which one matched.
   *
   * The 401 message is the server's own and is identical for a wrong name and a
   * wrong password; show it verbatim rather than rewording it into something
   * that hints which half was wrong.
   */
  async loginWithPassword(login: string, password: string): Promise<MeInfo | null> {
    const res = await send('POST', '/api/auth/login', { login, password })
    if (!res.ok) throw new ServerError(res.status, await serverMessage(res, 'Could not sign in.'))
    forgetIdentity()
    return api.me()
  },

  /** Clear the session cookie. Best-effort — never throws. */
  async logout(): Promise<void> {
    forgetIdentity()
    return safe(async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: headersFor('POST', false),
        credentials: 'same-origin',
      })
    }, undefined)
  },

  /**
   * What the sign-in screen may know before anyone has signed in. Never throws
   * — an unreachable server reads as "accounts, nothing available", which shows
   * a sign-in form rather than a broken page.
   */
  async authStatus(): Promise<AuthStatus> {
    return safe(async () => {
      const res = await fetch('/api/auth/status', { credentials: 'same-origin' })
      if (!res.ok) return AUTH_STATUS_UNKNOWN
      return await res.json() as AuthStatus
    }, AUTH_STATUS_UNKNOWN)
  },

  /**
   * Who am I? Null when nobody is signed in or the server cannot answer.
   *
   * Memoized for the process: every boot asks, and the answer only changes when
   * a session does — which is exactly where `forgetIdentity` is called.
   */
  async me(): Promise<MeInfo | null> {
    identity ??= safe(async () => {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
      if (!res.ok) return null
      return await res.json() as MeInfo
    }, null)
    return identity
  },

  /** Spend the one-time bootstrap code and create the first (owner) account. */
  async bootstrap(input: {
    code: string; username: string; display_name: string; password: string
  }): Promise<BootstrapResult> {
    const res = await send('POST', '/api/auth/bootstrap', input)
    if (!res.ok) {
      throw new ServerError(res.status, await serverMessage(res, 'Could not create the first account.'))
    }
    forgetIdentity()
    return await res.json() as BootstrapResult
  },

  // ── Ways back in (no session required) ────────────────────────────────────

  /**
   * Ask for a reset email. The server answers identically whether or not the
   * account exists — so this resolves rather than reporting a result, and the
   * caller must not imply one was sent.
   */
  async forgotPassword(login: string): Promise<void> {
    await send('POST', '/api/users/forgot', { login })
  },

  /** Redeem a reset link. Ends every session for that account, including ours. */
  async resetPassword(token: string, password: string): Promise<void> {
    const res = await send('POST', '/api/users/reset', { token, password })
    if (!res.ok) {
      throw new ServerError(res.status, await serverMessage(res, 'Could not reset the password.'))
    }
    forgetIdentity()
  },

  /** Spend a recovery code to set a new password. Returns how many are left. */
  async recoverWithCode(login: string, code: string, password: string): Promise<number> {
    const res = await send('POST', '/api/users/recover', { login, code, password })
    if (!res.ok) {
      throw new ServerError(res.status, await serverMessage(res, 'Could not use that recovery code.'))
    }
    forgetIdentity()
    const json = await res.json() as { codes_left?: number }
    return json.codes_left ?? 0
  },

  /** What an invitation is for, without spending it. Null when it is not valid. */
  async inviteInfo(token: string): Promise<InviteInfo | null> {
    return safe(async () => {
      const res = await send('GET', `/api/users/invite/${encodeURIComponent(token)}`)
      if (!res.ok) return null
      return await res.json() as InviteInfo
    }, null)
  },

  /** Redeem an invitation. The new account is signed in on success. */
  async acceptInvite(input: {
    token: string; username: string; display_name: string; password: string
  }): Promise<AcceptResult> {
    const res = await send('POST', '/api/users/accept', input)
    if (!res.ok) {
      throw new ServerError(res.status, await serverMessage(res, 'Could not create that account.'))
    }
    forgetIdentity()
    return await res.json() as AcceptResult
  },

  /** Confirm an email address so it can receive resets. */
  async verifyEmail(token: string): Promise<void> {
    const res = await send('POST', '/api/users/verify-email', { token })
    if (!res.ok) {
      throw new ServerError(res.status, await serverMessage(res, 'Could not confirm that address.'))
    }
  },

  // ── Your own account ──────────────────────────────────────────────────────

  /** The signed-in person's profile. */
  async profile(): Promise<AccountProfile> {
    const res = await request('GET', '/api/users/me')
    if (!res.ok) await fail(res, 'Could not load your profile')
    return await res.json() as AccountProfile
  },

  /**
   * Change the display name, username or email address. The server requires
   * `current_password` for either LOGIN identifier and answers 403 without it —
   * the UI asks for it up front rather than making the user discover that.
   */
  async updateProfile(update: ProfileUpdate): Promise<void> {
    const res = await request('PUT', '/api/users/me', update)
    if (!res.ok) await fail(res, 'Could not update your profile')
    forgetIdentity()
  },

  /**
   * Set a new password. The server ends every session for the account, so the
   * caller must expect to be signed out.
   */
  async changePassword(currentPassword: string, password: string): Promise<void> {
    const res = await request('POST', '/api/users/me/password', {
      current_password: currentPassword, password,
    })
    if (!res.ok) await fail(res, 'Could not change your password')
    forgetIdentity()
  },

  /** Issue a fresh set of recovery codes, invalidating the previous one. */
  async regenerateRecoveryCodes(): Promise<string[]> {
    const res = await request('POST', '/api/users/me/recovery-codes')
    if (!res.ok) await fail(res, 'Could not generate recovery codes')
    const json = await res.json() as { recovery_codes: string[] }
    return json.recovery_codes
  },

  /** Send (or resend) the address-verification link. */
  async sendVerificationEmail(): Promise<void> {
    const res = await request('POST', '/api/users/me/verify-email')
    if (!res.ok) await fail(res, 'Could not send that message')
  },

  // ── Everyone else's accounts (owner only) ─────────────────────────────────

  /** The user list. 403s for a member. */
  async listUsers(): Promise<TeamUser[]> {
    const res = await request('GET', '/api/users')
    if (!res.ok) await fail(res, 'Could not load the user list')
    const json = await res.json() as { users: TeamUser[] }
    return json.users
  },

  /**
   * Mint an invitation. The returned `url` is absolute when the server knows
   * its own address and a path otherwise — the owner passes it on themselves.
   */
  async inviteUser(input: { role: Role; email?: string }): Promise<{ url: string; token: string }> {
    const res = await request('POST', '/api/users/invite', input)
    if (!res.ok) await fail(res, 'Could not create an invitation')
    const json = await res.json() as { url: string; token: string }
    return { url: json.url, token: json.token }
  },

  /** Owner-side edit of somebody else's profile. No password required. */
  async updateUser(id: string, update: ProfileUpdate): Promise<void> {
    const res = await request('PUT', `/api/users/${encodeURIComponent(id)}`, update)
    if (!res.ok) await fail(res, 'Could not update that account')
  },

  /** Mint a reset link for another account, handed over out of band. */
  async userResetLink(id: string): Promise<string> {
    const res = await request('POST', `/api/users/${encodeURIComponent(id)}/reset-link`)
    if (!res.ok) await fail(res, 'Could not create a reset link')
    const json = await res.json() as { url: string }
    return json.url
  },

  /**
   * Disable or re-enable an account. Refused (409) for the last owner and for
   * your own account — surface the server's wording, it names the way out.
   */
  async setUserDisabled(id: string, disabled: boolean): Promise<void> {
    const res = await request('POST', `/api/users/${encodeURIComponent(id)}/disabled`, { disabled })
    if (!res.ok) await fail(res, 'Could not change that account')
  },

  /** Promote or demote. Refused (409) when it would leave no owner. */
  async setUserRole(id: string, role: Role): Promise<void> {
    const res = await request('POST', `/api/users/${encodeURIComponent(id)}/role`, { role })
    if (!res.ok) await fail(res, 'Could not change that role')
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
   * Hand a resume to another account, or to nobody (`null`).
   *
   * Owner-only. Refused as 404 rather than 403, like every other single-row
   * route, so the response set never tells a member which ids exist.
   */
  async setResumeOwner(id: string, ownerId: string | null): Promise<void> {
    const res = await request(
      'POST', `/api/resumes/${encodeURIComponent(id)}/owner`, { owner_id: ownerId },
    )
    if (res.status === 404) throw new NotFoundError('Resume not found')
    if (!res.ok) await fail(res, 'Could not change the owner')
  },

  /**
   * Share a resume with the rest of the instance, or take it back.
   *
   * `instance` grants READ to every member; it never grants write, which is
   * what makes sharing safe to switch on. Only the resume's owner (or an owner
   * -role account) may call this.
   */
  async setResumeVisibility(id: string, visibility: Visibility): Promise<void> {
    const res = await request(
      'POST', `/api/resumes/${encodeURIComponent(id)}/visibility`, { visibility },
    )
    if (res.status === 404) throw new NotFoundError('Resume not found')
    if (!res.ok) await fail(res, 'Could not change who can see this resume')
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

  /** Publish every resume to the sync folder now. Throws ServerError on failure. */
  async backupNow(): Promise<{ bytes: number; resumeCount: number; removed: number }> {
    const res = await request('POST', '/api/backup/now')
    if (!res.ok) {
      await fail(res, 'Backup failed')
    }
    return await res.json() as { bytes: number; resumeCount: number; removed: number }
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

  // ── Manual backup (every build) — the same per-resume files, in one zip ───

  /**
   * Download every resume as one zip: one file per person plus `resume-studio-registry.json`,
   * byte-identical in layout to the sync folder. Streams straight to the
   * browser's downloads; throws ServerError on failure.
   */
  async exportBackupZip(): Promise<void> {
    const res = await request('GET', '/api/backup/export')
    if (!res.ok) {
      await fail(res, 'Export failed')
    }
    // Prefer the server's filename (it carries the date) over reinventing one.
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const match = /filename="([^"]+)"/.exec(disposition)
    downloadBlob(await res.blob(), match?.[1] ?? 'resume-studio-backup.zip')
  },

  /**
   * Merge a backup FILE into this machine — a zip from `exportBackupZip`, a
   * single per-resume sync file, or a legacy combined backup.
   *
   * Identity is preserved: the server merges by resume id (newest `saved_at`
   * wins), so re-importing updates the resumes named in the file instead of
   * creating copies of them. That is the whole reason this exists rather than
   * routing our own backups through `createResume`.
   */
  async importBackupFile(file: File): Promise<RestoreSummary & { unreadable?: string[] }> {
    const isZip = /\.zip$/i.test(file.name)
    const res = await fetch('/api/backup/import', {
      method: 'POST',
      // Raw fetch rather than `request` — the body is the FILE, not JSON — so
      // the CSRF echo has to be asked for explicitly here.
      headers: headersFor('POST', true, isZip ? 'application/zip' : 'application/json'),
      credentials: 'same-origin',
      body: file,
    })
    if (res.status === 401) throw new UnauthorizedError()
    if (!res.ok) {
      await fail(res, 'Import failed')
    }
    return await res.json() as RestoreSummary & { unreadable?: string[] }
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

  /**
   * Inspect a candidate local name (`.local` / `.localhost`). Never throws — an
   * error reads as "not installed", which shows the Set-up button rather than a
   * broken panel.
   */
  async hostnameStatus(hostname: string): Promise<HostnameStatus | null> {
    return safe(async () => {
      const res = await request('POST', '/api/settings/hostname', { action: 'status', hostname })
      if (!res.ok) return null
      return await res.json() as HostnameStatus
    }, null)
  },

  /**
   * Add or remove the hosts-file entry for a `.local` name. The server asks the
   * OS for elevation, so this can take as long as the user takes to answer the
   * prompt — and reports honestly when they decline. Never throws.
   */
  async hostnameSetup(action: 'install' | 'uninstall', hostname: string): Promise<HostnameActionResult | null> {
    return safe(async () => {
      const res = await request('POST', '/api/settings/hostname', { action, hostname })
      if (!res.ok) return null
      return await res.json() as HostnameActionResult
    }, null)
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

  /**
   * Summarize a long description into one line in `locale`'s language. Throws
   * on failure.
   *
   * `context` is the entry's heading lines ("Customer: Statoil") — what the
   * reader already sees, and therefore what the summary must not restate. See
   * `lib/summarizeBatch → summaryContext`.
   */
  async summarize(text: string, locale: string, context: string[] = []): Promise<string> {
    const res = await request('POST', '/api/summarize', { text, locale, context })
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
  async llmModels(pending?: SettingsUpdate): Promise<LiveModel[]> {
    return safe(async () => {
      // POST with the form's pending values when we have them: the useful
      // moment is right after pasting a key, BEFORE Save. The server honours
      // pending values on the desktop build only (SSRF guard).
      const res = pending
        ? await request('POST', '/api/settings/llm/models', pending)
        : await request('GET', '/api/llm/models')
      if (!res.ok) return []
      const json = await res.json() as { models?: LiveModel[] }
      return Array.isArray(json.models)
        ? json.models.filter((m): m is LiveModel => typeof m?.id === 'string' && !!m.id)
        : []
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

  /**
   * Ask whether a newer release exists, without staging or downloading it.
   * Owner-only. Throws on failure so the caller can say why it couldn't ask.
   */
  async checkForUpdateOnly(): Promise<UpdateCheck> {
    const res = await request('POST', '/api/update/check-only')
    if (!res.ok) {
      await fail(res, 'Update check failed')
    }
    return await res.json() as UpdateCheck
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
