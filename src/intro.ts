// The opening: a white screen with four characters in the middle that keep changing
// (letters, numbers, signs) until, one by one from the left, each settles on its letter
// of "Loci". Then it fades away to show the app. Runs on every load.
// Under prefers-reduced-motion the word just shows and fades.

import { h } from './dom'

const WORD = 'Loci'
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=?/<>@$§¶∆Ωπ∑'
const TICK_MS = 55 // how often an unsettled character changes
const FIRST_SETTLE_MS = 520 // the first letter settles after this...
const SETTLE_GAP_MS = 260 // ...and each next one this much later
const HOLD_MS = 380 // the finished word stays this long
const FADE_MS = 520

const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]

// Shows the intro at once. `ready` is the app getting its first screen drawn underneath;
// the intro leaves when both it and the word are done.
export function playIntro(ready: Promise<unknown>): Promise<void> {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const cells = [...WORD].map((letter) => h('span', { class: 'intro-char' }, still ? letter : randomGlyph()))
  const el = h('div', { class: 'intro', 'aria-hidden': 'true' }, h('div', { class: 'intro-word' }, cells))
  document.body.append(el)

  const word = new Promise<void>((resolve) => {
    if (still) {
      setTimeout(resolve, HOLD_MS)
      return
    }
    const start = performance.now()
    const timer = setInterval(() => {
      const elapsed = performance.now() - start
      let settled = 0
      cells.forEach((cell, i) => {
        if (elapsed >= FIRST_SETTLE_MS + i * SETTLE_GAP_MS) {
          if (!cell.classList.contains('settled')) {
            cell.textContent = WORD[i]
            cell.classList.add('settled')
          }
          settled++
        } else {
          cell.textContent = randomGlyph()
        }
      })
      if (settled === cells.length) {
        clearInterval(timer)
        setTimeout(resolve, HOLD_MS)
      }
    }, TICK_MS)
  })

  // A failed start still lets the app (and its error) show.
  return Promise.all([word, ready.catch(() => {})]).then(async () => {
    const fade = el.animate(
      [
        { opacity: 1, filter: 'blur(0)' },
        { opacity: 0, filter: 'blur(6px)' },
      ],
      { duration: still ? 200 : FADE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    )
    // A hidden tab may hold the animation back: don't keep the app covered for it.
    await Promise.race([fade.finished.catch(() => {}), new Promise((r) => setTimeout(r, FADE_MS + 250))])
    el.remove()
  })
}
