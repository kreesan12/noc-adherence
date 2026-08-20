import { loadServerEnv } from './lib/loadEnv.js'
import { createApp } from './app.js'

loadServerEnv()

const app = createApp()
const PORT = process.env.PORT || 4000

app.listen(PORT, () => {
  console.log(`API - http://localhost:${PORT}`)
})
