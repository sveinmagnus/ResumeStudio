import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { parseEnvFile, loadDotEnv } from '../../server/env'

/**
 * `.env` was never loaded by the server, while README and `.env.example` both
 * read as though copying it configured one. The failure pointed the wrong way:
 * an unset `RESUME_API_TOKEN` disables authentication, so a deployment whose
 * configuration never arrived served every CV to anyone.
 */

let dir: string
const TOUCHED = ['RS_TEST_A', 'RS_TEST_B', 'RS_TEST_PRESET']

function writeEnv(contents: string): string {
  const file = path.join(dir, '.env')
  fs.writeFileSync(file, contents, 'utf8')
  return file
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-env-'))
  for (const k of TOUCHED) delete process.env[k]
})

afterEach(() => {
  for (const k of TOUCHED) delete process.env[k]
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('parseEnvFile', () => {
  it('reads plain assignments', () => {
    expect(parseEnvFile('A=1\nB=two')).toEqual({ A: '1', B: 'two' })
  })

  it('ignores comments and blank lines', () => {
    expect(parseEnvFile('# a comment\n\nA=1\n   \n# another\n')).toEqual({ A: '1' })
  })

  it('accepts an export prefix, which people paste from shell notes', () => {
    expect(parseEnvFile('export A=1')).toEqual({ A: '1' })
  })

  it('strips one level of matching quotes', () => {
    expect(parseEnvFile('A="hello world"\nB=\'x\'')).toEqual({ A: 'hello world', B: 'x' })
  })

  it('leaves mismatched or inner quotes alone', () => {
    expect(parseEnvFile(`A="unclosed`)).toEqual({ A: '"unclosed' })
    expect(parseEnvFile('A=say "hi"')).toEqual({ A: 'say "hi"' })
  })

  it('keeps = inside a value, which every connection string has', () => {
    expect(parseEnvFile('URL=postgres://u:p@h/db?x=1&y=2')).toEqual({
      URL: 'postgres://u:p@h/db?x=1&y=2',
    })
  })

  it('skips lines that are not assignments', () => {
    expect(parseEnvFile('nonsense\n=novalue\n1BAD=x\nA=1')).toEqual({ A: '1' })
  })

  it('handles CRLF, since a .env can be edited on Windows', () => {
    expect(parseEnvFile('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' })
  })
})

describe('loadDotEnv', () => {
  it('applies values that are not already set', () => {
    const file = writeEnv('RS_TEST_A=from-file')
    const result = loadDotEnv(file)
    expect(process.env.RS_TEST_A).toBe('from-file')
    expect(result.applied).toContain('RS_TEST_A')
  })

  it('NEVER overrides the real environment', () => {
    // The whole point. A systemd unit, a Docker -e or a CI secret is the
    // deliberate configuration; a .env left in the working directory is not.
    // It also means adding this cannot change a deployment that already worked.
    process.env.RS_TEST_PRESET = 'from-environment'
    const file = writeEnv('RS_TEST_PRESET=from-file')
    const result = loadDotEnv(file)
    expect(process.env.RS_TEST_PRESET).toBe('from-environment')
    expect(result.skipped).toContain('RS_TEST_PRESET')
    expect(result.applied).not.toContain('RS_TEST_PRESET')
  })

  it('reports no file rather than throwing when there is none', () => {
    const result = loadDotEnv(path.join(dir, 'nothing-here'))
    expect(result).toEqual({ file: null, applied: [], skipped: [] })
  })

  it('survives a malformed file, because the environment may already be right', () => {
    const file = writeEnv('this is not an env file\n\x20\nA')
    expect(() => loadDotEnv(file)).not.toThrow()
  })

  it('applies an empty value as an empty string, not as unset', () => {
    // `RESUME_API_TOKEN=` is the documented way to disable auth deliberately;
    // reading it as "absent" would be the same outcome by accident.
    const file = writeEnv('RS_TEST_B=')
    loadDotEnv(file)
    expect(process.env.RS_TEST_B).toBe('')
  })
})
