import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANT:  base must match the repo name for GitHub Pages
export default defineConfig({
  plugins: [react()],
  base: '/noc-adherence/',      // ← ensures correct asset paths
});
