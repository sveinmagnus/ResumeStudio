/**
 * The "Summarize" FEATURE — condense a long CV entry into one short line.
 *
 * One assist among many, NOT the LLM layer: provider config, endpoint
 * resolution and the chat round-trip live in `llm.ts`, which this file imports
 * like every other feature does. Nothing here should grow config of its own.
 */

import { chatComplete, languageName, languageDirective, LlmError, type LlmConfig } from './llm.js'

/** Hard cap on the source text sent to the model (chars). */
export const MAX_SUMMARIZE_CHARS = 6000

/** Max heading lines accepted as context, and the length of each. */
export const MAX_CONTEXT_LINES = 8
export const MAX_CONTEXT_LINE_CHARS = 160

/**
 * A leading line that is only a label ("Summary:", "Here is the summary:") —
 * the model announcing its answer rather than giving it. Matched structurally
 * (a short line ending in a colon) rather than by a list of English phrases,
 * because the reply is in the user's language, not ours.
 */
function isPreamble(line: string): boolean {
  return /:\s*$/.test(line) && line.length <= 60
}

/**
 * Tidy the model's reply into a single clean line: strip code fences / wrapping
 * quotes, drop an announcing preamble, collapse to one line, and cap the length.
 * LLMs add a preamble or quotes despite instructions — this keeps the field sane.
 *
 * The preamble skip is not cosmetic. This takes the FIRST usable line, so a reply
 * of "Here is the summary:\n\nLed the cloud migration." used to land the label in
 * the CV field and throw the summary away — a failure that reads as "the AI
 * writes nonsense" rather than as a parsing bug.
 */
export function tidyLine(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```[a-z]*\n?|```$/gi, '').trim()
  // First non-empty line that isn't the model announcing its answer. Falls back
  // to the first non-empty line, so a reply that is ONLY a label still shows.
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  s = lines.find((l) => !isPreamble(l)) ?? lines[0] ?? ''
  // Strip a leading list marker ("- ", "• ", "1. ") and wrapping quotes.
  s = s.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '')
  s = s.replace(/^["“'']+|["”'']+$/g, '').trim()
  return s.slice(0, 240)
}

/**
 * The instructions. Three failures shaped this, all reported on small models:
 *
 *  1. The line restated the entry's heading ("Consultant for Statoil") because
 *     nothing told the model that the customer/employer/title is printed
 *     directly above it. So the rule leads with what the reader ALREADY sees,
 *     and `context` names those exact words when the caller can supply them.
 *  2. It padded with hedges ("might have been involved in…") when the source
 *     was thin. A hedge in a CV is worse than a shorter line, so hedging is
 *     banned by name and "write less" is given as the explicit escape hatch —
 *     a model told only "don't hedge" still has to put SOMETHING there.
 *  3. It answered with a preamble. `tidyLine` cleans that up, but asking for a
 *     bare line costs nothing.
 *
 * No worked example, deliberately: an exemplar with invented specifics is how a
 * small model starts borrowing facts that aren't in the source, and "no invented
 * facts" is the rule the whole assist tier is built on. The shape is described
 * instead.
 */
const SYSTEM_PROMPT = [
  'You write the one-line short description shown under an entry in a résumé/CV.',
  '',
  'The reader ALREADY sees that entry\'s heading — its name, customer, employer, school, job title and dates. '
    + 'A line that repeats those words tells them nothing. Your line says what the work or subject actually WAS.',
  '',
  'Rules:',
  '- Answer with the line itself: no preamble, no label, no quotes, no markdown, no bullet.',
  '- One line, at most ~18 words.',
  '- Say what was built, done, taught or covered, plus the concrete means (technology, method, domain, scale) '
    + 'and the result when the source states one.',
  '- Use ONLY facts stated in the source. Never guess, never generalise from the job title, never add context '
    + 'you were not given.',
  '- Never hedge. Words like "might", "may", "possibly", "probably", "appears to", "seems", "various" and '
    + '"among other things" must not appear. If the source says little, write a SHORTER line — a short true '
    + 'line is better than a padded one.',
  '- No first person and no "The project…" / "This course…" opener. Start with the verb or with the subject matter.',
  '- Write it in {LANGUAGE}. {DIRECTIVE}',
].join('\n')

/** The heading block: the words already on screen, which the line must not spend itself on. */
function contextBlock(context: readonly string[]): string {
  const lines = context
    .map((l) => l.trim().slice(0, MAX_CONTEXT_LINE_CHARS))
    .filter(Boolean)
    .slice(0, MAX_CONTEXT_LINES)
  if (lines.length === 0) return ''
  return 'Already printed in the heading, so do NOT restate it:\n'
    + lines.map((l) => `- ${l}`).join('\n')
    + '\n\n'
}

/**
 * Summarize `text` into a one-line short description, in `locale`'s language,
 * using the configured (or supplied) provider. Throws LlmError on any failure —
 * callers map that to an HTTP response without leaking internals.
 *
 * `context` is the entry's heading fields (customer, employer, school, title…)
 * as the user sees them. Optional — an older client or a section with no
 * identity fields simply sends none, and the prompt's generic rule still holds.
 */
export async function summarize(
  text: string, locale: string, context: readonly string[] = [], config?: LlmConfig,
): Promise<string> {
  const language = languageName(locale)
  // The task is restated in the USER turn, after the source, for the same
  // reason the system prompt closes with the native directive: what a small
  // model reads LAST is what it follows. The system prompt alone left the
  // reply drifting back into "restate the heading".
  const directive = languageDirective(locale)
  const user = `${contextBlock(context)}Entry description:\n"""\n${text}\n"""\n\n`
    + `Write the one-line short description of that entry in ${language}, `
    + `saying what it actually involved. Output only the line.${directive ? ` ${directive}` : ''}`
  const content = await chatComplete(
    [
      {
        role: 'system',
        content: SYSTEM_PROMPT
          .replace('{LANGUAGE}', language)
          .replace('{DIRECTIVE}', directive)
          .trimEnd(),
      },
      { role: 'user', content: user },
    ],
    // 120 rather than 80: a hard cut mid-line is indistinguishable from a bad
    // summary, and ~18 words of Norwegian or Finnish is more tokens than of
    // English. Low temperature — this is extraction, not composition.
    { maxTokens: 120, temperature: 0.2 },
    config,
  )
  const line = tidyLine(content)
  if (!line) throw new LlmError(502, 'The AI model returned no usable summary')
  return line
}
