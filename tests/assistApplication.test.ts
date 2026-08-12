import { describe, it, expect } from 'vitest'
import { emptyStore, makeEducation, makeProject, makeSkill, makeView, makeCoverLetter, makeResume,
} from './fixtures'
import type { CoverLetter, ResumeStore } from '../src/types'
import {
  buildJobFitPrompt, validateJobFit, fitTally, hasPosting, InvalidJobFitError,
} from '../src/lib/jobFit'
import {
  buildLetterAnglesPrompt, buildLetterCritiquePrompt, hasLetterContext,
  validateLetterAngles, validateLetterCritique, InvalidLetterAdviceError,
} from '../src/lib/letterAdvice'
import { intakeInstructions, bulkSpec } from '../src/lib/bulkImport'
import { buildViewSections } from '../src/lib/viewFilter'

function storeWithProject(): ResumeStore {
  const s = emptyStore()
  s.projects = [makeProject({
    customer: { en: 'Acme' },
    description: { en: 'Payments platform' },
    long_description: { en: 'Containerised the services with Docker and Helm.' },
  })]
  return s
}

const pid = (s: ResumeStore) => s.projects[0].id

// ── B1: job fit ──────────────────────────────────────────────────────────────

describe('job fit', () => {
  const reply = (requirements: unknown[], verdict = 'Worth applying.') =>
    ({ verdict, requirements })

  it('needs a posting of real length before it will run', () => {
    expect(hasPosting('')).toBe(false)
    expect(hasPosting('Java dev')).toBe(false)
    expect(hasPosting('We are looking for a senior platform engineer with Kubernetes experience.')).toBe(true)
  })

  it('resolves evidence to real items and labels them', () => {
    const s = storeWithProject()
    const { requirements, dropped } = validateJobFit(reply([{
      requirement: 'Container orchestration', weight: 'essential', status: 'evidenced',
      evidence: [{ section: 'projects', item_id: pid(s), note: 'Docker and Helm.' }],
      suggestion: '',
    }]), s, 'en')

    expect(dropped).toHaveLength(0)
    expect(requirements[0].evidence[0]).toMatchObject({
      section: 'projects', itemId: pid(s), itemLabel: 'Acme — Payments platform',
    })
  })

  /**
   * The guard that keeps the report honest: a row claiming proof we can't
   * resolve must not read as proof. Downgraded, not dropped — the requirement
   * still has to appear, or the report silently loses a line and stops being
   * the complete list that makes it useful.
   */
  it('downgrades an "evidenced" row whose citation does not resolve', () => {
    const s = storeWithProject()
    const { requirements, dropped } = validateJobFit(reply([{
      requirement: 'Kubernetes', weight: 'essential', status: 'evidenced',
      evidence: [{ section: 'projects', item_id: 'not-a-real-id', note: 'x' }],
    }]), s, 'en')

    expect(requirements).toHaveLength(1)
    expect(requirements[0].status).toBe('adjacent')
    expect(dropped[0]).toMatch(/isn't in the CV/i)
  })

  it('opens on the gaps that matter: essentials first, missing before evidenced', () => {
    const s = storeWithProject()
    const { requirements } = validateJobFit(reply([
      { requirement: 'D-ok', weight: 'desirable', status: 'evidenced', evidence: [{ section: 'projects', item_id: pid(s), note: '' }] },
      { requirement: 'E-ok', weight: 'essential', status: 'evidenced', evidence: [{ section: 'projects', item_id: pid(s), note: '' }] },
      { requirement: 'D-gap', weight: 'desirable', status: 'missing' },
      { requirement: 'E-gap', weight: 'essential', status: 'missing' },
      { requirement: 'E-near', weight: 'essential', status: 'adjacent' },
    ]), s, 'en')

    expect(requirements.map((r) => r.requirement))
      .toEqual(['E-gap', 'E-near', 'E-ok', 'D-gap', 'D-ok'])
  })

  it('defaults an unknown status to missing rather than assuming the best', () => {
    const s = storeWithProject()
    const { requirements } = validateJobFit(
      reply([{ requirement: 'Something', status: 'brilliant' }]), s, 'en')
    expect(requirements[0].status).toBe('missing')
  })

  it('tallies the statuses for the summary line', () => {
    const s = storeWithProject()
    const result = validateJobFit(reply([
      { requirement: 'a', status: 'missing' },
      { requirement: 'b', status: 'adjacent' },
      { requirement: 'c', status: 'missing' },
    ]), s, 'en')
    expect(fitTally(result)).toEqual({ evidenced: 0, adjacent: 1, missing: 2 })
  })

  it('rejects a reply that is not a fit report', () => {
    expect(() => validateJobFit({ verdict: 'x' }, emptyStore(), 'en')).toThrow(InvalidJobFitError)
  })

  it('sends the posting and the CV, and asks for the adjacent class explicitly', () => {
    const s = storeWithProject()
    const prompt = buildJobFitPrompt(s, 'en', 'Must have Kubernetes in production.')
    expect(prompt).toContain('Must have Kubernetes in production.')
    expect(prompt).toContain('Containerised the services with Docker and Helm.')
    expect(prompt).toMatch(/adjacent/)
  })

  it('measures the posting after trimming, at exactly the threshold', () => {
    // Pasting from a job board brings a lot of surrounding whitespace; counting
    // it would arm the Run button on nothing.
    expect(hasPosting(' '.repeat(200))).toBe(false)
    expect(hasPosting(`  ${'x'.repeat(41)}  `)).toBe(true)
    // 40 is the floor, and it is exclusive.
    expect(hasPosting('x'.repeat(40))).toBe(false)
    expect(hasPosting('x'.repeat(41))).toBe(true)
  })

  it('names the registry skills in the language being reviewed', () => {
    const s = storeWithProject()
    s.skills = [makeSkill({ name: { en: 'Cloud architecture', no: 'Skyarkitektur' } })]
    expect(buildJobFitPrompt(s, 'no', 'Vi søker en arkitekt.')).toContain('Skyarkitektur')
  })

  it('trims and caps the posting it sends', () => {
    const s = storeWithProject()
    const prompt = buildJobFitPrompt(s, 'en', `   ${'p'.repeat(20_050)}   `)
    expect(prompt).toContain('p'.repeat(20_000))
    expect(prompt).not.toContain('p'.repeat(20_001))
  })
})

// ── B5: letter angles & critique ─────────────────────────────────────────────

function makeLetter(over: Partial<CoverLetter> = {}): CoverLetter {
  return {
    id: 'cl-1', resume_id: 'resume-1', name: 'Acme application',
    view_id: null, company: { en: 'Acme' }, role_applied: { en: 'Platform lead' },
    posting: 'We need a platform lead who has run Kubernetes in production for a regulated client.',
    recipient: {}, greeting: {}, body: {}, closing: {}, dateline: {},
    sort_order: 0, starred: false, disabled: false,
    ...over,
  } as CoverLetter
}

describe('letter angles', () => {
  it('needs a posting or a role before it will run', () => {
    expect(hasLetterContext(makeLetter({ posting: '', role_applied: {} }))).toBe(false)
    expect(hasLetterContext(makeLetter({ posting: '', role_applied: { en: 'Platform lead' } }))).toBe(true)
    expect(hasLetterContext(makeLetter())).toBe(true)
  })

  /**
   * The evidence must be the CV this letter TRAVELS WITH. A letter pitching a
   * project the attached view excluded reads as a different person's
   * application — and the view lookup had never been exercised at all.
   */
  it('grounds the letter in the attached view, not the master CV', () => {
    const s = storeWithProject()
    s.educations = [makeEducation({ description: { en: 'Studied at length.' } })]
    const view = makeView({
      id: 'v1', name: 'Consultant CV',
      sections: buildViewSections().map((sec) => (
        sec.key === 'educations' ? { ...sec, detail: 'off' as const } : sec
      )),
    })
    s.views = [view]

    const prompt = buildLetterAnglesPrompt(s, makeLetter({ view_id: 'v1' }), 'en')
    expect(prompt).toContain('CV VERSION ATTACHED: "Consultant CV"')
    expect(prompt).toContain('Containerised the services with Docker and Helm.')
    expect(prompt).not.toContain('Studied at length.')
  })

  it('falls back to the master CV when no view is attached, or the id is stale', () => {
    const s = storeWithProject()
    s.views = [makeView({ id: 'v1', name: 'Consultant CV' })]

    for (const viewId of [null, 'deleted-view']) {
      const prompt = buildLetterAnglesPrompt(s, makeLetter({ view_id: viewId }), 'en')
      expect(prompt, String(viewId)).toContain('CV VERSION: the full master CV')
      expect(prompt, String(viewId)).not.toContain('CV VERSION ATTACHED')
    }
  })

  it('says plainly when the letter names no company, role or posting', () => {
    const s = storeWithProject()
    const bare = makeLetter({ company: {}, role_applied: {}, posting: '   ' })
    const prompt = buildLetterAnglesPrompt(s, bare, 'en')
    expect(prompt).toContain('(unnamed company)')
    expect(prompt).toMatch(/no posting text was provided/)
  })

  it('keeps each angle whole and names what is being chosen between', () => {
    const angles = validateLetterAngles({ angles: [
      { name: 'Lead with regulated delivery', rationale: 'Lands with risk-averse buyers.', body: 'One.\n\nTwo.' },
      { name: 'Lead with the platform rebuild', rationale: 'Lands with engineers.', body: 'Three.' },
    ] })
    expect(angles).toHaveLength(2)
    expect(angles[0]).toMatchObject({
      name: 'Lead with regulated delivery', rationale: 'Lands with risk-averse buyers.', body: 'One.\n\nTwo.',
    })
  })

  /**
   * The body lands in a field that already has its own greeting and closing, so
   * a model that adds them anyway would produce "Dear ... Dear ..." on export.
   */
  it('strips a greeting and sign-off the model added anyway', () => {
    const [angle] = validateLetterAngles({ angles: [{
      name: 'x', body: 'Dear Hiring Manager,\n\nI build platforms.\n\nKind regards,\nSvein',
    }] })
    expect(angle.body).toBe('I build platforms.')
  })

  it('drops an angle with no body, and fails when none survive', () => {
    const angles = validateLetterAngles({ angles: [{ name: 'a', body: '' }, { name: 'b', body: 'Real.' }] })
    expect(angles).toHaveLength(1)
    expect(() => validateLetterAngles({ angles: [{ name: 'a', body: '' }] })).toThrow(InvalidLetterAdviceError)
    expect(() => validateLetterAngles({})).toThrow(InvalidLetterAdviceError)
  })

  it('grounds the prompt in the posting and the CV evidence', () => {
    const s = storeWithProject()
    const prompt = buildLetterAnglesPrompt(s, makeLetter(), 'en')
    expect(prompt).toContain('Kubernetes in production')
    expect(prompt).toContain('Acme — Payments platform')
    expect(prompt).toMatch(/GENUINELY DIFFERENT/)
  })
})

describe('letter critique', () => {
  it('sorts notes most severe first and keeps the ask', () => {
    const { overall, notes } = validateLetterCritique({
      overall: 'Solid but generic in the opening.',
      notes: [
        { severity: 'low', title: 'Long third paragraph', detail: 'x' },
        { severity: 'high', title: 'Claims Kubernetes', detail: 'The CV never shows it.', ask: 'Where did you run it?' },
      ],
    })
    expect(overall).toBe('Solid but generic in the opening.')
    expect(notes.map((n) => n.title)).toEqual(['Claims Kubernetes', 'Long third paragraph'])
    expect(notes[0].ask).toBe('Where did you run it?')
  })

  it('accepts a clean read with no notes', () => {
    const r = validateLetterCritique({ overall: 'This is a good letter.', notes: [] })
    expect(r.notes).toHaveLength(0)
  })

  /** An empty reply is not a clean bill of health. */
  it('rejects a reply with neither an overall read nor a note', () => {
    expect(() => validateLetterCritique({ notes: [] })).toThrow(InvalidLetterAdviceError)
  })

  it('shows the letter as written so the model can check it against the CV', () => {
    const s = storeWithProject()
    const letter = makeLetter({ body: { en: 'I have run Kubernetes for years.' } })
    const prompt = buildLetterCritiquePrompt(s, letter, 'en')
    expect(prompt).toContain('I have run Kubernetes for years.')
    expect(prompt).toContain('Containerised the services with Docker and Helm.')
    expect(prompt).toMatch(/CLAIMS THE CV DOES NOT SUPPORT/)
  })
})

// ── C1: freeform intake ──────────────────────────────────────────────────────

describe('intake instructions', () => {
  it('keeps the bulk contract and adds the messy-source rules plus the text', () => {
    const spec = bulkSpec('projects')!
    const source = 'Finally wrapped the Oslo thing last spring — helped the team ship it.'
    const prompt = intakeInstructions(spec, ['en', 'no'], source)

    // The output contract is unchanged: same schema, same section, so the same
    // validator/mapper/preview handle the reply.
    expect(prompt).toContain('resumestudio-bulk/v1')
    expect(prompt).toContain('"section": "projects"')
    // …and the source is carried inline rather than pasted by the user.
    expect(prompt).toContain(source)
    // The rules that stop prose inviting invention.
    expect(prompt).toMatch(/only what is stated/i)
    expect(prompt).toMatch(/Do not upgrade the language/i)
    expect(prompt).toMatch(/empty items array/i)
  })

  it('still names every locale so one paste fills both language columns', () => {
    const spec = bulkSpec('projects')!
    const prompt = intakeInstructions(spec, ['en', 'no'], 'source')
    expect(prompt).toMatch(/2 languages/)
  })
})

/**
 * B5's body tidying, and the remaining validator branches.
 *
 * tidyBody had 18 mutants and none of its four rules was exercised. It exists
 * because the model writes a greeting and a sign-off however firmly the prompt
 * says not to — and the drafted body lands in a field that ALREADY has its own
 * greeting and closing above and below it, so a stray one is duplicated in the
 * exported letter.
 */
describe('letter angles — tidying the drafted body', () => {
  const bodyOf = (body: string) =>
    validateLetterAngles({ angles: [{ label: 'A', body }] })[0].body

  it('strips a greeting the model added anyway', () => {
    // Each of these opens a letter in one of the languages this app supports.
    for (const hello of ['Dear Hiring Manager,', 'Hi there!', 'Hello,', 'Hei,', 'Kjære Hiring Manager,']) {
      expect(bodyOf(`${hello}\n\nI am writing about the role.`), hello)
        .toBe('I am writing about the role.')
    }
  })

  it('strips a sign-off block, including the name line under it', () => {
    for (const bye of ['Kind regards', 'Best regards', 'Sincerely', 'Yours sincerely', 'Regards', 'Mvh', 'Med vennlig hilsen']) {
      expect(bodyOf(`I am writing about the role.\n\n${bye},\nKari Nordmann`), bye)
        .toBe('I am writing about the role.')
    }
  })

  it('unwraps a fenced code block', () => {
    expect(bodyOf('```\nI am writing about the role.\n```')).toBe('I am writing about the role.')
    expect(bodyOf('```text\nI am writing about the role.\n```')).toBe('I am writing about the role.')
  })

  it('only strips a greeting at the START and a sign-off at the END', () => {
    // A letter may legitimately quote either mid-paragraph; removing those
    // would delete the applicant's own words.
    const body = 'They said "Dear Sir" in the advert.\n\nI would sign it Kind regards, but not here.\n\nFinal line.'
    expect(bodyOf(body)).toBe(body)
  })

  it('leaves a body with neither alone', () => {
    expect(bodyOf('I am writing about the role.')).toBe('I am writing about the role.')
  })

  it('reports a reply whose only angle has no body, rather than returning nothing', () => {
    // An empty list would render as a panel that ran and found nothing to say.
    expect(() => validateLetterAngles({ angles: [{ label: 'A', body: '   ' }] }))
      .toThrow(/no usable letters/i)
  })
})

describe('letter critique — the remaining branches', () => {
  it('defaults an unknown severity to medium rather than to the worst', () => {
    // Crying wolf on every note makes the real ones invisible.
    const r = validateLetterCritique({ notes: [{ title: 'T', detail: 'D', severity: 'catastrophic' }] })
    expect(r.notes[0].severity).toBe('medium')
  })

  it('sorts the most severe first', () => {
    const r = validateLetterCritique({ notes: [
      { title: 'low one', detail: 'd', severity: 'low' },
      { title: 'high one', detail: 'd', severity: 'high' },
      { title: 'medium one', detail: 'd', severity: 'medium' },
    ] })
    expect(r.notes.map((n) => n.severity)).toEqual(['high', 'medium', 'low'])
  })

  it('falls back to the detail when a note has no title', () => {
    // A note with no heading renders as a blank row you cannot act on.
    const r = validateLetterCritique({ notes: [{ detail: 'The opening restates the CV.' }] })
    expect(r.notes[0].title).toBe('The opening restates the CV.')
  })

  it('skips a note with neither a title nor a detail', () => {
    const r = validateLetterCritique({ overall: 'Fine.', notes: [{ severity: 'high' }] })
    expect(r.notes).toEqual([])
  })

  it('carries an ask only when there is one', () => {
    // `ask` is the escape valve (§15); an empty one would render an empty
    // question box.
    const withAsk = validateLetterCritique({ notes: [{ title: 'T', detail: 'D', ask: 'Which team?' }] })
    expect(withAsk.notes[0].ask).toBe('Which team?')
    const without = validateLetterCritique({ notes: [{ title: 'T', detail: 'D', ask: '  ' }] })
    expect('ask' in without.notes[0]).toBe(false)
  })

  it('accepts an overall read with NO notes — that is a clean bill', () => {
    expect(validateLetterCritique({ overall: 'Reads well.', notes: [] }).overall).toBe('Reads well.')
  })

  it('rejects a reply with neither an overall read nor a note', () => {
    // Not a clean bill — an empty response.
    expect(() => validateLetterCritique({ notes: [] })).toThrow(InvalidLetterAdviceError)
  })
})

/**
 * B5's gate and its prompt inputs.
 *
 * hasLetterContext decides whether the Run button works at all. Too strict and a
 * usable letter cannot be drafted; too loose and the model is asked to write from
 * nothing, which is exactly when it invents an employer.
 */
describe('letterAdvice — the run gate and prompt inputs', () => {
  const letter = (over: Record<string, unknown> = {}) => makeCoverLetter(over as never)

  it('needs a posting of real length, measured AFTER trimming', () => {
    const short = 'a'.repeat(40)
    expect(hasLetterContext(letter({ posting: short }))).toBe(false)
    expect(hasLetterContext(letter({ posting: `${short}b` }))).toBe(true)
    // Padding is not content.
    expect(hasLetterContext(letter({ posting: `${'a'.repeat(30)}${' '.repeat(60)}` }))).toBe(false)
  })

  it('accepts a stated ROLE even with no posting', () => {
    // A consultant who knows the job title can still get angles worth reading.
    expect(hasLetterContext(letter({ posting: '', role_applied: { en: 'Lead Architect' } }))).toBe(true)
  })

  it('does not accept a whitespace-only role', () => {
    expect(hasLetterContext(letter({ posting: '', role_applied: { en: '   ' } }))).toBe(false)
  })

  it('accepts a role stated in ANY locale', () => {
    expect(hasLetterContext(letter({ posting: '', role_applied: { no: 'Løsningsarkitekt' } }))).toBe(true)
  })

  it('refuses when there is neither', () => {
    expect(hasLetterContext(letter({ posting: '', role_applied: {} }))).toBe(false)
  })

  describe('the angles prompt', () => {
    const store = () => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'Kari Nordmann' })
      return s
    }

    it('names the applicant, and says so explicitly when unnamed', () => {
      // The model addresses the letter; an empty name would produce 'APPLICANT: '
      // and an invented signature.
      expect(buildLetterAnglesPrompt(store(), letter({ role_applied: { en: 'Architect' } }), 'en'))
        .toContain('Kari Nordmann')
      const anon = store()
      anon.resume = makeResume({ full_name: '   ' })
      expect(buildLetterAnglesPrompt(anon, letter({ role_applied: { en: 'Architect' } }), 'en'))
        .toMatch(/APPLICANT: \(unnamed\)/)
    })

    it('trims the company and role it states', () => {
      const p = buildLetterAnglesPrompt(store(), letter({
        company: { en: '  Equinor  ' }, role_applied: { en: '  Architect  ' },
      }), 'en')
      expect(p).toContain('Equinor')
      expect(p).not.toContain('  Equinor')
    })
  })

  describe('the critique prompt', () => {
    it('carries the body for the locale being reviewed', () => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'Kari' })
      const l = makeCoverLetter({ body: { en: 'English body.', no: 'Norsk tekst.' } } as never)
      expect(buildLetterCritiquePrompt(s, l, 'no')).toContain('Norsk tekst.')
      expect(buildLetterCritiquePrompt(s, l, 'no')).not.toContain('English body.')
    })

    it('reads the body slot RAW, without falling back to another locale', () => {
      // A critique of the English text presented as a review of the Norwegian
      // one would report problems that are not in the letter being read.
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'Kari' })
      const l = makeCoverLetter({ body: { en: 'English body.' } } as never)
      expect(buildLetterCritiquePrompt(s, l, 'no')).not.toContain('English body.')
    })
  })

  it('numbers unnamed angles from 1', () => {
    const angles = validateLetterAngles({
      angles: [{ body: 'First letter.' }, { body: 'Second letter.' }],
    })
    expect(angles.map((a) => a.name)).toEqual(['Option 1', 'Option 2'])
  })

  it('keeps a label the model supplied', () => {
    expect(validateLetterAngles({ angles: [{ name: 'The turnaround', body: 'x' }] })[0].name)
      .toBe('The turnaround')
  })
})

/**
 * B1's ordering and its evidence downgrade.
 *
 * The report is read top-down when deciding whether to apply at all, so the order
 * IS the message: essentials before desirables, gaps before what is already fine.
 */
describe('validateJobFit — weight, order and evidence', () => {
  const store = () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' } })]
    return s
  }
  const reply = (requirements: unknown[]) => ({ verdict: 'Worth applying.', requirements })

  it('defaults an unstated weight to ESSENTIAL, not desirable', () => {
    // Under-weighting a requirement moves it down the report and out of sight.
    const r = validateJobFit(reply([{ requirement: 'Kubernetes', status: 'missing' }]), store(), 'en')
    expect(r.requirements[0].weight).toBe('essential')
  })

  it('honours an explicit desirable', () => {
    const r = validateJobFit(reply([
      { requirement: 'Nice to have', status: 'missing', weight: 'desirable' },
    ]), store(), 'en')
    expect(r.requirements[0].weight).toBe('desirable')
  })

  it('treats an unknown weight as essential', () => {
    const r = validateJobFit(reply([
      { requirement: 'X', status: 'missing', weight: 'mandatory-ish' },
    ]), store(), 'en')
    expect(r.requirements[0].weight).toBe('essential')
  })

  it('puts every essential before every desirable', () => {
    const r = validateJobFit(reply([
      { requirement: 'Desirable gap', status: 'missing', weight: 'desirable' },
      { requirement: 'Essential met', status: 'evidenced', weight: 'essential',
        evidence: [{ section: 'projects', item_id: 'p1' }] },
    ]), store(), 'en')
    expect(r.requirements.map((x) => x.weight)).toEqual(['essential', 'desirable'])
  })

  it('within one weight, puts the gaps first', () => {
    const r = validateJobFit(reply([
      { requirement: 'Met', status: 'evidenced', evidence: [{ section: 'projects', item_id: 'p1' }] },
      { requirement: 'Adjacent', status: 'adjacent' },
      { requirement: 'Missing', status: 'missing' },
    ]), store(), 'en')
    expect(r.requirements.map((x) => x.requirement)).toEqual(['Missing', 'Adjacent', 'Met'])
  })

  it('downgrades an EVIDENCED row whose citation does not resolve — it does not drop it', () => {
    // Unproven is not proof, but losing the row breaks the completeness that
    // makes the report worth reading.
    const r = validateJobFit(reply([
      { requirement: 'Kubernetes', status: 'evidenced', evidence: [{ section: 'projects', item_id: 'ghost' }] },
    ]), store(), 'en')
    expect(r.requirements).toHaveLength(1)
    expect(r.requirements[0].status).toBe('adjacent')
  })

  it('keeps an evidenced row whose citation resolves', () => {
    const r = validateJobFit(reply([
      { requirement: 'Kubernetes', status: 'evidenced', evidence: [{ section: 'projects', item_id: 'p1' }] },
    ]), store(), 'en')
    expect(r.requirements[0].status).toBe('evidenced')
    expect(r.requirements[0].evidence).toHaveLength(1)
  })

  it('ignores a citation naming a section the advisors do not know', () => {
    const r = validateJobFit(reply([
      { requirement: 'X', status: 'evidenced', evidence: [{ section: 'skills', item_id: 'p1' }] },
    ]), store(), 'en')
    expect(r.requirements[0].status).toBe('adjacent')
  })

  it('carries the verdict text through, capped', () => {
    const long = 'x'.repeat(4000)
    expect(validateJobFit({ verdict: long, requirements: [] }, store(), 'en').verdict.length)
      .toBeLessThan(long.length)
  })

  it('drops a requirement with no text, naming the position', () => {
    const r = validateJobFit(reply([{ status: 'missing' }]), store(), 'en')
    expect(r.requirements).toEqual([])
    expect(r.dropped.join(' ')).toMatch(/Requirement 1/)
  })
})

/**
 * `tidyBody` exists because the model writes a greeting and a sign-off however
 * firmly the prompt forbids them — and the body field sits between a greeting and
 * a sign-off the user already wrote, so a duplicate is what ships.
 */
describe('validateLetterAngles — the body the model actually returns', () => {
  const bodyOf = (body: string) =>
    validateLetterAngles({ angles: [{ name: 'Angle', body }] })[0]?.body

  it('strips a fenced block, opening and closing', () => {
    expect(bodyOf('```\nThe letter body.\n```')).toBe('The letter body.')
    expect(bodyOf('```markdown\nThe letter body.\n```')).toBe('The letter body.')
  })

  it('strips an English or Norwegian greeting line', () => {
    for (const greeting of ['Dear Hiring Manager,', 'Hi there,', 'Hello,', 'Hei,', 'Kjære leser,']) {
      expect(bodyOf(`${greeting}\n\nThe letter body.`), greeting).toBe('The letter body.')
    }
  })

  it('strips a greeting whatever its case', () => {
    expect(bodyOf('DEAR HIRING MANAGER,\n\nThe letter body.')).toBe('The letter body.')
  })

  it('keeps a line that merely BEGINS with a greeting word mid-sentence', () => {
    // "Dearth of candidates…" is prose, not a salutation: the word boundary is
    // what separates them.
    expect(bodyOf('Dearth of good candidates is the problem.\n\nMore body.'))
      .toBe('Dearth of good candidates is the problem.\n\nMore body.')
  })

  it('strips a sign-off block at the end, in either language', () => {
    for (const signoff of [
      'Kind regards,\nAda', 'Best regards,\nAda', 'Sincerely,\nAda',
      'Yours sincerely,\nAda', 'Regards,\nAda', 'Mvh\nAda', 'Med vennlig hilsen\nAda',
    ]) {
      expect(bodyOf(`The letter body.\n\n${signoff}`), signoff).toBe('The letter body.')
    }
  })

  it('keeps a sign-off-like phrase that is not at the end', () => {
    expect(bodyOf('I send my regards to the team.\n\nThe rest of the body.'))
      .toBe('I send my regards to the team.\n\nThe rest of the body.')
  })

  it('refuses a reply whose only angle tidies away to nothing', () => {
    // An empty body is not an angle, and a reply of nothing but empties is not a
    // result — the panel says so rather than showing an empty list.
    expect(() => validateLetterAngles({ angles: [{ name: 'a', body: '```\n\n```' }] }))
      .toThrow(/no usable letters/)
    expect(() => validateLetterAngles({ angles: [{ name: 'a', body: '   ' }] }))
      .toThrow(/no usable letters/)
  })

  it('drops the empty angle but keeps the usable one beside it', () => {
    const angles = validateLetterAngles({ angles: [
      { name: 'empty', body: '   ' },
      { name: 'real', body: 'The letter body.' },
    ] })
    expect(angles.map((a) => a.name)).toEqual(['real'])
  })

  it('keeps a greeting that is the whole body — there is nothing else to keep', () => {
    // The strip needs a line AFTER the greeting; a one-line reply is all the
    // model gave us, and dropping it would report no angles at all.
    expect(validateLetterAngles({ angles: [{ name: 'a', body: 'Dear Sir,' }] })[0].body)
      .toBe('Dear Sir,')
  })

  it('refuses a reply that is not an object at all', () => {
    for (const bad of [null, undefined, 'text', 42, true]) {
      expect(() => validateLetterAngles(bad), String(bad)).toThrow(/not a JSON object/)
    }
  })

  it('skips a non-object angle among good ones', () => {
    const angles = validateLetterAngles({ angles: [
      null, 'text', 42, { name: 'real', body: 'The letter body.' },
    ] })
    expect(angles.map((a) => a.name)).toEqual(['real'])
  })

  it('caps the NUMBER of angles it will take from one reply', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `A${i}`, body: `Body ${i}.` }))
    expect(validateLetterAngles({ angles: many }).length).toBeLessThan(12)
  })

  it('trims a body before deciding it is empty, and after tidying', () => {
    expect(validateLetterAngles({ angles: [{ name: 'a', body: '  The letter body.  ' }] })[0].body)
      .toBe('The letter body.')
    const fenced = ['```', 'The body.', '```   '].join(String.fromCharCode(10))
    expect(validateLetterAngles({ angles: [{ name: 'a', body: fenced }] })[0].body)
      .toBe('The body.')
  })

  it('strips a bare fence with no newline after it', () => {
    // The tag pattern is letters, so a body starting with a digit shows the
    // no-newline path without the first word being read as a language tag.
    expect(bodyOf('```2 reasons to hire me.```')).toBe('2 reasons to hire me.')
  })

  it('strips the fence only at the EDGES', () => {
    // A fence in the middle is the model quoting something.
    expect(bodyOf('Before ``` after')).toBe('Before ``` after')
  })

  it('caps a runaway body rather than storing an essay', () => {
    const huge = 'word '.repeat(3000)
    const body = bodyOf(huge)!
    expect(body.length).toBeLessThanOrEqual(6000)
  })

  it('strips a sign-off only at the END of the body', () => {
    // "Kind regards" mid-letter is prose; only a closing block is a sign-off.
    const middle = ['Body one.', '', 'Kind regards for the help,', 'Ada', '', 'Body two.']
      .join(String.fromCharCode(10))
    expect(bodyOf(middle)).toBe(middle)
  })
})

describe('validateLetterCritique — the notes and their wording', () => {
  it('refuses a reply that is not an object', () => {
    for (const bad of [null, 'text', 42]) {
      expect(() => validateLetterCritique(bad)).toThrow(InvalidLetterAdviceError)
    }
  })

  it('refuses a reply with neither an overall read nor a single note', () => {
    // "Nothing to flag" is a useful answer; an empty reply is not the same thing.
    for (const empty of [{}, { notes: [] }, { notes: 'none' }]) {
      expect(() => validateLetterCritique(empty), JSON.stringify(empty))
        .toThrow(/no critique/)
    }
  })

  it('accepts an overall read with no notes at all', () => {
    const out = validateLetterCritique({ overall: 'Reads well.', notes: [] })
    expect(out.notes).toEqual([])
    expect(out.overall).toBe('Reads well.')
  })

  it('keys each note and defaults an unstated severity to medium', () => {
    const { notes } = validateLetterCritique({ notes: [
      { title: 'Too long', detail: 'Three pages.' },
      { title: 'Weak open', detail: 'Starts with a cliché.', severity: 'high' },
      { title: 'Nit', detail: 'A comma.', severity: 'nonsense' },
    ] })
    // Keyed by the reply's own order, then sorted most severe first.
    expect(notes.map((n) => n.key).sort()).toEqual(['note:0', 'note:1', 'note:2'])
    expect(notes[0]).toMatchObject({ key: 'note:1', severity: 'high' })
    expect(notes.slice(1).map((n) => n.severity)).toEqual(['medium', 'medium'])
  })

  it('falls back to a truncated detail when a note has no title', () => {
    const long = 'x'.repeat(200)
    const { notes } = validateLetterCritique({ notes: [{ detail: long }] })
    expect(notes[0].title).toHaveLength(80)
    expect(notes[0].detail).toBe(long)
  })

  it('caps the NUMBER of notes it will take from one reply', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `T${i}`, detail: 'x' }))
    expect(validateLetterCritique({ notes: many }).notes.length).toBeLessThan(40)
  })

  it('drops a note with neither title nor detail, and a non-object entry', () => {
    const { notes } = validateLetterCritique({ notes: [
      {}, null, 'text', { title: '   ' }, { title: 'Real', detail: 'Yes.' },
    ] })
    expect(notes.map((n) => n.title)).toEqual(['Real'])
  })

  it('carries an ask only when there is one', () => {
    const { notes } = validateLetterCritique({ notes: [
      { title: 'A', detail: 'x', ask: 'Which outcome mattered most?' },
      { title: 'B', detail: 'y' },
      { title: 'C', detail: 'z', ask: '   ' },
    ] })
    expect(notes[0].ask).toBe('Which outcome mattered most?')
    expect('ask' in notes[1]).toBe(false)
    expect('ask' in notes[2]).toBe(false)
  })
})

