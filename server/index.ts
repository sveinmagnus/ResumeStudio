import { createApp } from './app.js'

const PORT    = parseInt(process.env.PORT ?? '3001', 10)
const IS_PROD = process.env.NODE_ENV === 'production'

const app = createApp()

app.listen(PORT, () => {
  const mode = IS_PROD ? 'production' : 'development (API only)'
  console.log(`Resume Studio server [${mode}] → http://localhost:${PORT}`)
})
