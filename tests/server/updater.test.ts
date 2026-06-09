import { describe, it, expect } from 'vitest'
import {
  parseVersion, compareVersions, assetNameFor, isAllowedHost, checkForUpdate,
} from '../../server/desktop/updater'

describe('parseVersion', () => {
  it.each([
    ['1.2.3', [1, 2, 3]],
    ['v1.2.3', [1, 2, 3]],
    ['0.1', [0, 1, 0]],
    ['2', [2, 0, 0]],
    ['1.2.3-beta.1', [1, 2, 3]], // pre-release ignored for ordering
    ['1.2.3+build9', [1, 2, 3]],
    ['garbage', [0, 0, 0]],
  ])('parses %s', (input, expected) => {
    expect(parseVersion(input as string)).toEqual(expected)
  })
})

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.1', -1],
    ['1.2.0', '1.1.9', 1],
    ['0.1.1', '0.1.1', 0],
    ['v0.2.0', '0.1.9', 1],
    ['1.0.0-rc1', '1.0.0', 0], // pre-release suffix ignored
    ['2.0.0', '10.0.0', -1], // numeric, not lexical
  ])('compares %s vs %s', (a, b, expected) => {
    expect(compareVersions(a as string, b as string)).toBe(expected)
  })
})

describe('assetNameFor', () => {
  it.each([
    ['win32', 'x64', 'resume-studio-windows-x64.tar.gz'],
    ['darwin', 'arm64', 'resume-studio-macos-arm64.tar.gz'],
    ['darwin', 'x64', 'resume-studio-macos-x64.tar.gz'],
    ['linux', 'x64', 'resume-studio-linux-x64.tar.gz'],
  ])('%s/%s', (platform, arch, expected) => {
    expect(assetNameFor(platform as NodeJS.Platform, arch)).toBe(expected)
  })
})

describe('isAllowedHost (SSRF guard)', () => {
  it('allows GitHub hosts over https', () => {
    expect(isAllowedHost('https://api.github.com/repos/x/y/releases/latest')).toBe(true)
    expect(isAllowedHost('https://github.com/x/y/releases/download/v1/a.tgz')).toBe(true)
    expect(isAllowedHost('https://objects.githubusercontent.com/abc')).toBe(true)
    expect(isAllowedHost('https://codeload.github.com/x')).toBe(true)
  })
  it('rejects non-GitHub hosts, non-https, and lookalikes', () => {
    expect(isAllowedHost('https://evil.com/x')).toBe(false)
    expect(isAllowedHost('http://github.com/x')).toBe(false) // must be https
    expect(isAllowedHost('https://github.com.evil.com/x')).toBe(false) // suffix trick
    expect(isAllowedHost('https://notgithub.com/x')).toBe(false)
    expect(isAllowedHost('not a url')).toBe(false)
  })
})

// A minimal fetch stub returning a JSON GitHub release.
function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

const asset = assetNameFor() // for the current test runner's platform/arch

describe('checkForUpdate', () => {
  it('reports an available update when the release is newer', async () => {
    const f = fakeFetch({
      tag_name: 'v9.9.9',
      body: 'New stuff',
      html_url: 'https://github.com/sveinmagnus/resumestudio/releases/tag/v9.9.9',
      assets: [{ name: asset, browser_download_url: `https://github.com/sveinmagnus/resumestudio/releases/download/v9.9.9/${asset}` }],
    })
    const info = await checkForUpdate('0.1.0', f)
    expect(info.updateAvailable).toBe(true)
    expect(info.latestVersion).toBe('9.9.9')
    expect(info.assetUrl).toContain(asset)
    expect(info.notes).toBe('New stuff')
  })

  it('reports no update when the release equals the current version', async () => {
    const f = fakeFetch({ tag_name: 'v0.1.0', assets: [] })
    const info = await checkForUpdate('0.1.0', f)
    expect(info.updateAvailable).toBe(false)
  })

  it('reports no update when the release is older', async () => {
    const f = fakeFetch({ tag_name: 'v0.0.9', assets: [] })
    const info = await checkForUpdate('0.1.0', f)
    expect(info.updateAvailable).toBe(false)
  })

  it('leaves assetUrl null when no asset matches this platform', async () => {
    const f = fakeFetch({
      tag_name: 'v9.9.9',
      assets: [{ name: 'resume-studio-someotheros-mips.tar.gz', browser_download_url: 'https://github.com/x/y/z' }],
    })
    const info = await checkForUpdate('0.1.0', f)
    expect(info.updateAvailable).toBe(true)
    expect(info.assetUrl).toBeNull()
  })

  it('sanitizes an asset URL pointing at a non-GitHub host', async () => {
    const f = fakeFetch({
      tag_name: 'v9.9.9',
      assets: [{ name: asset, browser_download_url: 'https://evil.example.com/payload.tar.gz' }],
    })
    const info = await checkForUpdate('0.1.0', f)
    expect(info.assetUrl).toBeNull()
  })

  it('falls back to the releases page when html_url is foreign', async () => {
    const f = fakeFetch({ tag_name: 'v9.9.9', html_url: 'https://evil.example.com/x', assets: [] })
    const info = await checkForUpdate('0.1.0', f)
    expect(info.htmlUrl).toBe('https://github.com/sveinmagnus/resumestudio/releases')
  })

  it('throws on a non-200 GitHub response', async () => {
    await expect(checkForUpdate('0.1.0', fakeFetch({}, 404))).rejects.toThrow()
  })

  it('throws when the release has no tag', async () => {
    await expect(checkForUpdate('0.1.0', fakeFetch({ assets: [] }))).rejects.toThrow()
  })

  it('rejects a malicious tag that could inject into paths / the swap script', async () => {
    // The version becomes a filesystem path segment and is embedded in the
    // generated swap script — a tag with quotes / shell metacharacters / path
    // traversal must be refused.
    for (const tag of ['v1.0.0"; rm -rf /', 'v../../etc', 'v1.0 0', 'v1;reboot']) {
      await expect(checkForUpdate('0.1.0', fakeFetch({ tag_name: tag, assets: [] }))).rejects.toThrow()
    }
  })
})
