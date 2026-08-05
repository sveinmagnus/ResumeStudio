/**
 * The Copy / Draft / Summarize assist state machine shared by DualField and
 * RichField.
 *
 * Both fields render two locale columns and offer the same affordances on
 * whichever column is empty: copy the other column's text as a starting point,
 * draft a machine translation of it, or (DualField only) summarize a long
 * description into a short one. Both had their own copy of this — identical
 * `busyLocale`/`draftedLocale`/`error` state, `copyBetween`, `draftBetween`
 * and the annotation rules — differing only in CSS class prefix.
 *
 * They had already drifted: RichField never gained Summarize, and the two
 * disagreed about when Copy is offered. This hook is the single definition;
 * what each field renders around it stays in the field.
 *
 * State keys off the TARGET locale so an assist can run in either direction
 * (primary→secondary or secondary→primary) without cross-talk.
 */
import { useState } from 'react'
import { api } from '../../lib/api'
import { glossaryFor } from '../../lib/glossary'
import { useStore } from '../../store/useStore'
import type { LocalizedString } from '../../types'

export interface TranslationAssist {
  /** Locale currently awaiting a network round-trip, or null. */
  busyLocale: string | null
  /** Locale holding an un-edited machine translation. */
  draftedLocale: string | null
  /** Locale holding an un-edited AI summary. */
  summarizedLocale: string | null
  /** The most recent failure, scoped to the locale it happened in. */
  error: { locale: string; msg: string } | null
  /** Fill `to` from `from` verbatim (no network). */
  copyBetween: (from: string, to: string) => void
  /** Draft a translation of `from` into `to`. */
  draftBetween: (from: string, to: string) => Promise<void>
  /** Summarize `source` into `locale`, telling the model what the heading already says. */
  summarizeInto: (locale: string, source: string, context?: string[]) => Promise<void>
  /**
   * Clear a locale's draft/summary/error annotations — call when the user
   * edits that column, since they've now taken ownership of the text.
   */
  clearAnnotations: (locale: string) => void
}

export function useTranslationAssist(
  value: LocalizedString,
  /** Write `text` into `locale` (the field owns how a value is stored). */
  set: (locale: string, text: string) => void,
  /**
   * A locale's text as PLAIN prose, trimmed — what gets sent to the translator
   * and what "is this column empty?" means. RichField passes the tag-stripped
   * projection here, because the backend doesn't preserve markup and we don't
   * pretend to round-trip it; DualField's values are already plain.
   *
   * Copy still moves the RAW value, so a rich column keeps its formatting.
   */
  textOf: (locale: string) => string,
): TranslationAssist {
  const [busyLocale, setBusyLocale] = useState<string | null>(null)
  const [draftedLocale, setDraftedLocale] = useState<string | null>(null)
  const [summarizedLocale, setSummarizedLocale] = useState<string | null>(null)
  const [error, setError] = useState<{ locale: string; msg: string } | null>(null)

  const clearAnnotations = (locale: string) => {
    if (draftedLocale === locale) setDraftedLocale(null)
    if (summarizedLocale === locale) setSummarizedLocale(null)
    setError((e) => (e?.locale === locale ? null : e))
  }

  const copyBetween = (from: string, to: string) => {
    if (!textOf(from)) return
    // The RAW value, so rich formatting survives the copy.
    set(to, value[from] || '')
    clearAnnotations(to)
  }

  /** Shared round-trip: mark busy, run, annotate on success, report on failure. */
  const run = async (
    locale: string,
    call: () => Promise<string>,
    annotate: (locale: string) => void,
    failure: string,
  ) => {
    if (busyLocale) return
    setBusyLocale(locale)
    setError(null)
    try {
      set(locale, await call())
      annotate(locale)
    } catch (e) {
      setError({ locale, msg: (e as Error).message || failure })
    } finally {
      setBusyLocale(null)
    }
  }

  const draftBetween = (from: string, to: string) => {
    const source = textOf(from)
    if (!source) return Promise.resolve()
    // C3: the terminology this CV already uses, narrowed to the terms that
    // actually occur in THIS text. Invisible by design — there is no control for
    // it, because "translate this the way I translated it last time" is not a
    // decision the user should have to make per field. A few lines at most, so
    // it costs nothing and works on a small local model.
    const glossary = glossaryFor(useStore.getState().data, from, to, source)
    return run(to, () => api.translate(source, from, to, glossary), setDraftedLocale, 'Translation failed')
  }

  const summarizeInto = (locale: string, source: string, context: string[] = []) => {
    if (!source) return Promise.resolve()
    return run(locale, () => api.summarize(source, locale, context), setSummarizedLocale, 'Summarize failed')
  }

  return {
    busyLocale, draftedLocale, summarizedLocale, error,
    copyBetween, draftBetween, summarizeInto, clearAnnotations,
  }
}
