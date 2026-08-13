import { describe, it, expect } from 'vitest'
import {
  isValidLocalHostname, isLocalhostSuffixed, needsHostsEntry, isLoopbackHostname,
  applyHostsBlock, managedHostnames, hostsMapsToLoopback, resolvesToLoopback,
} from '../../server/localHost'

// The hosts file is a SYSTEM file shared with the OS and other tools, so the
// text transform that rewrites it is pure and pinned here: everything outside
// this app's delimited block has to survive untouched, byte for byte.

const REAL_HOSTS = [
  '# Copyright (c) 1993-2009 Microsoft Corp.',
  '#',
  '#\t102.54.94.97     rhino.acme.com          # source server',
  '',
  '127.0.0.1       kubernetes.docker.internal',
  '10.0.0.5        build.internal',
].join('\r\n')

describe('isValidLocalHostname()', () => {
  it('accepts .local and .localhost names', () => {
    for (const h of ['resumestudio.local', 'resumestudio.localhost', 'cv.localhost', 'my-cv.local']) {
      expect(isValidLocalHostname(h)).toBe(true)
    }
  })

  // Anything else could shadow a real site on the user's machine for as long as
  // the hosts entry survives — a typo must not be able to hijack mail.company.com.
  it('rejects names outside the reserved suffixes', () => {
    for (const h of ['', 'localhost', 'example.com', 'mail.company.com', 'resumestudio', '.local']) {
      expect(isValidLocalHostname(h)).toBe(false)
    }
  })

  it('rejects malformed labels and over-long names', () => {
    for (const h of ['-bad.local', 'bad-.local', 'has_underscore.local', 'a b.local', `${'x'.repeat(250)}.local`]) {
      expect(isValidLocalHostname(h)).toBe(false)
    }
  })
})

describe('which names need setup', () => {
  it('treats localhost and .localhost as automatic', () => {
    expect(isLocalhostSuffixed('localhost')).toBe(true)
    expect(isLocalhostSuffixed('resumestudio.localhost')).toBe(true)
    expect(needsHostsEntry('resumestudio.localhost')).toBe(false)
  })

  it('treats a .local name as needing a hosts entry', () => {
    expect(isLocalhostSuffixed('resumestudio.local')).toBe(false)
    expect(needsHostsEntry('resumestudio.local')).toBe(true)
  })

  it('counts only literals and .localhost as loopback by definition', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('resumestudio.localhost')).toBe(true)
    expect(isLoopbackHostname('resumestudio.local')).toBe(false)
    expect(isLoopbackHostname('localhost.evil.example')).toBe(false)
  })
})

describe('applyHostsBlock()', () => {
  it('appends a managed block, leaving every existing line intact', () => {
    const next = applyHostsBlock(REAL_HOSTS, ['resumestudio.local'])
    for (const line of REAL_HOSTS.split('\r\n')) {
      if (line.trim()) expect(next).toContain(line)
    }
    expect(next).toContain('127.0.0.1\tresumestudio.local')
    expect(managedHostnames(next)).toEqual(['resumestudio.local'])
  })

  // The server binds 127.0.0.1 only; an ::1 entry would make a browser prefer
  // IPv6 and fail to connect on a name that looks correctly installed.
  it('never maps the name to ::1', () => {
    expect(applyHostsBlock(REAL_HOSTS, ['resumestudio.local'])).not.toContain('::1\tresumestudio.local')
  })

  it('keeps the file line endings it was given', () => {
    expect(applyHostsBlock(REAL_HOSTS, ['a.local'])).toContain('\r\n')
    expect(applyHostsBlock('127.0.0.1 x\n', ['a.local'])).not.toContain('\r\n')
  })

  it('replaces rather than duplicates an existing block', () => {
    const once = applyHostsBlock(REAL_HOSTS, ['a.local'])
    const twice = applyHostsBlock(once, ['a.local', 'b.local'])
    expect(managedHostnames(twice)).toEqual(['a.local', 'b.local'])
    expect(twice.match(/# >>> Resume Studio/g)).toHaveLength(1)
  })

  it('removes the block entirely when given no names, restoring the original', () => {
    const withBlock = applyHostsBlock(REAL_HOSTS, ['a.local'])
    expect(applyHostsBlock(withBlock, [])).toBe(REAL_HOSTS.replace(/\s+$/, '') + '\r\n')
    expect(managedHostnames(applyHostsBlock(withBlock, []))).toEqual([])
  })

  // Install/uninstall is a cycle a user can run repeatedly; it must reach a
  // fixed point rather than growing the file by a blank line each time.
  it('is stable across repeated install/uninstall cycles', () => {
    let content = REAL_HOSTS
    for (let i = 0; i < 3; i++) {
      content = applyHostsBlock(content, ['a.local'])
      content = applyHostsBlock(content, [])
    }
    expect(content).toBe(applyHostsBlock(applyHostsBlock(REAL_HOSTS, ['a.local']), []))
  })

  it('de-duplicates and lower-cases the names it writes', () => {
    const next = applyHostsBlock(REAL_HOSTS, ['A.local', 'a.local', ' a.local '])
    expect(managedHostnames(next)).toEqual(['a.local'])
  })
})

describe('hostsMapsToLoopback()', () => {
  it('finds a hand-written entry outside our block', () => {
    const hand = `${REAL_HOSTS}\r\n127.0.0.1   resumestudio.local   # added by me`
    expect(hostsMapsToLoopback(hand, 'resumestudio.local')).toBe(true)
    // …and it is not OURS, so nothing offers to delete it.
    expect(managedHostnames(hand)).toEqual([])
  })

  it('finds a name sharing a line with others', () => {
    expect(hostsMapsToLoopback('127.0.0.1 a.local resumestudio.local', 'resumestudio.local')).toBe(true)
  })

  it('ignores commented-out lines and other addresses', () => {
    expect(hostsMapsToLoopback('# 127.0.0.1 resumestudio.local', 'resumestudio.local')).toBe(false)
    expect(hostsMapsToLoopback('10.0.0.5 resumestudio.local', 'resumestudio.local')).toBe(false)
  })

  it('does not match a name that merely contains the one asked for', () => {
    expect(hostsMapsToLoopback('127.0.0.1 notresumestudio.local', 'resumestudio.local')).toBe(false)
  })
})

describe('resolvesToLoopback()', () => {
  it('short-circuits .localhost without asking DNS', async () => {
    expect(await resolvesToLoopback('resumestudio.localhost')).toBe(true)
  })

  it('is false for a name that does not resolve', async () => {
    expect(await resolvesToLoopback('nothing-here.resumestudio.local')).toBe(false)
  })
})
