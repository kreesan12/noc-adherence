import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react({
      // parse both .js/.jsx and .ts/.tsx as React code
      include: [/\.jsx?$/, /\.tsx?$/]
    })
  ],
  base: '/noc-adherence/',

   build: {
   rollupOptions: {
     // don’t try to bundle CJS-only packages––they’ll be loaded at runtime
     external: ['react-calendar-timeline', 'moment']
   }
 }
});
