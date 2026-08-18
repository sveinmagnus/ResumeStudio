/**
 * The local address the desktop build is reached at — a NAME instead of
 * `http://127.0.0.1:<port>`.
 *
 * Two kinds of name, because they cost the user different amounts:
 *
 *   - **`*.localhost`** (`resumestudio.localhost`) — RFC 6761 reserves the whole
 *     `localhost` TLD for loopback, and every current browser resolves it
 *     internally without asking DNS. Nothing to install, no privileges, works on
 *     a machine the user has just unzipped the app onto. It is not delegated in
 *     the DNS root either, so no attacker can make a name under it resolve
 *     anywhere — which is what makes widening the desktop Host guard to it safe.
 *   - **`*.local`** (`resumestudio.local`) — needs a line in the system hosts file,
 *     which needs one elevated write. Worth it because it is resolved by
 *     everything, not just browsers: curl, another device's browser pointed at
 *     this machine, a script.
 *
 * This module owns both: validation, the PURE hosts-file text transform, the
 * elevated write per platform, and the loopback predicate `app.ts` guards on.
 * The text transform is pure and separately tested — a hosts file is a system
 * file shared with the OS and other tools, so "rewrite it correctly" is not a
 * thing to get right only in production.
 *
 * We map ONLY 127.0.0.1, never `::1`: the server binds 127.0.0.1, and a browser
 * that saw an AAAA-shaped hosts entry would prefer IPv6 and get a connection
 * refused on a name that looks correctly installed.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import dns from 'dns'
import { spawn } from 'child_process'

/** Offered by default: needs no setup at all. */
export const DEFAULT_LOCALHOST_NAME = 'resumestudio.localhost'
/** Offered by default for the hosts-file route. */
export const DEFAULT_MDNS_NAME = 'resumestudio.local'

/** Marker lines delimiting the block this app owns inside the hosts file. */
const BLOCK_BEGIN = '# >>> Resume Studio (managed) >>>'
const BLOCK_END = '# <<< Resume Studio (managed) <<<'

/** One DNS label: letters/digits/hyphen, not starting or ending with a hyphen. */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * A hostname we are willing to answer on, and to write into a hosts file.
 *
 * Constrained to the `.local` / `.localhost` suffixes on purpose. Both are
 * reserved for local use, so pointing one at 127.0.0.1 cannot shadow a real
 * site — whereas accepting an arbitrary name would let a typo (or a pasted
 * value) hijack `mail.company.com` on the user's machine for as long as the
 * entry survives.
 */
export function isValidLocalHostname(name: string): boolean {
  const h = name.trim().toLowerCase()
  if (!h || h.length > 253) return false
  if (!(h.endsWith('.local') || h.endsWith('.localhost'))) return false
  const labels = h.split('.')
  if (labels.length < 2) return false
  return labels.every((l) => LABEL.test(l))
}

/** True for `localhost` itself and anything under the reserved `.localhost` TLD. */
export function isLocalhostSuffixed(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost')
}

/** Whether reaching this name requires a hosts-file entry (`.local` does). */
export function needsHostsEntry(hostname: string): boolean {
  return !isLocalhostSuffixed(hostname)
}

/**
 * True when a hostname is loopback by definition — no DNS involved, so nothing
 * an attacker controls can change the answer. `app.ts`'s DNS-rebinding guard
 * accepts exactly these plus the user's own configured name.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  return h === '127.0.0.1' || h === '::1' || isLocalhostSuffixed(h)
}

/** Where the system hosts file lives on this platform. */
export function hostsFilePath(): string {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot?.trim() || 'C:\\Windows'
    return path.join(root, 'System32', 'drivers', 'etc', 'hosts')
  }
  return '/etc/hosts'
}

/** The dominant line ending in a file, so a rewrite doesn't convert the whole thing. */
function eolOf(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * Replace this app's managed block with mappings for `hostnames` (empty list
 * removes the block). PURE — takes and returns the whole file text.
 *
 * Only the delimited block is ever touched: everything else in the file belongs
 * to the OS, to Docker Desktop, to whatever else edits it, and rewriting a line
 * we did not add is how a tool like this earns a reputation for breaking
 * machines.
 */
export function applyHostsBlock(content: string, hostnames: string[]): string {
  const eol = eolOf(content)
  const lines = content.split(/\r?\n/)
  const kept: string[] = []
  let inBlock = false
  for (const line of lines) {
    const t = line.trim()
    if (t === BLOCK_BEGIN) { inBlock = true; continue }
    if (t === BLOCK_END) { inBlock = false; continue }
    if (!inBlock) kept.push(line)
  }
  // Drop trailing blank lines so repeated install/uninstall cycles can't grow
  // the file by one empty line each time.
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop()

  const names = [...new Set(hostnames.map((h) => h.trim().toLowerCase()).filter(Boolean))]
  if (!names.length) return kept.join(eol) + (kept.length ? eol : '')

  const block = [BLOCK_BEGIN, ...names.map((h) => `127.0.0.1\t${h}`), BLOCK_END]
  return [...kept, '', ...block].join(eol) + eol
}

/** The hostnames currently inside this app's managed block. PURE. */
export function managedHostnames(content: string): string[] {
  const out: string[] = []
  let inBlock = false
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (t === BLOCK_BEGIN) { inBlock = true; continue }
    if (t === BLOCK_END) { inBlock = false; continue }
    if (!inBlock || !t || t.startsWith('#')) continue
    // `<address> <name> [name…]` — take every name mapped to loopback.
    const [addr, ...names] = t.split(/\s+/)
    if (addr === '127.0.0.1') out.push(...names.filter((n) => !n.startsWith('#')))
  }
  return out
}

/**
 * Whether the file maps `hostname` to 127.0.0.1 ANYWHERE — inside our block or
 * in a line the user added by hand. PURE.
 *
 * Checked separately from `managedHostnames` so "it already works" and "we put
 * it there" stay distinct: we offer to remove only what we own.
 */
export function hostsMapsToLoopback(content: string, hostname: string): boolean {
  const want = hostname.trim().toLowerCase()
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const [addr, ...rest] = t.split(/\s+/)
    if (addr !== '127.0.0.1') continue
    const names = rest.join(' ').split('#')[0].trim().split(/\s+/)
    if (names.some((n) => n.toLowerCase() === want)) return true
  }
  return false
}

export interface HostnameStatus {
  hostname: string
  /** Path of the system hosts file (shown so the user can edit it themselves). */
  file: string
  /** True when the name resolves without any hosts entry (`*.localhost`). */
  automatic: boolean
  /** The name currently resolves to 127.0.0.1 via the hosts file (or is automatic). */
  installed: boolean
  /** The entry is inside OUR block, so removing it is ours to offer. */
  managed: boolean
  /** We could write the hosts file without asking for elevation. */
  writable: boolean
  /** The command a user can run themselves if the elevated write is refused. */
  manualCommand: string
  /** A platform caveat worth showing, or null. */
  note: string | null
}

/**
 * Can this process write the hosts file as-is (root, or a loosened ACL)?
 *
 * Opened for real rather than asked via `access(W_OK)`: on Windows that check
 * only consults the read-only ATTRIBUTE, not the ACL, so it answers "yes" for
 * an unelevated process that cannot write a byte. Believing it made the panel
 * promise a silent edit and then produce a UAC prompt anyway.
 */
function canWriteHosts(file: string): boolean {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r+')
    return true
  } catch {
    return false
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch { /* best effort */ } }
  }
}

function readHosts(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * The command to paste into an elevated shell when we can't do the write.
 *
 * Always offered, never hidden behind a failure: a user who would rather edit a
 * system file themselves than approve a UAC prompt from a downloaded app is
 * being reasonable, and this is a one-line change.
 */
function manualCommandFor(file: string, hostname: string): string {
  if (process.platform === 'win32') {
    return `Add-Content -Path "${file}" -Value "127.0.0.1\t${hostname}"   (in an Administrator PowerShell)`
  }
  return `echo "127.0.0.1\t${hostname}" | sudo tee -a ${file}`
}

/**
 * macOS routes every `.local` lookup to mDNS, which can win over the hosts file
 * — so the entry installs cleanly and the name still may not resolve there.
 * Say so up front rather than letting it read as a broken feature.
 */
function noteFor(hostname: string): string | null {
  if (process.platform === 'darwin' && hostname.toLowerCase().endsWith('.local')) {
    return 'On macOS, .local names are handled by Bonjour/mDNS, which can override the hosts file. '
      + 'If the name does not resolve, use a .localhost name instead — it needs no setup.'
  }
  return null
}

export function hostnameStatus(hostname: string): HostnameStatus {
  const file = hostsFilePath()
  const automatic = !needsHostsEntry(hostname)
  const content = automatic ? '' : readHosts(file)
  return {
    hostname,
    file,
    automatic,
    installed: automatic || hostsMapsToLoopback(content, hostname),
    managed: !automatic && managedHostnames(content).includes(hostname.trim().toLowerCase()),
    writable: canWriteHosts(file),
    manualCommand: manualCommandFor(file, hostname),
    note: noteFor(hostname),
  }
}

/**
 * Replace the hosts file with `next`, asking the OS for elevation.
 *
 * The new content goes to a temp file first and the elevated step only COPIES
 * it over the target: the privileged command then contains nothing but two
 * paths we generated ourselves, so no user-supplied text is ever interpolated
 * into a command line. (The hostname reaches the temp file's contents, and it
 * has already passed `isValidLocalHostname`.)
 */
async function elevatedReplace(file: string, next: string): Promise<{ ok: boolean; message: string }> {
  const tmp = path.join(os.tmpdir(), `resume-studio-hosts-${process.pid}-${Date.now()}.txt`)
  try {
    fs.writeFileSync(tmp, next)
  } catch (err) {
    return { ok: false, message: `Could not stage the change: ${(err as Error).message}` }
  }

  try {
    if (process.platform === 'win32') {
      // A .ps1 the elevated shell runs, so the outer command carries only its
      // path. Single quotes make both embedded paths literal to PowerShell.
      const ps = path.join(os.tmpdir(), `resume-studio-hosts-${process.pid}-${Date.now()}.ps1`)
      const q = (s: string) => `'${s.replace(/'/g, "''")}'`
      fs.writeFileSync(ps, [
        `Copy-Item -LiteralPath ${q(tmp)} -Destination ${q(file)} -Force`,
        // Already elevated, and a cached negative lookup would otherwise make a
        // freshly-added name look like it did not work.
        'ipconfig /flushdns | Out-Null',
      ].join('\r\n'))
      const outer = `Start-Process -FilePath powershell -Verb RunAs -WindowStyle Hidden -Wait `
        + `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${q(ps)}`
      const r = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', outer])
      try { fs.rmSync(ps, { force: true }) } catch { /* best effort */ }
      if (!r.ok) return { ok: false, message: 'The administrator prompt was refused or failed.' }
    } else if (process.platform === 'darwin') {
      // One -e argument, so nothing is parsed by a shell on the way in.
      const script = `do shell script "/bin/cp '${tmp}' '${file}'" with administrator privileges`
      const r = await run('osascript', ['-e', script])
      if (!r.ok) return { ok: false, message: 'The administrator prompt was refused or failed.' }
    } else {
      const r = await run('pkexec', ['/bin/cp', tmp, file])
      if (!r.ok) {
        return {
          ok: false,
          message: 'Could not get administrator rights (pkexec unavailable or refused). '
            + 'Run the command shown below in a terminal instead.',
        }
      }
    }
  } finally {
    try { fs.rmSync(tmp, { force: true }) } catch { /* best effort */ }
  }

  // Trust the file, not the exit code: an elevated helper can report success
  // and still have written nothing (a cancelled prompt, a redirected path).
  return readHosts(file) === next
    ? { ok: true, message: 'Done.' }
    : { ok: false, message: 'The hosts file was not changed.' }
}

/** Spawn argv-only and resolve on exit. Never throws into the request path. */
function run(cmd: string, args: string[]): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true })
      child.on('error', () => resolve({ ok: false }))
      child.on('close', (code) => resolve({ ok: code === 0 }))
    } catch {
      resolve({ ok: false })
    }
  })
}

/** Write `hostname` into the hosts file (elevating if we must). */
export async function installHostname(hostname: string): Promise<{ ok: boolean; message: string }> {
  if (!isValidLocalHostname(hostname)) {
    return { ok: false, message: 'Not a valid .local / .localhost name.' }
  }
  if (!needsHostsEntry(hostname)) {
    return { ok: true, message: `${hostname} needs no setup — .localhost names always point at this computer.` }
  }
  const file = hostsFilePath()
  const current = readHosts(file)
  if (!current) return { ok: false, message: `Could not read ${file}.` }
  if (hostsMapsToLoopback(current, hostname)) {
    return { ok: true, message: `${hostname} is already in ${file}.` }
  }
  const next = applyHostsBlock(current, [...managedHostnames(current), hostname])
  return writeHosts(file, current, next, `${hostname} now points at this computer.`)
}

/** Remove `hostname` from the block this app manages. */
export async function uninstallHostname(hostname: string): Promise<{ ok: boolean; message: string }> {
  const file = hostsFilePath()
  const current = readHosts(file)
  if (!current) return { ok: false, message: `Could not read ${file}.` }
  const remaining = managedHostnames(current).filter((h) => h !== hostname.trim().toLowerCase())
  const next = applyHostsBlock(current, remaining)
  if (next === current) return { ok: true, message: `${hostname} was not in this app's section of ${file}.` }
  return writeHosts(file, current, next, `${hostname} was removed from ${file}.`)
}

/** Direct write when we already have permission, elevated copy otherwise. */
async function writeHosts(
  file: string, current: string, next: string, okMessage: string,
): Promise<{ ok: boolean; message: string }> {
  if (next === current) return { ok: true, message: okMessage }
  if (canWriteHosts(file)) {
    try {
      fs.writeFileSync(file, next)
      return { ok: true, message: okMessage }
    } catch {
      // Fall through to elevation: W_OK can pass and the write still fail
      // (Windows ACLs, a read-only mount).
    }
  }
  const r = await elevatedReplace(file, next)
  return r.ok ? { ok: true, message: okMessage } : r
}

/**
 * Whether this name will actually reach us, checked before the launcher prints
 * it as THE address. A `.localhost` name is loopback by definition; anything
 * else has to resolve, and every address it resolves to must be loopback — a
 * name pointing somewhere else would send the user to another machine.
 */
export async function resolvesToLoopback(hostname: string): Promise<boolean> {
  if (isLocalhostSuffixed(hostname)) return true
  try {
    const addrs = await dns.promises.lookup(hostname, { all: true })
    return addrs.length > 0 && addrs.every((a) => a.address === '127.0.0.1' || a.address === '::1')
  } catch {
    return false
  }
}
