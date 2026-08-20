import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import net from 'node:net'
import {
  sendMail, isMailConfigured, isValidEmailAddress, encodeHeaderValue, buildMessage,
  stuffDots, effectiveSmtpPort, resolveMailConfig, sendResetMail, sendVerifyMail,
  type MailConfig,
} from '../../server/mail'

/**
 * Control characters are BUILT, never typed: a raw one in a source file makes
 * git and grep treat the whole file as binary, which is what `npm run
 * check:text` exists to prevent (CLAUDE.md §2).
 */
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const NUL = String.fromCharCode(0)
const BEL = String.fromCharCode(7)
const ESC = String.fromCharCode(27)
const DEL = String.fromCharCode(127)
const NEL = String.fromCharCode(0x85)
const LINE_SEP = String.fromCharCode(0x2028)
const PARA_SEP = String.fromCharCode(0x2029)
const CRLF = CR + LF

// ─── sendmail: child_process is mocked so nothing is ever executed ───────────

const sendmail = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: readonly string[]; opts: Record<string, unknown>; body: string }[],
  failWith: null as Error | null,
}))

vi.mock('node:child_process', async () => {
  const { PassThrough } = await import('node:stream')
  return {
    execFile: (
      cmd: string,
      args: readonly string[],
      opts: Record<string, unknown>,
      cb: (err: Error | null) => void,
    ) => {
      const stdin = new PassThrough()
      const chunks: Buffer[] = []
      stdin.on('data', (c: Buffer) => { chunks.push(Buffer.from(c)) })
      stdin.on('end', () => {
        sendmail.calls.push({ cmd, args, opts, body: Buffer.concat(chunks).toString('utf8') })
        cb(sendmail.failWith)
      })
      return { stdin }
    },
  }
})

// ─── A fake SMTP server, just enough of RFC 5321 to hold the client to it ────

interface FakeOptions {
  /** Capability lines after the EHLO greeting line. */
  caps?: string[]
  /** Greeting lines before the code (multi-line when more than one). */
  greeting?: string[]
  /** Verbatim reply to RCPT TO. */
  rcpt?: string
}

interface FakeServer {
  port: number
  /** Every line the client sent outside DATA, in order. */
  commands: string[]
  /** The DATA payload exactly as it arrived — dot-stuffing NOT undone. */
  data: string
  close(): Promise<void>
}

function multiline(code: number, lines: string[]): string {
  return lines.map((l, i) => `${code}${i === lines.length - 1 ? ' ' : '-'}${l}${CRLF}`).join('')
}

async function startFakeSmtp(opts: FakeOptions = {}): Promise<FakeServer> {
  const state: { commands: string[]; data: string } = { commands: [], data: '' }
  const caps = opts.caps ?? ['SIZE 10240000', 'AUTH PLAIN LOGIN', 'HELP']
  const sockets = new Set<net.Socket>()

  const server = net.createServer((sock) => {
    sockets.add(sock)
    let buf = ''
    let inData = false
    let body: string[] = []
    let awaiting: 'user' | 'pass' | null = null

    const reply = (line: string): string => {
      if (awaiting === 'user') { awaiting = 'pass'; return `334 UGFzc3dvcmQ6${CRLF}` }
      if (awaiting === 'pass') { awaiting = null; return `235 2.7.0 Authentication successful${CRLF}` }
      const verb = line.split(' ')[0].toUpperCase()
      if (verb === 'EHLO') return multiline(250, ['fake.example.com Hello', ...caps])
      if (verb === 'HELO') return `250 fake.example.com${CRLF}`
      if (verb === 'AUTH') {
        const mech = (line.split(' ')[1] ?? '').toUpperCase()
        if (mech === 'PLAIN') return `235 2.7.0 Authentication successful${CRLF}`
        if (mech === 'LOGIN') { awaiting = 'user'; return `334 VXNlcm5hbWU6${CRLF}` }
        return `504 5.5.4 Unrecognized authentication type${CRLF}`
      }
      if (verb === 'MAIL') return `250 2.1.0 Ok${CRLF}`
      if (verb === 'RCPT') return opts.rcpt ?? `250 2.1.5 Ok${CRLF}`
      if (verb === 'DATA') { inData = true; return `354 End data with <CR><LF>.<CR><LF>${CRLF}` }
      if (verb === 'QUIT') return `221 2.0.0 Bye${CRLF}`
      return `502 5.5.2 Error: command not recognized${CRLF}`
    }

    sock.setEncoding('utf8')
    sock.write(multiline(220, opts.greeting ?? ['fake.example.com ESMTP ready']))
    sock.on('data', (chunk: string) => {
      buf += chunk
      for (;;) {
        const nl = buf.indexOf(LF)
        if (nl < 0) return
        const line = buf.slice(0, nl).replace(new RegExp(`${CR}$`), '')
        buf = buf.slice(nl + 1)
        if (inData) {
          // The terminator is checked BEFORE any un-stuffing, which is what lets
          // the dot-stuffing test see the doubled dot on the wire.
          if (line === '.') {
            inData = false
            state.data = body.join(LF)
            body = []
            sock.write(`250 2.0.0 Ok: queued${CRLF}`)
            continue
          }
          body.push(line)
          continue
        }
        state.commands.push(line)
        sock.write(reply(line))
      }
    })
    sock.on('error', () => { /* the client destroys the socket after QUIT */ })
    sock.on('close', () => sockets.delete(sock))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  return {
    port,
    get commands() { return state.commands },
    get data() { return state.data },
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy()
      server.close(() => resolve())
    }),
  }
}

function smtpConfig(port: number, over: Partial<MailConfig['smtp']> = {}): MailConfig {
  return {
    transport: 'smtp',
    from: 'noreply@example.com',
    sendmailPath: '/usr/sbin/sendmail',
    smtp: { host: '127.0.0.1', port, security: 'none', user: '', pass: '', ...over },
  }
}

const SENDMAIL_CONFIG: MailConfig = {
  transport: 'sendmail',
  from: 'noreply@example.com',
  sendmailPath: '/usr/sbin/sendmail',
  smtp: { host: '', port: 0, security: 'starttls', user: '', pass: '' },
}

const OK_MESSAGE = { to: 'user@example.com', subject: 'Reset your password', text: 'Open the link.' }

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  sendmail.calls.length = 0
  sendmail.failWith = null
  // The failure path logs upstream detail on purpose; keep it out of the run.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { warn.mockRestore() })

// ─── The injection table ─────────────────────────────────────────────────────

/**
 * Every one of these must be REJECTED, never sanitised into something sendable.
 *
 * A CR or LF in an address ends the To: header early and everything after it is
 * parsed as further headers — a Bcc: to a third party — or, past a blank line,
 * as a second message body. In `RCPT TO:<…>` the same bytes inject SMTP verbs.
 */
const INJECTIONS: [name: string, address: string][] = [
  ['bare CR', `user@example.com${CR}`],
  ['bare LF', `user@example.com${LF}`],
  ['CRLF', `user@example.com${CRLF}`],
  ['CRLF + a Bcc header', `user@example.com${CRLF}Bcc: attacker@evil.test`],
  ['LF + a Bcc header', `user@example.com${LF}Bcc: attacker@evil.test`],
  ['CRLF + a blank line and a second body', `user@example.com${CRLF}${CRLF}Injected body`],
  ['CR inside the local part', `us${CR}er@example.com`],
  ['NUL', `user@example.com${NUL}`],
  ['BEL (other C0)', `user@example.com${BEL}`],
  ['ESC (other C0)', `user@example.com${ESC}`],
  ['DEL', `user@example.com${DEL}`],
  ['NEL (C1, a line break to some parsers)', `user@example.com${NEL}`],
  ['U+2028 line separator', `user${LINE_SEP}@example.com`],
  ['U+2029 paragraph separator', `user@example.com${PARA_SEP}`],
  ['percent-encoded CRLF', 'user@example.com%0d%0aBcc:attacker@evil.test'],
  ['SMTP verb injection', `user@example.com${CRLF}RCPT TO:<attacker@evil.test>`],
  ['over-long address', `${'a'.repeat(250)}@example.com`],
  ['over-long local part', `${'a'.repeat(65)}@example.com`],
  ['two @ signs', 'user@example@com'],
  ['no @ at all', 'userexample.com'],
  ['empty', ''],
  ['leading dot in the local part', '.user@example.com'],
  ['trailing dot in the local part', 'user.@example.com'],
  ['doubled dot in the local part', 'us..er@example.com'],
  ['trailing dot in the domain', 'user@example.com.'],
  ['leading dot in the domain', 'user@.example.com'],
  ['doubled dot in the domain', 'user@example..com'],
  ['a space', 'user name@example.com'],
  ['a leading space', ' user@example.com'],
  ['a hyphen-led label', 'user@-example.com'],
  ['an angle-bracketed phrase', '<user@example.com>'],
  ['a display name', 'User <user@example.com>'],
  ['non-ASCII (SMTPUTF8 is not implemented)', 'bruker@eksempel.no'.replace('e', 'é')],
]

describe('isValidEmailAddress', () => {
  it.each(INJECTIONS)('rejects %s', (_name, address) => {
    expect(isValidEmailAddress(address)).toBe(false)
  })

  it('rejects a non-string', () => {
    for (const v of [null, undefined, 42, {}, ['a@b.com']]) expect(isValidEmailAddress(v)).toBe(false)
  })

  it('accepts the shapes people actually use', () => {
    for (const ok of [
      'user@example.com',
      'first.last@sub.example.co.uk',
      'user+tag@example.com',
      "o'brien@example.com",
      'user_name-1@example-host.com',
      'root@localhost',
      `${'a'.repeat(64)}@example.com`,
    ]) {
      expect(isValidEmailAddress(ok), ok).toBe(true)
    }
  })
})

describe('sendMail refuses an injected recipient outright', () => {
  it.each(INJECTIONS)('sends nothing for %s', async (_name, address) => {
    const server = await startFakeSmtp()
    try {
      const result = await sendMail({ ...OK_MESSAGE, to: address }, smtpConfig(server.port))
      expect(result).toEqual({ ok: false, error: 'invalid-recipient' })
      // Rejected, not sanitised: no connection was made at all.
      expect(server.commands).toEqual([])
      expect(server.data).toBe('')
    } finally {
      await server.close()
    }
  })

  it('never reaches the sendmail binary either', async () => {
    const result = await sendMail(
      { ...OK_MESSAGE, to: `user@example.com${CRLF}Bcc: attacker@evil.test` },
      SENDMAIL_CONFIG,
    )
    expect(result).toEqual({ ok: false, error: 'invalid-recipient' })
    expect(sendmail.calls).toEqual([])
  })

  it('builds no message for an injected recipient', () => {
    expect(buildMessage('noreply@example.com', {
      ...OK_MESSAGE, to: `user@example.com${CRLF}Bcc: attacker@evil.test`,
    })).toBeNull()
  })

  it('refuses an injected SENDER (it lands in From: and in MAIL FROM)', async () => {
    const server = await startFakeSmtp()
    try {
      const cfg = smtpConfig(server.port)
      cfg.from = `noreply@example.com${CRLF}Bcc: attacker@evil.test`
      expect(isMailConfigured(cfg)).toBe(false)
      expect(await sendMail(OK_MESSAGE, cfg)).toEqual({ ok: false, error: 'not-configured' })
      expect(server.commands).toEqual([])
    } finally {
      await server.close()
    }
  })
})

describe('header-bound values other than the address', () => {
  it.each([
    ['CRLF + a header', `Reset${CRLF}Bcc: attacker@evil.test`],
    ['bare LF', `Reset${LF}X-Injected: yes`],
    ['bare CR', `Reset${CR}`],
    ['NUL', `Reset${NUL}`],
    ['U+2028', `Reset${LINE_SEP}`],
    ['NEL', `Reset${NEL}`],
  ])('encodeHeaderValue rejects a subject with %s', (_name, subject) => {
    expect(encodeHeaderValue(subject)).toBeNull()
  })

  it('a subject carrying a header break sends nothing', async () => {
    const server = await startFakeSmtp()
    try {
      const result = await sendMail(
        { ...OK_MESSAGE, subject: `Reset${CRLF}Bcc: attacker@evil.test` },
        smtpConfig(server.port),
      )
      expect(result).toEqual({ ok: false, error: 'invalid-message' })
      expect(server.commands).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('RFC 2047 encodes a non-ASCII subject, decodably', () => {
    const encoded = encodeHeaderValue('Tilbakestill passordet ditt — æøå')
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/)
    const decoded = (encoded ?? '')
      .split(`${CRLF} `)
      .map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, ''), 'base64').toString('utf8'))
      .join('')
    expect(decoded).toBe('Tilbakestill passordet ditt — æøå')
  })

  it('splits a long non-ASCII subject into words inside the 75-char limit', () => {
    const subject = 'æ'.repeat(120)
    const encoded = encodeHeaderValue(subject) ?? ''
    const words = encoded.split(`${CRLF} `)
    expect(words.length).toBeGreaterThan(1)
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75)
    const decoded = words
      .map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, ''), 'base64').toString('utf8'))
      .join('')
    expect(decoded).toBe(subject)
  })

  it('leaves a plain ASCII subject alone', () => {
    expect(encodeHeaderValue('Reset your password')).toBe('Reset your password')
  })
})

// ─── The message itself ──────────────────────────────────────────────────────

describe('buildMessage', () => {
  const built = () => buildMessage('noreply@example.com', OK_MESSAGE, new Date(Date.UTC(2026, 7, 20, 9, 30, 0))) ?? ''

  it('writes the headers, a blank line, then the body — all CRLF', () => {
    const msg = built()
    expect(msg).toContain(`From: noreply@example.com${CRLF}`)
    expect(msg).toContain(`To: user@example.com${CRLF}`)
    expect(msg).toContain(`Subject: Reset your password${CRLF}`)
    expect(msg).toContain(`Date: Thu, 20 Aug 2026 09:30:00 +0000${CRLF}`)
    expect(msg).toMatch(new RegExp(`Message-ID: <[0-9a-f]{32}@example\\.com>${CRLF}`))
    expect(msg).toContain(`MIME-Version: 1.0${CRLF}`)
    expect(msg).toContain(`Content-Type: text/plain; charset=utf-8${CRLF}`)
    expect(msg).toContain(`${CRLF}${CRLF}Open the link.`)
    // No bare LF anywhere: every newline is part of a CRLF pair.
    expect(msg.replace(new RegExp(CRLF, 'g'), '')).not.toContain(LF)
  })

  it('sends an ASCII body verbatim as 7bit', () => {
    expect(built()).toContain(`Content-Transfer-Encoding: 7bit${CRLF}`)
  })

  it('base64-encodes a non-ASCII body rather than putting 8 bits on the wire', () => {
    const msg = buildMessage('noreply@example.com', { ...OK_MESSAGE, text: 'Åpne lenken — takk.' }) ?? ''
    expect(msg).toContain(`Content-Transfer-Encoding: base64${CRLF}`)
    const body = msg.split(`${CRLF}${CRLF}`).slice(1).join(`${CRLF}${CRLF}`)
    expect(Buffer.from(body.replace(new RegExp(CRLF, 'g'), ''), 'base64').toString('utf8')).toBe('Åpne lenken — takk.')
  })

  it('normalises a lone LF or CR in the body to CRLF', () => {
    const msg = buildMessage('noreply@example.com', { ...OK_MESSAGE, text: `one${LF}two${CR}three` }) ?? ''
    expect(msg).toContain(`one${CRLF}two${CRLF}three`)
  })
})

describe('stuffDots', () => {
  it('doubles a leading dot so a lone "." cannot end the message', () => {
    expect(stuffDots(`a${CRLF}.${CRLF}b`)).toBe(`a${CRLF}..${CRLF}b`)
  })

  it('doubles a dot that merely starts a line', () => {
    expect(stuffDots(`.hidden${CRLF}..already${CRLF}mid.dot`))
      .toBe(`..hidden${CRLF}...already${CRLF}mid.dot`)
  })

  it('leaves a message with no leading dots untouched', () => {
    expect(stuffDots(`a${CRLF}b`)).toBe(`a${CRLF}b`)
  })
})

// ─── SMTP over a real socket ─────────────────────────────────────────────────

describe('SMTP transport', () => {
  it('walks the protocol in order and handles the multi-line EHLO reply', async () => {
    const server = await startFakeSmtp({ greeting: ['fake.example.com ESMTP', 'ready when you are'] })
    try {
      expect(await sendMail(OK_MESSAGE, smtpConfig(server.port))).toEqual({ ok: true })
      // A client that answered each capability line separately would be one
      // command out of step from here on; the exact sequence is the proof.
      expect(server.commands).toEqual([
        'EHLO example.com',
        'MAIL FROM:<noreply@example.com>',
        'RCPT TO:<user@example.com>',
        'DATA',
        'QUIT',
      ])
      expect(server.data).toContain('To: user@example.com')
      expect(server.data).toContain('Open the link.')
    } finally {
      await server.close()
    }
  })

  it('dot-stuffs the body, so a line of "." arrives doubled and nothing is truncated', async () => {
    const server = await startFakeSmtp()
    try {
      const text = `before${LF}.${LF}.hidden${LF}after`
      expect(await sendMail({ ...OK_MESSAGE, text }, smtpConfig(server.port))).toEqual({ ok: true })
      const lines = server.data.split(LF)
      expect(lines).toContain('..')
      expect(lines).toContain('..hidden')
      // The whole body survived: without stuffing, the lone dot would have ended
      // DATA and 'after' would have been read as an SMTP command.
      expect(lines).toContain('after')
      expect(server.commands).not.toContain('after')
    } finally {
      await server.close()
    }
  })

  it('authenticates with AUTH PLAIN when the server offers it', async () => {
    const server = await startFakeSmtp({ caps: ['AUTH PLAIN LOGIN'] })
    try {
      const cfg = smtpConfig(server.port, { user: 'relay-user', pass: 'p@ss word' })
      expect(await sendMail(OK_MESSAGE, cfg)).toEqual({ ok: true })
      const auth = server.commands.find((c) => c.startsWith('AUTH ')) ?? ''
      expect(auth.startsWith('AUTH PLAIN ')).toBe(true)
      expect(Buffer.from(auth.slice('AUTH PLAIN '.length), 'base64').toString('utf8'))
        .toBe(`${NUL}relay-user${NUL}p@ss word`)
    } finally {
      await server.close()
    }
  })

  it('falls back to AUTH LOGIN when PLAIN is not offered', async () => {
    const server = await startFakeSmtp({ caps: ['AUTH LOGIN'] })
    try {
      const cfg = smtpConfig(server.port, { user: 'relay-user', pass: 'secret' })
      expect(await sendMail(OK_MESSAGE, cfg)).toEqual({ ok: true })
      const start = server.commands.indexOf('AUTH LOGIN')
      expect(start).toBeGreaterThanOrEqual(0)
      expect(Buffer.from(server.commands[start + 1], 'base64').toString('utf8')).toBe('relay-user')
      expect(Buffer.from(server.commands[start + 2], 'base64').toString('utf8')).toBe('secret')
    } finally {
      await server.close()
    }
  })

  it('handles the older AUTH=LOGIN capability spelling', async () => {
    const server = await startFakeSmtp({ caps: ['AUTH=LOGIN'] })
    try {
      const cfg = smtpConfig(server.port, { user: 'u', pass: 'p' })
      expect(await sendMail(OK_MESSAGE, cfg)).toEqual({ ok: true })
      expect(server.commands).toContain('AUTH LOGIN')
    } finally {
      await server.close()
    }
  })

  it('will not send credentials to a server that advertises no AUTH', async () => {
    const server = await startFakeSmtp({ caps: ['SIZE 100'] })
    try {
      const cfg = smtpConfig(server.port, { user: 'u', pass: 'p' })
      expect(await sendMail(OK_MESSAGE, cfg)).toEqual({ ok: false, error: 'send-failed' })
      expect(server.commands.some((c) => c.startsWith('AUTH'))).toBe(false)
      expect(server.commands.some((c) => c.startsWith('MAIL FROM'))).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('reports a 5xx at RCPT TO as a failure and never opens DATA', async () => {
    const server = await startFakeSmtp({
      rcpt: `550 5.1.1 <user@example.com>: Recipient address rejected: User unknown${CRLF}`,
    })
    try {
      expect(await sendMail(OK_MESSAGE, smtpConfig(server.port))).toEqual({ ok: false, error: 'send-failed' })
      expect(server.commands).toContain('RCPT TO:<user@example.com>')
      expect(server.commands).not.toContain('DATA')
      expect(server.data).toBe('')
    } finally {
      await server.close()
    }
  })

  it('reads a multi-line 5xx without desyncing', async () => {
    const server = await startFakeSmtp({
      rcpt: multiline(550, ['5.1.1 Recipient address rejected', '5.1.1 see https://relay.example/why']),
    })
    try {
      expect(await sendMail(OK_MESSAGE, smtpConfig(server.port))).toEqual({ ok: false, error: 'send-failed' })
      expect(server.commands).not.toContain('DATA')
    } finally {
      await server.close()
    }
  })

  it('refuses to continue in the clear when STARTTLS was asked for and not offered', async () => {
    const server = await startFakeSmtp({ caps: ['SIZE 100'] })
    try {
      const cfg = smtpConfig(server.port, { security: 'starttls' })
      expect(await sendMail(OK_MESSAGE, cfg)).toEqual({ ok: false, error: 'send-failed' })
      // Nothing about the message left this machine.
      expect(server.commands).toEqual(['EHLO example.com'])
      expect(server.data).toBe('')
    } finally {
      await server.close()
    }
  })

  it('reports a failure rather than throwing when nothing is listening', async () => {
    const server = await startFakeSmtp()
    const { port } = server
    await server.close()
    expect(await sendMail(OK_MESSAGE, smtpConfig(port))).toEqual({ ok: false, error: 'send-failed' })
  })

  it('never returns the relay\'s own words to the caller', async () => {
    const server = await startFakeSmtp({
      rcpt: `550 5.1.1 no mailbox for user@example.com on relay-07.internal${CRLF}`,
    })
    try {
      const result = await sendMail(OK_MESSAGE, smtpConfig(server.port))
      expect(JSON.stringify(result)).not.toContain('relay-07.internal')
      expect(JSON.stringify(result)).not.toContain('no mailbox')
    } finally {
      await server.close()
    }
  })
})

describe('effectiveSmtpPort', () => {
  it('derives the conventional port from the security mode', () => {
    const smtp = { host: 'h', port: 0, security: 'tls' as const, user: '', pass: '' }
    expect(effectiveSmtpPort(smtp)).toBe(465)
    expect(effectiveSmtpPort({ ...smtp, security: 'starttls' })).toBe(587)
    expect(effectiveSmtpPort({ ...smtp, security: 'none' })).toBe(25)
  })

  it('an explicit port wins', () => {
    expect(effectiveSmtpPort({ host: 'h', port: 2525, security: 'tls', user: '', pass: '' })).toBe(2525)
  })
})

// ─── sendmail ────────────────────────────────────────────────────────────────

describe('sendmail transport', () => {
  it('invokes the binary argv-only and pipes the message to stdin', async () => {
    expect(await sendMail(OK_MESSAGE, SENDMAIL_CONFIG)).toEqual({ ok: true })
    expect(sendmail.calls).toHaveLength(1)
    const call = sendmail.calls[0]
    expect(call.cmd).toBe('/usr/sbin/sendmail')
    // -t reads the recipients from the To: header; -i stops a lone '.' ending it.
    expect(call.args).toEqual(['-t', '-i'])
    // No shell anywhere: nothing user-supplied can reach a command line.
    expect(call.opts.shell).toBeUndefined()
    expect(call.body).toContain('To: user@example.com')
    expect(call.body).toContain('Subject: Reset your password')
    expect(call.body).toContain('Open the link.')
    expect(call.body.endsWith(CRLF)).toBe(true)
  })

  it('pipes a lone "." unchanged, because -i is what disarms it', async () => {
    await sendMail({ ...OK_MESSAGE, text: `before${LF}.${LF}after` }, SENDMAIL_CONFIG)
    expect(sendmail.calls[0].body).toContain(`before${CRLF}.${CRLF}after`)
  })

  it('reports a failing binary without throwing', async () => {
    sendmail.failWith = new Error('spawn /usr/sbin/sendmail ENOENT')
    const result = await sendMail(OK_MESSAGE, SENDMAIL_CONFIG)
    expect(result).toEqual({ ok: false, error: 'send-failed' })
    expect(JSON.stringify(result)).not.toContain('ENOENT')
  })
})

// ─── Configuration ───────────────────────────────────────────────────────────

describe('configuration', () => {
  it('transport "off" is not configured and sends nothing', async () => {
    const server = await startFakeSmtp()
    try {
      const cfg = smtpConfig(server.port)
      cfg.transport = 'off'
      expect(isMailConfigured(cfg)).toBe(false)
      expect(await sendMail(OK_MESSAGE, cfg)).toEqual({ ok: false, error: 'not-configured' })
      expect(server.commands).toEqual([])
      expect(sendmail.calls).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('an smtp transport with no host, and a sendmail one with no binary, are not configured', () => {
    expect(isMailConfigured({ ...smtpConfig(25), smtp: { ...smtpConfig(25).smtp, host: '' } })).toBe(false)
    expect(isMailConfigured({ ...SENDMAIL_CONFIG, sendmailPath: '' })).toBe(false)
    expect(isMailConfigured(SENDMAIL_CONFIG)).toBe(true)
    expect(isMailConfigured(smtpConfig(25))).toBe(true)
  })

  it('resolves from env, defaulting to off', () => {
    expect(resolveMailConfig({}).transport).toBe('off')
    const cfg = resolveMailConfig({
      MAIL_TRANSPORT: 'smtp',
      MAIL_FROM: ' noreply@example.com ',
      SMTP_HOST: 'relay.example.com',
      SMTP_PORT: '2525',
      SMTP_SECURITY: 'STARTTLS',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
    })
    expect(cfg).toEqual({
      transport: 'smtp',
      from: 'noreply@example.com',
      sendmailPath: '/usr/sbin/sendmail',
      smtp: { host: 'relay.example.com', port: 2525, security: 'starttls', user: 'u', pass: 'p' },
    })
  })

  it('falls back rather than trusting a nonsense transport, security or port', () => {
    const cfg = resolveMailConfig({ MAIL_TRANSPORT: 'carrier-pigeon', SMTP_SECURITY: 'maybe', SMTP_PORT: '99999' })
    expect(cfg.transport).toBe('off')
    expect(cfg.smtp.security).toBe('starttls')
    expect(cfg.smtp.port).toBe(0)
  })
})

// ─── The two messages the app is allowed to send ─────────────────────────────

describe('the reset and verification messages', () => {
  /** Everything after the header block's blank line. */
  const bodyOf = (wire: string): string => wire.split(`${CRLF}${CRLF}`).slice(1).join(`${CRLF}${CRLF}`).trimEnd()

  /**
   * Asserted whole rather than by keyword: "no CV content, ever" is a claim
   * about what is ABSENT, and only pinning the entire body can hold it. The
   * expiries are read off GRANT_TTL_MS, so a retuned lifetime moves both the
   * message and this expectation together.
   */
  it('the reset message is one link, an expiry, and the ignore line', async () => {
    await sendResetMail('user@example.com', 'https://cv.example.com/reset?token=abc', SENDMAIL_CONFIG)
    expect(bodyOf(sendmail.calls[0].body)).toBe([
      'Somebody asked to reset the password for your Resume Studio account.',
      '',
      'Open this link to choose a new one:',
      'https://cv.example.com/reset?token=abc',
      '',
      'The link works once and expires in 30 minutes.',
      '',
      'If you did not ask for this, you can ignore this message. Nothing has changed.',
    ].join(CRLF))
  })

  it('the verification message states its own longer life', async () => {
    await sendVerifyMail('user@example.com', 'https://cv.example.com/verify-email?token=abc', SENDMAIL_CONFIG)
    expect(bodyOf(sendmail.calls[0].body)).toBe([
      'Open this link to confirm this address for your Resume Studio account:',
      'https://cv.example.com/verify-email?token=abc',
      '',
      'The link works once and expires in 24 hours.',
      '',
      'Until it is confirmed, this address cannot be used to reset a password.',
      '',
      'If you did not ask for this, you can ignore this message. Nothing has changed.',
    ].join(CRLF))
  })

  it('stay 7-bit, so the whole message is readable on the wire', async () => {
    await sendResetMail('user@example.com', 'https://cv.example.com/reset?token=abc', SENDMAIL_CONFIG)
    expect(sendmail.calls[0].body).toContain(`Content-Transfer-Encoding: 7bit${CRLF}`)
  })

  it('are refused for an injected address like any other message', async () => {
    const result = await sendResetMail(
      `user@example.com${CRLF}Bcc: attacker@evil.test`, 'https://cv.example.com/reset?token=abc', SENDMAIL_CONFIG,
    )
    expect(result).toEqual({ ok: false, error: 'invalid-recipient' })
    expect(sendmail.calls).toEqual([])
  })
})
