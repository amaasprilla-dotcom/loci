// Small signs that a tap did something (the Android app's feedback request): a short buzz
// on phones that can, alongside what the screens show (a tick filling in, a new row
// glowing once; style.css, "Feedback"). Desktop browsers ignore the buzz.

import { motionAllowed } from './transition'

export function buzz(ms = 10): void {
  try {
    navigator.vibrate?.(ms)
  } catch {
    // Some browsers refuse without a user gesture: nothing lost.
  }
}

// Waits for a short animation to be seen, or not at all when motion is off.
export function afterMotion(ms: number): Promise<void> {
  return motionAllowed() ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

// The row for a just-added item glows once and comes into view; if it's tucked away
// (a closed section), a toast says it was added instead. Some lists redraw a moment
// after the add, so it waits up to a second and a half for the row.
export function showAdded(itemId: string, fallback: () => void): void {
  const find = () => document.querySelector<HTMLElement>(`.task-row[data-item="${CSS.escape(itemId)}"]`)
  const glow = (row: HTMLElement) => {
    if (row.offsetParent === null) return fallback()
    row.classList.add('just-added')
    row.addEventListener('animationend', () => row.classList.remove('just-added'), { once: true })
    row.scrollIntoView({ block: 'nearest', behavior: motionAllowed() ? 'smooth' : 'auto' })
  }
  const now = find()
  if (now) return glow(now)
  const watch = new MutationObserver(() => {
    const row = find()
    if (!row) return
    done()
    glow(row)
  })
  const timer = setTimeout(() => {
    done()
    fallback()
  }, 1_500)
  const done = () => {
    watch.disconnect()
    clearTimeout(timer)
  }
  watch.observe(document.body, { childList: true, subtree: true })
}
