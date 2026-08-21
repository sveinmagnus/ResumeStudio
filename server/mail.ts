/**
 * Outbound email — one short plain-text message, and nothing else.
 *
 * NOTHING else in the app sends mail. This exists so a user with no owner to
 * ask, no shell on the box and no recovery code filed away can still get back
 * in: a message carries who it is from, one link, an expiry and "ignore this if
 * it wasn't you". **No CV content ever reaches this module.**
 *
 * Two transports, both dependency-free — the same trade `passwords.ts` makes
 * over bcrypt and `sqlite.ts` over better-sqlite3:
 *   - `sendmail` — `execFile` on the local binary, argv only, message on stdin.
 *   - `smtp`     — hand-rolled over `node:net`/`node:tls`: implicit TLS (465),
 *                  STARTTLS (587) or a plain local relay (25), AUTH PLAIN/LOGIN.
 *
 * The transport is DECLARED (`mail_transport`), never sniffed — the same rule as
 * `llm_high_end` and the release channel. A misdetected mail path is silent
 * until the one moment somebody needs a reset link.
 *
 * ── Header injection is the risk this module is shaped around ────────────────
 *
 * A CR or LF in an address ends the `To:` line early: everything after it is
 * parsed as further headers (a `Bcc:` to somebody else) or, past a blank line,
 * as a second body. The same bytes in `RCPT TO:<…>` inject SMTP verbs. So every
 * header-bound value is REJECTED rather than sanitised — `resumeId.ts`'s rule,
 * for the same reason: a value is either well-formed or it is not, and a
 * stripping pass leaves you reasoning about what it left behind.
 *
 * Env is read lazily (per call), like `translate.ts`, so tests can vary it and
 * importing this module has no side effects.
 */

import { execFile } from 'node:child_process'
import net from 'node:net'
import tls from 'node:tls'
import { randomBytes } from 'node:crypto'
import { GRANT_TTL_MS } from './accounts.js'

export type MailTransport = 'off' | 'sendmail' | 'smtp'
export const MAIL_TRANSPORTS: readonly MailTransport[] = ['off', 'sendmail', 'smtp']

export type SmtpSecurity = 'none' | 'starttls' | 'tls'
export const SMTP_SECURITIES: readonly SmtpSecurity[] = ['none', 'starttls', 'tls']

/** Where a sendmail-compatible binary lives on every mainstream MTA install. */
export const DEFAULT_SENDMAIL_PATH = '/usr/sbin/sendmail'

export interface MailConfig {
  transport: MailTransport
  /** Envelope sender and `From:`. Must pass isValidEmailAddress to send at all. */
  from: string
  sendmailPath: string
  smtp: {
    host: string
    /** 0 = the standard port for `security` — see effectiveSmtpPort. */
    port: number
    security: SmtpSecurity
    /** Empty = no AUTH attempted. */
    user: string
    pass: string
  }
}

export interface MailMessage {
  to: string
  subject: string
  text: string
}

/**
 * Why a fixed set of codes rather than a message: the caller is a request
 * handler, and anything derived from the relay's own text can name an internal
 * host or confirm whether an address exists. Upstream detail is logged here and
 * never travels back up.
 */
export type MailError = 'not-configured' | 'invalid-recipient' | 'invalid-message' | 'send-failed'
export type MailResult = { ok: true } | { ok: false; error: MailError }

const CRLF = '\r\n'
/** SMTP's NUL separator (RFC 4616), spelled so no raw control byte is in source. */
const NUL = String.fromCharCode(0)

function clean(v: string | undefined): string {
  return v?.trim() ?? ''
}

function pickEnum<T extends string>(values: readonly T[], raw: string, dflt: T): T {
  const v = raw.toLowerCase()
  return (values as readonly string[]).includes(v) ? (v as T) : dflt
}

/** The active mail config from env. The desktop build pushes settings onto these. */
export function resolveMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const port = Number(clean(env.SMTP_PORT))
  return {
    transport: pickEnum(MAIL_TRANSPORTS, clean(env.MAIL_TRANSPORT), 'off'),
    from: clean(env.MAIL_FROM),
    sendmailPath: clean(env.SENDMAIL_PATH) || DEFAULT_SENDMAIL_PATH,
    smtp: {
      host: clean(env.SMTP_HOST),
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0,
      security: pickEnum(SMTP_SECURITIES, clean(env.SMTP_SECURITY), 'starttls'),
      user: clean(env.SMTP_USER),
      pass: clean(env.SMTP_PASS),
    },
  }
}

/**
 * Whether this instance can send at all. The "Forgot password?" link is HIDDEN
 * when this is false — the rule the whole AI surface follows, because a disabled
 * control advertises a feature while refusing it.
 *
 * An unusable `from` counts as unconfigured: it is a header value, so the send
 * path would refuse it anyway, and failing here means failing before a user is
 * ever offered the link.
 */
export function isMailConfigured(config?: MailConfig): boolean {
  const c = config ?? resolveMailConfig()
  if (!isValidEmailAddress(c.from)) return false
  switch (c.transport) {
    case 'sendmail': return c.sendmailPath.length > 0
    case 'smtp':     return c.smtp.host.length > 0
    default:         return false
  }
}

// ─── Address and header validation ───────────────────────────────────────────

/** RFC 5321's practical ceiling for a whole address. */
export const MAX_EMAIL_LENGTH = 254
const MAX_LOCAL_LENGTH = 64
const MAX_DOMAIN_LENGTH = 255

/** Dot-atom (RFC 5322 §3.2.3). Quoted local parts are refused, not supported. */
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
/** One DNS label: letters/digits/hyphen, never starting or ending with a hyphen. */
const DOMAIN_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

/**
 * Anything a receiving parser might read as the end of a header line: the C0
 * controls (CR and LF among them), DEL, the C1 block — of which U+0085 NEL is a
 * line break to several parsers — and the two Unicode line separators.
 *
 * Kept as a code-point scan rather than folded into the address grammar because
 * every header-bound value goes through it, not only the address.
 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true
  }
  return false
}

function isAsciiPrintable(value: string): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x20 || c > 0x7e) return false
  }
  return true
}

/**
 * Is this an address we are willing to put in a header and in `RCPT TO:<…>`?
 *
 * Deliberately narrower than RFC 5321 allows. No quoted local part, no address
 * literal, no non-ASCII (SMTPUTF8 is not implemented, and a bare 8-bit address
 * is mangled rather than rejected by many relays). Every address a person
 * actually types satisfies this; the shapes it turns away are the ones whose
 * only realistic origin is an attempt to write a second header.
 */
export function isValidEmailAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!value || value.length > MAX_EMAIL_LENGTH) return false
  if (hasControlChar(value)) return false
  const at = value.indexOf('@')
  if (at < 0 || at !== value.lastIndexOf('@')) return false
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (!local || local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) return false
  // Stryker disable next-line all: MAX_DOMAIN_LENGTH (255) sits behind
  // MAX_EMAIL_LENGTH (254), which is checked first — a domain long enough to
  // trip this rule cannot reach it. Kept as belt and braces in case the two
  // limits are ever changed independently, but no test can distinguish it.
  if (!domain || domain.length > MAX_DOMAIN_LENGTH) return false
  // An empty label — a leading, trailing or doubled dot — fails the label test.
  return domain.split('.').every((label) => DOMAIN_LABEL.test(label))
}

/** The domain half of an already-validated address. */
function domainOf(address: string): string {
  return address.slice(address.indexOf('@') + 1)
}

/**
 * A header value: unchanged when it is printable ASCII, RFC 2047 base64
 * encoded-words when it is not, and NULL when it carries anything that could
 * end the header line early.
 *
 * Split by CODE POINT, not by byte: a B-encoded word must decode to whole
 * characters, so a word cut through a multi-byte sequence renders as mojibake in
 * every client that decodes the words separately. 45 UTF-8 bytes encode to 60
 * base64 characters, which with the 12-character `=?UTF-8?B?…?=` wrapper stays
 * inside RFC 2047's 75-character limit for one word.
 */
const ENCODED_WORD_BYTES = 45

export function encodeHeaderValue(value: string): string | null {
  if (hasControlChar(value)) return null
  if (isAsciiPrintable(value)) return value

  const words: string[] = []
  let chunk: string[] = []
  let bytes = 0
  const flush = (): void => {
    if (!chunk.length) return
    words.push(`=?UTF-8?B?${Buffer.from(chunk.join(''), 'utf8').toString('base64')}?=`)
    chunk = []
    bytes = 0
  }
  for (const ch of value) {
    const size = Buffer.byteLength(ch, 'utf8')
    if (bytes + size > ENCODED_WORD_BYTES) flush()
    chunk.push(ch)
    bytes += size
  }
  flush()
  // Folded onto continuation lines: several encoded-words on one line would
  // pass RFC 5322's 78-character soft limit. A parser joins adjacent words and
  // drops the whitespace between them, so the decoded value is unaffected.
  return words.join(`${CRLF} `)
}

// ─── Message construction ────────────────────────────────────────────────────

/** RFC 5322 recognises exactly one line ending. */
function toCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, CRLF)
}

/** RFC 5322 wants a numeric zone; toUTCString's only difference is its 'GMT'. */
function rfc2822Date(now: Date): string {
  return now.toUTCString().replace(/GMT$/, '+0000')
}

/**
 * RFC 5322 caps a line at 998 characters excluding its CRLF. A body inside that
 * can go on the wire verbatim; a longer one has to be re-encoded, since base64
 * picks its own line length and 7bit cannot.
 */
const MAX_BODY_LINE = 990

function isSevenBitBody(body: string): boolean {
  for (const ch of body) {
    const c = ch.codePointAt(0) ?? 0
    if (c > 0x7e) return false
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false
  }
  return true
}

/**
 * The body and the transfer encoding that describes it.
 *
 * base64 is the fallback rather than quoted-printable because it is total: it
 * cannot produce an over-long line, cannot be broken by a soft line break in the
 * wrong place, and needs no escaping rules of its own. A reset message is plain
 * 7-bit ASCII and takes the verbatim path, which is also what keeps the
 * dot-stuffing rule below observable at all.
 */
function bodyPart(text: string): { encoding: string; body: string } {
  const body = toCrlf(text)
  const overLong = body.split(CRLF).some((line) => line.length > MAX_BODY_LINE)
  if (isSevenBitBody(body) && !overLong) return { encoding: '7bit', body }
  const b64 = Buffer.from(body, 'utf8').toString('base64')
  return { encoding: 'base64', body: (b64.match(/.{1,76}/g) ?? []).join(CRLF) }
}

/**
 * The complete RFC 5322 message, or NULL when any header-bound value is
 * unusable. Null is the whole error contract here: a caller that gets one must
 * not send, and there is no partially-sanitised message to fall back to.
 *
 * No display name is composed into `From:` or `To:`. A phrase would need its own
 * quoting rules on top of the encoded-word ones, for no gain in a message whose
 * entire job is to carry one link.
 */
export function buildMessage(from: string, message: MailMessage, now: Date = new Date()): string | null {
  if (!isValidEmailAddress(from) || !isValidEmailAddress(message.to)) return null
  const subject = encodeHeaderValue(message.subject)
  if (subject === null) return null

  const part = bodyPart(message.text)
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${subject}`,
    `Date: ${rfc2822Date(now)}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${domainOf(from)}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Transfer-Encoding: ${part.encoding}`,
    // Stops an out-of-office from answering a reset link, which would otherwise
    // bounce a credential-bearing thread back through the relay.
    'Auto-Submitted: auto-generated',
  ]
  return `${headers.join(CRLF)}${CRLF}${CRLF}${part.body}`
}

/**
 * RFC 5321 §4.5.2: inside DATA, a line consisting of a single '.' ends the
 * message. Every line that begins with one therefore gets a second, which the
 * receiver removes. Without this a body line of '.' truncates the mail and
 * leaves the remainder to be read as SMTP commands.
 */
export function stuffDots(message: string): string {
  return message
    .split(CRLF)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join(CRLF)
}

// ─── Sending ─────────────────────────────────────────────────────────────────

/** Inactivity ceiling for the socket, which also bounds connecting. */
const SMTP_IDLE_TIMEOUT_MS = 20_000
/** Absolute ceiling on one conversation, so a server dribbling bytes can't stall a request. */
const SMTP_TOTAL_TIMEOUT_MS = 60_000
const SENDMAIL_TIMEOUT_MS = 30_000

function fail(error: MailError): MailResult {
  return { ok: false, error }
}

/**
 * Send one message. Never throws: a reset flow that 500s because a relay is down
 * tells the caller more about the account than the flow is allowed to.
 */
export async function sendMail(message: MailMessage, config?: MailConfig): Promise<MailResult> {
  const c = config ?? resolveMailConfig()
  if (!isMailConfigured(c)) return fail('not-configured')
  if (!isValidEmailAddress(message.to)) return fail('invalid-recipient')

  const wire = buildMessage(c.from, message)
  if (wire === null) return fail('invalid-message')

  try {
    if (c.transport === 'sendmail') await sendViaSendmail(c, wire)
    else await sendViaSmtp(c, message.to, wire)
    return { ok: true }
  } catch (err) {
    // Server-side only. The text can name an internal relay or echo a rejection
    // that says whether an address exists, so it stops here.
    console.warn('[mail] send failed:', (err as Error).message)
    return fail('send-failed')
  }
}

// ─── The two messages this app is allowed to send ────────────────────────────

/** Rendered from GRANT_TTL_MS so a retuned lifetime cannot leave the text lying. */
function humanDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? '1 hour' : `${hours} hours`
}

/**
 * Neither message names the account, the username or the display name. The
 * mailbox is the only thing that identifies the reader, and a message that
 * confirms whose account it belongs to is worth more to somebody who has
 * reached the mailbox by mistake than it is to its owner.
 */
const IGNORE_LINE = 'If you did not ask for this, you can ignore this message. Nothing has changed.'

export function sendResetMail(to: string, link: string, config?: MailConfig): Promise<MailResult> {
  return sendMail({
    to,
    subject: 'Reset your Resume Studio password',
    text: [
      'Somebody asked to reset the password for your Resume Studio account.',
      '',
      'Open this link to choose a new one:',
      link,
      '',
      `The link works once and expires in ${humanDuration(GRANT_TTL_MS.reset)}.`,
      '',
      IGNORE_LINE,
    ].join('\n'),
  }, config)
}

export function sendVerifyMail(to: string, link: string, config?: MailConfig): Promise<MailResult> {
  return sendMail({
    to,
    subject: 'Confirm your Resume Studio email address',
    text: [
      'Open this link to confirm this address for your Resume Studio account:',
      link,
      '',
      `The link works once and expires in ${humanDuration(GRANT_TTL_MS.verify_email)}.`,
      '',
      'Until it is confirmed, this address cannot be used to reset a password.',
      '',
      IGNORE_LINE,
    ].join('\n'),
  }, config)
}

/**
 * `-t` takes the recipients from the `To:` header (already validated) and `-i`
 * stops a lone '.' from ending the message — the local-binary equivalent of the
 * dot-stuffing SMTP needs, which is why the body is piped verbatim here.
 *
 * `execFile` with an explicit argv and no shell, the rule `localHost.ts` follows
 * for its privileged copy: nothing user-supplied reaches a command line at all.
 */
function sendViaSendmail(c: MailConfig, wire: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      c.sendmailPath,
      ['-t', '-i'],
      { timeout: SENDMAIL_TIMEOUT_MS, windowsHide: true },
      (err) => (err ? reject(err) : resolve()),
    )
    // EPIPE when the binary exits before reading stdin. The callback above
    // carries the real failure; this only stops an unhandled 'error' event.
    child.stdin?.on('error', () => { /* reported through the callback */ })
    child.stdin?.end(`${wire}${CRLF}`)
  })
}

interface SmtpReply {
  code: number
  /** Every line's text, continuation lines included, newline-joined. */
  text: string
}

class SmtpError extends Error {
  constructor(stage: string, reply: SmtpReply) {
    super(`${stage}: ${reply.code} ${reply.text.slice(0, 200)}`)
    this.name = 'SmtpError'
  }
}

/**
 * One SMTP conversation: line framing, multi-line replies, and the STARTTLS
 * upgrade.
 *
 * Bytes are decoded as latin1, never utf8: the protocol is ASCII, and latin1
 * maps bytes one-to-one so a chunk boundary can never land mid-character and
 * corrupt the framing.
 */
class SmtpSession {
  private sock: net.Socket
  private buf = ''
  private group: string[] = []
  private replies: SmtpReply[] = []
  private error: Error | null = null
  private wake: (() => void) | null = null

  constructor(sock: net.Socket) {
    this.sock = sock
    this.bind(sock)
  }

  private bind(sock: net.Socket): void {
    sock.setTimeout(SMTP_IDLE_TIMEOUT_MS)
    sock.on('data', (chunk: Buffer) => this.feed(chunk.toString('latin1')))
    sock.on('timeout', () => this.abort(new Error('SMTP timed out')))
    sock.on('error', (err: Error) => this.abort(err))
    sock.on('close', () => this.abort(new Error('SMTP connection closed')))
  }

  private unbind(sock: net.Socket): void {
    for (const event of ['data', 'timeout', 'error', 'close']) sock.removeAllListeners(event)
  }

  abort(err: Error): void {
    if (!this.error) this.error = err
    this.wake?.()
  }

  private feed(chunk: string): void {
    this.buf += chunk
    for (;;) {
      const nl = this.buf.indexOf('\n')
      if (nl < 0) return
      const line = this.buf.slice(0, nl).replace(/\r$/, '')
      this.buf = this.buf.slice(nl + 1)
      this.take(line)
    }
  }

  /**
   * RFC 5321 §4.2.1: a reply is `NNN-text` on every line but the last, which is
   * `NNN text`. The continuation flag is the FOURTH character — read any other
   * way an EHLO capability list is indistinguishable from several replies, and a
   * client that answers each line runs one command out of step for the rest of
   * the session.
   */
  private take(line: string): void {
    this.group.push(line)
    if (line.length >= 4 && line[3] === '-') return
    const code = Number.parseInt(line.slice(0, 3), 10)
    const text = this.group.map((l) => l.slice(4)).join('\n')
    this.group = []
    this.replies.push({ code: Number.isNaN(code) ? 0 : code, text })
    this.wake?.()
  }

  read(): Promise<SmtpReply> {
    return new Promise((resolve, reject) => {
      const settle = (): boolean => {
        const next = this.replies.shift()
        if (next) { this.wake = null; resolve(next); return true }
        if (this.error) { this.wake = null; reject(this.error); return true }
        return false
      }
      if (settle()) return
      this.wake = () => { settle() }
    })
  }

  write(data: string): void {
    this.sock.write(data)
  }

  command(line: string): Promise<SmtpReply> {
    this.write(`${line}${CRLF}`)
    return this.read()
  }

  /**
   * Wrap the live socket in TLS. Everything buffered before the upgrade is
   * dropped: the server must not have spoken since its 220, and carrying a
   * pre-TLS byte across the boundary is how an injected reply survives it.
   *
   * `rejectUnauthorized` is left at its default. There is no setting to turn it
   * off, because an unverified certificate on the leg that carries the password
   * is the one thing STARTTLS was selected for.
   */
  async upgrade(host: string): Promise<void> {
    const plain = this.sock
    this.unbind(plain)
    plain.setTimeout(0)
    const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const onError = (err: Error): void => reject(err)
      const s = tls.connect({ socket: plain, servername: host }, () => {
        s.off('error', onError)
        resolve(s)
      })
      s.once('error', onError)
    })
    this.buf = ''
    this.group = []
    this.replies = []
    this.sock = secure
    this.bind(secure)
  }

  close(): void {
    try { this.sock.destroy() } catch { /* best effort */ }
  }
}

function expectCode(reply: SmtpReply, stage: string, ...codes: number[]): void {
  if (!codes.includes(reply.code)) throw new SmtpError(stage, reply)
}

/** 0 = "whatever this security mode is conventionally served on". */
export function effectiveSmtpPort(smtp: MailConfig['smtp']): number {
  if (smtp.port > 0) return smtp.port
  switch (smtp.security) {
    case 'tls':      return 465
    case 'starttls': return 587
    default:         return 25
  }
}

/**
 * EHLO, falling back to HELO for a relay predating ESMTP. The fallback returns
 * no capabilities, so STARTTLS and AUTH then fail loudly rather than quietly
 * proceeding without them.
 */
async function greet(session: SmtpSession, domain: string): Promise<Set<string>> {
  const reply = await session.command(`EHLO ${domain}`)
  if (reply.code === 250) {
    // The first line is the server's greeting text, not a capability.
    return new Set(reply.text.split('\n').slice(1).map((l) => l.trim().toUpperCase()))
  }
  expectCode(await session.command(`HELO ${domain}`), 'HELO', 250)
  return new Set()
}

/** The mechanisms an `AUTH …` (or the older `AUTH=…`) capability line offers. */
function authMechanisms(caps: Set<string>): Set<string> {
  for (const line of caps) {
    if (line !== 'AUTH' && !line.startsWith('AUTH ') && !line.startsWith('AUTH=')) continue
    return new Set(line.slice(4).replace(/^=/, '').trim().split(/\s+/).filter(Boolean))
  }
  return new Set()
}

/**
 * AUTH PLAIN when offered, AUTH LOGIN otherwise.
 *
 * The mechanism has to be ADVERTISED. A server that lists no AUTH is not
 * expecting credentials, and pushing them at it anyway is how a password lands
 * in a stranger's log. Credentials over an unencrypted link are allowed —
 * `smtp_security: 'none'` is a deliberate choice for a relay on localhost — but
 * they are never sent to a server that did not ask for them.
 */
async function authenticate(
  session: SmtpSession, caps: Set<string>, user: string, pass: string,
): Promise<void> {
  // A NUL in either value would re-frame AUTH PLAIN's own separators.
  if (hasControlChar(user) || hasControlChar(pass)) {
    throw new Error('SMTP credentials contain a control character')
  }
  const mechs = authMechanisms(caps)
  if (mechs.has('PLAIN')) {
    const token = Buffer.from(`${NUL}${user}${NUL}${pass}`, 'utf8').toString('base64')
    expectCode(await session.command(`AUTH PLAIN ${token}`), 'AUTH PLAIN', 235)
    return
  }
  if (mechs.has('LOGIN')) {
    expectCode(await session.command('AUTH LOGIN'), 'AUTH LOGIN', 334)
    expectCode(await session.command(Buffer.from(user, 'utf8').toString('base64')), 'AUTH LOGIN user', 334)
    expectCode(await session.command(Buffer.from(pass, 'utf8').toString('base64')), 'AUTH LOGIN password', 235)
    return
  }
  throw new Error('SMTP server offers no supported AUTH mechanism')
}

async function sendViaSmtp(c: MailConfig, to: string, wire: string): Promise<void> {
  const host = c.smtp.host
  const port = effectiveSmtpPort(c.smtp)
  const sock = c.smtp.security === 'tls'
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port })
  const session = new SmtpSession(sock)
  const deadline = setTimeout(() => session.abort(new Error('SMTP session exceeded its deadline')), SMTP_TOTAL_TIMEOUT_MS)
  deadline.unref?.()

  try {
    expectCode(await session.read(), 'greeting', 220)
    const domain = domainOf(c.from)
    let caps = await greet(session, domain)

    if (c.smtp.security === 'starttls') {
      // No fallback to sending in the clear. The operator asked for STARTTLS,
      // and a missing capability line is what a downgrade attack looks like.
      if (!caps.has('STARTTLS')) throw new Error('SMTP server does not offer STARTTLS')
      expectCode(await session.command('STARTTLS'), 'STARTTLS', 220)
      await session.upgrade(host)
      // RFC 3207 §4.2: the pre-TLS capability list was unauthenticated and must
      // be discarded, not reused.
      caps = await greet(session, domain)
    }

    if (c.smtp.user) await authenticate(session, caps, c.smtp.user, c.smtp.pass)

    expectCode(await session.command(`MAIL FROM:<${c.from}>`), 'MAIL FROM', 250)
    expectCode(await session.command(`RCPT TO:<${to}>`), 'RCPT TO', 250, 251)
    expectCode(await session.command('DATA'), 'DATA', 354)
    session.write(`${stuffDots(wire)}${CRLF}.${CRLF}`)
    expectCode(await session.read(), 'message body', 250)
    // A courtesy: the message is accepted at the 250 above, so a relay that
    // drops the connection rather than answering has not failed the send.
    await session.command('QUIT').catch(() => undefined)
  } finally {
    clearTimeout(deadline)
    session.close()
  }
}
