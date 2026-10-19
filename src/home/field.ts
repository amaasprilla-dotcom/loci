// The bubble field on the home screen: one requestAnimationFrame loop runs the
// physics (physics.ts) and writes each bubble's transform. Pointer Events give
// mouse and touch one code path for drag and tap.

import { textColorOn } from '../colors'
import { h } from '../dom'
import type { Locus } from '../types'
import { type Body, clamp, clampInside, step, wobble } from './physics'

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
    x: clamp((width / 2 + Math.cos(angle) * dist) / width, 0, 1),
    y: clamp((height / 2 + Math.sin(angle) * dist) / height, 0, 1),
  }
}

const STEP_MS = 1000 / 60 // physics runs at 60 steps a second whatever the screen's refresh rate
const DRAG_THRESHOLD = 8 // px a press must move before it counts as a drag

export interface FieldOptions {
  onTap(locus: Locus): void
  // A bubble was dropped; x and y are its new home, normalized 0..1 of the field.
  onMove(locus: Locus, x: number, y: number): void
}

export interface Field {
  el: HTMLElement
  render(loci: Locus[]): void
  bubble(id: string): HTMLElement | undefined
  // Freeze the bubbles in place, e.g. while another screen covers the field.
  pause(): void
  resume(): void
  destroy(): void
}

interface Drag {
  pointerId: number
  startX: number // client px, to measure the drag threshold
  startY: number
  offsetX: number // bubble center minus pointer, so the bubble doesn't jump under the finger
  offsetY: number
  moved: boolean
}

export function createField(options: FieldOptions): Field {
  const el = h('div', { class: 'field' })
  const loci = new Map<string, Locus>()
  const bodies = new Map<string, Body>()
  const nodes = new Map<string, HTMLElement>()
  let list: Body[] = []
  let width = 0
  let height = 0
  let rendered = false

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

  function setHome(b: Body, locus: Locus) {
    b.hx = clamp(locus.x * width, b.r, width - b.r)
    b.hy = clamp(locus.y * height, b.r, height - b.r)
  }

  function measure() {
    const rect = el.getBoundingClientRect()
    const wasEmpty = width === 0 || height === 0
    width = rect.width
    height = rect.height
    for (const b of list) {
      setHome(b, loci.get(b.id)!)
      if (wasEmpty) {
        // First real size: start everyone at home instead of flying in from the corner.
        b.x = b.hx
        b.y = b.hy
      }
      clampInside(b, width, height)
    }
  }

  function toField(e: PointerEvent): { x: number; y: number } {
    const rect = el.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function createBubble(locus: Locus): HTMLElement {
    const node = h('div', { class: 'bubble', 'data-id': locus.id }, h('span', { class: 'bubble-name' }))
    let drag: Drag | null = null

    node.addEventListener('pointerdown', (e) => {
      if (drag || e.button !== 0) return
      const b = bodies.get(locus.id)!
      const p = toField(e)
      node.setPointerCapture(e.pointerId)
      drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, offsetX: b.x - p.x, offsetY: b.y - p.y, moved: false }
      b.held = true
      b.vx = 0
      b.vy = 0
    })

    node.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) <= DRAG_THRESHOLD) return
        drag.moved = true
        node.classList.add('dragging')
      }
      const b = bodies.get(locus.id)!
      const p = toField(e)
      b.x = p.x + drag.offsetX
      b.y = p.y + drag.offsetY
      clampInside(b, width, height)
    })

    // pointerup ends a tap or a drop; pointercancel (the browser took the gesture) only drops.
    const release = (e: PointerEvent, isTap: boolean) => {
      if (!drag || e.pointerId !== drag.pointerId) return
      const { moved } = drag
      drag = null
      node.classList.remove('dragging')
      const b = bodies.get(locus.id)
      if (!b) return
      b.held = false
      const current = loci.get(locus.id)!
      if (moved) {
        b.hx = b.x
        b.hy = b.y
        const x = b.x / width
        const y = b.y / height
        loci.set(current.id, { ...current, x, y })
        options.onMove(current, x, y)
      } else if (isTap) {
        options.onTap(current)
      }
    }
    node.addEventListener('pointerup', (e) => release(e, true))
    node.addEventListener('pointercancel', (e) => release(e, false))

    return node
  }

  function updateBubble(node: HTMLElement, locus: Locus) {
    node.title = locus.name
    node.style.setProperty('--c', locus.color)
    node.style.setProperty('--fg', textColorOn(locus.color))
    node.style.width = node.style.height = `${locus.radius * 2}px`
    node.querySelector('.bubble-name')!.textContent = locus.name
  }

  // Keeps each existing bubble where it is (and its motion); adds new ones, removes deleted ones.
  function render(next: Locus[]) {
    if (width === 0) measure()
    const ids = new Set(next.map((l) => l.id))
    for (const id of [...bodies.keys()]) {
      if (ids.has(id)) continue
      nodes.get(id)!.remove()
      nodes.delete(id)
      bodies.delete(id)
      loci.delete(id)
    }
    for (const locus of next) {
      loci.set(locus.id, locus)
      let node = nodes.get(locus.id)
      let b = bodies.get(locus.id)
      if (!node || !b) {
        node = createBubble(locus)
        if (rendered) {
          node.classList.add('appearing')
          node.addEventListener('animationend', () => node!.classList.remove('appearing'), { once: true })
        }
        nodes.set(locus.id, node)
        el.append(node)
        b = { id: locus.id, x: 0, y: 0, vx: 0, vy: 0, hx: 0, hy: 0, r: locus.radius, phase: Math.random() * Math.PI * 2, held: false }
        bodies.set(locus.id, b)
        setHome(b, locus)
        b.x = b.hx
        b.y = b.hy
      }
      b.r = locus.radius
      if (!b.held) setHome(b, locus)
      updateBubble(node, locus)
    }
    list = [...bodies.values()]
    rendered = true
    draw(performance.now())
  }

  function draw(t: number) {
    const still = reducedMotion.matches
    for (const b of list) {
      const s = still ? 0 : wobble(b, t) // keeps wobbling while held, so pressing doesn't snap it round
      nodes.get(b.id)!.style.transform = `translate(${b.x - b.r}px, ${b.y - b.r}px) scale(${1 + s}, ${1 - s})`
    }
  }

  let raf = 0
  let paused = false
  let last = 0
  let pending = 0 // ms of physics not yet stepped

  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    // Cap the catch-up after a long pause so bubbles don't lurch.
    pending = Math.min(pending + now - last, STEP_MS * 4)
    last = now
    const drift = !reducedMotion.matches
    while (pending >= STEP_MS) {
      step(list, width, height, now - pending, drift)
      pending -= STEP_MS
    }
    draw(now)
  }

  function start() {
    if (raf || paused || document.visibilityState === 'hidden') return
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }

  function stop() {
    cancelAnimationFrame(raf)
    raf = 0
  }

  // Save battery: no animation while the app is in the background.
  const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start())
  document.addEventListener('visibilitychange', onVisibility)

  const resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(el)
  start()

  return {
    el,
    render,
    bubble: (id) => nodes.get(id),
    pause() {
      paused = true
      stop()
    },
    resume() {
      paused = false
      start()
    },
    destroy() {
      stop()
      resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
