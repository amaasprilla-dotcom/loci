# Assets and licenses

Every visual, font and sound in Echomathia, and where it comes from.
No third-party art, fonts or sounds are copied into this project.

## Fonts

Loaded from Google Fonts in `index.html` (not stored in this repository).

| Font | Used for | License |
| --- | --- | --- |
| [Inter](https://fonts.google.com/specimen/Inter) | All text | SIL Open Font License 1.1 |

Math is drawn by [KaTeX](https://katex.org) with its own bundled fonts (MIT license, from the `katex` npm package).

## Sounds

All sound effects (flip, play, correct, wrong, score tick, pack added) are **synthesized in code**
with the browser's Web Audio API, in `src/sound.ts`: short tones and filtered noise.
No audio files are used. They were written for this project.

## Images and designs

All original, made for this project with plain CSS or small SVG paths:

- **Card-type icons** (spark, prism, tiles): `src/components/SuitIcon.tsx`
- **Study cards, deck stack marks, the pack-added animation**: CSS in `src/cards.css` and `src/decks.css`
- **Brand mark and favicon** (a light-blue card over a black one): `public/favicon.svg`
  and the `.brand` style in `src/index.css`
- **Charts**: plain SVG drawn in `src/components/charts.tsx`
