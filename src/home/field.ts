// The bubble field on the home screen.
// Milestone 1 draws each locus at its saved home position. The physics loop
// (drift, wobble, separation, drag) arrives in milestone 2.

import { textColorOn } from '../colors'
import { h } from '../dom'
import type { Locus } from '../types'

// Where the n-th new locus goes when it has no saved position: a loose
// sunflower spiral out from the center, spaced so default-size bubbles don't touch.
// The first sits in the middle; the rest start a ring out, which keeps every pair
// at least 104px apart (two 48px bubbles plus the 6px gap need 102).
export function spiralPoint(index: number, width: number, height: number): { x: number; y: number } {
  const GOLDEN_ANGLE = 2.39996
  const SPACING = 66 // px
  const angle = index * GOLDEN_ANGLE
  const dist = index === 0 ? 0 : SPACING * Math.sqrt(index + 1.5)
  return {
    x: clamp01((width / 2 + Math.cos(angle) * dist) / width),
    y: clamp01((height / 2 + Math.sin(angle) * dist) / height),
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function createField(): { el: HTMLElement; render(loci: Locus[]): void } {
  const el = h('div', { class: 'field' })
  let current: Locus[] = []

  function layout() {
    const { width, height } = el.getBoundingClientRect()
    for (const locus of current) {
      const bubble = el.querySelector<HTMLElement>(`[data-id="${locus.id}"]`)
      if (!bubble) continue
      const r = locus.radius
      // Keep the whole bubble inside the field.
      const x = Math.min(Math.max(locus.x * width, r), width - r)
      const y = Math.min(Math.max(locus.y * height, r), height - r)
      bubble.style.transform = `translate(${x - r}px, ${y - r}px)`
    }
  }

  function render(loci: Locus[]) {
    current = loci
    el.replaceChildren(
      ...loci.map((locus) =>
        h(
          'div',
          {
            class: 'bubble',
            'data-id': locus.id,
            title: locus.name,
            style: {
              '--c': locus.color,
              '--fg': textColorOn(locus.color),
              width: `${locus.radius * 2}px`,
              height: `${locus.radius * 2}px`,
            },
          },
          h('span', { class: 'bubble-name' }, locus.name),
        ),
      ),
    )
    layout()
  }

  new ResizeObserver(layout).observe(el)
  return { el, render }
}
