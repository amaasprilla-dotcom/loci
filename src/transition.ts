// The bubble ↔ locus transition: a circle in the locus color grows from the
// bubble until it fills the screen, then the locus view fades in on top.
// Going back runs it in reverse. Skipped under prefers-reduced-motion.

import { h } from './dom'

const GROW_MS = 380
const SHRINK_MS = 320
const FADE_IN_MS = 180
const FADE_OUT_MS = 150
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

// Also false while the page is hidden: browsers may hold animations back then,
// which would leave navigation waiting, and nobody would see them anyway.
export function motionAllowed(): boolean {
  return document.visibilityState === 'visible' && !matchMedia('(prefers-reduced-motion: reduce)').matches
}

// A circle centered on the bubble, just big enough to cover the whole screen,
// and the scale at which it is exactly the bubble's size.
function coverCircle(bubble: HTMLElement, color: string): { el: HTMLElement; bubbleScale: number } {
  const rect = bubble.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const w = innerWidth
  const ht = innerHeight
  const R = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, ht - cy), Math.hypot(w - cx, ht - cy))
  const el = h('div', {
    class: 'cover-circle',
    style: { left: `${cx - R}px`, top: `${cy - R}px`, width: `${2 * R}px`, height: `${2 * R}px`, background: color },
  })
  document.body.append(el)
  return { el, bubbleScale: rect.width / 2 / R }
}

// Grows the bubble to fill the screen. Returns the full-screen circle; remove
// it once the next screen is showing.
export async function growFrom(bubble: HTMLElement, color: string): Promise<HTMLElement> {
  const { el, bubbleScale } = coverCircle(bubble, color)
  bubble.style.visibility = 'hidden'
  await el.animate([{ transform: `scale(${bubbleScale})` }, { transform: 'scale(1)' }], { duration: GROW_MS, easing: EASE }).finished
  bubble.style.visibility = ''
  return el
}

// The reverse: covers the screen in the locus color, then shrinks into the bubble.
// Call coverFor first, then remove the locus view, then shrinkInto.
export function coverFor(bubble: HTMLElement, color: string): { el: HTMLElement; bubbleScale: number } {
  bubble.style.visibility = 'hidden'
  return coverCircle(bubble, color)
}

export async function shrinkInto(bubble: HTMLElement, cover: { el: HTMLElement; bubbleScale: number }): Promise<void> {
  await cover.el.animate([{ transform: 'scale(1)' }, { transform: `scale(${cover.bubbleScale})` }], {
    duration: SHRINK_MS,
    easing: EASE,
    fill: 'forwards',
  }).finished
  bubble.style.visibility = ''
  cover.el.remove()
}

export function fadeIn(el: HTMLElement): Promise<unknown> {
  return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, easing: 'ease-out' }).finished
}

export function fadeOut(el: HTMLElement): Promise<unknown> {
  return el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_OUT_MS, easing: 'ease-in', fill: 'forwards' }).finished
}
