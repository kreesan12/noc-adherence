import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function normalizeBasePath(input = '/') {
  const raw = String(input || '/').trim()
  if (!raw || raw === '/') return '/'

  let value = raw
  if (!value.startsWith('/')) value = `/${value}`
  if (!value.endsWith('/')) value = `${value}/`
  return value
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devApiTarget = env.VITE_DEV_API_TARGET || 'http://localhost:4000'
  const devPort = Number(env.VITE_PORT || 5173)
  const appBasePath = command === 'serve'
    ? '/'
    : normalizeBasePath(env.VITE_APP_BASE_PATH || '/')

  return {
    base: appBasePath,
    plugins: [
      react({
        include: [/\.jsx?$/, /\.tsx?$/],
        jsxRuntime: 'automatic'
      })
    ],
    server: {
      host: '0.0.0.0',
      port: devPort,
      proxy: {
        '/api': {
          target: devApiTarget,
          changeOrigin: true
        },
        '/whatsapp': {
          target: devApiTarget,
          changeOrigin: true
        }
      }
    }
  }
})
