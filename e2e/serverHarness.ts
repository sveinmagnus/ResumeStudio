/**
 * A server of one's own, and — when a test needs to read what the app sent —
 * a mailbox to catch it in.
 *
 * WHY A SERVER PER SPEC. The suite-wide server in `playwright.config.ts` is
 * shared and already has whatever state earlier specs left in it. Everything the
 * accounts feature does happens exactly once per database (the first account) or
 * depends on how the process was configured before it booted (a mail transport,
 * a service token), so these specs each boot their own.
 *
 * WHY AN ISOLATED DATA DIRECTORY. `server/index.ts` calls `applyServerSettings()`,
 * which projects `settings.json` from the data directory onto `process.env` —
 * and the file it reads is coerced against the defaults first, so a key the
 * operator never saved arrives as its DEFAULT and overwrites the environment.
 * On a developer machine that has ever run the desktop build, that silently
 * clears `RESUME_APP_BASE_URL` and forces `MAIL_TRANSPORT=off` here: invite
 * links come back relative and no message is ever sent. A private directory per
 * server means these specs measure the app rather than the machine.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'

export interface ServerHandle {
  /** Origin to point a browser context's `baseURL` at. */
  base: string
  /**
   * The one-time code the server printed, read off STDOUT the way an operator
   * reads it off their console. Empty when the instance printed none.
   */
  bootstrapCode: string
  stop(): void
}

/** Matches the code in the start-up banner: four groups of five. */
const BOOTSTRAP_CODE = /\b([0-9A-Z]{5}(?:-[0-9A-Z]{5}){3})\b/

export interface StartServerOptions {
  port: number
  /** Merged over the base environment; `PORT` and the paths are set for you. */
  env?: Record<string, string>
  /**
   * Whether to wait for a bootstrap code. False for an instance that prints
   * none (a token-mode server without `RESUME_SETUP`), which would otherwise
   * only ever time out.
   */
  expectBootstrapCode?: boolean
}

/**
 * Start a production server on `port` and resolve once it is ready.
 *
 * Readiness is the banner rather than a health poll: both lines it can wait for
 * are written from inside the `listen` callback, so either arriving means the
 * port is open.
 */
export function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const base = `http://127.0.0.1:${opts.port}`
  const wantsCode = opts.expectBootstrapCode !== false

  const dataDir = mkdtempSync(join(tmpdir(), 'rs-e2e-'))

  return new Promise<ServerHandle>((resolve, reject) => {
    const child = spawn('npx tsx server/index.ts', {
      shell: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(opts.port),
        RESUME_DB_PATH: ':memory:',
        RESUME_DATA_DIR: dataDir,
        ...opts.env,
      },
    })

    let out = ''
    let settled = false
    const handle: ServerHandle = {
      base,
      bootstrapCode: '',
      stop: () => {
        stopServer(child)
        // The database is in memory; only the log file is left behind, and a
        // run over three engines makes one of these directories per spec per
        // engine. Best-effort with retries: on Windows the log handle can
        // outlive the process by a moment, and a leftover temp directory must
        // never be the thing that fails a suite.
        try {
          rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        } catch { /* tidying, not a result */ }
      },
    }
    const done = (): void => {
      if (settled) return
      settled = true
      resolve(handle)
    }

    const read = (buf: Buffer): void => {
      out += buf.toString()
      const m = BOOTSTRAP_CODE.exec(out)
      if (m) handle.bootstrapCode = m[1]
      if (wantsCode ? m : out.includes('Resume Studio server')) done()
    }
    child.stdout?.on('data', read)
    child.stderr?.on('data', read)
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`server exited (${code}):\n${out}`))
    })
    setTimeout(() => {
      if (!settled) reject(new Error(`server did not come up within 60s. It said:\n${out}`))
    }, 60_000)
  })
}

/**
 * Kill the server and everything under it.
 *
 * It runs under a shell, so killing the shell alone leaves node holding the port
 * and the next run fails at boot. Synchronous because the test process can exit
 * before an async kill has run.
 */
function stopServer(child: ChildProcess | null): void {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

// ─── A mailbox the tests can read ───────────────────────────────────────────

export interface CapturedMail {
  /** The whole RFC 5322 message, headers included. */
  raw: string
  to: string
  subject: string
  /** Everything after the header block, with CRLF normalised to newlines. */
  body: string
  /** The first absolute URL in the body — every message this app sends has one. */
  link: string
}

export interface MailSink {
  messages: CapturedMail[]
  /** Resolve with the first message matching `subject`, or reject on timeout. */
  waitFor(subject: RegExp, timeoutMs?: number): Promise<CapturedMail>
  close(): Promise<void>
}

/**
 * An SMTP server that answers everything and files the message away.
 *
 * SMTP rather than the `sendmail` transport because this suite has to run on
 * Windows, where `execFile` refuses to launch a `.cmd`/`.bat` without a shell
 * and there is no sendmail binary to point at. It also exercises more of the
 * real code: `sendViaSmtp` does the framing, dot-stuffing and MAIL/RCPT/DATA
 * conversation that a pipe to a local binary skips entirely.
 *
 * Nothing is advertised in the EHLO reply, so `mail.ts` attempts neither
 * STARTTLS nor AUTH — matching `smtp_security: 'none'` with no user, which is
 * what the spec configures.
 */
export function startMailSink(port: number): Promise<MailSink> {
  const messages: CapturedMail[] = []

  const server = net.createServer((sock) => {
    let buf = ''
    let inData = false
    let body = ''
    sock.write('220 e2e-sink ESMTP\r\n')
    // latin1, never utf8: the protocol is ASCII and a byte-per-character
    // decode cannot break framing on a chunk boundary.
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('latin1')
      for (;;) {
        const nl = buf.indexOf('\n')
        if (nl < 0) return
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)

        if (inData) {
          if (line === '.') {
            inData = false
            messages.push(parseMessage(body))
            body = ''
            sock.write('250 queued\r\n')
          } else {
            // RFC 5321 §4.5.2 in reverse: the sender doubled a leading dot.
            body += `${line.startsWith('..') ? line.slice(1) : line}\n`
          }
          continue
        }

        const verb = line.slice(0, 4).toUpperCase()
        if (verb === 'DATA') {
          inData = true
          sock.write('354 go ahead\r\n')
        } else if (verb === 'QUIT') {
          sock.write('221 bye\r\n')
          sock.end()
        } else {
          sock.write('250 ok\r\n')
        }
      }
    })
    sock.on('error', () => { /* a hung-up client is not a test failure */ })
  })

  return new Promise<MailSink>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        messages,
        async waitFor(subject: RegExp, timeoutMs = 15_000): Promise<CapturedMail> {
          const deadline = Date.now() + timeoutMs
          for (;;) {
            const hit = messages.find((m) => subject.test(m.subject))
            if (hit) return hit
            if (Date.now() > deadline) {
              throw new Error(
                `no message matching ${String(subject)} within ${timeoutMs}ms. `
                + `Captured: ${messages.map((m) => m.subject).join(' | ') || '(none)'}`,
              )
            }
            await new Promise((r) => setTimeout(r, 100))
          }
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

function parseMessage(raw: string): CapturedMail {
  const split = raw.indexOf('\n\n')
  const head = split < 0 ? raw : raw.slice(0, split)
  const body = split < 0 ? '' : raw.slice(split + 2)
  const header = (name: string): string =>
    new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(head)?.[1].trim() ?? ''
  return {
    raw,
    to: header('To'),
    subject: header('Subject'),
    body,
    link: /https?:\/\/\S+/.exec(body)?.[0] ?? '',
  }
}

// ─── Getting a browser past the service worker ──────────────────────────────

/**
 * Open the app once in a fresh browser profile and let it settle.
 *
 * A first visit to an origin registers the service worker, which claims the open
 * page as soon as it activates; `swRegister.ts` reloads on `controllerchange`,
 * so roughly a second after the first paint the document is replaced and
 * anything typed into it is gone. Every screen a first-time visitor types into —
 * setup, sign-in, an invitation, a reset link — is inside that window.
 *
 * Absorbed here rather than asserted, because a suite racing one defect cannot
 * report any other.
 */
export async function firstVisit(page: Page): Promise<void> {
  // The app's reload can land mid-navigation, which Playwright reports as
  // "interrupted by another navigation". One retry is enough: the worker claims
  // a profile once, so the second attempt has nothing left to race.
  const open = async (): Promise<void> => {
    try {
      await page.goto('/')
    } catch {
      await page.goto('/')
    }
  }

  await open()
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller,
      null,
      { timeout: 20_000 },
    )
    .catch(() => { /* no worker here: nothing will claim the page, nothing to wait for */ })
  // Taking the next navigation ourselves guarantees the document every test
  // below works in is one the worker was already controlling.
  await open()
}

// ─── Steps every accounts spec repeats ──────────────────────────────────────

export async function signIn(page: Page, login: string, password: string): Promise<void> {
  await page.getByLabel('Username or email address').fill(login)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function signOut(page: Page, displayName: string): Promise<void> {
  await page.getByRole('button', { name: displayName }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
}
