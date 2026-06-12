import express, { type Express } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import rateLimit from 'express-rate-limit'
import { authMiddleware } from './auth.js'
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
  app.use('/api/translate', apiLimiter, authMiddleware, translateRouter)

  // ── Store backup / sync (auth-gated) — desktop build's Drive-folder sync ───
  app.use('/api/backup', apiLimiter, authMiddleware, backupRouter)

  // ── In-app settings (auth-gated) — desktop build only; env-managed on VPS ──
  app.use('/api/settings', apiLimiter, authMiddleware, settingsRouter)

  // ── Auto-update (auth-gated) — desktop build only; reports unsupported on VPS ─
  app.use('/api/update', apiLimiter, authMiddleware, updateRouter)

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
