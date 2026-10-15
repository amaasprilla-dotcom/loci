# Assets and licenses

Every visual, font and sound in the app, and where it comes from.
No third-party art, fonts or sounds are copied into this project.

## Fonts

Loaded from Google Fonts in `index.html` (not stored in this repository).

| Font | Used for | License |
| --- | --- | --- |
| [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) | Headings, scores, big buttons | SIL Open Font License 1.1 |
| [Atkinson Hyperlegible](https://fonts.google.com/specimen/Atkinson+Hyperlegible) | All reading text, card content | SIL Open Font License 1.1 |

Math is drawn by [KaTeX](https://katex.org) with its own bundled fonts (MIT license, from the `katex` npm package).

## Sounds

All sound effects (flip, play, correct, wrong, score tick, pack open) are **synthesized in code**
with the browser's Web Audio API, in `src/sound.ts`: short tones and filtered noise.
No audio files are used. They were written for this project.

## Images and designs

All original, made for this project with plain CSS or small SVG paths:

- **Card types' suit icons** (spark, prism, tiles): `src/components/SuitIcon.tsx`
- **Card backs** (Garnet stripes, Lagoon dots, Meadow chevrons, Amethyst diamonds,
  Sunrise rays, Midnight stars): CSS patterns in `src/decks.css`
- **Foil packs, deck stacks, playing cards, felt table**: CSS in `src/decks.css`,
  `src/cards.css` and `src/index.css`
- **Favicon** (two stacked cards with a check): `public/favicon.svg`

The card-game feel is inspired by roguelike deck-builders in general; no art, card designs,
layouts, logos, names, fonts or sounds from any specific game are used.
