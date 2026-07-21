/**
 * Vocabulary for the "Other roles" (positions) type field — the SINGLE source
 * for the editor dropdown and the rendered label, so they can't drift. Lets a
 * consultant classify non-employment engagements (board seats, volunteering,
 * mentoring…) to sort and filter them. Optional per position.
 *
 * Each entry carries a full localized label set because the type is a PICK, not
 * typed text: the consultant never gets a chance to translate it themselves, so
 * an export in any locale has to supply the word. `label` is the English twin,
 * derived from `labels.en` — it feeds the editor dropdown, which stays English
 * (see lib/exportStrings.ts on why the editor is out of scope).
 */

import type { LocalizedString } from '../types'
import { resolve } from './locales'

const ENTRIES: ReadonlyArray<{ value: string; labels: LocalizedString }> = [
  {
    value: 'board_member',
    labels: {
      en: 'Board member', no: 'Styremedlem', se: 'Styrelseledamot', dk: 'Bestyrelsesmedlem',
      de: 'Vorstandsmitglied', fr: 'Membre du conseil', es: 'Miembro del consejo', it: 'Membro del consiglio',
      nl: 'Bestuurslid', pt: 'Membro do conselho', pl: 'Członek zarządu',
      fi: 'Hallituksen jäsen', is: 'Stjórnarmaður', ru: 'Член совета директоров', uk: 'Член правління',
    },
  },
  {
    value: 'committee_member',
    labels: {
      en: 'Committee member', no: 'Utvalgsmedlem', se: 'Kommittéledamot', dk: 'Udvalgsmedlem',
      de: 'Ausschussmitglied', fr: 'Membre du comité', es: 'Miembro del comité', it: 'Membro del comitato',
      nl: 'Commissielid', pt: 'Membro do comité', pl: 'Członek komisji',
      fi: 'Toimikunnan jäsen', is: 'Nefndarmaður', ru: 'Член комитета', uk: 'Член комітету',
    },
  },
  {
    value: 'advisor',
    labels: {
      en: 'Advisor', no: 'Rådgiver', se: 'Rådgivare', dk: 'Rådgiver',
      de: 'Berater', fr: 'Conseiller', es: 'Asesor', it: 'Consulente',
      nl: 'Adviseur', pt: 'Consultor', pl: 'Doradca',
      fi: 'Neuvonantaja', is: 'Ráðgjafi', ru: 'Советник', uk: 'Радник',
    },
  },
  {
    value: 'mentor',
    labels: {
      en: 'Mentor', no: 'Mentor', se: 'Mentor', dk: 'Mentor',
      de: 'Mentor', fr: 'Mentor', es: 'Mentor', it: 'Mentore',
      nl: 'Mentor', pt: 'Mentor', pl: 'Mentor',
      fi: 'Mentori', is: 'Leiðbeinandi', ru: 'Наставник', uk: 'Наставник',
    },
  },
  {
    value: 'coach',
    labels: {
      en: 'Coach', no: 'Coach', se: 'Coach', dk: 'Coach',
      de: 'Coach', fr: 'Coach', es: 'Coach', it: 'Coach',
      nl: 'Coach', pt: 'Coach', pl: 'Coach',
      fi: 'Valmentaja', is: 'Þjálfari', ru: 'Коуч', uk: 'Коуч',
    },
  },
  {
    value: 'organizer',
    labels: {
      en: 'Organizer', no: 'Arrangør', se: 'Arrangör', dk: 'Arrangør',
      de: 'Organisator', fr: 'Organisateur', es: 'Organizador', it: 'Organizzatore',
      nl: 'Organisator', pt: 'Organizador', pl: 'Organizator',
      fi: 'Järjestäjä', is: 'Skipuleggjandi', ru: 'Организатор', uk: 'Організатор',
    },
  },
  {
    value: 'volunteer',
    labels: {
      en: 'Volunteer', no: 'Frivillig', se: 'Volontär', dk: 'Frivillig',
      de: 'Ehrenamtlicher', fr: 'Bénévole', es: 'Voluntario', it: 'Volontario',
      nl: 'Vrijwilliger', pt: 'Voluntário', pl: 'Wolontariusz',
      fi: 'Vapaaehtoinen', is: 'Sjálfboðaliði', ru: 'Волонтёр', uk: 'Волонтер',
    },
  },
  {
    value: 'reviewer',
    labels: {
      en: 'Reviewer', no: 'Fagfelle', se: 'Granskare', dk: 'Bedømmer',
      de: 'Gutachter', fr: 'Relecteur', es: 'Revisor', it: 'Revisore',
      nl: 'Beoordelaar', pt: 'Revisor', pl: 'Recenzent',
      fi: 'Arvioija', is: 'Ritrýnir', ru: 'Рецензент', uk: 'Рецензент',
    },
  },
  {
    // A business run alongside a primary job/role (the "side-business
    // entrepreneur"). Editor-only classification — never exported.
    value: 'side_venture',
    labels: {
      en: 'Side venture', no: 'Sidevirksomhet', se: 'Sidoverksamhet', dk: 'Bivirksomhed',
      de: 'Nebengewerbe', fr: 'Activité secondaire', es: 'Negocio paralelo', it: 'Attività secondaria',
      nl: 'Nevenactiviteit', pt: 'Negócio paralelo', pl: 'Działalność dodatkowa',
      fi: 'Sivutoiminta', is: 'Hliðarrekstur', ru: 'Побочный бизнес', uk: 'Побічний бізнес',
    },
  },
]

export const POSITION_TYPES: ReadonlyArray<{ value: string; label: string; labels: LocalizedString }> =
  ENTRIES.map((e) => ({ value: e.value, label: e.labels.en ?? e.value, labels: e.labels }))

const BY_VALUE = new Map(POSITION_TYPES.map((t) => [t.value, t]))

/** Human label for a stored position type in `locale`; '' for none/unknown. */
export function positionTypeLabel(type: string | null | undefined, locale = 'en'): string {
  if (type == null) return ''
  const entry = BY_VALUE.get(type)
  return entry ? resolve(entry.labels, locale) : ''
}
