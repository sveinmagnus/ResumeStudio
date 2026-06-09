/**
 * Auto-updater core for the desktop build.
 *
 * Pure-ish logic + a few I/O helpers (network + filesystem + `tar`), kept
 * dependency-light and unit-testable: the version comparison and asset naming
 * are pure, and the network/extract helpers take explicit paths + an injectable
 * `fetch` so tests never touch GitHub or spawn `tar`.
 *
 * Flow (orchestrated by `updateRuntime.ts`):
 *   checkForUpdate() ─▶ downloadAsset() ─▶ extractArchive() ─▶ stage sanity-check
 * then the runtime writes a per-OS swap script and relaunches (see updateRuntime).
 *
 * SECURITY: this fetches over the network and later swaps app files, so every
 * URL we touch is constrained to GitHub hosts (`isAllowedHost`) — both the
 * release API call and the asset download (including each redirect hop). The
 * release/asset URLs themselves originate from GitHub's own API response.
 */

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

/** owner/repo to check. Overridable for forks / testing. */
export function updateRepo(): string {
  return process.env.RESUME_UPDATE_REPO?.trim() || 'sveinmagnus/resumestudio'
}

// ── Version comparison (pure) ────────────────────────────────────────────────

/**
 * Parse a semver-ish string into numeric components, tolerating a leading `v`
 * and a `-prerelease`/`+build` suffix (which we ignore for ordering). Missing
 * components read as 0, so "1.2" == "1.2.0".
 */
export function parseVersion(v: string): [number, number, number] {
  const core = String(v).trim().replace(/^v/i, '').split(/[-+]/)[0]
  const parts = core.split('.').map((p) => {
    const n = parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/** -1 if a<b, 0 if equal, 1 if a>b. Pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1
    if (pa[i] > pb[i]) return 1
  }
  return 0
}

// ── Asset naming (pure) ──────────────────────────────────────────────────────

/**
 * The release-asset filename for a given platform/arch, matching what
 * `scripts/build-desktop.mjs` emits and `.github/workflows/release.yml`
 * uploads. KEEP IN SYNC with the (intentionally duplicated) helper in the build
 * script — build scripts can't import this TS module.
 */
export function assetNameFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'
  return `resume-studio-${os}-${arch}.tar.gz`
}

// ── Host allowlist (SSRF guard) ──────────────────────────────────────────────

const ALLOWED_HOST_SUFFIXES = ['github.com', 'githubusercontent.com']

/** True only for GitHub hosts (exact or subdomain). Used on every URL we fetch. */
export function isAllowedHost(rawUrl: string): boolean {
  let host: string
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'https:') return false
    host = u.hostname.toLowerCase()
  } catch {
    return false
  }
  return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  /** Asset download URL for THIS platform, or null if the release lacks one. */
  assetUrl: string | null
  assetName: string
  /** Release notes (the GitHub release body), truncated for display. */
  notes: string
  /** The release page on github.com (for the "Release notes" link). */
  htmlUrl: string
}

type FetchLike = typeof fetch

// ── Check GitHub for the latest release ──────────────────────────────────────

interface GithubAsset { name?: unknown; browser_download_url?: unknown }
interface GithubRelease {
  tag_name?: unknown
  body?: unknown
  html_url?: unknown
  assets?: unknown
}

/**
 * Query GitHub's `releases/latest` and compare to `currentVersion`. Never
 * follows a non-GitHub host. Throws on network / non-200 / malformed responses;
 * the runtime catches and surfaces a generic "check failed".
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: FetchLike = fetch,
): Promise<UpdateInfo> {
  const apiUrl = `https://api.github.com/repos/${updateRepo()}/releases/latest`
  if (!isAllowedHost(apiUrl)) throw new Error('Update host not allowed')

  const res = await fetchImpl(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ResumeStudio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
  const rel = (await res.json()) as GithubRelease

  const tag = typeof rel.tag_name === 'string' ? rel.tag_name : ''
  if (!tag) throw new Error('Release has no tag')
  const latestVersion = tag.replace(/^v/i, '')
  // SECURITY: latestVersion becomes a path segment AND is embedded in the
  // generated swap script. Reject anything outside a strict version charset so a
  // crafted tag can't inject path traversal or break out of the script's quoting
  // (defense-in-depth — the release repo is the trust boundary, but cheap).
  if (!/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(latestVersion)) {
    throw new Error('Release tag is not a valid version')
  }

  const wantName = assetNameFor()
  const assets = Array.isArray(rel.assets) ? (rel.assets as GithubAsset[]) : []
  const match = assets.find((a) => typeof a.name === 'string' && a.name === wantName)
  const rawAssetUrl = match && typeof match.browser_download_url === 'string'
    ? match.browser_download_url
    : null
  const assetUrl = rawAssetUrl && isAllowedHost(rawAssetUrl) ? rawAssetUrl : null

  const notes = (typeof rel.body === 'string' ? rel.body : '').slice(0, 2000)
  const htmlUrl = typeof rel.html_url === 'string' && isAllowedHost(rel.html_url)
    ? rel.html_url
    : `https://github.com/${updateRepo()}/releases`

  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    assetUrl,
    assetName: wantName,
    notes,
    htmlUrl,
  }
}

// ── Download (manual redirect following, host-checked each hop) ───────────────

/**
 * Stream a release asset to `destPath`, validating the host on every redirect
 * hop (SSRF guard). Reports progress 0..1 when a Content-Length is known.
 * Returns the number of bytes written.
 */
export async function downloadAsset(
  url: string,
  destPath: string,
  onProgress?: (fraction: number) => void,
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  let current = url
  let res: Response | null = null
  for (let hop = 0; hop < 6; hop++) {
    if (!isAllowedHost(current)) throw new Error('Download host not allowed')
    const r = await fetchImpl(current, {
      redirect: 'manual',
      headers: { 'User-Agent': 'ResumeStudio', Accept: 'application/octet-stream' },
    })
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location')
      if (!loc) throw new Error('Redirect without a location')
      current = new URL(loc, current).toString()
      continue
    }
    res = r
    break
  }
  if (!res) throw new Error('Too many redirects')
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)

  const total = Number(res.headers.get('content-length')) || 0
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  const out = fs.createWriteStream(destPath)
  let written = 0
  try {
    // undici's response body is async-iterable over Uint8Array chunks.
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      out.write(Buffer.from(chunk))
      written += chunk.byteLength
      if (total > 0 && onProgress) onProgress(Math.min(1, written / total))
    }
  } finally {
    out.end()
    await new Promise<void>((resolve) => out.on('close', () => resolve()))
  }
  if (total > 0 && written !== total) {
    throw new Error(`Incomplete download (${written}/${total} bytes)`)
  }
  return written
}

// ── Extract (system tar; .tar.gz works cross-platform with bsdtar/GNU tar) ────

/**
 * Extract a `.tar.gz` into `destDir` using the system `tar`. argv-only spawn
 * (never a shell string), mirroring `translateDocker.ts`. Rejects on a non-zero
 * exit. Present on Win10 1803+ (bsdtar), macOS, and Linux.
 */
export function extractArchive(archivePath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  // Run with cwd = the archive's dir and a BARE archive filename: a Windows
  // drive letter in the -f path (C:\…) is misread as a remote host (`host:path`)
  // by GNU tar. The -C dest dir is never host-parsed, so it can stay absolute.
  const cwd = path.dirname(archivePath)
  const file = path.basename(archivePath)
  return new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xzf', file, '-C', destDir], { cwd, stdio: 'ignore' })
    child.on('error', (err) => reject(new Error(`Could not run tar: ${err.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar exited with code ${code}`))
    })
  })
}

/**
 * The launcher binary name inside an extracted/installed build, for the
 * structural sanity check and the swap script.
 */
export function nodeBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'node.exe' : 'node'
}

/**
 * After extraction, confirm the tree looks like a real Resume Studio build
 * (the bundled launcher + a node binary). Guards against relaunching a broken
 * or foreign archive. Returns true when the staged dir is safe to install.
 */
export function looksLikeValidBuild(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    fs.existsSync(path.join(dir, 'app', 'launcher.cjs')) &&
    fs.existsSync(path.join(dir, nodeBinaryName(platform)))
  )
}

export interface StagedUpdate {
  /** Directory holding the extracted, validated new build. */
  dir: string
  version: string
}

/**
 * Download + extract + validate a release into `<stagingRoot>/<version>/`.
 * Cleans any prior staging for the same version first. Throws if the asset is
 * missing, the download is incomplete, or the extracted tree fails validation.
 */
export async function stageUpdate(
  info: UpdateInfo,
  stagingRoot: string,
  onProgress?: (fraction: number) => void,
  platform: NodeJS.Platform = process.platform,
): Promise<StagedUpdate> {
  if (!info.assetUrl) throw new Error(`No download for this platform (${info.assetName}).`)
  const verDir = path.join(stagingRoot, info.latestVersion)
  fs.rmSync(verDir, { recursive: true, force: true })
  fs.mkdirSync(verDir, { recursive: true })

  const archive = path.join(verDir, info.assetName)
  await downloadAsset(info.assetUrl, archive, onProgress)

  const extractDir = path.join(verDir, 'extracted')
  await extractArchive(archive, extractDir)
  // The build script tars the contents of release/ (so entries are at the root
  // of the archive). If a single wrapping dir slipped in, unwrap it.
  const root = resolveBuildRoot(extractDir, platform)
  if (!looksLikeValidBuild(root, platform)) {
    throw new Error('Downloaded update failed its integrity check.')
  }
  // Free the archive once extracted.
  try { fs.rmSync(archive, { force: true }) } catch { /* best-effort */ }
  return { dir: root, version: info.latestVersion }
}

/**
 * Return the directory that actually contains the build — `extractDir` itself,
 * or its sole subdirectory if the archive wrapped everything one level deep.
 */
function resolveBuildRoot(extractDir: string, platform: NodeJS.Platform): string {
  if (looksLikeValidBuild(extractDir, platform)) return extractDir
  try {
    const entries = fs.readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory())
    if (entries.length === 1) {
      const nested = path.join(extractDir, entries[0].name)
      if (looksLikeValidBuild(nested, platform)) return nested
    }
  } catch { /* fall through */ }
  return extractDir
}
