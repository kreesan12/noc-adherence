// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ---------------------------------------------------------------------------
//  ▸  jsxRuntime: 'automatic'  ➜ compiler injects the React import for you
//  ▸  include regexp still limits Babel to .jsx / .tsx files
//  ▸  base remains unchanged for GitHub-Pages style hosting
// ---------------------------------------------------------------------------
export default defineConfig({
  base: '/noc-adherence/',
  plugins: [
    react({
      include: [/\.jsx?$/, /\.tsx?$/],
      jsxRuntime: 'automatic'
      // (nothing else is required – @vitejs/plugin-react already wires
      //  up @babel/preset-react for you using the options above)
    })
  ]
})
