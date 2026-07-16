/**
 * PURE: the curated list of recommender-relationship options for the
 * Recommendations editor. The relationship describes how the recommender knows
 * the consultant, phrased from the CONSULTANT's perspective ("Was my manager").
 *
 * Each option carries a localized label set so the dropdown can render in the
 * user's current editing language and — because picking an option stamps the
 * full label set onto the stored `LocalizedString` — every export locale gets
 * the right translation with no per-language typing. Every LOCALE_LABELS code
 * is authored here (tests pin it); anything else falls back to English through
 * `resolve()`.
 *
 * The stored value stays a plain `LocalizedString` (no schema change): a picked
 * option is just its label set, and `matchRelationshipKey()` reverse-maps a
 * stored value back to its option so the dropdown re-selects it on reload.
 */

import type { LocalizedString } from '../types'

export interface RelationshipOption {
  /** Stable identifier — persisted nowhere; used only for the <option> value. */
  key: string
  /** Localized labels — one per LOCALE_LABELS code. */
  labels: LocalizedString
}

// Ordered in display clusters: hierarchy → mentoring → teams/peers →
// business/external → education → personal. Every directional relationship has
// both directions (manager/reported-to-me, senior/junior, mentor/mentee,
// client/supplier, teacher/student).
//
// Every label is phrased from the CONSULTANT's perspective and in the past
// tense ("Was my manager"), because that is how it reads on the finished CV.
// Languages that inflect the recommender's gender (ru/uk/pl "Был/Была моим…")
// use the masculine form: the data model has no gender for a recommender, and
// inventing one to satisfy grammar is worse than the convention every CV
// template in those languages already follows.
//
// A stored pick stamps EVERY locale label (see `relationshipLabels`), and a
// value is matched back to its option if ANY locale label still matches
// (`matchRelationshipKey`). The English label is the stable anchor — a picked
// value almost always carries it — so refining the other wording is free.
// Rewording an `en` label orphans any saved pick that has no other matching
// locale into free text; it was safe to do so while real data was still sparse,
// but once recommendations accumulate, prefer adding a NEW option instead.
export const RELATIONSHIP_OPTIONS: RelationshipOption[] = [
  // ─── Hierarchy ─────────────────────────────────────────────────────────────
  {
    key: 'manager',
    labels: {
      en: 'Was my manager', no: 'Var min leder', se: 'Var min chef', dk: 'Var min leder',
      de: 'War mein Vorgesetzter', fr: 'Était mon responsable', es: 'Fue mi jefe', it: 'Era il mio responsabile',
      nl: 'Was mijn leidinggevende', pt: 'Foi o meu gestor', pl: 'Był moim przełożonym',
      fi: 'Oli esihenkilöni', is: 'Var yfirmaður minn', ru: 'Был моим руководителем', uk: 'Був моїм керівником',
    },
  },
  {
    key: 'reported_to_me',
    labels: {
      en: 'Reported to me', no: 'Rapporterte til meg', se: 'Rapporterade till mig', dk: 'Rapporterede til mig',
      de: 'Berichtete an mich', fr: 'Était sous ma responsabilité', es: 'Reportaba a mí', it: 'Riportava a me',
      nl: 'Rapporteerde aan mij', pt: 'Reportava a mim', pl: 'Podlegał mi',
      fi: 'Raportoi minulle', is: 'Heyrði undir mig', ru: 'Подчинялся мне', uk: 'Підпорядковувався мені',
    },
  },
  {
    key: 'senior_colleague',
    labels: {
      en: 'Was a senior colleague', no: 'Var en seniorkollega', se: 'Var en seniorkollega', dk: 'Var en seniorkollega',
      de: 'War ein erfahrenerer Kollege', fr: 'Était un collègue senior', es: 'Fue un colega sénior', it: 'Era un collega senior',
      nl: 'Was een senior collega', pt: 'Foi um colega sénior', pl: 'Był starszym stażem współpracownikiem',
      fi: 'Oli kokeneempi kollega', is: 'Var reyndari samstarfsmaður', ru: 'Был старшим коллегой', uk: 'Був старшим колегою',
    },
  },
  {
    key: 'junior_colleague',
    labels: {
      en: 'Was a junior colleague', no: 'Var en juniorkollega', se: 'Var en juniorkollega', dk: 'Var en juniorkollega',
      de: 'War ein Nachwuchskollege', fr: 'Était un collègue junior', es: 'Fue un colega júnior', it: 'Era un collega junior',
      nl: 'Was een junior collega', pt: 'Foi um colega júnior', pl: 'Był młodszym stażem współpracownikiem',
      fi: 'Oli nuorempi kollega', is: 'Var yngri samstarfsmaður', ru: 'Был младшим коллегой', uk: 'Був молодшим колегою',
    },
  },
  // ─── Mentoring ─────────────────────────────────────────────────────────────
  {
    key: 'mentor',
    labels: {
      en: 'Was my mentor', no: 'Var min mentor', se: 'Var min mentor', dk: 'Var min mentor',
      de: 'War mein Mentor', fr: 'Était mon mentor', es: 'Fue mi mentor', it: 'Era il mio mentore',
      nl: 'Was mijn mentor', pt: 'Foi o meu mentor', pl: 'Był moim mentorem',
      fi: 'Oli mentorini', is: 'Var leiðbeinandi minn', ru: 'Был моим наставником', uk: 'Був моїм наставником',
    },
  },
  {
    key: 'mentee',
    labels: {
      en: 'Was my mentee', no: 'Var min mentee', se: 'Var min adept', dk: 'Var min mentee',
      de: 'War mein Mentee', fr: 'Était mon mentoré', es: 'Fue mi mentorizado', it: 'Era il mio mentee',
      nl: 'Was mijn mentee', pt: 'Foi o meu mentorando', pl: 'Był moim podopiecznym',
      fi: 'Oli mentoroitavani', is: 'Var lærlingur minn', ru: 'Был моим подопечным', uk: 'Був моїм підопічним',
    },
  },
  // ─── Teams / peers ─────────────────────────────────────────────────────────
  {
    key: 'same_team',
    labels: {
      en: 'Worked on the same team', no: 'Jobbet i samme team', se: 'Arbetade i samma team', dk: 'Arbejdede i samme team',
      de: 'Arbeitete im selben Team', fr: 'Travaillait dans la même équipe', es: 'Trabajó en el mismo equipo', it: 'Lavorava nello stesso team',
      nl: 'Werkte in hetzelfde team', pt: 'Trabalhou na mesma equipa', pl: 'Pracował w tym samym zespole',
      fi: 'Työskenteli samassa tiimissä', is: 'Vann í sama teymi', ru: 'Работал в той же команде', uk: 'Працював у тій самій команді',
    },
  },
  {
    key: 'same_group',
    labels: {
      en: 'Worked in the same group', no: 'Jobbet i samme gruppe', se: 'Arbetade i samma grupp', dk: 'Arbejdede i samme gruppe',
      de: 'Arbeitete in derselben Abteilung', fr: 'Travaillait dans le même groupe', es: 'Trabajó en el mismo grupo', it: 'Lavorava nello stesso gruppo',
      nl: 'Werkte in dezelfde groep', pt: 'Trabalhou no mesmo grupo', pl: 'Pracował w tej samej grupie',
      fi: 'Työskenteli samassa ryhmässä', is: 'Vann í sama hópi', ru: 'Работал в той же группе', uk: 'Працював у тій самій групі',
    },
  },
  {
    key: 'different_team',
    labels: {
      en: 'Worked on a different team', no: 'Jobbet i et annet team', se: 'Arbetade i ett annat team', dk: 'Arbejdede i et andet team',
      de: 'Arbeitete in einem anderen Team', fr: 'Travaillait dans une autre équipe', es: 'Trabajó en otro equipo', it: 'Lavorava in un altro team',
      nl: 'Werkte in een ander team', pt: 'Trabalhou noutra equipa', pl: 'Pracował w innym zespole',
      fi: 'Työskenteli toisessa tiimissä', is: 'Vann í öðru teymi', ru: 'Работал в другой команде', uk: 'Працював в іншій команді',
    },
  },
  {
    key: 'executive_team',
    labels: {
      en: 'Served on the same leadership team or board', no: 'Satt i samme ledergruppe eller styre', se: 'Satt i samma ledningsgrupp eller styrelse', dk: 'Sad i samme ledelsesgruppe eller bestyrelse',
      de: 'War in derselben Geschäftsleitung oder im selben Vorstand', fr: 'Siégeait au même comité de direction ou conseil', es: 'Formó parte del mismo equipo directivo o consejo', it: 'Faceva parte dello stesso team dirigenziale o consiglio',
      nl: 'Zat in hetzelfde directieteam of bestuur', pt: 'Integrou a mesma equipa de liderança ou conselho', pl: 'Zasiadał w tym samym zespole kierowniczym lub zarządzie',
      fi: 'Kuului samaan johtoryhmään tai hallitukseen', is: 'Sat í sömu framkvæmdastjórn eða stjórn', ru: 'Входил в ту же руководящую команду или совет', uk: 'Входив до тієї самої керівної команди або правління',
    },
  },
  // ─── Business / external ───────────────────────────────────────────────────
  {
    key: 'client',
    labels: {
      en: 'Was my client', no: 'Var min kunde', se: 'Var min kund', dk: 'Var min kunde',
      de: 'War mein Kunde', fr: 'Était mon client', es: 'Fue mi cliente', it: 'Era il mio cliente',
      nl: 'Was mijn klant', pt: 'Foi o meu cliente', pl: 'Był moim klientem',
      fi: 'Oli asiakkaani', is: 'Var viðskiptavinur minn', ru: 'Был моим клиентом', uk: 'Був моїм клієнтом',
    },
  },
  {
    key: 'service_provider',
    labels: {
      en: 'Was my supplier', no: 'Var min leverandør', se: 'Var min leverantör', dk: 'Var min leverandør',
      de: 'War mein Lieferant', fr: 'Était mon fournisseur', es: 'Fue mi proveedor', it: 'Era il mio fornitore',
      nl: 'Was mijn leverancier', pt: 'Foi o meu fornecedor', pl: 'Był moim dostawcą',
      fi: 'Oli toimittajani', is: 'Var birgir minn', ru: 'Был моим поставщиком', uk: 'Був моїм постачальником',
    },
  },
  {
    key: 'business_partner',
    labels: {
      en: 'Was my business partner', no: 'Var min forretningspartner', se: 'Var min affärspartner', dk: 'Var min forretningspartner',
      de: 'War mein Geschäftspartner', fr: 'Était mon partenaire commercial', es: 'Fue mi socio comercial', it: 'Era il mio partner commerciale',
      nl: 'Was mijn zakenpartner', pt: 'Foi o meu parceiro de negócios', pl: 'Był moim partnerem biznesowym',
      fi: 'Oli liikekumppanini', is: 'Var viðskiptafélagi minn', ru: 'Был моим деловым партнёром', uk: 'Був моїм діловим партнером',
    },
  },
  // ─── Education ─────────────────────────────────────────────────────────────
  {
    key: 'teacher',
    labels: {
      en: 'Was my teacher or professor', no: 'Var min lærer eller foreleser', se: 'Var min lärare eller föreläsare', dk: 'Var min lærer eller underviser',
      de: 'War mein Lehrer oder Dozent', fr: 'Était mon enseignant ou professeur', es: 'Fue mi profesor', it: 'Era il mio insegnante o professore',
      nl: 'Was mijn docent of hoogleraar', pt: 'Foi o meu professor', pl: 'Był moim nauczycielem lub wykładowcą',
      fi: 'Oli opettajani tai luennoitsijani', is: 'Var kennari minn', ru: 'Был моим преподавателем', uk: 'Був моїм викладачем',
    },
  },
  {
    key: 'student',
    labels: {
      en: 'Was my student', no: 'Var min student', se: 'Var min student', dk: 'Var min studerende',
      de: 'War mein Student', fr: 'Était mon étudiant', es: 'Fue mi alumno', it: 'Era il mio studente',
      nl: 'Was mijn student', pt: 'Foi o meu aluno', pl: 'Był moim studentem',
      fi: 'Oli opiskelijani', is: 'Var nemandi minn', ru: 'Был моим студентом', uk: 'Був моїм студентом',
    },
  },
  {
    key: 'studied_together',
    labels: {
      en: 'Studied together', no: 'Studerte sammen', se: 'Studerade tillsammans', dk: 'Studerede sammen',
      de: 'Studierte mit mir', fr: 'Nous avons étudié ensemble', es: 'Estudiamos juntos', it: 'Abbiamo studiato insieme',
      nl: 'Studeerde samen met mij', pt: 'Estudámos juntos', pl: 'Studiowaliśmy razem',
      fi: 'Opiskelimme yhdessä', is: 'Við lærðum saman', ru: 'Учились вместе', uk: 'Навчалися разом',
    },
  },
  // ─── Personal ──────────────────────────────────────────────────────────────
  {
    key: 'friend',
    labels: {
      en: 'A friend', no: 'Var en venn', se: 'Var en vän', dk: 'Var en ven',
      de: 'Ein Freund', fr: 'Un ami', es: 'Un amigo', it: 'Un amico',
      nl: 'Een vriend', pt: 'Um amigo', pl: 'Znajomy',
      fi: 'Ystävä', is: 'Vinur', ru: 'Друг', uk: 'Друг',
    },
  },
]

const OPTION_BY_KEY = new Map(RELATIONSHIP_OPTIONS.map((o) => [o.key, o]))

/** The localized label set for a key, or `{}` for an unknown key. */
export function relationshipLabels(key: string): LocalizedString {
  return { ...(OPTION_BY_KEY.get(key)?.labels ?? {}) }
}

/**
 * Reverse-map a stored relationship value back to its option key so the
 * dropdown re-selects it. Matches when ANY non-empty locale value equals an
 * option's label in that same locale (case-insensitive, trimmed). Returns null
 * for free-text / legacy values that match no option.
 */
export function matchRelationshipKey(relationship: LocalizedString | undefined): string | null {
  if (!relationship) return null
  const norm = (s: string) => s.trim().toLowerCase()
  const entries = Object.entries(relationship).filter(([, v]) => (v ?? '').trim())
  if (entries.length === 0) return null
  for (const opt of RELATIONSHIP_OPTIONS) {
    for (const [locale, value] of entries) {
      const label = opt.labels[locale]
      if (label && norm(label) === norm(value)) return opt.key
    }
  }
  return null
}
