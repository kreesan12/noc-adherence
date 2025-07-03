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
});
