// The tag chip bar on the home screen. Tapping a tag selects it (bubbles without
// it grey out); tapping it again clears the filter. One tag at a time for now.
// The choice is remembered on this device.

import { h } from '../dom'
import type { Tag } from '../types'

const STORAGE_KEY = 'loci.tagFilter'

function load(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function save(tagId: string | null) {
  try {
    if (tagId) localStorage.setItem(STORAGE_KEY, tagId)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private mode): the filter just won't be remembered.
  }
}

export interface TagFilter {
  el: HTMLElement
  render(tags: Tag[]): void
  selected(): string | null
}

export function createTagFilter(onChange: () => void): TagFilter {
  const el = h('div', { class: 'filter-bar', role: 'toolbar', 'aria-label': 'Filter by tag' })
  let selectedId = load()
  let current: Tag[] = []

  function render(tags: Tag[]) {
    current = tags
    // The selected tag was deleted (no locus uses it any more): drop the filter.
    if (selectedId && !tags.some((t) => t.id === selectedId)) {
      selectedId = null
      save(null)
    }
    el.replaceChildren(
      ...tags.map((t) =>
        h(
          'button',
          {
            type: 'button',
            class: 'chip',
            'aria-pressed': String(t.id === selectedId),
            onclick: () => {
              selectedId = selectedId === t.id ? null : t.id
              save(selectedId)
              render(current)
              onChange()
            },
          },
          t.name,
        ),
      ),
    )
    el.hidden = tags.length === 0
  }

  return { el, render, selected: () => selectedId }
}
