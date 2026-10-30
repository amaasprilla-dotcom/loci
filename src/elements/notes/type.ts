// The Notes element type: a notebook of rich-text notes (SPEC-v2.md, "Notes").
// Notes make no tasks of their own; notes practised by recall (SPEC-v3-coach.md)
// join the locus's Study task. The editor (TipTap, KaTeX, MathLive) is loaded only
// when a notebook is opened, so the app starts fast.

import { h } from '../../dom'
import { count, formatNumber } from '../../locale'
import { elementHash } from '../../router'
import { db } from '../../store/db'
import { elementStudyTask } from '../../study/tasks'
import { formatAgo } from '../../time'
import { iconNode } from '../flashcards/type'
import type { ElementType } from '../registry'
import { practising } from './recall'
import { noteTitle } from './store'

const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M15 3.5V7h3.5M9 11h6.5M9 14.5h6.5M9 18h4"/></svg>'

export const notesType: ElementType<Record<string, never>> = {
  type: 'notes',
  label: 'Notes',
  noun: 'notebook',
  description: 'Notes with headings, lists, math, images and files',
  icon: ICON,

  createDefault: () => ({}),

  async renderCard(el, now) {
    const notes = await db.notes.where('elementId').equals(el.id).toArray()
    const last = notes.reduce<(typeof notes)[number] | null>((a, n) => (!a || n.updatedAt > a.updatedAt ? n : a), null)
    const toRecall = notes.filter((n) => practising(n) && n.recall!.srs.due <= now).length
    return h(
      'div',
      { class: 'tile-content' },
      h('div', { class: 'tile-head' }, iconNode(ICON), h('span', { class: 'tile-kind' }, 'Notes')),
      h('h3', { class: 'tile-title' }, el.title),
      h('p', { class: 'tile-meta' }, count(notes.length, 'note', 'notes')),
      h(
        'div',
        { class: 'tile-status' },
        toRecall > 0 ? h('span', { class: 'pill pill-due' }, `${formatNumber(toRecall)} to recall`) : h('span', { class: 'tile-quiet' }, last ? `${noteTitle(last)} · ${formatAgo(now - last.updatedAt)}` : 'No notes yet'),
      ),
    )
  },

  async renderScreen(el, sub) {
    const screens = await import('./screens')
    return sub[0] === 'note' && sub[1] ? screens.renderNoteEditor(el, sub[1]) : screens.renderNotebook(el)
  },

  // The notebook's own Study button: its notes to recall, until done.
  async renderSession(el) {
    const { renderStudyScreen } = await import('../../study/screen')
    return renderStudyScreen({ locusId: el.locusId, elementIds: [el.id], backHash: elementHash(el), title: el.title, chooseLength: false })
  },

  getTasks: (el, now) => elementStudyTask(el, now),

  async nextDueAt(el, now) {
    const due = (await db.notes.where('elementId').equals(el.id).toArray()).filter(practising).map((n) => n.recall!.srs.due).filter((d) => d > now)
    return due.length ? Math.min(...due) : null
  },
}
