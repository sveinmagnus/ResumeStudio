import express, { type Express } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import rateLimit from 'express-rate-limit'
import { authMiddleware } from './auth.js'
import { isDesktop } from './settings.js'
import authRouter from './routes/auth.js'
import resumeRouter from './routes/resume.js'
import translateRouter from './routes/translate.js'
import backupRouter from './routes/backup.js'
import settingsRouter from './routes/settings.js'
import updateRouter from './routes/update.js'

// import.meta.url is this module's file URL under tsx/ESM (dev + the VPS
// `tsx` entry), but esbuild emits "" for it in the desktop CJS bundle. Guard so
// we never call fileURLToPath("") at module load. In the bundle this dir-based
// static-file fallback is unused anyway — the launcher always sets
// RESUME_CLIENT_DIR — so the cwd fallback value is moot there.
const __dirname = import.meta.url
  ? path.dirname(fileURLToPath(import.meta.url))
  : process.cwd()

/**
 * True when the HTTP `Host` header names a loopback address (any/no port).
 * Powers the desktop DNS-rebinding guard: a request whose Host is an attacker's
 * own hostname — even one that has rebound its DNS to 127.0.0.1 — is rejected,
 * while the app's own `http://127.0.0.1:<port>` / `http://localhost:<port>`
 * requests pass. Exported for unit testing.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false
  // Strip the port. IPv6 literals are bracketed in a Host header: `[::1]:3001`.
  const hostname = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.split(':')[0]
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/**
 * Build the Express app (routes, middleware, security headers) WITHOUT
 * starting a listener. `index.ts` calls this then listens; tests call it and
 * drive it with supertest. Production behaviour is identical to the previous
 * inline bootstrap.
 */
export function createApp(): Express {
  const isProd = process.env.NODE_ENV === 'production'
  const app = express()

  // Trim default Express fingerprinting header.
  app.disable('x-powered-by')

  // Behind a reverse proxy (nginx/caddy on a VPS), the socket peer is the proxy,
  // so `req.ip` (and thus the rate limiter's key) collapses to one address for
  // every user — one attacker's bad-token flood would 429 the whole team. When
  // RESUME_TRUST_PROXY is set we trust X-Forwarded-* so the limiter keys on the
  // real client IP. Value: a hop count ("1"), a boolean ("true"), or an Express
  // preset ("loopback"). Left OFF by default (direct-bind dev/desktop) so a
  // spoofable header is never trusted unless the operator opts in.
  const trustProxy = process.env.RESUME_TRUST_PROXY?.trim()
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy)
  }

  // Content-Security-Policy for the SPA shell — the second line of defence
  // behind the escape-at-render discipline in viewFilter/exporter. Tuned to
  // the app's real resource usage:
  //   - script-src 'self'          → only the bundled Vite chunks (no inline JS
  //                                   in the built index.html).
  //   - style-src 'unsafe-inline'  → REQUIRED: every component ships an inline
  //                                   <style> block (the project's styling
  //                                   convention) + JSX style={{…}} attrs.
  //   - font-src 'self'            → fonts are self-hosted under /fonts/
  //                                   (no Google Fonts CDN since v0.3.1).
  //   - img-src 'self' data: blob: → brand assets, data: URIs, and the
  //                                   blob: URLs that URL.createObjectURL
  //                                   produces for image uploads (ImageField
  //                                   feeds the picked file through an
  //                                   <Image> element to measure + downscale
  //                                   it on a canvas — without blob: in
  //                                   img-src that <Image> can't load).
  //   - connect-src 'self'         → /api/* only (LibreTranslate is proxied
  //                                   server-side, so the browser never leaves
  //                                   this origin).
  //   - object/base/frame-ancestors locked down.
  // The live-preview <iframe srcdoc> inherits this policy; it stays renderable
  // because the intersection with buildViewHtml's own meta-CSP still permits
  // inline styles, data: images, and the same font origins.
  // Applied globally: inert on JSON API responses, active on the served shell.
  // (Dev's Vite-served shell isn't covered here — Vite needs a looser policy
  // for HMR — but dev isn't the hardening target; prod, served by Express, is.)
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ')

  // Conservative default security headers. We don't pull in helmet to keep the
  // dep tree small — these cover the realistic threats for a single-tenant
  // API + SPA.
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'interest-cohort=()')
    next()
  })

  // ── DNS-rebinding guard (desktop loopback build only) ─────────────────────
  // The desktop build runs auth-less on 127.0.0.1, relying on the browser's
  // origin model to keep other sites out. The Sec-Fetch-Site brake below stops
  // classic cross-site CSRF, but a DNS-rebinding attack defeats it: a page on
  // `attacker.example` that re-resolves its OWN hostname to 127.0.0.1 issues
  // requests the browser labels 'same-origin', so they slip past the brake AND
  // the cookie's SameSite. Those requests still carry the attacker's hostname in
  // the Host header, so pinning Host to a loopback name closes the hole — for
  // reads too (a rebind could otherwise exfiltrate the CV), hence it runs on
  // every method. Armed only on the desktop build; the VPS is served on a real
  // domain and reads Host legitimately (and requires auth regardless).
  if (isDesktop()) {
    app.use((req, res, next) => {
      if (!isLoopbackHost(req.headers.host)) {
        res.status(403).json({ error: 'Invalid host' })
        return
      }
      next()
    })
  }

  // ── Cross-site request guard (CSRF brake) ─────────────────────────────────
  // Browsers tag every request with `Sec-Fetch-Site`. Reject state-changing
  // requests a browser reports as cross-site. This matters most on the desktop
  // build, where the API runs auth-less on a loopback port: without it, a web
  // page the user happens to visit could fire a "simple" no-preflight POST at
  // 127.0.0.1 and trigger a side effect (e.g. POST /api/update/install →
  // download + swap + relaunch, or /api/backup/restore). Same-origin SPA
  // fetches send 'same-origin'; non-browser clients (curl, bearer-token API
  // consumers, tests) send no such header and are unaffected. Complements the
  // session cookie's SameSite=Strict, which only helps when auth is enabled.
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
  app.use((req, res, next) => {
    if (!SAFE_METHODS.has(req.method) && req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: 'Cross-site request blocked' })
      return
    }
    next()
  })

  // 2 MB is plenty for realistic resumes (typical payload is well under 200 KB).
  // The previous 50 MB ceiling made unauthenticated body parsing a DoS amplifier.
  app.use(express.json({ limit: '2mb' }))

  // ── Rate limiting (auth-gated API only) ───────────────────────────────────
  // `skipSuccessfulRequests` means only responses with status >= 400 count
  // against the window. That makes this a brute-force / failure-flood brake
  // (repeated 401s while guessing the bearer token, or hammering bad requests)
  // WITHOUT throttling a consultant's legitimate auto-save traffic, which is a
  // steady stream of 2xx PUTs (~1/s while editing) that never accumulates.
  // Runs BEFORE authMiddleware so 401s are counted. Env-tunable for ops/tests.
  const limitMax = Number(process.env.RESUME_RATE_LIMIT_MAX) || 50
  const limitWindowMs = Number(process.env.RESUME_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000
  const apiLimiter = rateLimit({
    windowMs: limitWindowMs,
    limit: limitMax,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => { res.status(429).json({ error: 'Too many requests' }) },
  })

  // A SECOND, success-inclusive limiter for the translation proxy only. The
  // main limiter deliberately skips 2xx responses (so auto-save isn't throttled)
  // — but a *successful* translate call can cost real money with a paid DeepL /
  // Google / Azure key, so a token holder (or a leaked token) could otherwise
  // run up the provider bill at wire speed. This caps calls per window
  // regardless of status. Default 60/min is far above human drafting pace.
  const translateMax = Number(process.env.RESUME_TRANSLATE_RATE_LIMIT_MAX) || 60
  const translateWindowMs = Number(process.env.RESUME_TRANSLATE_RATE_LIMIT_WINDOW_MS) || 60 * 1000
  const translateLimiter = rateLimit({
    windowMs: translateWindowMs,
    limit: translateMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => { res.status(429).json({ error: 'Too many translation requests' }) },
  })

  // ── Health check (no auth, no rate limit — frontend reachability probe) ────
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  // ── Auth (rate-limited, NOT auth-gated — this is how a browser logs in) ────
  // Exchanges the token for an HttpOnly session cookie so it never sits in
  // JS-readable storage. Rate-limited like the rest of the API so login
  // attempts (401s) are throttled against brute force.
  app.use('/api/auth', apiLimiter, authRouter)

  // ── Resume API (auth-gated) ──────────────────────────────────────────────
  app.use('/api/resumes', apiLimiter, authMiddleware, resumeRouter)

  // ── Translation proxy (auth-gated) — drafts via self-hosted LibreTranslate ─
  // Both limiters: apiLimiter brakes failure-floods (401s), translateLimiter
  // caps successful (billable) calls too.
  app.use('/api/translate', apiLimiter, translateLimiter, authMiddleware, translateRouter)

  // ── Store backup / sync (auth-gated) — desktop build's Drive-folder sync ───
  app.use('/api/backup', apiLimiter, authMiddleware, backupRouter)

  // ── In-app settings (auth-gated) — desktop build only; env-managed on VPS ──
  app.use('/api/settings', apiLimiter, authMiddleware, settingsRouter)

  // ── Auto-update (auth-gated) — desktop build only; reports unsupported on VPS ─
  app.use('/api/update', apiLimiter, authMiddleware, updateRouter)

  // ── JSON error handler for the API ─────────────────────────────────────────
  // Express's default handler renders an HTML error page; for /api that breaks
  // JSON clients (and a corrupt stored row surfacing as an HTML 500 is a poor
  // failure mode). Honour a status the error already carries (body-parser sets
  // 400 on malformed JSON); everything else is a real server fault → 500. Never
  // echo the underlying message (it could carry a path).
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const carried = (err as { status?: unknown; statusCode?: unknown })
    const status = typeof carried?.status === 'number' ? carried.status
      : typeof carried?.statusCode === 'number' ? carried.statusCode
      : 500
    if (status >= 500) console.error('[api] unhandled error:', err)
    if (res.headersSent) return
    res.status(status).json({ error: status < 500 ? 'Invalid request' : 'Internal server error' })
  })

  // ── Serve the built frontend ──────────────────────────────────────────────
  // VPS prod sets NODE_ENV=production and ships dist/ next to the server; the
  // desktop launcher instead points RESUME_CLIENT_DIR at the bundled dist/.
  // Serve static whenever we have a client dir to serve.
  const clientDir = process.env.RESUME_CLIENT_DIR?.trim() || (isProd ? path.join(__dirname, '..', 'dist') : null)
  if (clientDir) {
    app.use(express.static(clientDir))
    // SPA fallback — all non-API routes serve index.html
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'))
    })
  }

  return app
}
