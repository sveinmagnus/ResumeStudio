/**
 * PURE: the shared vocabulary behind every "Run with my AI" affordance — how to
 * describe the backend honestly, and when to warn that a prompt is too big for
 * it. The transport lives in lib/api.ts; the UI in components/ui/AssistRun.tsx.
 *
 * The whole point of this file is that the assists must never overstate what
 * they do with your CV. Two rules follow from that and are load-bearing:
 *  - "nothing leaves this computer" is only ever said when the SERVER reported
 *    a local endpoint (see server/summarize.ts → isLocalEndpoint);
 *  - anything we can't classify is described as leaving the machine.
 */

import type { AssistStatus } from './api'

/**
 * Rough chars-per-token. English prose is ~4; CV text is denser (names, tags,
 * dates) so 3.5 is the conservative side of reality — this feeds a WARNING, and
 * over-warning is cheaper than a silently truncated import.
 */
const CHARS_PER_TOKEN = 3.5

/**
 * Usable input budget in tokens, by model class. These are deliberately well
 * under the advertised context windows: the window has to hold the reply too,
 * and a small model's effective quality collapses long before its stated limit.
 */
const SMALL_MODEL_BUDGET = 6_000   // ~1–3B local models
const MEDIUM_MODEL_BUDGET = 20_000 // ~7–9B local models
const LARGE_MODEL_BUDGET = 100_000 // hosted frontier models

/**
 * Parameter count parsed out of an Ollama-style tag ('llama3.2:3b' → 3).
 * Returns null for anything unparseable (a hosted model name, a custom tag).
 */
export function paramsOf(model: string): number | null {
  const m = /[:\-_](\d+(?:\.\d+)?)\s*b\b/i.exec(model)
  if (m) return parseFloat(m[1])
  // '360m' / '135m' style sub-billion tags.
  const mm = /[:\-_](\d+(?:\.\d+)?)\s*m\b/i.exec(model)
  if (mm) return parseFloat(mm[1]) / 1000
  return null
}

/**
 * The input budget we assume for a model. A LOCAL model with no parseable size
 * is treated as small — local models are usually small, and the failure we're
 * guarding against (garbled output from an overloaded 3B) is the local one. A
 * REMOTE model with no parseable size is treated as large: hosted endpoints are
 * the ones people point at precisely to get a big context.
 */
export function inputBudget(status: AssistStatus): number {
  const p = paramsOf(status.model)
  if (p == null) return status.local ? SMALL_MODEL_BUDGET : LARGE_MODEL_BUDGET
  if (p <= 4) return SMALL_MODEL_BUDGET
  if (p <= 15) return MEDIUM_MODEL_BUDGET
  return LARGE_MODEL_BUDGET
}

/** Approximate token count of a prompt. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/**
 * A warning when `chars` looks too big for the configured model — never a block.
 * The user asked to keep Run available and step aside to the manual path with a
 * stronger model when they choose to, so this informs rather than decides.
 * Returns null when the prompt fits comfortably.
 */
export function sizeHint(chars: number, status: AssistStatus): string | null {
  if (!status.configured) return null
  const tokens = estimateTokens(chars)
  const budget = inputBudget(status)
  if (tokens <= budget) return null
  const name = status.model || 'this model'
  return `This is long (~${tokens.toLocaleString()} tokens). ${name} may truncate or garble it — ` +
    'consider the manual path with a stronger model.'
}

/**
 * One sentence saying where the content goes. Rendered next to every Run
 * button; the wording is the user's only signal, so it names the destination
 * rather than saying something vague like "your configured provider".
 */
export function providerBlurb(status: AssistStatus): string {
  if (!status.configured) {
    return 'No AI model is configured — use the manual path, or set one up in Settings → AI assist.'
  }
  if (status.local) {
    return `Runs on ${status.model} on this computer — the content does not leave it.`
  }
  return `Sends the content to your configured AI provider (${status.provider}${status.model ? `, ${status.model}` : ''}) over the internet.`
}

/** True when a run would send content off this machine. Drives the confirm. */
export function isRemote(status: AssistStatus): boolean {
  return status.configured && !status.local
}

/**
 * The manual (BYO) path is ALWAYS available — it's the only path with no model
 * configured, and a deliberate choice when the content is too big for a small
 * local one. Copy describes it honestly: the user is the one sending it.
 */
export const MANUAL_BLURB =
  'You copy the prompt and paste it into whatever AI you choose — nothing is sent from this app. ' +
  'Whatever you paste it into sees the content.'
