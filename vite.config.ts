import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative paths, so the built site works from any address or subfolder
  // (e.g. https://you.github.io/study-app/ or a Netlify URL).
  base: './',
})
