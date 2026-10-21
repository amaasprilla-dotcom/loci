// The Flashcards element type: a deck of front/back cards with spaced repetition.

import { h } from '../../dom'
import { db } from '../../store/db'
import { formatIn } from '../../time'
import type { LocusElement } from '../../types'
import { elementHash, go, reviewHash } from '../../router'
import type { ElementType, Task } from '../registry'
import { renderDeckScreen } from './editor'
import { planSession } from './session'
import { DEFAULT_FLASHCARDS_DATA, deckStats, type FlashcardsData, isNew, listCards } from './store'
import { count, formatNumber } from '../../locale'
import { elementStudyTask } from '../../study/tasks'

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
          ? [stats.due > 0 && h('span', { class: 'pill pill-due' }, `${formatNumber(stats.due)} due`), stats.fresh > 0 && h('span', { class: 'pill' }, `${formatNumber(stats.fresh)} new`)]
          : h('span', { class: 'tile-quiet' }, stats.nextDue != null ? `Next ${formatIn(stats.nextDue - now)}` : 'All caught up')
    const studyable = (await planSession(el, now)).length > 0
    return h(
      'div',
      { class: 'tile-content' },
      h('div', { class: 'tile-head' }, iconNode(ICON), h('span', { class: 'tile-kind' }, 'Flashcards')),
      h('h3', { class: 'tile-title' }, el.title),
      h('p', { class: 'tile-meta' }, count(stats.total, 'card', 'cards')),
      h('div', { class: 'tile-status' }, status),
      studyable &&
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-study',
            onclick: (e: Event) => {
              e.stopPropagation() // straight to the review, not the deck screen
              go(reviewHash(el))
            },
          },
          'Study',
        ),
    )
  },

  renderScreen: (el) => renderDeckScreen(el),
  // The deck's own Study button: this deck only, until done.
  async renderSession(el) {
    const { renderStudyScreen } = await import('../../study/screen')
    return renderStudyScreen({ locusId: el.locusId, elementIds: [el.id], backHash: elementHash(el), title: el.title, chooseLength: false })
  },

  // Due reviews make work; cards never studied don't (see the deck's "new" count).
  // Overdue once a review has waited past a 04:00 rollover. These join the locus's
  // one Study task (study/tasks.ts), unless the setting splits them.
  getTasks: (el: LocusElement<FlashcardsData>, now: number): Promise<Task[]> => elementStudyTask(el, now),

  // The [elementId+srs.due] index is sorted by due, so the first match is the soonest.
  async nextDueAt(el, now) {
    const next = await db.cards
      .where('[elementId+srs.due]')
      .between([el.id, now], [el.id, Infinity], false, true)
      .filter((c) => !isNew(c))
      .first()
    return next?.srs.due ?? null
  },
}

export function iconNode(svg: string): HTMLElement {
  const span = h('span', { class: 'icon' })
  span.innerHTML = svg // our own constant markup, never user text
  return span
}
