// The tag chip bar on the home screen. Tapping a tag selects it (bubbles without
// it grey out); tapping it again clears the filter. One tag at a time for now.
// The choice is remembered on this device, and the Tasks screen follows it too.

import { h } from '../dom'
import type { Tag } from '../types'

const STORAGE_KEY = 'loci.tagFilter'

// Kept in memory; localStorage only remembers it between visits (it may be blocked).
let current: string | null | undefined

export function getTagFilter(): string | null {
  if (current === undefined) {
    try {
      current = localStorage.getItem(STORAGE_KEY)
    } catch {
      current = null
    }
  }
  return current
}

export function setTagFilter(tagId: string | null): void {
  current = tagId
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
  let selectedId = getTagFilter()
  let shownTags: Tag[] = []

  function render(tags: Tag[]) {
    shownTags = tags
    selectedId = getTagFilter() // the Tasks screen may have cleared it
    // The selected tag was deleted (no locus uses it any more): drop the filter.
    if (selectedId && !tags.some((t) => t.id === selectedId)) {
      selectedId = null
      setTagFilter(null)
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
              setTagFilter(selectedId)
              render(shownTags)
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
