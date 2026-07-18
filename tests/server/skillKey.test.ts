import { describe, it, expect } from 'vitest'
import { skillKey as serverSkillKey, normalizeKey as serverNormalizeKey } from '../../server/skillKey'
import { skillKey as clientSkillKey } from '../../src/lib/skillExtract'
import { normalizeKey as clientNormalizeKey } from '../../src/lib/skillMatch'

/**
 * The server key is a hand-kept mirror of the client's (server can't import
 * client code across the layer boundary). This suite is the guard: if either
 * side drifts, the promote-to-registry migration would split one skill across
 * two canonical entries. Test the pair against a table that exercises every
 * rule — case, punctuation, diacritics, version tokens, the "js" alias.
 */
const NAMES = [
  'React', 'React.js', 'react', 'Node.js', 'Node',
  'Spring', 'Spring Boot', 'Java', 'JavaScript',
  'C#', 'C++', '.NET', 'ASP.NET Core',
  'Amazon Web Services', 'AWS', 'CI/CD',
  'Prosjektledelse', 'Løsningsarkitektur', 'Über-Skill',   // diacritics
  'Angular 18', 'Vue 3', 'Python 3.11', 'v2.0 tooling',    // version tokens
  '   Messy   Spacing  ', 'ALL CAPS THING', '',
]

describe('server skillKey mirrors the client', () => {
  it('agrees with client skillKey on every sample', () => {
    for (const n of NAMES) {
      expect(serverSkillKey(n)).toBe(clientSkillKey(n))
    }
  })

  it('agrees with client normalizeKey on every sample', () => {
    for (const n of NAMES) {
      expect(serverNormalizeKey(n)).toBe(clientNormalizeKey(n))
    }
  })

  it('strips diacritics (so NO/EN spellings of a tech line up)', () => {
    expect(serverSkillKey('Über-Skill')).toBe('uber skill')
  })

  it('drops a trailing js token', () => {
    expect(serverSkillKey('React.js')).toBe(serverSkillKey('React'))
    expect(serverSkillKey('Node.js')).toBe('node')
  })

  it('does not merge different skills sharing a head word', () => {
    expect(serverSkillKey('Spring')).not.toBe(serverSkillKey('Spring Boot'))
  })
})
