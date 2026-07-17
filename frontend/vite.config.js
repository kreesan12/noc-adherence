import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devApiTarget = env.VITE_DEV_API_TARGET || 'http://localhost:4000'
  const devPort = Number(env.VITE_PORT || 5173)

  return {
    base: command === 'serve' ? '/' : '/noc-adherence/',
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
