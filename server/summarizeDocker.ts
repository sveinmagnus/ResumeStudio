/**
 * Optional management of a local Docker **Ollama** for the "Summarize" feature
 * (desktop build) — the first-class local LLM option, mirroring the Docker
 * LibreTranslate used for translation.
 *
 * The model runtime is a multi-GB service we can't bundle into the portable
 * folder, so the managed path drives Docker on the user's machine via the
 * project's docker-compose.yml (`ollama` service). Best-effort and defensive:
 * Docker may be absent, the first `pull` downloads a model (minutes/GB), and
 * none of it must ever crash the editor.
 *
 * All shelling out uses spawn with an explicit argv (never a shell string).
 * The one value that isn't fixed — the model name — is validated against a
 * strict allowlist before it reaches `ollama pull`.
 */

import { spawn } from 'child_process'
import { DEFAULT_OLLAMA_URL } from './summarize.js'

export const DOCKER_OLLAMA_URL = DEFAULT_OLLAMA_URL

const SERVICE = 'ollama'
const CONTAINER = 'resumestudio-ollama'

/** Ollama model tags: letters, digits, and ._/:- (e.g. "llama3.2:3b"). */
const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,80}$/
export function isValidModelName(model: string): boolean {
  return MODEL_RE.test(model.trim())
}

function composeFile(): string | null {
  return process.env.RESUME_COMPOSE_FILE?.trim() || null
}

interface RunResult { code: number; stdout: string; stderr: string }

/** Run a command to completion; never rejects (failures come back as a code). */
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

export async function dockerAvailable(): Promise<boolean> {
  const r = await run('docker', ['version', '--format', '{{.Server.Version}}'], 10_000)
  return r.code === 0 && r.stdout.trim().length > 0
}

export interface DockerActionResult {
  ok: boolean
  available: boolean
  message: string
}

/**
 * `docker compose up -d ollama`, then `ollama pull <model>` inside the
 * container so the chosen model is ready. The pull can take a long time (GBs).
 */
export async function startSummarize(model: string): Promise<DockerActionResult> {
  const file = composeFile()
  if (!file) return { ok: false, available: false, message: 'No docker-compose file is configured for this build.' }
  const trimmedModel = model.trim()
  if (!trimmedModel || !isValidModelName(trimmedModel)) {
    return { ok: false, available: true, message: 'Set a valid model name first (e.g. "llama3.2:3b") before starting.' }
  }
  if (!(await dockerAvailable())) {
    return {
      ok: false, available: false,
      message: 'Docker is not available. Install Docker Desktop and start it, or point Summarize at a remote Ollama / OpenAI endpoint instead.',
    }
  }
  const up = await run('docker', ['compose', '-f', file, 'up', '-d', SERVICE], 5 * 60_000)
  if (up.code !== 0) {
    return { ok: false, available: true, message: `Failed to start Ollama: ${(up.stderr || up.stdout).trim().slice(0, 400)}` }
  }
  // Pull the model (idempotent — no-op if already present). Generous timeout.
  const pull = await run('docker', ['exec', CONTAINER, 'ollama', 'pull', trimmedModel], 30 * 60_000)
  if (pull.code === 0) {
    return { ok: true, available: true, message: `Ollama is running and "${trimmedModel}" is ready.` }
  }
  return {
    ok: false, available: true,
    message: `Ollama started but pulling "${trimmedModel}" failed: ${(pull.stderr || pull.stdout).trim().slice(0, 300)}`,
  }
}

export async function stopSummarize(): Promise<DockerActionResult> {
  const file = composeFile()
  if (!file) return { ok: false, available: false, message: 'No docker-compose file is configured for this build.' }
  if (!(await dockerAvailable())) return { ok: false, available: false, message: 'Docker is not available.' }
  const r = await run('docker', ['compose', '-f', file, 'stop', SERVICE], 60_000)
  return r.code === 0
    ? { ok: true, available: true, message: 'Ollama container stopped.' }
    : { ok: false, available: true, message: `Failed to stop Ollama: ${(r.stderr || r.stdout).trim().slice(0, 400)}` }
}

export interface ReachResult {
  reachable: boolean
  /** Number of models the instance has pulled (a readiness signal). */
  models?: number
  message: string
}

/** One model the instance has pulled. */
export interface OllamaTag { name: string; size?: number }

/**
 * The models an Ollama instance has already pulled, for the settings model
 * picker. Never throws — an unreachable/absent instance is simply "none known",
 * which the UI shows alongside the curated catalog.
 *
 * `url` is the SERVER's configured Ollama URL, never a client-supplied one:
 * this reaches out over the network, so letting a request name the host would
 * be an SSRF hole.
 */
export async function listOllamaModels(url: string, timeoutMs = 5_000): Promise<OllamaTag[]> {
  const base = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) return []
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return []
    const data = await res.json().catch(() => null) as { models?: Array<Record<string, unknown>> } | null
    if (!Array.isArray(data?.models)) return []
    return data.models
      .map((m) => ({
        name: typeof m.name === 'string' ? m.name : '',
        size: typeof m.size === 'number' ? m.size : undefined,
      }))
      .filter((m) => m.name.length > 0)
  } catch {
    return []
  }
}

/** Probe an Ollama instance's /api/tags endpoint. Short timeout; never throws. */
export async function ollamaReachable(url: string, timeoutMs = 4_000): Promise<ReachResult> {
  const base = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) return { reachable: false, message: 'URL must start with http:// or https://' }
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { reachable: false, message: `Instance responded with HTTP ${res.status}.` }
    const data = await res.json().catch(() => null) as { models?: unknown[] } | null
    const count = Array.isArray(data?.models) ? data!.models!.length : undefined
    return { reachable: true, models: count, message: count != null ? `Reachable — ${count} model(s) available.` : 'Reachable.' }
  } catch {
    return { reachable: false, message: 'Not reachable (the service may still be starting, or is not running).' }
  }
}
