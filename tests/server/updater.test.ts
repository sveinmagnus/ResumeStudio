import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import {
  parseVersion, compareVersions, assetNameFor, isAllowedHost, checkForUpdate,
  checksumNameFor, parseChecksum, sha256File, fetchChecksum, installBlocker,
  stageUpdate, ChecksumError, type UpdateInfo,
} from '../../server/desktop/updater'

describe('parseVersion', () => {
  it.each([
    ['1.2.3', [1, 2, 3]],
    ['v1.2.3', [1, 2, 3]],
    ['0.1', [0, 1, 0]],
    ['2', [2, 0, 0]],
    // Pre-release ignored for ordering
    ['1.2.3-beta.1', [1, 2, 3]],
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
    // Pre-release suffix ignored
    ['1.0.0-rc1', '1.0.0', 0],
    // Numeric, not lexical
    ['2.0.0', '10.0.0', -1],
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
    // Must be https
    expect(isAllowedHost('http://github.com/x')).toBe(false)
    // Suffix trick
    expect(isAllowedHost('https://github.com.evil.com/x')).toBe(false)
    expect(isAllowedHost('https://notgithub.com/x')).toBe(false)
    expect(isAllowedHost('not a url')).toBe(false)
  })
})

// A minimal fetch stub returning a JSON GitHub release.
function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

// For the current test runner's platform/arch
const asset = assetNameFor()

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

  it('picks up the checksum sidecar alongside the asset', async () => {
    const f = fakeFetch({
      tag_name: 'v9.9.9',
      assets: [
        { name: asset, browser_download_url: `https://github.com/x/y/releases/download/v9.9.9/${asset}` },
        { name: `${asset}.sha256`, browser_download_url: `https://github.com/x/y/releases/download/v9.9.9/${asset}.sha256` },
      ],
    })
    const info = await checkForUpdate('0.1.0', f)
    expect(info.checksumUrl).toContain(`${asset}.sha256`)
    expect(installBlocker(info)).toBeNull()
  })

  it('sanitizes a checksum URL pointing at a non-GitHub host', async () => {
    // Same SSRF guard as the asset: a foreign digest source is no digest at all.
    const f = fakeFetch({
      tag_name: 'v9.9.9',
      assets: [
        { name: asset, browser_download_url: `https://github.com/x/y/releases/download/v9.9.9/${asset}` },
        { name: `${asset}.sha256`, browser_download_url: 'https://evil.example.com/sums.txt' },
      ],
    })
    const info = await checkForUpdate('0.1.0', f)
    expect(info.checksumUrl).toBeNull()
    expect(installBlocker(info)).toMatch(/checksum/)
  })

  it('leaves checksumUrl null when the release publishes no sidecar', async () => {
    const f = fakeFetch({
      tag_name: 'v9.9.9',
      assets: [{ name: asset, browser_download_url: `https://github.com/x/y/releases/download/v9.9.9/${asset}` }],
    })
    const info = await checkForUpdate('0.1.0', f)
    expect(info.checksumUrl).toBeNull()
  })
})

describe('checksumNameFor', () => {
  it('is the asset name plus .sha256 (must match build-desktop.mjs)', () => {
    expect(checksumNameFor('resume-studio-linux-x64.tar.gz')).toBe('resume-studio-linux-x64.tar.gz.sha256')
  })
})

describe('parseChecksum', () => {
  const digest = 'a'.repeat(64)

  it('reads a sha256sum-format line for the asset', () => {
    expect(parseChecksum(`${digest}  pkg.tar.gz\n`, 'pkg.tar.gz')).toBe(digest)
  })

  it('tolerates the binary marker, tabs, comments, blank lines and CRLF', () => {
    const text = `# generated by build-desktop\r\n\r\n${digest}\t*pkg.tar.gz\r\n`
    expect(parseChecksum(text, 'pkg.tar.gz')).toBe(digest)
  })

  it('picks the right line out of a multi-asset file', () => {
    const other = 'b'.repeat(64)
    const text = `${other}  other.tar.gz\n${digest}  pkg.tar.gz\n`
    expect(parseChecksum(text, 'pkg.tar.gz')).toBe(digest)
  })

  it('accepts a lone bare digest', () => {
    expect(parseChecksum(`${digest}\n`, 'pkg.tar.gz')).toBe(digest)
  })

  it('lower-cases the digest so comparison is case-insensitive', () => {
    expect(parseChecksum(`${'A'.repeat(64)}  pkg.tar.gz`, 'pkg.tar.gz')).toBe('a'.repeat(64))
  })

  it('will not read a digest out of a COMMENTED line', () => {
    // A commented-out entry is a revoked one. Recognising comments only at the
    // START of a line is what separates the two, and honouring a digest from
    // inside a comment would validate an archive somebody deliberately withdrew.
    expect(parseChecksum(`# ${digest}  pkg.tar.gz`, 'pkg.tar.gz')).toBeNull()
  })

  it('requires the digest to START the line', () => {
    // Unanchored, the pattern finds a 64-hex run anywhere — so a line whose
    // real content is something else entirely would still yield a digest.
    expect(parseChecksum(`sha256: ${digest}  pkg.tar.gz`, 'pkg.tar.gz')).toBeNull()
  })

  it('refuses a run of hex that is not exactly 64 characters', () => {
    expect(parseChecksum(`${'a'.repeat(63)}  pkg.tar.gz`, 'pkg.tar.gz')).toBeNull()
    expect(parseChecksum(`${'a'.repeat(65)}  pkg.tar.gz`, 'pkg.tar.gz')).toBeNull()
  })

  it('matches on the base name, so a path in either side still lines up', () => {
    expect(parseChecksum(`${digest}  ./dist/pkg.tar.gz`, 'pkg.tar.gz')).toBe(digest)
    expect(parseChecksum(`${digest}  pkg.tar.gz`, '  /tmp/pkg.tar.gz  ')).toBe(digest)
  })

  it('returns null for an empty or digest-free file', () => {
    expect(parseChecksum('', 'pkg.tar.gz')).toBeNull()
    expect(parseChecksum('# nothing here\n\n', 'pkg.tar.gz')).toBeNull()
  })

  it('returns null when no line matches the asset', () => {
    expect(parseChecksum(`${digest}  other.tar.gz\n`, 'pkg.tar.gz')).toBeNull()
  })

  it('returns null for junk and for a wrong-length digest', () => {
    expect(parseChecksum('not a checksum file', 'pkg.tar.gz')).toBeNull()
    expect(parseChecksum(`${'a'.repeat(63)}  pkg.tar.gz`, 'pkg.tar.gz')).toBeNull()
  })
})

describe('installBlocker', () => {
  const base: UpdateInfo = {
    currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true,
    assetUrl: 'https://github.com/x/y/a.tar.gz', assetName: 'a.tar.gz',
    checksumUrl: 'https://github.com/x/y/a.tar.gz.sha256', notes: '', htmlUrl: 'https://github.com/x/y',
  }
  it('passes a complete release', () => {
    expect(installBlocker(base)).toBeNull()
  })
  it('blocks when there is no asset for this platform', () => {
    expect(installBlocker({ ...base, assetUrl: null })).toMatch(/no build for this platform/)
  })
  it('blocks when the asset cannot be verified', () => {
    expect(installBlocker({ ...base, checksumUrl: null })).toMatch(/no published checksum/)
  })
})

// ── Download verification (fail-closed paths) ────────────────────────────────

const tmpDirs: string[] = []
function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-updater-'))
  tmpDirs.push(d)
  return d
}
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

/** Serve fixed bodies per URL; anything else 404s. */
function routedFetch(routes: Record<string, string>): typeof fetch {
  return (async (url: string) => {
    const body = routes[String(url)]
    return body === undefined ? new Response('', { status: 404 }) : new Response(body)
  }) as unknown as typeof fetch
}

describe('sha256File', () => {
  it('matches the digest of the file contents', async () => {
    const dir = tmpRoot()
    const file = path.join(dir, 'x.bin')
    fs.writeFileSync(file, 'hello world')
    const expected = createHash('sha256').update('hello world').digest('hex')
    await expect(sha256File(file)).resolves.toBe(expected)
  })
})

describe('fetchChecksum', () => {
  const url = 'https://github.com/x/y/pkg.tar.gz.sha256'
  const digest = 'c'.repeat(64)

  it('returns the digest for the asset', async () => {
    const f = routedFetch({ [url]: `${digest}  pkg.tar.gz\n` })
    await expect(fetchChecksum(url, 'pkg.tar.gz', f)).resolves.toBe(digest)
  })

  it('throws a ChecksumError when the sidecar is missing', async () => {
    await expect(fetchChecksum(url, 'pkg.tar.gz', routedFetch({}))).rejects.toThrow(ChecksumError)
  })

  it('throws a ChecksumError when the sidecar has no entry for the asset', async () => {
    const f = routedFetch({ [url]: `${digest}  something-else.tar.gz\n` })
    await expect(fetchChecksum(url, 'pkg.tar.gz', f)).rejects.toThrow(ChecksumError)
  })

  it('refuses a non-GitHub sidecar host', async () => {
    await expect(fetchChecksum('https://evil.example.com/s.sha256', 'pkg.tar.gz', routedFetch({})))
      .rejects.toThrow(/host not allowed/)
  })
})

describe('stageUpdate verification', () => {
  const assetUrl = 'https://github.com/x/y/releases/download/v9.9.9/pkg.tar.gz'
  const sumUrl = `${assetUrl}.sha256`
  const payload = 'not-really-a-tarball'
  const realDigest = createHash('sha256').update(payload).digest('hex')

  const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({
    currentVersion: '1.0.0', latestVersion: '9.9.9', updateAvailable: true,
    assetUrl, assetName: 'pkg.tar.gz', checksumUrl: sumUrl,
    notes: '', htmlUrl: 'https://github.com/x/y', ...over,
  })

  it('refuses to stage a release with no checksum (fails closed)', async () => {
    // No network should even be touched — the refusal is decided up front.
    await expect(
      stageUpdate(info({ checksumUrl: null }), tmpRoot(), undefined, 'linux', routedFetch({})),
    ).rejects.toThrow(ChecksumError)
  })

  it('rejects a tampered download and discards it before tar sees it', async () => {
    const root = tmpRoot()
    const f = routedFetch({
      [assetUrl]: 'TAMPERED-PAYLOAD',
      [sumUrl]: `${realDigest}  pkg.tar.gz\n`,
    })
    await expect(stageUpdate(info(), root, undefined, 'linux', f)).rejects.toThrow(ChecksumError)
    // The staged version dir is removed, so no tampered bytes are left behind.
    expect(fs.existsSync(path.join(root, '9.9.9'))).toBe(false)
  })

  it('rejects when the release publishes a sidecar it cannot serve', async () => {
    // Sidecar 404s
    const f = routedFetch({ [assetUrl]: payload })
    await expect(stageUpdate(info(), tmpRoot(), undefined, 'linux', f)).rejects.toThrow(ChecksumError)
  })
})
