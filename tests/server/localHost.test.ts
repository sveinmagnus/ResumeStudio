import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isValidLocalHostname, isLocalhostSuffixed, needsHostsEntry, isLoopbackHostname,
  applyHostsBlock, managedHostnames, hostsMapsToLoopback, resolvesToLoopback,
  hostsFilePath, hostnameStatus,
} from '../../server/localHost'

// hostnameStatus reads the SYSTEM hosts file, which a unit test must never
// depend on: the mock intercepts exactly that path (set per test via
// hostsControl) and passes every other fs call through untouched, so the pure
// text-transform tests above are unaffected.
const hostsControl = vi.hoisted(() => ({
  content: null as string | null,
  writable: false,
}))
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  const isHosts = (p: unknown): boolean =>
    typeof p === 'string' && p.replace(/\\/g, '/').toLowerCase().endsWith('/etc/hosts')
  const mocked = {
    ...real,
    readFileSync: ((p: unknown, ...rest: unknown[]) => {
      if (isHosts(p) && hostsControl.content !== null) return hostsControl.content
      return (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest)
    }) as typeof real.readFileSync,
    openSync: ((p: unknown, ...rest: unknown[]) => {
      if (isHosts(p)) {
        if (hostsControl.writable) return 99
        throw new Error('EACCES')
      }
      return (real.openSync as (...a: unknown[]) => unknown)(p, ...rest)
    }) as typeof real.openSync,
    closeSync: ((fd: unknown) => {
      if (fd === 99) return
      return (real.closeSync as (...a: unknown[]) => unknown)(fd)
    }) as typeof real.closeSync,
  }
  return { ...mocked, default: mocked }
})

/** Run `fn` with process.platform reporting `platform`, restoring afterwards. */
function onPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const real = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: platform })
  try { return fn() } finally { Object.defineProperty(process, 'platform', real) }
}

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

describe('managedHostnames()', () => {
  /*
   * The transforms run over a file OTHER tools also edit, so the shapes here
   * are the ones a hosts file actually contains — LF endings from a Linux
   * editor, indentation, comments — not only what applyHostsBlock writes.
   */
  it('reads a block from an LF file, not only a CRLF one', () => {
    const lf = applyHostsBlock('127.0.0.1 localhost\n', ['a.local'])
    expect(lf).not.toContain('\r')
    expect(managedHostnames(lf)).toEqual(['a.local'])
  })

  it('tolerates a hand-indented block, as an edited file may be', () => {
    const indented = [
      '  # >>> Resume Studio (managed) >>>',
      '  127.0.0.1\ta.local',
      '  # <<< Resume Studio (managed) <<<',
    ].join('\n')
    expect(managedHostnames(indented)).toEqual(['a.local'])
  })

  it('stops at the block end — a later loopback line is NOT ours', () => {
    // What managedHostnames answers is "ours to remove". Counting a line the
    // user wrote below our block would make uninstall claim their entry.
    const content = applyHostsBlock('127.0.0.1 localhost\n', ['a.local'])
      + '127.0.0.1 theirs.local\n'
    expect(managedHostnames(content)).toEqual(['a.local'])
  })

  it('skips a comment line inside the block', () => {
    const content = [
      '# >>> Resume Studio (managed) >>>',
      '# a note somebody left',
      '127.0.0.1\ta.local',
      '# <<< Resume Studio (managed) <<<',
    ].join('\n')
    expect(managedHostnames(content)).toEqual(['a.local'])
  })

  it('ends the names at an inline comment, as hostsMapsToLoopback does', () => {
    // Filtering only the `#` token kept the comment's WORDS: a hand-added
    // "# mine" on our block's line reported "mine" as a managed hostname.
    const content = [
      '# >>> Resume Studio (managed) >>>',
      '127.0.0.1\ta.local # mine',
      '# <<< Resume Studio (managed) <<<',
    ].join('\n')
    expect(managedHostnames(content)).toEqual(['a.local'])
  })

  it('ignores a non-loopback line inside the block', () => {
    const content = [
      '# >>> Resume Studio (managed) >>>',
      '10.0.0.5\tother.local',
      '127.0.0.1\ta.local',
      '# <<< Resume Studio (managed) <<<',
    ].join('\n')
    expect(managedHostnames(content)).toEqual(['a.local'])
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

  it('is case- and padding-insensitive on both sides', () => {
    // The file is edited by hand and the query comes from settings; neither
    // side owns the casing.
    expect(hostsMapsToLoopback('127.0.0.1 RESUMESTUDIO.LOCAL', 'resumestudio.local')).toBe(true)
    expect(hostsMapsToLoopback('127.0.0.1 resumestudio.local', '  ResumeStudio.LOCAL  ')).toBe(true)
  })

  it('reads an LF file', () => {
    expect(hostsMapsToLoopback('# comment\n127.0.0.1 a.local\n', 'a.local')).toBe(true)
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

// ─── Mutation-audit tripwires ────────────────────────────────────────────────
// The full sweep found the validation boundaries and the whole status half
// (hostnameStatus, hostsFilePath, the platform texts) unmeasured.

describe('validation boundaries (mutation audit)', () => {
  it('accepts a single-character label', () => {
    expect(isValidLocalHostname('a.local')).toBe(true)
  })

  it('the 253-character ceiling is inclusive', () => {
    const label = 'a'.repeat(61)
    // 61+61+61+61 chars + 4 dots + "local" = 253 exactly.
    const at = [label, label, label, label, 'local'].join('.')
    expect(at).toHaveLength(253)
    expect(isValidLocalHostname(at)).toBe(true)
    // One more character (a still-legal 62-char label) tips it to 254.
    const over = [label, label, label, 'a'.repeat(62), 'local'].join('.')
    expect(over).toHaveLength(254)
    expect(isValidLocalHostname(over)).toBe(false)
  })

  it('a 63-character label passes; 64 fails', () => {
    expect(isValidLocalHostname(`${'a'.repeat(63)}.local`)).toBe(true)
    expect(isValidLocalHostname(`${'a'.repeat(64)}.local`)).toBe(false)
  })

  it('bare "localhost" is not a WRITABLE name (one label), though it is loopback', () => {
    expect(isValidLocalHostname('localhost')).toBe(false)
    expect(isLoopbackHostname('localhost')).toBe(true)
  })

  it('loopback detection survives uppercase and padding', () => {
    expect(isLoopbackHostname('  LOCALHOST  ')).toBe(true)
    expect(isLoopbackHostname('APP.LOCALHOST')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('app.local')).toBe(false)
  })
})

describe('hostsFilePath()', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('windows: under SystemRoot, falling back to C:\\Windows when unset', () => {
    onPlatform('win32', () => {
      vi.stubEnv('SystemRoot', 'D:\\Win')
      expect(hostsFilePath()).toBe('D:\\Win\\System32\\drivers\\etc\\hosts')
      vi.stubEnv('SystemRoot', '  ')
      expect(hostsFilePath()).toBe('C:\\Windows\\System32\\drivers\\etc\\hosts')
    })
  })

  it('everything else: /etc/hosts', () => {
    onPlatform('linux', () => expect(hostsFilePath()).toBe('/etc/hosts'))
  })
})

describe('hostnameStatus()', () => {
  const BLOCK = [
    '# >>> Resume Studio (managed) >>>',
    '127.0.0.1\tresumestudio.local',
    '# <<< Resume Studio (managed) <<<',
  ].join('\n')

  const status = (hostname: string, content: string, writable = false) =>
    onPlatform('linux', () => {
      hostsControl.content = content
      hostsControl.writable = writable
      try { return hostnameStatus(hostname) } finally { hostsControl.content = null }
    })

  it('a .localhost name is automatic and installed whatever the file says', () => {
    const s = status('app.localhost', '')
    expect(s).toMatchObject({ automatic: true, installed: true, managed: false })
  })

  it('an entry in OUR block is installed AND managed', () => {
    const s = status('resumestudio.local', BLOCK)
    expect(s).toMatchObject({ automatic: false, installed: true, managed: true })
  })

  it('a hand-written entry is installed but NOT ours to remove', () => {
    const s = status('resumestudio.local', '127.0.0.1 resumestudio.local')
    expect(s).toMatchObject({ installed: true, managed: false })
  })

  it('an absent entry is neither installed nor managed', () => {
    const s = status('resumestudio.local', '127.0.0.1 something.else.local')
    expect(s).toMatchObject({ installed: false, managed: false })
  })

  it('writable follows an actual open-for-write probe', () => {
    expect(status('resumestudio.local', '', true).writable).toBe(true)
    expect(status('resumestudio.local', '', false).writable).toBe(false)
  })

  it('offers the platform-appropriate manual command naming the file and the host', () => {
    const posix = status('resumestudio.local', '')
    expect(posix.manualCommand).toContain('sudo tee')
    expect(posix.manualCommand).toContain('/etc/hosts')
    expect(posix.manualCommand).toContain('resumestudio.local')
    onPlatform('win32', () => {
      hostsControl.content = ''
      try {
        expect(hostnameStatus('resumestudio.local').manualCommand).toContain('Add-Content')
      } finally { hostsControl.content = null }
    })
  })

  it('warns about Bonjour only for .local names on macOS', () => {
    onPlatform('darwin', () => {
      hostsControl.content = ''
      try {
        expect(hostnameStatus('resumestudio.local').note).toMatch(/mDNS/)
        expect(hostnameStatus('app.localhost').note).toBeNull()
      } finally { hostsControl.content = null }
    })
    expect(status('resumestudio.local', '').note).toBeNull()
  })
})
