// The bottom sheet for creating or editing a locus: name, color and tags.
// In edit mode it also offers Delete, with a confirmation step.

import { PALETTE } from '../colors'
import { h } from '../dom'
import { button, deleteConfirmation, describeCounts, openSheet, sheetActions, submitButton } from '../sheet'
import { DEFAULT_STUDY_DIFFICULTY, DEFAULT_STUDY_IMPORTANCE, levelPicker } from '../levels'
import { DEFAULT_RETENTION } from '../elements/flashcards/srs'
import { linkedItemsSection } from '../linkedItems'
import { formatNumber } from '../locale'
import { countLocusContents, tagKey } from '../store/db'
import type { Level, Locus, Tag } from '../types'

export interface LocusDraft {
  name: string
  color: string
  tagIds: string[] // existing tags
  newTags: string[] // names of tags to create on save
  studyImportance: Level
  studyDifficulty: Level
  retention: number
}

export type LocusSheetResult = { action: 'save'; draft: LocusDraft } | { action: 'delete' }

const MAX_TAG_LENGTH = 30

// Opens the sheet. Resolves with what the user chose, or null if they cancelled.
export function openLocusSheet(options: { locus?: Locus; tags: Tag[]; suggestedColor: string }): Promise<LocusSheetResult | null> {
  const { locus, tags } = options
  const editing = locus != null

  return openSheet<LocusSheetResult>(editing ? 'Edit locus' : 'New locus', (api) => {
    let color = locus?.color ?? options.suggestedColor
    const selected = new Set(locus?.tagIds ?? [])
    const newTags: string[] = []
    const importance = levelPicker('importance', locus?.studyImportance ?? DEFAULT_STUDY_IMPORTANCE)
    const difficulty = levelPicker('difficulty', locus?.studyDifficulty ?? DEFAULT_STUDY_DIFFICULTY)
    const retention = retentionSlider(locus?.retention ?? DEFAULT_RETENTION)

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

    function chip(label: string, pressed: boolean, onclick: () => void) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), onclick }, label)
    }

    function renderChips() {
      chips.replaceChildren(
        ...tags.map((t) =>
          chip(t.name, selected.has(t.id), () => {
            if (selected.has(t.id)) selected.delete(t.id)
            else selected.add(t.id)
            renderChips()
          }),
        ),
        // New tags show as selected; tapping one drops it.
        ...newTags.map((name, i) =>
          chip(name, true, () => {
            newTags.splice(i, 1)
            renderChips()
          }),
        ),
      )
      chips.hidden = chips.childElementCount === 0
    }

    // ----- Form -----

    const submit = submitButton(editing ? 'Save' : 'Create')
    function syncSubmit() {
      submit.disabled = nameInput.value.trim() === ''
    }

    const form = [
      h('h2', {}, editing ? 'Edit locus' : 'New locus'),
      h('label', { class: 'field-label' }, 'Name', nameInput),
      h('div', { class: 'field-label' }, 'Color', h('div', { class: 'swatches' }, swatches, custom)),
      h('div', { class: 'field-label' }, 'Tags', chips, tagInput),
      h(
        'div',
        { class: 'field-label' },
        'Study priority',
        h('span', { class: 'field-hint' }, 'How reviews due here rank on the Tasks screen.'),
        h('div', { class: 'level-row' }, h('span', { class: 'level-name' }, 'Importance'), importance.el),
        h('div', { class: 'level-row' }, h('span', { class: 'level-name' }, 'Difficulty'), difficulty.el),
      ),
      retention.el,
      editing && linkedItemsSection({ type: 'locus', id: locus.id }, () => api.close(null)),
      sheetActions(
        editing && button('Delete', () => void askDelete(), 'danger-text'),
        button('Cancel', () => api.close(null)),
        submit,
      ),
    ]

    async function askDelete() {
      const { elements, cards, notes } = await countLocusContents(locus!.id)
      const contents = describeCounts([
        [elements, 'element', 'elements'],
        [cards, 'card', 'cards'],
        [notes, 'note', 'notes'],
      ])
      api.show(
        ...deleteConfirmation(
          `Delete “${locus!.name}”?`,
          contents ? `This also deletes its ${contents}.` : '',
          () => api.show(...form),
          () => api.close({ action: 'delete' }),
        ),
      )
    }

    pick(color)
    renderChips()
    syncSubmit()

    return {
      content: form,
      onSubmit: () => {
        const name = nameInput.value.trim()
        if (!name) return
        addTag(tagInput.value) // a tag typed but not yet added with Enter still counts
        api.close({ action: 'save', draft: { name, color, tagIds: [...selected], newTags: [...newTags], studyImportance: importance.value(), studyDifficulty: difficulty.value(), retention: retention.value() } })
      },
      // Editing: don't pop the phone keyboard over the sheet.
      focus: editing ? undefined : nameInput,
    }
  })
}

// Desired retention (SPEC-v2.md, "Scheduling: FSRS"): how likely you want to be to
// remember a card when it comes up. 80–95%; higher means more frequent reviews.
function retentionSlider(initial: number): { el: HTMLElement; value(): number } {
  const input = h('input', { type: 'range', min: 80, max: 95, step: 1, class: 'range', 'aria-label': 'Desired retention' })
  input.value = String(Math.round(initial * 100))
  const shown = h('span', { class: 'range-value' })
  const show = () => (shown.textContent = formatNumber(Number(input.value) / 100, { style: 'percent' }))
  input.addEventListener('input', show)
  show()
  return {
    el: h(
      'div',
      { class: 'field-label' },
      h('span', { class: 'range-head' }, 'Remembering target', shown),
      h('span', { class: 'field-hint' }, 'How sure you want to be of remembering a card when it comes up. Higher means more reviews.'),
      input,
    ),
    value: () => Number(input.value) / 100,
  }
}
