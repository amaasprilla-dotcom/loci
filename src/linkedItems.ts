// The Linked items section (SPEC-v2.md, "Links"): in an item's sheet, everything
// linked to it in either direction, with tap-through, unlink, and "Link to…".

import { h } from './dom'
import { closeIcon } from './icons'
import { describeItem, type ItemInfo, searchItems } from './items'
import { button, openSheet, sheetActions } from './sheet'
import { addLink, type LinkEnd, linksOf, removeLink } from './store/links'
import type { ItemRef } from './types'

// How a link reads from this end. "related" just names the other item's kind.
function relation(end: LinkEnd, info: ItemInfo): string {
  const { kind } = end.link
  if (kind === 'contributes') return end.direction === 'out' ? 'Counts toward' : 'Counted by'
  if (kind === 'after') return end.direction === 'out' ? 'Waits for' : 'Then'
  if (kind === 'scope') return end.direction === 'out' ? 'Covered by exam' : 'Covers'
  return info.kind
}

// `leave` closes the sheet this sits in, before tapping through to another item.
export function linkedItemsSection(item: ItemRef, leave: () => void): HTMLElement {
  const list = h('div', { class: 'linked-list' })

  async function render() {
    const ends = await linksOf(item)
    const rows = (await Promise.all(ends.map(async (end) => ({ end, info: await describeItem(end.other) })))).filter(
      (r): r is { end: LinkEnd; info: ItemInfo } => r.info != null,
    )
    list.replaceChildren(
      ...(rows.length === 0
        ? [h('p', { class: 'field-hint' }, 'Nothing linked yet.')]
        : rows.map(({ end, info }) =>
            h(
              'div',
              { class: 'linked-row', style: { '--c': info.color } },
              h(
                'button',
                {
                  type: 'button',
                  class: 'linked-main',
                  onclick: () => {
                    leave()
                    info.open()
                  },
                },
                h('span', { class: 'dot' }),
                h(
                  'span',
                  { class: 'linked-text' },
                  h('span', { class: 'linked-kind' }, relation(end, info)),
                  h('span', { class: 'linked-title' }, info.title),
                  info.context && h('span', { class: 'linked-context' }, info.context),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'icon-btn linked-remove',
                  'aria-label': `Unlink ${info.title}`,
                  onclick: async () => {
                    await removeLink(end.link.id)
                    await render()
                  },
                },
                closeIcon(),
              ),
            ),
          )),
    )
  }

  async function linkTo() {
    const already = (await linksOf(item)).map((e) => e.other)
    const picked = await pickItem([item, ...already])
    if (!picked) return
    await addLink(item, picked, 'related')
    await render()
  }

  void render()
  return h(
    'div',
    { class: 'field-label' },
    'Linked items',
    list,
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => void linkTo() }, 'Link to…'),
  )
}

// Search for any item to link to. Resolves with its ref, or null.
export function pickItem(exclude: ItemRef[]): Promise<ItemRef | null> {
  return openSheet<ItemRef>('Link to', (api) => {
    const results = h('div', { class: 'linked-list picker-results' })
    const search = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Search loci, decks, cards and notes',
      'aria-label': 'Search',
      oninput: () => void show(),
    })

    let latest = 0
    async function show() {
      const ticket = ++latest
      const found = await searchItems(search.value, exclude)
      if (ticket !== latest) return // a newer search has started
      results.replaceChildren(
        ...(found.length === 0
          ? [h('p', { class: 'field-hint' }, search.value.trim() ? 'Nothing matches.' : 'Type to search cards and notes too.')]
          : found.map((info) =>
              h(
                'div',
                { class: 'linked-row', style: { '--c': info.color } },
                h(
                  'button',
                  { type: 'button', class: 'linked-main', onclick: () => api.close(info.ref) },
                  h('span', { class: 'dot' }),
                  h(
                    'span',
                    { class: 'linked-text' },
                    h('span', { class: 'linked-kind' }, info.kind),
                    h('span', { class: 'linked-title' }, info.title),
                    info.context && h('span', { class: 'linked-context' }, info.context),
                  ),
                ),
              ),
            )),
      )
    }
    void show()

    return {
      content: [h('h2', {}, 'Link to…'), search, results, sheetActions(null, button('Cancel', () => api.close(null)))],
      focus: search,
    }
  })
}
