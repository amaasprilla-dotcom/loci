// The bottom sheet for creating or editing a locus: name, color and tags.
// In edit mode it also offers Delete, with a confirmation step.

import { PALETTE } from '../colors'
import { h } from '../dom'
import { countLocusContents, tagKey } from '../store/db'
import type { Locus, Tag } from '../types'

export interface LocusDraft {
  name: string
  color: string
  tagIds: string[] // existing tags
  newTags: string[] // names of tags to create on save
}

export type LocusSheetResult = { action: 'save'; draft: LocusDraft } | { action: 'delete' } | null

const MAX_TAG_LENGTH = 30

// Opens the sheet. Resolves with what the user chose, or null if they cancelled.
export function openLocusSheet(options: { locus?: Locus; tags: Tag[]; suggestedColor: string }): Promise<LocusSheetResult> {
  const { locus, tags } = options
  const editing = locus != null

  return new Promise((resolve) => {
    let color = locus?.color ?? options.suggestedColor
    const selected = new Set(locus?.tagIds ?? [])
    const newTags: string[] = []

    const nameInput = h('input', {
      class: 'input',
      type: 'text',
      placeholder: 'e.g. Spanish, Thesis, Guitar',
      maxlength: 60,
      autocomplete: 'off',
      'aria-label': 'Name',
      oninput: () => syncSubmit(),
    })
    nameInput.value = locus?.name ?? ''

    // ----- Color -----

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

    function pick(hex: string) {
      color = hex
      for (const s of swatches) s.classList.toggle('selected', s.dataset.color === hex)
      const isCustom = !PALETTE.includes(hex)
      custom.classList.toggle('selected', isCustom)
      if (isCustom) custom.style.setProperty('--c', hex)
    }

    // ----- Tags -----

    const chips = h('div', { class: 'chips' })
    const tagInput = h('input', {
      class: 'input',
      type: 'text',
      placeholder: 'Add a tag',
      maxlength: MAX_TAG_LENGTH,
      autocomplete: 'off',
      enterkeyhint: 'done',
      'aria-label': 'New tag',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== 'Enter') return
        e.preventDefault() // Enter here adds a tag; it doesn't submit the sheet
        addTag(tagInput.value)
        tagInput.value = ''
      },
    })

    // Typing a name that already exists (in any case) selects that tag instead of making a second one.
    function addTag(raw: string) {
      const name = raw.trim().slice(0, MAX_TAG_LENGTH)
      if (!name) return
      const key = tagKey(name)
      const existing = tags.find((t) => t.key === key)
      if (existing) selected.add(existing.id)
      else if (!newTags.some((n) => tagKey(n) === key)) newTags.push(name)
      renderChips()
    }

    function renderChips() {
      chips.replaceChildren(
        ...tags.map((t) =>
          h(
            'button',
            {
              type: 'button',
              class: 'chip',
              'aria-pressed': String(selected.has(t.id)),
              onclick: () => {
                if (selected.has(t.id)) selected.delete(t.id)
                else selected.add(t.id)
                renderChips()
              },
            },
            t.name,
          ),
        ),
        // New tags show as selected; tapping one drops it.
        ...newTags.map((name, i) =>
          h(
            'button',
            {
              type: 'button',
              class: 'chip',
              'aria-pressed': 'true',
              onclick: () => {
                newTags.splice(i, 1)
                renderChips()
              },
            },
            name,
          ),
        ),
      )
      chips.hidden = chips.childElementCount === 0
    }

    // ----- Form -----

    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, editing ? 'Save' : 'Create')

    const formBody = h(
      'div',
      { class: 'sheet-body' },
      h('h2', {}, editing ? 'Edit locus' : 'New locus'),
      h('label', { class: 'field-label' }, 'Name', nameInput),
      h('div', { class: 'field-label' }, 'Color', h('div', { class: 'swatches' }, swatches, custom)),
      h('div', { class: 'field-label' }, 'Tags', chips, tagInput),
      h(
        'div',
        { class: 'sheet-actions' },
        editing && h('button', { type: 'button', class: 'btn btn-danger-text', onclick: () => void confirmDelete() }, 'Delete'),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
        submit,
      ),
    )

    const form = h(
      'form',
      {
        class: 'sheet',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': editing ? 'Edit locus' : 'New locus',
        onsubmit: (e: Event) => {
          e.preventDefault()
          const name = nameInput.value.trim()
          if (!name) return
          addTag(tagInput.value) // a tag typed but not yet added with Enter still counts
          close({ action: 'save', draft: { name, color, tagIds: [...selected], newTags: [...newTags] } })
        },
      },
      h('div', { class: 'sheet-handle' }),
      formBody,
    )

    async function confirmDelete() {
      const { elements, cards } = await countLocusContents(locus!.id)
      const parts = [
        elements > 0 && `${elements} ${elements === 1 ? 'element' : 'elements'}`,
        cards > 0 && `${cards} ${cards === 1 ? 'card' : 'cards'}`,
      ].filter(Boolean)
      const confirmBody = h(
        'div',
        { class: 'sheet-body' },
        h('h2', {}, `Delete “${locus!.name}”?`),
        h(
          'p',
          { class: 'sheet-text' },
          parts.length > 0 ? `This also deletes its ${parts.join(' and ')}. ` : '',
          'This can’t be undone.',
        ),
        h(
          'div',
          { class: 'sheet-actions' },
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn', onclick: () => confirmBody.replaceWith(formBody) }, 'Keep it'),
          h('button', { type: 'button', class: 'btn btn-danger', onclick: () => close({ action: 'delete' }) }, 'Delete'),
        ),
      )
      formBody.replaceWith(confirmBody)
    }

    const backdrop = h('div', { class: 'backdrop', onclick: (e: Event) => e.target === backdrop && close(null) }, form)

    function syncSubmit() {
      submit.disabled = nameInput.value.trim() === ''
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(null)
    }

    function close(result: LocusSheetResult) {
      document.removeEventListener('keydown', onKey)
      backdrop.remove()
      resolve(result)
    }

    pick(color)
    renderChips()
    syncSubmit()
    document.addEventListener('keydown', onKey)
    document.body.append(backdrop)
    if (!editing) nameInput.focus() // editing: don't pop the phone keyboard over the sheet
  })
}
