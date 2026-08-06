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
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('react-router-dom') || id.includes('react-dom') || id.includes('\\react\\') || id.includes('/react/')) {
              return 'vendor-react'
            }
            if (id.includes('@mui/x-data-grid')) return 'vendor-mui-grid'
            if (id.includes('@mui/x-date-pickers') || id.includes('@date-io')) return 'vendor-mui-dates'
            if (
              id.includes('@mui/material') ||
              id.includes('@mui/system') ||
              id.includes('@mui/icons-material') ||
              id.includes('@emotion')
            ) {
              return 'vendor-mui'
            }
            if (id.includes('recharts')) return 'vendor-recharts'
            if (id.includes('leaflet') || id.includes('react-leaflet')) return 'vendor-maps'
            if (id.includes('xlsx')) return 'vendor-xlsx'
            if (id.includes('dayjs')) return 'vendor-dayjs'
          }
        }
      }
    }
  }
})
