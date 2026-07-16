import type { LocalizedString, Publication } from '../types'
import { resolve } from './locales'

export type PublicationType = Publication['publication_type']

/**
 * Ordered publication types with their display labels — the SINGLE source for
 * both the editor dropdown and the rendered "(Type)" parenthetical, so the two
 * can never drift. "Thesis" covers a bachelor's / master's thesis or a
 * master-level major project report; "Research Publication" covers
 * peer-reviewed / academic research output.
 *
 * Each entry carries a full localized label set: the type is a PICK, so the
 * consultant never types it and an export in any locale has to supply the word.
 * `label` is the English twin (from `labels.en`) that feeds the editor
 * dropdown, which stays English — see lib/exportStrings.ts on that boundary.
 */
const ENTRIES: ReadonlyArray<{ value: PublicationType; labels: LocalizedString }> = [
  {
    value: 'article',
    labels: {
      en: 'Article', no: 'Artikkel', se: 'Artikel', dk: 'Artikel',
      de: 'Artikel', fr: 'Article', es: 'Artículo', it: 'Articolo',
      nl: 'Artikel', pt: 'Artigo', pl: 'Artykuł',
      fi: 'Artikkeli', is: 'Grein', ru: 'Статья', uk: 'Стаття',
    },
  },
  {
    value: 'research',
    labels: {
      en: 'Research Publication', no: 'Forskningspublikasjon', se: 'Forskningspublikation', dk: 'Forskningspublikation',
      de: 'Forschungspublikation', fr: 'Publication scientifique', es: 'Publicación científica', it: 'Pubblicazione scientifica',
      nl: 'Wetenschappelijke publicatie', pt: 'Publicação científica', pl: 'Publikacja naukowa',
      fi: 'Tieteellinen julkaisu', is: 'Vísindagrein', ru: 'Научная публикация', uk: 'Наукова публікація',
    },
  },
  {
    // Kept as "Whitepaper" where the loanword is the working term (Nordics,
    // German, Dutch, Finnish); calqued where the native form is established.
    value: 'whitepaper',
    labels: {
      en: 'Whitepaper', no: 'Whitepaper', se: 'Whitepaper', dk: 'Whitepaper',
      de: 'Whitepaper', fr: 'Livre blanc', es: 'Libro blanco', it: 'Libro bianco',
      nl: 'Whitepaper', pt: 'Livro branco', pl: 'Biała księga',
      fi: 'Whitepaper', is: 'Hvítbók', ru: 'Белая книга', uk: 'Біла книга',
    },
  },
  {
    value: 'report',
    labels: {
      en: 'Report', no: 'Rapport', se: 'Rapport', dk: 'Rapport',
      de: 'Bericht', fr: 'Rapport', es: 'Informe', it: 'Rapporto',
      nl: 'Rapport', pt: 'Relatório', pl: 'Raport',
      fi: 'Raportti', is: 'Skýrsla', ru: 'Отчёт', uk: 'Звіт',
    },
  },
  {
    value: 'thesis',
    labels: {
      en: 'Thesis', no: 'Avhandling', se: 'Uppsats', dk: 'Afhandling',
      de: 'Abschlussarbeit', fr: 'Mémoire', es: 'Tesis', it: 'Tesi',
      nl: 'Scriptie', pt: 'Tese', pl: 'Praca dyplomowa',
      fi: 'Opinnäytetyö', is: 'Ritgerð', ru: 'Дипломная работа', uk: 'Дипломна робота',
    },
  },
  {
    value: 'book',
    labels: {
      en: 'Book', no: 'Bok', se: 'Bok', dk: 'Bog',
      de: 'Buch', fr: 'Livre', es: 'Libro', it: 'Libro',
      nl: 'Boek', pt: 'Livro', pl: 'Książka',
      fi: 'Kirja', is: 'Bók', ru: 'Книга', uk: 'Книга',
    },
  },
  {
    value: 'book_chapter',
    labels: {
      en: 'Book chapter', no: 'Bokkapittel', se: 'Bokkapitel', dk: 'Bogkapitel',
      de: 'Buchkapitel', fr: 'Chapitre de livre', es: 'Capítulo de libro', it: 'Capitolo di libro',
      nl: 'Boekhoofdstuk', pt: 'Capítulo de livro', pl: 'Rozdział książki',
      fi: 'Kirjan luku', is: 'Bókarkafli', ru: 'Глава книги', uk: 'Розділ книги',
    },
  },
  {
    value: 'blog_post',
    labels: {
      en: 'Blog post', no: 'Blogginnlegg', se: 'Blogginlägg', dk: 'Blogindlæg',
      de: 'Blogbeitrag', fr: 'Article de blog', es: 'Entrada de blog', it: 'Articolo di blog',
      nl: 'Blogbericht', pt: 'Artigo de blogue', pl: 'Wpis na blogu',
      fi: 'Blogikirjoitus', is: 'Bloggfærsla', ru: 'Запись в блоге', uk: 'Допис у блозі',
    },
  },
]

export const PUBLICATION_TYPES: ReadonlyArray<{ value: PublicationType; label: string; labels: LocalizedString }> =
  ENTRIES.map((e) => ({ value: e.value, label: e.labels.en ?? e.value, labels: e.labels }))

const BY_VALUE = new Map(PUBLICATION_TYPES.map((t) => [t.value as string, t]))

/** Human label for a stored publication_type in `locale`; '' for unknown/absent. */
export function publicationTypeLabel(type: string | null | undefined, locale = 'en'): string {
  if (type == null) return ''
  const entry = BY_VALUE.get(type)
  return entry ? resolve(entry.labels, locale) : ''
}
