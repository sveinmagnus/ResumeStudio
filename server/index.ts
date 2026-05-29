import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { authMiddleware } from './auth.js'
import resumeRouter from './routes/resume.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT      = parseInt(process.env.PORT ?? '3001', 10)
const IS_PROD   = process.env.NODE_ENV === 'production'

const app = express()

// Parse JSON bodies up to 50 MB (resume data can be large with projects)
app.use(express.json({ limit: '50mb' }))

// ── Health check (no auth — used by frontend to detect server) ─────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

// ── Resume API (auth-gated) ────────────────────────────────────────────────
app.use('/api/resume', authMiddleware, resumeRouter)

// ── In production: serve the built frontend ────────────────────────────────
if (IS_PROD) {
  const distDir = path.join(__dirname, '..', 'dist')
  app.use(express.static(distDir))
  // SPA fallback — all non-API routes serve index.html
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(PORT, () => {
  const mode = IS_PROD ? 'production' : 'development (API only)'
  console.log(`Resume Studio server [${mode}] → http://localhost:${PORT}`)
})
