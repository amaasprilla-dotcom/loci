// Long-press for buttons in lists (cards, tiles): hold 500ms without moving
// on touch, or right-click with a mouse. A normal tap still clicks.

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE = 8 // px; more than this is a scroll, not a press

export function onLongPress(node: HTMLElement, callback: () => void): void {
  let timer = 0
  let start: { x: number; y: number } | null = null
  let fired = false
  let pointerType = 'mouse'

  const cancel = () => {
    clearTimeout(timer)
    start = null
  }

  node.addEventListener('pointerdown', (e) => {
    pointerType = e.pointerType
    if (e.button !== 0) return
    fired = false
    start = { x: e.clientX, y: e.clientY }
    timer = window.setTimeout(() => {
      fired = true
      start = null
      navigator.vibrate?.(15)
      callback()
    }, LONG_PRESS_MS)
  })
  node.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) cancel()
  })
  node.addEventListener('pointerup', cancel)
  node.addEventListener('pointercancel', cancel) // the page started scrolling
  node.addEventListener('pointerleave', cancel)

  // The click that follows a long-press is not a tap.
  node.addEventListener(
    'click',
    (e) => {
      if (!fired) return
      fired = false
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true,
  )

  // Touch long-press is handled by the timer above, so only a mouse right-click
  // acts here. Either way, no browser menu.
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (pointerType === 'mouse' && !fired) callback()
  })
}
