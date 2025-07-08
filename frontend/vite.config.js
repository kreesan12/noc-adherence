import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path  from 'path'

export default defineConfig({
  plugins: [ react({ include: [/\.jsx?$/, /\.tsx?$/] }) ],
  base: '/noc-adherence/',
  resolve: {
    alias: {
      'react-calendar-timeline/lib/Timeline.css': path.resolve(
        __dirname,
        'node_modules/react-calendar-timeline/lib/Timeline.css'
      )
    }
  },
  build: {
    rollupOptions: {
      external: ['react-calendar-timeline', 'moment']
    },
    commonjsOptions: {
      include: [/node_modules/]
    }
  },
  optimizeDeps: {
    exclude: ['react-calendar-timeline', 'moment']
  },
  assetsInclude: ['**/*.css']
})
