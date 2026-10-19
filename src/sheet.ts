// Bottom sheets: the one way this app asks for input or confirmation.
// openSheet handles the backdrop, Escape, closing and focus; the caller builds
// what goes inside and decides what the sheet resolves with.

import { h } from './dom'

export interface SheetApi<T> {
  close(result: T | null): void
  // Swap what the sheet shows, e.g. a form for its delete confirmation.
  show(...content: Node[]): void
}

export interface SheetSpec {
  content: Node[]
  onSubmit?(): void // Enter in a text field, or a submit button
  focus?: HTMLElement
}

export function openSheet<T>(label: string, build: (api: SheetApi<T>) => SheetSpec): Promise<T | null> {
  return new Promise((resolve) => {
    let onSubmit: (() => void) | undefined
    const body = h('div', { class: 'sheet-body' })
    const form = h(
      'form',
      {
        class: 'sheet',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': label,
        onsubmit: (e: Event) => {
          e.preventDefault()
          onSubmit?.()
        },
      },
      h('div', { class: 'sheet-handle' }),
      body,
    )
    const backdrop = h('div', { class: 'backdrop', onclick: (e: Event) => e.target === backdrop && close(null) }, form)

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(null)
    }

    function close(result: T | null) {
      document.removeEventListener('keydown', onKey)
      backdrop.remove()
      resolve(result)
    }

    const api: SheetApi<T> = {
      close,
      show: (...content) => body.replaceChildren(...content),
    }
    const spec = build(api)
    onSubmit = spec.onSubmit
    body.replaceChildren(...spec.content)
    document.addEventListener('keydown', onKey)
    document.body.append(backdrop)
    spec.focus?.focus()
  })
}

// The row of buttons at the bottom of a sheet. `start` sits on the left (e.g. Delete).
export function sheetActions(start: Node | false | null, ...end: (Node | false | null)[]): HTMLElement {
  return h('div', { class: 'sheet-actions' }, start, h('span', { class: 'spacer' }), ...end)
}

export function button(label: string, onclick: () => void, variant: '' | 'primary' | 'danger' | 'danger-text' = ''): HTMLButtonElement {
  return h('button', { type: 'button', class: variant ? `btn btn-${variant}` : 'btn', onclick }, label)
}

export function submitButton(label: string): HTMLButtonElement {
  return h('button', { type: 'submit', class: 'btn btn-primary' }, label)
}

// "Delete X?" with what else goes and a red Delete. Resolves true to delete.
export async function confirmDelete(title: string, detail: string): Promise<boolean> {
  const result = await openSheet<boolean>('Confirm delete', (api) => ({ content: deleteConfirmation(title, detail, () => api.close(false), () => api.close(true)) }))
  return result === true
}

// The content of a delete confirmation, for sheets that swap to it in place.
export function deleteConfirmation(title: string, detail: string, onKeep: () => void, onDelete: () => void): Node[] {
  return [
    h('h2', {}, title),
    h('p', { class: 'sheet-text' }, detail ? `${detail} ` : '', 'This can’t be undone.'),
    sheetActions(null, button('Keep it', onKeep), button('Delete', onDelete, 'danger')),
  ]
}

// "2 elements and 140 cards" — the parts that are not zero.
export function describeCounts(counts: [number, string, string][]): string {
  return counts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(' and ')
}
