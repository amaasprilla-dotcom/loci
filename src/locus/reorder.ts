// Drag tiles in a grid to reorder them, plus long-press for a tile's menu.
//
// Mouse: press and move to drag; right-click (or hold still 500ms) for the menu.
// Touch: hold still 500ms first (so a swipe still scrolls the page), then move
// to drag, or let go without moving for the menu.
// Other tiles slide out of the way (FLIP animation).

const LONG_PRESS_MS = 500
const MOVE_THRESHOLD = 8 // px before a press counts as movement
const SETTLE_PX = 24 // after a swap, how far the pointer moves before another

interface Press {
  tile: HTMLElement
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  grabX: number // pointer position inside the tile, so it doesn't jump under the finger
  grabY: number
  timer: number
  armed: boolean // held long enough: moving drags, letting go opens the menu
  dragging: boolean
  startOrder: string
  passed: HTMLElement | null // the tile it last swapped with, while the pointer is still over it
  swappedAt: { x: number; y: number } | null // where the pointer was at the last swap
}

export function makeSortable(
  grid: HTMLElement,
  options: { onReorder(ids: string[]): void; onMenu(id: string): void },
): void {
  let press: Press | null = null
  let swallowClick = false // the click after a drag or a long-press isn't a tap

  const tiles = () => [...grid.querySelectorAll<HTMLElement>(':scope > .tile')]
  const order = () => tiles().map((t) => t.dataset.id!)

  // The tile's slot in the grid, from layout alone: transforms (the drag, the slide
  // of tiles making room, a hover lift) don't move it. Reading the box with the
  // transform taken off instead caught tiles mid-slide, so a tile could be swapped
  // back and forth while the others were still moving: the jitter.
  function slotOf(tile: HTMLElement): { left: number; top: number; right: number; bottom: number } {
    const g = grid.getBoundingClientRect() // the grid is the tiles' offsetParent (position: relative)
    const left = g.left + tile.offsetLeft
    const top = g.top + tile.offsetTop
    return { left, top, right: left + tile.offsetWidth, bottom: top + tile.offsetHeight }
  }

  function follow(e: PointerEvent) {
    const p = press!
    const slot = slotOf(p.tile)
    p.tile.style.transform = `translate(${e.clientX - p.grabX - slot.left}px, ${e.clientY - p.grabY - slot.top}px)`
  }

  // Moves the dragged tile to the slot under the pointer, sliding the others.
  // Tiles of different heights reshape the rows when they swap, which can leave the
  // pointer over another tile, or back over the one it just passed: swapping again
  // straight away traded places on every move (the jitter). So after a swap the
  // pointer has to move a little first, and the tile just passed waits until the
  // pointer leaves it.
  function maybeSwap(e: PointerEvent) {
    const p = press!
    if (p.swappedAt && Math.hypot(e.clientX - p.swappedAt.x, e.clientY - p.swappedAt.y) < SETTLE_PX) return
    const all = tiles()
    const under = (t: HTMLElement) => {
      const r = slotOf(t)
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    }
    if (p.passed && !under(p.passed)) p.passed = null
    const target = all.find((t) => t !== p.tile && t !== p.passed && under(t))
    if (!target) return
    p.passed = target
    p.swappedAt = { x: e.clientX, y: e.clientY }
    // Where each tile is drawn now (mid-slide, maybe), so the next slide starts there.
    const before = new Map(all.map((t) => [t, t.getBoundingClientRect()]))
    const from = all.indexOf(p.tile)
    const to = all.indexOf(target)
    grid.insertBefore(p.tile, to > from ? target.nextSibling : target)
    for (const t of all) {
      if (t === p.tile) continue
      const a = before.get(t)!
      const b = slotOf(t)
      if (a.left === b.left && a.top === b.top) continue
      t.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      })
    }
    follow(e)
  }

  function finish(e: PointerEvent | null) {
    const p = press
    if (!p) return
    clearTimeout(p.timer)
    press = null
    p.tile.classList.remove('armed')
    if (p.dragging) {
      swallowClick = true
      // Glide from where it was dropped into its slot.
      const from = p.tile.style.transform
      p.tile.style.transform = ''
      p.tile.classList.remove('dragging')
      if (from) p.tile.animate([{ transform: from }, { transform: 'none' }], { duration: 160, easing: 'ease-out' })
      if (order().join() !== p.startOrder) options.onReorder(order())
    } else if (p.armed && e?.type === 'pointerup') {
      swallowClick = true
      options.onMenu(p.tile.dataset.id!)
    }
  }

  grid.addEventListener('pointerdown', (e) => {
    swallowClick = false // a drop outside the grid gets no click; don't eat the next real one
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile')
    if (!tile || press || e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return // buttons inside a tile do their own thing
    const rect = tile.getBoundingClientRect()
    press = {
      tile,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      armed: false,
      dragging: false,
      startOrder: order().join(),
      passed: null,
      swappedAt: null,
      timer: window.setTimeout(() => {
        if (!press || press.dragging) return
        press.armed = true
        tile.classList.add('armed')
        navigator.vibrate?.(15)
      }, LONG_PRESS_MS),
    }
  })

  grid.addEventListener('pointermove', (e) => {
    const p = press
    if (!p || e.pointerId !== p.pointerId) return
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) <= MOVE_THRESHOLD) return
      if (p.pointerType !== 'mouse' && !p.armed) {
        // A swipe before the long-press: the page is scrolling, not a drag.
        clearTimeout(p.timer)
        press = null
        return
      }
      clearTimeout(p.timer)
      p.dragging = true
      p.tile.classList.remove('armed')
      p.tile.classList.add('dragging')
      p.tile.setPointerCapture(e.pointerId)
    }
    follow(e)
    maybeSwap(e)
  })

  grid.addEventListener('pointerup', (e) => press?.pointerId === e.pointerId && finish(e))
  grid.addEventListener('pointercancel', (e) => press?.pointerId === e.pointerId && finish(null))

  // Once a tile is armed or dragging, a touch must not scroll the page.
  grid.addEventListener(
    'touchmove',
    (e) => {
      if (press && (press.armed || press.dragging)) e.preventDefault()
    },
    { passive: false },
  )

  grid.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return
      swallowClick = false
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true,
  )

  grid.addEventListener('contextmenu', (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile')
    if (!tile) return
    e.preventDefault()
    // Touch long-press is handled by the timer; this is a mouse right-click.
    if (!press) options.onMenu(tile.dataset.id!)
  })
}
