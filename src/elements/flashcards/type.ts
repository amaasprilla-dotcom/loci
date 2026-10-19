// The Flashcards element type: a deck of front/back cards with spaced repetition.

import { h } from '../../dom'
import { db } from '../../store/db'
import { formatIn } from '../../time'
import type { LocusElement } from '../../types'
import type { ElementType, Task } from '../registry'
import { renderDeckScreen } from './editor'
import { DEFAULT_FLASHCARDS_DATA, deckStats, type FlashcardsData, isNew, listCards } from './store'

const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3.5" width="13" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 7.5v10A3 3 0 0 0 7 20.5h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'

export const flashcardsType: ElementType<FlashcardsData> = {
  type: 'flashcards',
  label: 'Flashcards',
  noun: 'flashcard deck',
  description: 'A deck of cards with spaced repetition',
  icon: ICON,

  createDefault: () => ({ ...DEFAULT_FLASHCARDS_DATA }),

  async renderCard(el, now) {
    const stats = deckStats(await listCards(el.id), now)
    const status =
      stats.total === 0
        ? h('span', { class: 'tile-quiet' }, 'No cards yet')
        : stats.due > 0 || stats.fresh > 0
          ? [stats.due > 0 && h('span', { class: 'pill pill-due' }, `${stats.due} due`), stats.fresh > 0 && h('span', { class: 'pill' }, `${stats.fresh} new`)]
          : h('span', { class: 'tile-quiet' }, stats.nextDue != null ? `Next ${formatIn(stats.nextDue - now)}` : 'All caught up')
    return h(
      'div',
      { class: 'tile-content' },
      h('div', { class: 'tile-head' }, iconNode(ICON), h('span', { class: 'tile-kind' }, 'Flashcards')),
      h('h3', { class: 'tile-title' }, el.title),
      h('p', { class: 'tile-meta' }, `${stats.total} ${stats.total === 1 ? 'card' : 'cards'}`),
      h('div', { class: 'tile-status' }, status),
    )
  },

  renderScreen: (el) => renderDeckScreen(el),

  // Only reviews that are due make work: cards never studied don't
  // (SPEC.md leaves this open and recommends it; see the deck's "new" count).
  async getTasks(el: LocusElement<FlashcardsData>, now: number): Promise<Task[]> {
    const due = await db.cards
      .where('[elementId+due]')
      .between([el.id, 0], [el.id, now], true, true)
      .filter((c) => !isNew(c))
      .count()
    if (due === 0) return []
    return [
      {
        locusId: el.locusId,
        elementId: el.id,
        label: `${due} ${due === 1 ? 'card' : 'cards'} due`,
        count: due,
        dueAt: now,
        action: () => {}, // starts the review session in milestone 6
      },
    ]
  },
}

export function iconNode(svg: string): HTMLElement {
  const span = h('span', { class: 'icon' })
  span.innerHTML = svg // our own constant markup, never user text
  return span
}
