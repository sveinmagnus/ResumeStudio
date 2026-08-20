/**
 * Load `.env` for the server build.
 *
 * WHY THIS EXISTS. Nothing loaded it. README and `.env.example` both read as
 * though copying that file configures the server, and it did not — there is no
 * `dotenv` dependency, no `--env-file` in any script, and nothing called
 * `process.loadEnvFile`. The failure was silent and pointed the wrong way: an
 * unset `RESUME_API_TOKEN` disables authentication, so a deployment whose
 * configuration never arrived booted happily and served every CV to anyone who
 * asked.
 *
 * NO DEPENDENCY. `process.loadEnvFile` is built into Node, and Node 24 is
 * already a hard floor here (`node:sqlite`). `dotenv` would be a runtime
 * dependency for something the platform does.
 *
 * THE REAL ENVIRONMENT WINS. `loadEnvFile` overwrites, which is the wrong way
 * round for a server: a systemd unit, a Docker `-e`, or a CI secret is the
 * deliberate configuration, and a `.env` left in the working directory from
 * someone's laptop is not. So the file is parsed, and only keys that are not
 * already set are applied. The practical consequence is that adding this cannot
 * change the behaviour of any deployment that was already working.
 *
 * Not used by the desktop build, which has `settings.json` and `applyToEnv`.
 */

import fs from 'fs'
import path from 'path'

/** Where `.env` is looked for. The repo root in dev, the CWD in production. */
function envPath(): string {
  return path.join(process.cwd(), '.env')
}

/**
 * Parse `KEY=value` lines.
 *
 * Deliberately small rather than a full dotenv clone: comments, blank lines,
 * `export ` prefixes and one level of matching quotes. Anything more elaborate
 * belongs in the real environment, where it is not being reimplemented here.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = body.slice(eq + 1).trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export interface LoadEnvResult {
  /** Absolute path read, or null when no file was found. */
  file: string | null
  /** Keys taken from the file. */
  applied: string[]
  /** Keys present in the file but already set in the real environment. */
  skipped: string[]
}

/**
 * Apply `.env` without overriding anything already set.
 *
 * Never throws: a malformed or unreadable file must not stop the server, since
 * the environment it was meant to supply may already be present.
 */
export function loadDotEnv(file = envPath()): LoadEnvResult {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return { file: null, applied: [], skipped: [] }
  }
  const parsed = parseEnvFile(text)
  const applied: string[] = []
  const skipped: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
      applied.push(key)
    } else {
      skipped.push(key)
    }
  }
  return { file, applied, skipped }
}
