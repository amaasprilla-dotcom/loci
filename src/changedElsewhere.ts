// The bar an editor shows when what it edits changed on another device
// (SPEC-v4-sync.md, "Everywhere else"). The editor keeps what the user has, and
// saving makes it the newest version; "Show their version" swaps in the other
// device's, and Undo (where the editor can offer it) swaps back.

import { h } from './dom'

export interface ChangedElsewhereBar {
  el: HTMLElement
  show(): void
}

export function changedElsewhereBar(options: { showTheirs(): Promise<void> | void; undo?(): void; note?: string }): ChangedElsewhereBar {
  const el = h('div', { class: 'changed-elsewhere', role: 'status', hidden: true })

  function offerTheirs() {
    el.replaceChildren(
      h('span', {}, 'Changed on another device.', options.note ? ` ${options.note}` : ''),
      h(
        'button',
        {
          type: 'button',
          class: 'link-btn',
          onclick: async () => {
            await options.showTheirs()
            if (options.undo) offerUndo()
            else el.hidden = true
          },
        },
        'Show their version',
      ),
    )
    el.hidden = false
  }

  function offerUndo() {
    el.replaceChildren(
      h('span', {}, 'Showing the other device’s version.'),
      h(
        'button',
        {
          type: 'button',
          class: 'link-btn',
          onclick: () => {
            options.undo!()
            el.hidden = true
          },
        },
        'Undo',
      ),
    )
  }

  return { el, show: offerTheirs }
}
