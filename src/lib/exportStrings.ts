/**
 * PURE: the localized chrome that an EXPORTED VIEW renders around the user's
 * own content — words the app supplies rather than the consultant typing them
 * (skill-matrix column headers, the "Skills:" tag label, an ongoing marker).
 *
 * Scope, deliberately: this is the EXPORT boundary only. The editor UI stays
 * English — CLAUDE.md §12 still defers app-wide UI-chrome localization behind a
 * dictionary-based `t()`, and this file is not that. The distinction that keeps
 * it from becoming that: a string belongs here only if it lands in a `.pdf` /
 * `.docx` / `.txt` a consultant sends to a client. If it only ever appears in
 * the editor, it stays a hardcoded English literal where it is. Do not import
 * this from `components/`.
 *
 * Vocabulary that already has a home keeps it — months and "Present" live in
 * lib/locales.ts, section headings in lib/sections.ts, the CEFR words in
 * lib/cefr.ts, and the type/relationship label sets in lib/positionTypes.ts,
 * lib/publicationTypes.ts and lib/recommendationRelationships.ts. This file is
 * for export chrome with no other natural owner.
 *
 * Every LOCALE_LABELS code is translated for every key — tests pin it.
 */

import type { LocalizedString } from '../types'
import { resolve, bcp47 } from './locales'

export type ExportStringKey =
  | 'matrix_skill'
  | 'matrix_category'
  | 'matrix_experience'
  | 'matrix_proficiency'
  | 'matrix_last_used'
  | 'ongoing'
  | 'skills'
  | 'grade'
  | 'team_of'
  | 'allocation'

/**
 * Exported for the locale-coverage test only — a missing locale degrades to
 * English through `resolve`, so completeness is invisible via `xs` and has to
 * be asserted against the table. Render code calls `xs` / `xt`.
 */
export const EXPORT_STRINGS: Record<ExportStringKey, LocalizedString> = {
  // ─── Skill-matrix column headers ──────────────────────────────────────────
  matrix_skill: {
    en: 'Skill', no: 'Ferdighet', se: 'Färdighet', dk: 'Kompetence',
    de: 'Fähigkeit', fr: 'Compétence', es: 'Habilidad', it: 'Competenza',
    nl: 'Vaardigheid', pt: 'Competência', pl: 'Umiejętność',
    fi: 'Osaaminen', is: 'Hæfni', ru: 'Навык', uk: 'Навичка',
  },
  matrix_category: {
    en: 'Category', no: 'Kategori', se: 'Kategori', dk: 'Kategori',
    de: 'Kategorie', fr: 'Catégorie', es: 'Categoría', it: 'Categoria',
    nl: 'Categorie', pt: 'Categoria', pl: 'Kategoria',
    fi: 'Kategoria', is: 'Flokkur', ru: 'Категория', uk: 'Категорія',
  },
  matrix_experience: {
    en: 'Experience', no: 'Erfaring', se: 'Erfarenhet', dk: 'Erfaring',
    de: 'Erfahrung', fr: 'Expérience', es: 'Experiencia', it: 'Esperienza',
    nl: 'Ervaring', pt: 'Experiência', pl: 'Doświadczenie',
    fi: 'Kokemus', is: 'Reynsla', ru: 'Опыт', uk: 'Досвід',
  },
  matrix_proficiency: {
    en: 'Proficiency', no: 'Nivå', se: 'Nivå', dk: 'Niveau',
    de: 'Niveau', fr: 'Niveau', es: 'Nivel', it: 'Livello',
    nl: 'Niveau', pt: 'Nível', pl: 'Poziom',
    fi: 'Taso', is: 'Færni', ru: 'Уровень', uk: 'Рівень',
  },
  matrix_last_used: {
    en: 'Last used', no: 'Sist brukt', se: 'Senast använd', dk: 'Sidst brugt',
    de: 'Zuletzt genutzt', fr: 'Dernière utilisation', es: 'Último uso', it: 'Ultimo utilizzo',
    nl: 'Laatst gebruikt', pt: 'Última utilização', pl: 'Ostatnio używane',
    fi: 'Viimeksi käytetty', is: 'Síðast notað', ru: 'Последнее использование', uk: 'Останнє використання',
  },

  // ─── Shared ───────────────────────────────────────────────────────────────
  /** Skill-matrix "Last used" value for a skill still in use. */
  ongoing: {
    en: 'Ongoing', no: 'Pågående', se: 'Pågående', dk: 'Igangværende',
    de: 'Laufend', fr: 'En cours', es: 'En curso', it: 'In corso',
    nl: 'Lopend', pt: 'Em curso', pl: 'W trakcie',
    fi: 'Käynnissä', is: 'Í gangi', ru: 'Сейчас', uk: 'Зараз',
  },
  /** Bare noun — callers compose the separator (e.g. `${xs('skills', l)}: `). */
  skills: {
    en: 'Skills', no: 'Ferdigheter', se: 'Färdigheter', dk: 'Kompetencer',
    de: 'Fähigkeiten', fr: 'Compétences', es: 'Habilidades', it: 'Competenze',
    nl: 'Vaardigheden', pt: 'Competências', pl: 'Umiejętności',
    fi: 'Osaaminen', is: 'Hæfni', ru: 'Навыки', uk: 'Навички',
  },
  /** Bare noun — education's grade line composes `${xs('grade', l)}: A`. */
  grade: {
    en: 'Grade', no: 'Karakter', se: 'Betyg', dk: 'Karakter',
    de: 'Note', fr: 'Mention', es: 'Calificación', it: 'Voto',
    nl: 'Cijfer', pt: 'Classificação', pl: 'Ocena',
    fi: 'Arvosana', is: 'Einkunn', ru: 'Оценка', uk: 'Оцінка',
  },

  // ─── Templates (interpolate with `xt`) ────────────────────────────────────
  // `{n}` is positioned per language, not appended: Finnish and Icelandic put
  // the count first ("5 hengen tiimi"), Slavic languages lead with the noun
  // ("Загрузка 50%"). A concatenating helper could not express either.
  /** A project's team size — `{n}` is the head count. */
  team_of: {
    en: 'Team of {n}', no: 'Team på {n}', se: 'Team på {n}', dk: 'Team på {n}',
    de: 'Team von {n}', fr: 'Équipe de {n}', es: 'Equipo de {n}', it: 'Team di {n}',
    nl: 'Team van {n}', pt: 'Equipa de {n}', pl: 'Zespół {n} osób',
    fi: '{n} hengen tiimi', is: '{n} manna teymi', ru: 'Команда из {n}', uk: 'Команда з {n}',
  },
  /** A project's time allocation — `{n}` is the percentage, without its sign. */
  allocation: {
    en: '{n}% allocation', no: '{n} % allokering', se: '{n} % allokering', dk: '{n} % allokering',
    de: '{n} % Auslastung', fr: '{n} % d’allocation', es: '{n} % de dedicación', it: '{n}% di allocazione',
    nl: '{n}% inzet', pt: '{n}% de alocação', pl: 'Zaangażowanie {n}%',
    fi: '{n} %:n työpanos', is: '{n}% starfshlutfall', ru: 'Загрузка {n}%', uk: 'Завантаження {n}%',
  },
}

/** Localized export-chrome string; unknown locales fall back to English. */
export function xs(key: ExportStringKey, locale: string): string {
  return resolve(EXPORT_STRINGS[key], locale)
}

/**
 * Localized export-chrome string with `{placeholder}` substitution — for the
 * entries above whose word order puts a value mid-string. An unknown
 * placeholder renders empty rather than leaving `{n}` visible in a client's PDF.
 */
export function xt(key: ExportStringKey, locale: string, vars: Record<string, string | number>): string {
  return xs(key, locale).replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : '')
}

/**
 * The unit noun for a count of years, per Intl plural category.
 *
 * Why per-category rather than one string: Slavic languages inflect the noun by
 * count (Polish 1 rok / 2 lata / 5 lat; Russian 1 год / 2 года / 5 лет), so a
 * single "lat"/"лет" renders "1 lat" — visibly wrong in the one place a reader
 * checks carefully. `Intl.PluralRules` already knows every rule here, so we
 * only supply the words. Categories a language doesn't use are simply absent;
 * `other` is the required fallback for all of them.
 */
const YEAR_UNIT: Record<string, Partial<Record<Intl.LDMLPluralRule, string>>> = {
  en: { one: 'yr', other: 'yrs' },
  no: { other: 'år' },
  se: { other: 'år' },
  dk: { other: 'år' },
  de: { one: 'Jahr', other: 'Jahre' },
  fr: { one: 'an', other: 'ans' },
  es: { one: 'año', other: 'años' },
  it: { one: 'anno', other: 'anni' },
  nl: { other: 'jaar' },
  pt: { one: 'ano', other: 'anos' },
  pl: { one: 'rok', few: 'lata', many: 'lat', other: 'lat' },
  fi: { other: 'v.' },
  is: { other: 'ár' },
  ru: { one: 'год', few: 'года', many: 'лет', other: 'лет' },
  uk: { one: 'рік', few: 'роки', many: 'років', other: 'років' },
}

/**
 * Format a count of years for the skill matrix's Experience column — "5 yrs",
 * "5 år", "5 lat". Returns '' for a non-positive count so the cell stays blank.
 */
export function fmtYears(years: number, locale = 'en'): string {
  if (!(years > 0)) return ''
  const unit = YEAR_UNIT[locale] ?? YEAR_UNIT.en
  let category: Intl.LDMLPluralRule = 'other'
  try {
    category = new Intl.PluralRules(bcp47(locale)).select(years)
  } catch {
    // An engine without data for this locale — `other` is always populated.
  }
  return `${years} ${unit[category] ?? unit.other}`
}
