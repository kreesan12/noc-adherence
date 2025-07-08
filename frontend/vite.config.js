// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react({
      include: [/\.jsx?$/, /\.tsx?$/]
    })
  ],
  base: '/noc-adherence/',
  build: {
    rollupOptions: {
      // keep these out of your bundle
      external: ['react-calendar-timeline', 'moment']
    }
  },
  optimizeDeps: {
    // don’t pre-bundle these during dev
    exclude: ['react-calendar-timeline', 'moment']
  }
})
