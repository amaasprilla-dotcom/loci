// App icons for install (PNG sizes and a maskable icon for Android), made from
// public/favicon.svg. Regenerate after changing the favicon: npm run icons
import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset,
  images: ['public/favicon.svg'],
})
