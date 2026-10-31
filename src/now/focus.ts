// The focus timer: Start on a to-do from the Now card. One task, a countdown, and
// two ways out. (P1 adds the short 2- and 5-minute starters and the resume breadcrumb.)

import { announceChange } from '../changes'
import { textColorOn } from '../colors'
import { h } from '../dom'
import type { Task } from '../elements/registry'
import { completeTodo } from '../elements/todos/store'
import { closeIcon } from '../icons'
import { back } from '../router'
import type { Locus, Todo } from '../types'
import { logEvent } from './events'

export const FOCUS_MINUTES = 25

const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// `task` is the ranked task the card showed, so the events carry its score.
export function renderFocusScreen(todo: Todo, locus: Pick<Locus, 'name' | 'color'>, task?: Task): HTMLElement {
  const startedAt = Date.now()
  const total = FOCUS_MINUTES * 60_000
  const clock = h('p', { class: 'focus-clock', role: 'timer' }, clockText(total))
  const note = h('p', { class: 'focus-note' }, '')
  let ended = false

  // Counted from the clock, not by ticks, so it stays right when the tab sleeps.
  const tick = () => {
    const left = total - (Date.now() - startedAt)
    clock.textContent = clockText(left)
    note.textContent = left <= 0 ? `${FOCUS_MINUTES} minutes done.` : ''
  }
  const timer = setInterval(tick, 500)

  async function end(done: boolean, leave = true) {
    if (ended) return
    ended = true
    clearInterval(timer)
    window.removeEventListener('hashchange', onLeave)
    if (task) {
      await logEvent('session_end', task, { meta: { minutes: Math.round((Date.now() - startedAt) / 60_000), kind: 'focus' } })
      if (done) await logEvent('done', task)
    }
    if (done) {
      await completeTodo(todo.id)
      announceChange()
    }
    if (leave) back('#/')
  }
  // Left by the browser's back button or a link: still counts as the end of the session.
  const onLeave = () => void end(false, false)
  window.addEventListener('hashchange', onLeave)

  return h(
    'div',
    { class: 'review-screen', style: { '--c': locus.color, '--fg': textColorOn(locus.color) } },
    h(
      'header',
      { class: 'review-bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Stop', onclick: () => void end(false) }, closeIcon()),
      h('span', { class: 'review-title' }, h('span', {}, locus.name)),
    ),
    h('main', { class: 'review-main' }, h('div', { class: 'focus' }, h('h2', { class: 'focus-task' }, todo.title), clock, note)),
    h(
      'footer',
      { class: 'review-footer focus-actions' },
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => void end(true) }, 'Done'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => void end(false) }, 'Stop here'),
    ),
  )
}
