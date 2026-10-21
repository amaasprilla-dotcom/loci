// The Problems element type (SPEC-v2.md, "Problems"): a problem set of templates,
// each a problem whose numbers change every time it comes up.

import { h } from '../../dom'
import { count, formatNumber } from '../../locale'
import { elementHash, go, reviewHash } from '../../router'
import { studyAdjustments } from '../../study/limits'
import { studyPool, summarize } from '../../study/plan'
import { elementStudyTask } from '../../study/tasks'
import type { LocusElement } from '../../types'
import { iconNode } from '../flashcards/type'
import type { ElementType } from '../registry'
import { listTemplates } from './store'

export interface ProblemsData {
  newPerDay: number // templates seen for the first time, per day
}

export const DEFAULT_PROBLEMS_DATA: ProblemsData = { newPerDay: 10 }

export const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M7 16.5c2-7 4-9 5-9s1.6 1.4 2 3 1 3 3 3"/><path d="M7 12h3.5"/></svg>'

export const problemsType: ElementType<ProblemsData> = {
  type: 'problems',
  label: 'Problems',
  noun: 'problem set',
  description: 'Practice problems with new numbers every time',
  icon: ICON,

  createDefault: () => ({ ...DEFAULT_PROBLEMS_DATA }),

  async renderCard(el: LocusElement<ProblemsData>, now) {
    const templates = await listTemplates(el.id)
    const tight = templates.filter((t) => t.tooTight).length
    const s = summarize(await studyPool([el], now, await studyAdjustments([el], now)))
    return h(
      'div',
      { class: 'tile-content' },
      h('div', { class: 'tile-head' }, iconNode(ICON), h('span', { class: 'tile-kind' }, 'Problems')),
      h('h3', { class: 'tile-title' }, el.title),
      h('p', { class: 'tile-meta' }, templates.length === 0 ? 'No problems yet' : count(templates.length, 'problem', 'problems')),
      h(
        'div',
        { class: 'tile-status' },
        s.problems > 0 && h('span', { class: 'pill pill-due' }, `${formatNumber(s.problems)} due`),
        tight > 0 && h('span', { class: 'pill pill-overdue' }, `${formatNumber(tight)} need fixing`),
      ),
      s.problems > 0 &&
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-study',
            onclick: (e: Event) => {
              e.stopPropagation() // straight to practice, not the set screen
              go(reviewHash(el))
            },
          },
          'Study',
        ),
    )
  },

  // The set's own Study button: this set only, until done.
  async renderSession(el) {
    const { renderStudyScreen } = await import('../../study/screen')
    return renderStudyScreen({ locusId: el.locusId, elementIds: [el.id], backHash: elementHash(el), title: el.title, chooseLength: false })
  },

  async renderScreen(el, sub) {
    const screens = await import('./screens')
    if (sub[0] === 'template' && sub[1]) return screens.renderTemplateEditor(el, sub[1] === 'new' ? null : sub[1])
    return screens.renderProblemSet(el)
  },

  getTasks: (el, now) => elementStudyTask(el, now),
}
