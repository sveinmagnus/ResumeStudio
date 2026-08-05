/**
 * The "Summarize" FEATURE — condense a long CV entry into one short line.
 *
 * One assist among many, NOT the LLM layer: provider config, endpoint
 * resolution and the chat round-trip live in `llm.ts`, which this file imports
 * like every other feature does. Nothing here should grow config of its own.
 */

import { chatComplete, languageName, LlmError, type LlmConfig } from './llm.js'

/** Hard cap on the source text sent to the model (chars). */
export const MAX_SUMMARIZE_CHARS = 6000

/**
 * Tidy the model's reply into a single clean line: strip code fences / wrapping
 * quotes, collapse whitespace to one line, and cap the length. LLMs sometimes
 * add a preamble or quotes despite instructions — this keeps the field sane.
 */
export function tidyLine(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```[a-z]*\n?|```$/gi, '').trim()
  // First non-empty line only (drop any trailing explanation).
  s = (s.split(/\r?\n/).find((l) => l.trim()) ?? '').trim()
  // Strip a leading list marker ("- ", "• ", "1. ") and wrapping quotes.
  s = s.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '')
  s = s.replace(/^["“'']+|["”'']+$/g, '').trim()
  return s.slice(0, 240)
}

const SYSTEM_PROMPT =
  'You condense a résumé/CV entry into ONE concise line for a summary view. ' +
  'Output only that single line — no preamble, no quotes, no markdown, no trailing period unless natural. ' +
  'Keep it under ~18 words, factual and specific, preserving key role/technology/outcome. ' +
  'Write it in {LANGUAGE}.'

/**
 * Summarize `text` into a one-line short description, in `locale`'s language,
 * using the configured (or supplied) provider. Throws LlmError on any failure —
 * callers map that to an HTTP response without leaking internals.
 */
export async function summarize(text: string, locale: string, config?: LlmConfig): Promise<string> {
  const content = await chatComplete(
    [
      { role: 'system', content: SYSTEM_PROMPT.replace('{LANGUAGE}', languageName(locale)) },
      { role: 'user', content: text },
    ],
    { maxTokens: 80 },
    config,
  )
  const line = tidyLine(content)
  if (!line) throw new LlmError(502, 'The AI model returned no usable summary')
  return line
}
