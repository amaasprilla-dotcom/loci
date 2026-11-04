// A short message at the bottom of the screen that goes away by itself,
// e.g. "Deleted on another device". With an action (e.g. Undo), it stays a little
// longer and has a button for it.

import { announceChange } from './changes'
import { h } from './dom'

const SHOW_MS = 3500
const WITH_ACTION_MS = 6000

export interface ToastAction {
  label: string
  run(): void | Promise<void>
}

export function toast(message: string, action?: ToastAction): void {
  document.querySelector('.toast')?.remove()
  const el = h(
    'div',
    { class: 'toast', role: 'status' },
    h('span', {}, message),
    action &&
      h(
        'button',
        {
          type: 'button',
          class: 'toast-action',
          onclick: async () => {
            el.remove()
            await action.run()
          },
        },
        action.label,
      ),
  )
  document.body.append(el)
  setTimeout(() => el.remove(), action ? WITH_ACTION_MS : SHOW_MS)
}

// "Done: Call mum · Undo". Undoing redraws whatever screen is showing.
export function undoToast(message: string, undo: () => Promise<void>): void {
  toast(message, {
    label: 'Undo',
    run: async () => {
      await undo()
      announceChange()
    },
  })
}
