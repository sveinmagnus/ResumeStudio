/**
 * The `$schema` id every assist puts in its prompt.
 *
 * Each one is a contract: the prompt tells the model to stamp it, and the id is
 * what makes a reply identifiable as an answer to THAT assist rather than to
 * some other one. Every one of them survived the mutation report — the suites
 * assert `prompt.toContain(CONST)`, which holds for an emptied constant and for
 * two constants that are the same string.
 *
 * Two of them WERE the same string when this was written:
 *  - `HYGIENE_SCHEMA` was `resumestudio-registry/v1`, byte-identical to the
 *    sync folder's registry FILE format — and `isMergeableBackupFormat` routes
 *    anything under that prefix to the server's merge endpoint, so a saved C4
 *    reply dropped on the picker was read as a registry to merge;
 *  - `PAGE_FIT_SCHEMA` and `JOB_FIT_SCHEMA` were both `resumestudio-fit/v1`.
 */
import { describe, it, expect } from 'vitest'
import { MINING_SCHEMA } from '../src/lib/achievementMining'
import { AI_IMPORT_SCHEMA } from '../src/lib/aiImport'
import { ANON_CHECK_SCHEMA } from '../src/lib/anonCheck'
import { FINDINGS_SCHEMA } from '../src/lib/assistFindings'
import { PROPOSALS_SCHEMA } from '../src/lib/assistProposals'
import { ATS_SCHEMA } from '../src/lib/atsAudit'
import { BULK_IMPORT_SCHEMA } from '../src/lib/bulkImport'
import { JOB_FIT_SCHEMA } from '../src/lib/jobFit'
import { KEY_POINTS_SCHEMA } from '../src/lib/keyPoints'
import { LETTER_ANGLES_SCHEMA, LETTER_CRITIQUE_SCHEMA } from '../src/lib/letterAdvice'
import { PAGE_FIT_SCHEMA } from '../src/lib/pageFit'
import { PROFILE_SCHEMA } from '../src/lib/profileGenerator'
import { HYGIENE_SCHEMA } from '../src/lib/registryHygiene'
import { SKILL_EXTRACT_SCHEMA } from '../src/lib/skillExtract'
import { TAILOR_SCHEMA } from '../src/lib/viewTailor'
import { WRITING_COACH_SCHEMA } from '../src/lib/writingCoach'
import { isMergeableBackupFormat } from '../src/lib/backup'

const SCHEMAS: Array<[string, string]> = [
  ['achievementMining', MINING_SCHEMA],
  ['aiImport', AI_IMPORT_SCHEMA],
  ['anonCheck', ANON_CHECK_SCHEMA],
  ['assistFindings', FINDINGS_SCHEMA],
  ['assistProposals', PROPOSALS_SCHEMA],
  ['atsAudit', ATS_SCHEMA],
  ['bulkImport', BULK_IMPORT_SCHEMA],
  ['jobFit', JOB_FIT_SCHEMA],
  ['keyPoints', KEY_POINTS_SCHEMA],
  ['letterAdvice (angles)', LETTER_ANGLES_SCHEMA],
  ['letterAdvice (critique)', LETTER_CRITIQUE_SCHEMA],
  ['pageFit', PAGE_FIT_SCHEMA],
  ['profileGenerator', PROFILE_SCHEMA],
  ['registryHygiene', HYGIENE_SCHEMA],
  ['skillExtract', SKILL_EXTRACT_SCHEMA],
  ['viewTailor', TAILOR_SCHEMA],
  ['writingCoach', WRITING_COACH_SCHEMA],
]

describe('assist schema ids', () => {
  it('names each one concretely and versions it', () => {
    expect(Object.fromEntries(SCHEMAS)).toEqual({
      achievementMining: 'resumestudio-achievements/v1',
      aiImport: 'resumestudio-ai/v1',
      anonCheck: 'resumestudio-anon/v1',
      assistFindings: 'resumestudio-findings/v1',
      assistProposals: 'resumestudio-edits/v1',
      atsAudit: 'resumestudio-ats/v1',
      bulkImport: 'resumestudio-bulk/v1',
      jobFit: 'resumestudio-fit/v1',
      keyPoints: 'resumestudio-points/v1',
      'letterAdvice (angles)': 'resumestudio-letter-angles/v1',
      'letterAdvice (critique)': 'resumestudio-letter-critique/v1',
      pageFit: 'resumestudio-pagefit/v1',
      profileGenerator: 'resumestudio-profiles/v1',
      registryHygiene: 'resumestudio-registry-hygiene/v1',
      skillExtract: 'resumestudio-skills/v1',
      viewTailor: 'resumestudio-tailor/v1',
      writingCoach: 'resumestudio-rewrite/v1',
    })
  })

  it('gives no two assists the same id', () => {
    const ids = SCHEMAS.map(([, id]) => id)
    expect(new Set(ids).size, ids.join(', ')).toBe(ids.length)
  })

  it('never collides with a file format the importer merges by identity', () => {
    // `isMergeableBackupFormat` matches on a schema PREFIX and routes a match
    // straight to the server's merge endpoint. An assist reply is not a
    // backup: it carries no resume id and nothing to merge against.
    for (const [name, id] of SCHEMAS) {
      expect(isMergeableBackupFormat({ $schema: id }), name).toBe(false)
    }
  })
})
