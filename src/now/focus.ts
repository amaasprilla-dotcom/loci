// The focus timer: Start on a to-do from the Now card. One task, a countdown, and
// two ways out. (P1 adds the short 2- and 5-minute starters and the resume breadcrumb.)
// A to-do with a work block (SPEC-v8-experimental.md) runs for the block's length, and with
// noDistractions (in the Android app) blocks distracting apps until it ends: it waits on a
// Start first, so opening it by mistake doesn't lock the phone.

import { blockerState, blockNow, endBlock, inAndroidApp } from '../android'
import { formatTime } from '../elements/todos/when'
import { buzz } from '../feedback'
import { undoToast } from '../toast'
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
  const minutes = todo.block?.minutes ?? FOCUS_MINUTES
  const blocks = inAndroidApp && !!todo.block?.noDistractions
  let startedAt = Date.now()
  const total = minutes * 60_000
  const clock = h('p', { class: 'focus-clock', role: 'timer' }, clockText(total))
  const note = h('p', { class: 'focus-note' }, '')
  const blockNote = h('p', { class: 'focus-block-note' }, '')
  let ended = false
  let started = false
  let blocking = false
  let timer: ReturnType<typeof setInterval> | undefined

  // Counted from the clock, not by ticks, so it stays right when the tab sleeps.
  const tick = () => {
    const left = total - (Date.now() - startedAt)
    clock.textContent = clockText(left)
    note.textContent = left <= 0 ? `${minutes} minutes done.` : ''
  }
  async function start() {
    if (started) return
    started = true
    startedAt = Date.now()
    timer = setInterval(tick, 500)
    footer.replaceChildren(doneButton, stopButton)
    if (!blocks) return
    try {
      const state = await blockNow(startedAt + total)
      blocking = state.on
      blockNote.textContent = state.on ? `Distractions blocked until ${formatTime(startedAt + total)}` : 'The blocker is off in Wellbeing, so nothing is blocked.'
    } catch (err) {
      console.error(err)
    }
  }

  // Done ends the block (not in Strict). Stopping without finishing ends it only in Gentle:
  // in Firm the way out stays Wellbeing's End early, as for any block.
  async function endBlocking(done: boolean) {
    if (!blocking) return
    try {
      const { firmness } = await blockerState()
      if (firmness === 'gentle' || (done && firmness === 'firm')) await endBlock('now')
    } catch (err) {
      console.error(err)
    }
  }

  async function end(done: boolean, leave = true) {
    if (ended) return
    ended = true
    clearInterval(timer)
    window.removeEventListener('hashchange', onLeave)
    if (started) await endBlocking(done)
    if (task) {
      await logEvent('session_end', task, { meta: { minutes: Math.round((Date.now() - startedAt) / 60_000), kind: 'focus' } })
      if (done) await logEvent('done', task)
    }
    if (done) {
      buzz()
      const undo = await completeTodo(todo.id)
      announceChange()
      undoToast(`Done: ${todo.title}`, undo)
    }
    if (leave) back('#/')
  }
  // Left by the browser's back button or a link: still counts as the end of the session.
  const onLeave = () => void end(false, false)
  window.addEventListener('hashchange', onLeave)

  const doneButton = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => void end(true) }, 'Done')
  const stopButton = h('button', { type: 'button', class: 'btn btn-block', onclick: () => void end(false) }, 'Stop here')
  const footer = h('footer', { class: 'review-footer focus-actions' })
  if (blocks) {
    blockNote.textContent = `${minutes} minutes, with your distracting apps blocked until the end.`
    footer.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => void start() }, 'Start'))
  } else {
    void start()
  }

  // "When I finish lunch, I will open this week's video. First: open the editor."
  const cue = todo.plan?.cue
  return h(
    'div',
    { class: 'review-screen', style: { '--c': locus.color, '--fg': textColorOn(locus.color) } },
    h(
      'header',
      { class: 'review-bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Stop', onclick: () => void end(false) }, closeIcon()),
      h('span', { class: 'review-title' }, h('span', {}, locus.name)),
    ),
    h(
      'main',
      { class: 'review-main' },
      h(
        'div',
        { class: 'focus' },
        cue ? h('p', { class: 'focus-cue' }, `When ${cue},`) : null,
        h('h2', { class: 'focus-task' }, todo.title),
        todo.plan?.firstStep ? h('p', { class: 'focus-first' }, `First: ${todo.plan.firstStep}`) : null,
        clock,
        note,
        blockNote,
      ),
    ),
    footer,
  )
}
