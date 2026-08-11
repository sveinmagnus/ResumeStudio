/**
 * The version identity: a semver for the updater, a label for humans.
 *
 * The rule worth pinning is the asymmetry — only a build that CI declared
 * `release` may show a version number. Everything else says `Dev-<commit>`, so
 * a bug report from a working tree can't be mistaken for one from the artifact
 * users downloaded. `APP_VERSION` must stay a bare semver through all of it,
 * because the updater compares it against the latest GitHub release.
 *
 * The module resolves everything at import time, so each case needs a fresh
 * module registry rather than a re-read.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

async function loadVersion(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, '')
    else vi.stubEnv(k, v)
  }
  return import('../../server/version.js')
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

describe('APP_VERSION_LABEL', () => {
  it('shows the version number only when CI declared a release build', async () => {
    const mod = await loadVersion({
      RESUME_APP_VERSION: '1.0.0',
      RESUME_BUILD_CHANNEL: 'release',
      RESUME_BUILD_COMMIT: 'abcdef1234567',
    })
    expect(mod.IS_RELEASE_BUILD).toBe(true)
    expect(mod.APP_VERSION_LABEL).toBe('v1.0.0')
    // The updater's input is untouched by any of the labelling.
    expect(mod.APP_VERSION).toBe('1.0.0')
  })

  it('reports Dev-<commit> when no channel is declared, even with a real version', async () => {
    const mod = await loadVersion({
      RESUME_APP_VERSION: '1.0.0',
      RESUME_BUILD_CHANNEL: undefined,
      RESUME_BUILD_COMMIT: 'abcdef1234567',
    })
    expect(mod.IS_RELEASE_BUILD).toBe(false)
    expect(mod.APP_VERSION_LABEL).toBe('Dev-abcdef1')
    // Still a valid semver for the updater — the label is a display concern.
    expect(mod.APP_VERSION).toBe('1.0.0')
  })

  it('does not let a local build claim the release channel by another name', async () => {
    const mod = await loadVersion({
      RESUME_APP_VERSION: '1.0.0',
      RESUME_BUILD_CHANNEL: 'production',
      RESUME_BUILD_COMMIT: 'abcdef1234567',
    })
    expect(mod.IS_RELEASE_BUILD).toBe(false)
    expect(mod.APP_VERSION_LABEL).toBe('Dev-abcdef1')
  })

  it('accepts the declaration case-insensitively and around whitespace', async () => {
    const mod = await loadVersion({
      RESUME_APP_VERSION: '1.0.0',
      RESUME_BUILD_CHANNEL: ' Release ',
      RESUME_BUILD_COMMIT: 'abcdef1',
    })
    expect(mod.APP_VERSION_LABEL).toBe('v1.0.0')
  })

  it('truncates a full commit sha to the short form', async () => {
    const mod = await loadVersion({
      RESUME_BUILD_CHANNEL: undefined,
      RESUME_BUILD_COMMIT: '0123456789abcdef0123456789abcdef01234567',
    })
    expect(mod.BUILD_COMMIT).toBe('0123456')
  })
})
