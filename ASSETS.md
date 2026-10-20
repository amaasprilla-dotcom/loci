# Assets and licenses

Every visual and font in Loci, and where it comes from.
No third-party art or fonts are copied into this project by hand.

## Fonts

Bundled from the `@fontsource-variable/inter` npm package, so the app needs no font service
and works offline.

| Font | Used for | License |
| --- | --- | --- |
| [Inter](https://rsms.me/inter/) | All text | SIL Open Font License 1.1 |

## Images and designs

All original, made for this project with plain CSS or small SVG paths:

- **Bubbles and the New locus sheet**: CSS in `src/style.css`
- **Favicon** (three bubbles): `public/favicon.svg`
- **App icons** (`public/pwa-*.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`,
  `favicon.ico`): generated from `public/favicon.svg` by `npm run icons`
  (`@vite-pwa/assets-generator`, MIT)
