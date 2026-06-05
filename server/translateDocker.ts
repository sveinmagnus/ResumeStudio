/**
 * Optional management of a local Docker LibreTranslate for the desktop build.
 *
 * The translation engine is a multi-GB self-hosted service we can't bundle into
 * the portable folder, so the "managed" path instead drives Docker on the
 * user's machine via the project's docker-compose.yml. This is best-effort and
 * defensive: Docker may not be installed, the first run pulls a large image +
 * models (minutes), and none of it must ever crash the editor.
 *
 * All shelling out uses spawn with an explicit argv (never a shell string) and
 * a fixed service name — no user input reaches the command line, so there's no
 * injection surface.
 */

import { spawn } from 'child_process'
import { DOCKER_TRANSLATE_URL } from './settings.js'

/** docker-compose file location (set by the launcher shim / dev fallback). */
function composeFile(): string | null {
  return process.env.RESUME_COMPOSE_FILE?.trim() || null
}

const SERVICE = 'libretranslate'

interface RunResult { code: number; stdout: string; stderr: string }

/** Run a command to completion, capturing output. Never rejects — failures
 *  come back as a non-zero `code` (or 127 when the binary is missing). */
function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch {
      resolve({ code: 127, stdout: '', stderr: 'spawn failed' })
      return
    }
    const timer = setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, timeoutMs)
    timer.unref?.()
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('error', () => { clearTimeout(timer); resolve({ code: 127, stdout, stderr: stderr || 'not found' }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }) })
  })
}

/** Is the Docker CLI present and its daemon responsive? */
export async function dockerAvailable(): Promise<boolean> {
  const r = await run('docker', ['version', '--format', '{{.Server.Version}}'], 10_000)
  return r.code === 0 && r.stdout.trim().length > 0
}

export interface DockerActionResult {
  ok: boolean
  /** Whether Docker itself is available (false → user must install it). */
  available: boolean
  message: string
}

/** `docker compose up -d libretranslate` using the bundled compose file. */
export async function startTranslate(): Promise<DockerActionResult> {
  const file = composeFile()
  if (!file) {
    return { ok: false, available: false, message: 'No docker-compose file is configured for this build.' }
  }
  if (!(await dockerAvailable())) {
    return {
      ok: false, available: false,
      message: 'Docker is not available. Install Docker Desktop and start it, or point Translate at a remote LibreTranslate URL instead.',
    }
  }
  // First run can take a while (image + model download). Allow generous time.
  const r = await run('docker', ['compose', '-f', file, 'up', '-d', SERVICE], 10 * 60_000)
  if (r.code === 0) {
    return {
      ok: true, available: true,
      message: 'LibreTranslate container started. The first run downloads language models, which can take several minutes before translations work.',
    }
  }
  return { ok: false, available: true, message: `Failed to start LibreTranslate: ${(r.stderr || r.stdout).trim().slice(0, 400)}` }
}

/** `docker compose stop libretranslate`. */
export async function stopTranslate(): Promise<DockerActionResult> {
  const file = composeFile()
  if (!file) return { ok: false, available: false, message: 'No docker-compose file is configured for this build.' }
  if (!(await dockerAvailable())) return { ok: false, available: false, message: 'Docker is not available.' }
  const r = await run('docker', ['compose', '-f', file, 'stop', SERVICE], 60_000)
  return r.code === 0
    ? { ok: true, available: true, message: 'LibreTranslate container stopped.' }
    : { ok: false, available: true, message: `Failed to stop LibreTranslate: ${(r.stderr || r.stdout).trim().slice(0, 400)}` }
}

export interface ReachResult {
  reachable: boolean
  /** Number of languages the instance reports (a readiness signal), if reachable. */
  languages?: number
  message: string
}

/**
 * Probe a LibreTranslate instance's /languages endpoint. Used by the Settings
 * "Test connection" button and by the Docker readiness check (models loading →
 * not yet reachable). Short timeout; never throws.
 */
export async function translateReachable(url: string, timeoutMs = 4_000): Promise<ReachResult> {
  const base = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    return { reachable: false, message: 'URL must start with http:// or https://' }
  }
  try {
    const res = await fetch(`${base}/languages`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { reachable: false, message: `Instance responded with HTTP ${res.status}.` }
    const data = await res.json().catch(() => null)
    const count = Array.isArray(data) ? data.length : undefined
    return { reachable: true, languages: count, message: count != null ? `Reachable — ${count} languages loaded.` : 'Reachable.' }
  } catch {
    return { reachable: false, message: 'Not reachable (the service may still be starting up, or is not running).' }
  }
}

export { DOCKER_TRANSLATE_URL }
