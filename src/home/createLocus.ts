// The bottom sheet for creating a locus: name and color.
// Tags join this sheet in milestone 4, editing and deleting with long-press.

import { PALETTE } from '../colors'
import { h } from '../dom'

export interface LocusDraft {
  name: string
  color: string
}

// Opens the sheet. Resolves with the draft, or null if the user cancels.
export function openCreateLocusSheet(suggestedColor: string): Promise<LocusDraft | null> {
  return new Promise((resolve) => {
    let color = suggestedColor

    const nameInput = h('input', {
      class: 'input',
      type: 'text',
      placeholder: 'e.g. Spanish, Thesis, Guitar',
      maxlength: 60,
      autocomplete: 'off',
      'aria-label': 'Name',
      oninput: () => syncSubmit(),
    })

    const swatches = PALETTE.map((hex) =>
      h('button', {
        type: 'button',
        class: 'swatch',
        style: { '--c': hex },
        'aria-label': `Color ${hex}`,
        'data-color': hex,
        onclick: () => pick(hex),
      }),
    )

    const customInput = h('input', {
      type: 'color',
      class: 'swatch-custom-input',
      value: color,
      'aria-label': 'Custom color',
      oninput: () => pick(customInput.value),
    })
    const custom = h('label', { class: 'swatch swatch-custom', title: 'Custom color' }, customInput)

    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create')

    const form = h(
      'form',
      {
        class: 'sheet',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'New locus',
        onsubmit: (e: Event) => {
          e.preventDefault()
          const name = nameInput.value.trim()
          if (name) close({ name, color })
        },
      },
      h('div', { class: 'sheet-handle' }),
      h('h2', {}, 'New locus'),
      h('label', { class: 'field-label' }, 'Name', nameInput),
      h('div', { class: 'field-label' }, 'Color', h('div', { class: 'swatches' }, swatches, custom)),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
        submit,
      ),
    )

    const backdrop = h('div', { class: 'backdrop', onclick: (e: Event) => e.target === backdrop && close(null) }, form)

    function pick(hex: string) {
      color = hex
      for (const s of swatches) s.classList.toggle('selected', s.dataset.color === hex)
      const isCustom = !PALETTE.includes(hex)
      custom.classList.toggle('selected', isCustom)
      if (isCustom) custom.style.setProperty('--c', hex)
    }

    function syncSubmit() {
      submit.disabled = nameInput.value.trim() === ''
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(null)
    }

    function close(result: LocusDraft | null) {
      document.removeEventListener('keydown', onKey)
      backdrop.remove()
      resolve(result)
    }

    pick(color)
    syncSubmit()
    document.addEventListener('keydown', onKey)
    document.body.append(backdrop)
    nameInput.focus()
  })
}
