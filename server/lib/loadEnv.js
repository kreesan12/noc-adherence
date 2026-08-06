import dotenv from 'dotenv'

const envPath = new URL('../.env', import.meta.url)
const envLocalPath = new URL('../.env.local', import.meta.url)

export function loadServerEnv() {
  dotenv.config({ path: envPath })
  dotenv.config({ path: envLocalPath, override: true })
}
