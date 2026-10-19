// The locus screen: a header tinted in the locus color (back button, name, tags)
// and a grid of element tiles. The + button adds an element of any registered type.

import { textColorOn } from '../colors'
import { h } from '../dom'
import { type ElementType, registry } from '../elements/registry'
import { iconNode } from '../elements/flashcards/type'
import { backIcon } from '../icons'
import { elementHash, go } from '../router'
import { button, deleteConfirmation, describeCounts, openSheet, sheetActions, submitButton } from '../sheet'
import { createElement, db, deleteElement, listElements, reorderElements, updateElement } from '../store/db'
import type { Locus, LocusElement } from '../types'
import { makeSortable } from './reorder'

export async function renderLocusView(locus: Locus, options: { onBack(): void }): Promise<HTMLElement> {
  const tags = (await db.tags.bulkGet(locus.tagIds)).filter((t) => t != null)
  const grid = h('div', { class: 'tile-grid' })
  let elements: LocusElement[] = []

  async function renderTiles() {
    elements = await listElements(locus.id)
    const now = Date.now()
    if (elements.length === 0) {
      grid.replaceChildren(h('p', { class: 'locus-empty' }, 'Nothing in this locus yet. Tap + to add a flashcard deck.'))
      return
    }
    grid.replaceChildren(...(await Promise.all(elements.map((el) => tile(el, now)))))
  }

  async function tile(el: LocusElement, now: number): Promise<HTMLElement> {
    const type = registry.get(el.type)
    const open = () => go(elementHash(el))
    return h(
      'div',
      {
        class: 'tile',
        'data-id': el.id,
        role: 'button',
        tabindex: 0,
        'aria-label': el.title,
        onclick: open,
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        },
      },
      // A type this version doesn't know (e.g. from a newer backup) still shows, by title.
      type ? await type.renderCard(el, now) : h('div', { class: 'tile-content' }, h('h3', { class: 'tile-title' }, el.title)),
    )
  }

  makeSortable(grid, {
    onReorder: (ids) => void reorderElements(ids),
    onMenu: (id) => {
      const el = elements.find((e) => e.id === id)
      if (!el) return
      void openTileMenu(el).then((changed) => {
        if (changed) void renderTiles()
      })
    },
  })

  async function onAdd() {
    const result = await openAddSheet()
    if (!result) return
    await createElement(locus.id, result.type.type, result.title, result.type.createDefault())
    await renderTiles()
  }

  const view = h(
    'div',
    { class: 'locus-view', style: { '--c': locus.color, '--fg': textColorOn(locus.color) } },
    h(
      'header',
      { class: 'locus-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: options.onBack }, backIcon()),
      h(
        'div',
        { class: 'locus-title' },
        h('h1', {}, locus.name),
        tags.length > 0 && h('div', { class: 'locus-tags' }, tags.map((t) => h('span', { class: 'tag' }, t.name))),
      ),
    ),
    h('main', { class: 'locus-body' }, grid),
    h('button', { class: 'fab', 'aria-label': 'Add to this locus', onclick: () => void onAdd() }, '+'),
  )
  await renderTiles()
  return view
}

// The + menu: pick a type, then name it.
function openAddSheet(): Promise<{ type: ElementType; title: string } | null> {
  return openSheet<{ type: ElementType; title: string }>('Add to locus', (api) => {
    let chosen: ElementType | null = null
    const titleInput = h('input', { class: 'input', type: 'text', maxlength: 80, 'aria-label': 'Title', oninput: () => sync() })
    const create = submitButton('Create')
    const sync = () => (create.disabled = titleInput.value.trim() === '')

    function nameStep(type: ElementType) {
      chosen = type
      titleInput.placeholder = type.type === 'flashcards' ? 'e.g. Spanish verbs' : ''
      sync()
      api.show(
        h('h2', {}, `New ${type.noun}`),
        h('label', { class: 'field-label' }, 'Title', titleInput),
        sheetActions(null, button('Cancel', () => api.close(null)), create),
      )
      titleInput.focus()
    }

    return {
      content: [
        h('h2', {}, 'Add to this locus'),
        h(
          'div',
          { class: 'type-options' },
          [...registry.values()].map((type) =>
            h(
              'button',
              { type: 'button', class: 'type-option', onclick: () => nameStep(type) },
              iconNode(type.icon),
              h('span', {}, h('strong', {}, type.label), h('span', { class: 'type-desc' }, type.description)),
            ),
          ),
        ),
        sheetActions(null, button('Cancel', () => api.close(null))),
      ],
      onSubmit: () => {
        const title = titleInput.value.trim()
        if (chosen && title) api.close({ type: chosen, title })
      },
    }
  })
}

// Long-press (or right-click) on a tile: rename or delete. Resolves true if something changed.
function openTileMenu(el: LocusElement): Promise<boolean | null> {
  return openSheet<boolean>('Edit element', (api) => {
    const titleInput = h('input', { class: 'input', type: 'text', maxlength: 80, 'aria-label': 'Title', oninput: () => sync() })
    titleInput.value = el.title
    const save = submitButton('Save')
    const sync = () => (save.disabled = titleInput.value.trim() === '')

    const form = [
      h('h2', {}, 'Rename'),
      h('label', { class: 'field-label' }, 'Title', titleInput),
      sheetActions(
        button('Delete', () => void askDelete(), 'danger-text'),
        button('Cancel', () => api.close(null)),
        save,
      ),
    ]

    async function askDelete() {
      const cards = await db.cards.where('elementId').equals(el.id).count()
      api.show(
        ...deleteConfirmation(
          `Delete “${el.title}”?`,
          cards > 0 ? `This also deletes its ${describeCounts([[cards, 'card', 'cards']])}.` : '',
          () => api.show(...form),
          async () => {
            await deleteElement(el.id)
            api.close(true)
          },
        ),
      )
    }

    sync()
    return {
      content: form,
      onSubmit: async () => {
        const title = titleInput.value.trim()
        if (!title) return
        await updateElement(el.id, { title })
        api.close(true)
      },
    }
  })
}
