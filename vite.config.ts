import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths, so the built site works from any address or subfolder
  // (e.g. https://you.github.io/loci/ or a Netlify URL).
  base: './',
  build: {
    // The math editor (MathLive, ~790 KB) and the note editor load only when a
    // notebook is opened; the main bundle stays far below this.
    chunkSizeWarningLimit: 900,
  },
  plugins: [
    // Makes the app installable (manifest) and work offline (service worker
    // that keeps a copy of every file). New versions install themselves.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Loci',
        short_name: 'Loci',
        description: 'Your projects as bubbles. Flashcards inside, with spaced repetition.',
        display: 'standalone',
        start_url: './',
        scope: './',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything the app needs, fonts included, so it opens with no connection.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // The sync API is never answered from the offline copy.
        navigateFallbackDenylist: [/\/api\//],
      },
    }),
  ],
})
