/**
 * PURE: the shared vocabulary behind every "Run with my AI" affordance — how to
 * describe the backend honestly, and when to warn that a prompt is too big for
 * it. The transport lives in lib/api.ts; the UI in components/ui/AssistRun.tsx.
 *
 * The whole point of this file is that the assists must never overstate what
 * they do with your CV. Two rules follow from that and are load-bearing:
 *  - "nothing leaves this computer" is only ever said when the SERVER reported
 *    a local endpoint (see server/llm.ts → isLocalEndpoint);
 *  - anything we can't classify is described as leaving the machine.
 *
 * It also owns the ADVANCED gate (`supportsAdvanced`): which assists a model is
 * trusted with, as declared by whoever configured it.
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
/** ~1–3B local models. */
const SMALL_MODEL_BUDGET = 6_000
/** ~7–9B local models. */
const MEDIUM_MODEL_BUDGET = 20_000
/** Hosted frontier models. */
const LARGE_MODEL_BUDGET = 100_000

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
 * The input budget we assume for a model. A model declared HIGH-END gets the
 * large budget outright: the declaration is a statement about capability, and
 * it's the only signal that survives a hosted model name (`claude-opus-4-5`
 * parses to no parameter count at all) or a `compat` endpoint fronting anything.
 *
 * Otherwise: a LOCAL model with no parseable size is treated as small — local
 * models are usually small, and the failure we're guarding against (garbled
 * output from an overloaded 3B) is the local one. A REMOTE model with no
 * parseable size is treated as large: hosted endpoints are the ones people point
 * at precisely to get a big context.
 */
export function inputBudget(status: AssistStatus): number {
  if (status.highEnd) return LARGE_MODEL_BUDGET
  const p = paramsOf(status.model)
  if (p == null) return status.local ? SMALL_MODEL_BUDGET : LARGE_MODEL_BUDGET
  if (p <= 4) return SMALL_MODEL_BUDGET
  if (p <= 15) return MEDIUM_MODEL_BUDGET
  return LARGE_MODEL_BUDGET
}

/**
 * THE gate on every advanced assist (whole-CV review, consistency pass,
 * achievement mining, semantic drift, positioning, section advice).
 *
 * Why a declaration rather than a guess: these tasks ask a model to judge a
 * whole document and hand back advice the user will act on. A small model does
 * not refuse them — it answers fluently and wrongly, which is worse than not
 * offering the feature, and there is no reliable way to detect that from a model
 * name. So the person who configured the endpoint states what it is, and the
 * server enforces the same flag on /api/llm/complete (defence in depth: a stale
 * tab can't route a whole-CV review to a 3B model).
 */
export function supportsAdvanced(status: AssistStatus): boolean {
  return status.configured && status.highEnd
}

/**
 * A SUGGESTION for the "this is a high-end model" checkbox — never a decision.
 *
 * Two signals, both conservative: a parsed parameter count at or above
 * HIGH_END_PARAMS (a 30B+ local model is in the right class), or a name matching
 * a known frontier family. It exists so the common case (someone pastes an
 * Opus/GPT-5/Gemini-Pro id) doesn't need explaining; anything it doesn't
 * recognise stays unticked and the user decides.
 */
const HIGH_END_PARAMS = 27
const HIGH_END_NAMES = [
  /\bopus\b/i, /\bsonnet\b/i,
  /\bgpt-[5-9]/i, /\bgpt-4\.[1-9]/i, /\bgpt-4o\b(?!-mini)/i, /\bo[1-9]\b/i,
  /\bgemini-[0-9.]+-pro\b/i,
  /\bmistral-large\b/i, /\bdeepseek-(?:r1|v3)/i, /\bqwen[0-9.]*-max\b/i,
  /\bgrok-[0-9]/i, /\bllama-?[0-9.]*-?405b\b/i,
]

export function looksHighEnd(model: string): boolean {
  const name = model.trim()
  if (!name) return false
  const p = paramsOf(name)
  if (p != null && p >= HIGH_END_PARAMS) return true
  return HIGH_END_NAMES.some((re) => re.test(name))
}

/** Approximate token count of a prompt. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/**
 * Reply budget for a short-answer, in-item assist (rewrite, points, skills).
 *
 * The ANSWER is one line or a handful of bullets — a few hundred tokens. The
 * rest is headroom for a REASONING model, which spends its budget thinking
 * before it writes anything: production's `gemma-4-31b-it` burned ~900 tokens
 * deliberating over a two-line course description and ~4,900 over a harder one,
 * answering correctly both times once it had the room. At the old 900 it
 * produced no answer at all — under-budgeting a reasoning model does not
 * truncate the answer, it PREVENTS the answer, and what reaches the user is a
 * parse error about the thinking.
 *
 * Sizing for the slow case is free: a cap is not a spend, so a model that
 * answers in eighty tokens is still billed for eighty.
 */
export const ASSIST_MAX_TOKENS = 8_000

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
 * How to name the backend in one phrase.
 *
 * Hosted model ids usually already carry the provider ("gemini-3.6-flash",
 * "mistral-small-latest"), so printing both produced "gemini, gemini-3.6-flash"
 * — the same word twice. When the model id already says who it is, the model id
 * is the whole answer.
 */
export function backendName(status: AssistStatus): string {
  const provider = status.provider.trim()
  const model = status.model.trim()
  if (!model) return provider
  if (!provider) return model
  return model.toLowerCase().includes(provider.toLowerCase()) ? model : `${provider}, ${model}`
}

/**
 * One sentence saying where the content goes. Rendered next to every Run
 * button; the wording is the user's only signal, so it names the destination
 * rather than saying something vague like "your configured provider".
 *
 * `hasManualPath` says whether the caller actually offers a copy-prompt /
 * paste-result fallback (AssistRun's `children`). It only changes the
 * unconfigured wording, and it is REQUIRED rather than defaulted on purpose:
 * the modal flows have a manual path and the in-editor panels (key points,
 * writing coach, skill suggest) do not, so pointing every unconfigured panel
 * at "the manual path" sent half of them chasing something not on screen. A
 * default would let the next caller re-introduce exactly that.
 */
export function providerBlurb(status: AssistStatus, hasManualPath: boolean): string {
  if (!status.configured) {
    return hasManualPath
      ? 'No AI model is configured — use the manual path, or set one up in Settings → AI assist.'
      : 'No AI model is configured — set one up in Settings → AI assist.'
  }
  if (status.local) {
    return `Runs on ${status.model} on this computer — the content does not leave it.`
  }
  return `Sends the content to your configured AI provider (${backendName(status)}) over the internet.`
}

/**
 * True when the configured model is small enough that a writing task will
 * likely disappoint. Advisory only — it never blocks the run, it just says so
 * next to the button, because "the AI is rubbish" is usually "the 3B model is
 * doing something a 3B model can't do".
 */
export function looksWeakForWriting(status: AssistStatus): boolean {
  if (!status.configured || status.highEnd) return false
  const params = paramsOf(status.model)
  // Unknown size on a REMOTE endpoint is assumed fine (hosted models are the
  // ones people point at for capability); unknown size locally is assumed small.
  if (params == null) return status.local
  return params <= 8
}

/** True when a run would send content off this machine. Drives the confirm. */
export function isRemote(status: AssistStatus): boolean {
  return status.configured && !status.local
}

/**
 * The manual (BYO) path, where a caller offers one: the only path with no model
 * configured, and a deliberate choice when the content is too big for a small
 * local one. Copy describes it honestly: the user is the one sending it.
 * (The in-editor panels have no manual path — see `providerBlurb`.)
 */
export const MANUAL_BLURB =
  'You copy the prompt and paste it into whatever AI you choose — nothing is sent from this app. ' +
  'Whatever you paste it into sees the content.'

/**
 * The wrappers a REASONING model puts its deliberation in before answering.
 *
 * Kept in step with `server/llm.ts → REASONING_TAGS` (cross-checked by
 * `tests/reasoningReply.test.ts`), because both boundaries where a model reply
 * enters the app have to agree on what counts as thinking rather than answer.
 */
export const REASONING_TAGS = ['thought', 'think', 'reasoning', 'thinking', 'scratchpad'] as const

/**
 * Drop a reasoning model's thinking, leaving only the answer.
 *
 * Not cosmetic. Google's `gemma-4-31b-it` (and every model of that shape) emits
 * a `<thought>` block first, and that prose is full of brackets — so the old
 * "slice from the first bracket to the last" heuristic below sliced out
 * `[Accredited study] in [Project management]` and JSON.parse died at column 1.
 * That is exactly the error reported against the production instance.
 *
 * The UNCLOSED form matters as much as the closed one: a reply that ran out of
 * budget mid-thought has an opening tag and no closing one, and everything
 * after it is thinking, never answer.
 */
export function stripReasoning(reply: string): string {
  let s = reply
  for (const tag of REASONING_TAGS) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), '')
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i'), '')
  }
  return s.trim()
}

/** True when `s` is a complete JSON document. */
function parses(s: string): boolean {
  if (!s) return false
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

/**
 * The substring starting at `start` that closes its own bracket, or null.
 *
 * String-aware, so a `}` inside a quoted value doesn't end the object early —
 * which is the case a plain bracket count gets wrong on any reply containing
 * punctuation in its text fields, i.e. most of ours.
 */
function balancedAt(s: string, start: number): string | null {
  const open = s[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close && --depth === 0) return s.slice(start, i + 1)
  }
  return null
}

/** The first balanced `{…}` / `[…]` in `s` that is valid JSON, or null. */
function firstJsonValue(s: string): string | null {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{' && s[i] !== '[') continue
    const candidate = balancedAt(s, i)
    if (candidate && parses(candidate)) return candidate
  }
  return null
}

/**
 * Pull the JSON payload out of a model's reply.
 *
 * Models wrap JSON in ```json fences, prepend "Here's the JSON:", and — if they
 * reason — think out loud first, no matter how firmly the prompt says not to.
 * Rather than fail on output that is *obviously* correct bar its packaging,
 * find the JSON.
 *
 * Each step is checked by whether the result actually PARSES rather than by
 * where a bracket happens to sit: the old version sliced blindly from the first
 * bracket to the last, so one stray bracket in a preamble produced a string
 * that could never parse and an error naming the wrong culprit.
 *
 * This helps BOTH paths: a reply pasted from ChatGPT arrives fenced, and a
 * reply from a local reasoning model arrives behind a `<thought>` block.
 * Returns the cleaned reply when nothing parses — the caller's own error stays
 * the one the user sees.
 */
export function extractJson(reply: string): string {
  const s = stripReasoning(reply)

  // ```json … ``` (or a bare ``` fence), when it really holds the payload.
  const fence = /```(?:json)?\s*\r?\n?([\s\S]*?)```/i.exec(s)
  const fenced = fence ? fence[1].trim() : ''
  if (fenced && parses(fenced)) return fenced

  const found = firstJsonValue(s)
  if (found) return found

  // Nothing parsed. Prefer the fence's contents when there was one — it is the
  // model's own claim about where its answer is, and a truncated payload there
  // gives a better error than the surrounding prose would.
  return fenced || s
}
