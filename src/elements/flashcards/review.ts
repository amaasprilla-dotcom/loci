// The review session (SPEC.md, "Review session"): show the front, reveal the
// back, grade Again / Hard / Good / Easy. Each grade is saved straight away
// with a review log, so leaving mid-session loses nothing.
// Keyboard: Space shows the answer, 1–4 grade.

import { textColorOn } from '../../colors'
import { h } from '../../dom'
import { closeIcon } from '../../icons'
import { back, elementHash } from '../../router'
import { db } from '../../store/db'
import { formatIn } from '../../time'
import type { Card, Grade, LocusElement } from '../../types'
import { planSession, recordReview } from './session'
import { DEFAULT_RETENTION, outcomes, waitLabel } from './srs'
import { type FlashcardsData, listCards } from './store'
import { count, formatNumber } from '../../locale'

const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: 0, label: 'Again', key: '1' },
  { grade: 1, label: 'Hard', key: '2' },
  { grade: 2, label: 'Good', key: '3' },
  { grade: 3, label: 'Easy', key: '4' },
]
const MAX_SECONDS_PER_CARD = 60 // a card left on screen while you make tea doesn't count as study time
const COMES_BACK_WITHIN = 60 * 60_000 // a card due again within the hour (a learning step) returns in this session

export async function renderReviewScreen(deck: LocusElement<FlashcardsData>): Promise<HTMLElement> {
  const locus = await db.loci.get(deck.locusId)
  const retention = locus?.retention ?? DEFAULT_RETENTION // the locus's desired retention
  const color = locus?.color ?? '#0b0f14'
  let leaving = false
  const leave = () => {
    if (leaving) return // e.g. Enter on a focused "Back to deck" would otherwise go back twice
    leaving = true
    back(elementHash(deck))
  }

  const queue = await planSession(deck, Date.now())
  // Cards on a learning step (Again, or new cards being learned) come back when
  // their step is up, or sooner if nothing else is left.
  const waiting: { card: Card; showAt: number }[] = []
  const total = queue.length
  let reviewed = 0 // reviews done, repeats included
  const cardsSeen = new Set<string>()
  let studyMs = 0

  let current: Card | null = null
  // The four FSRS results for the current card, worked out when the answer shows:
  // the buttons display them and grading saves the one picked.
  let options: ReturnType<typeof outcomes> | null = null
  let shownAt = 0
  let revealed = false
  // Grades are saved in the background, one after another, so the next card shows at once.
  let saving: Promise<void> = Promise.resolve()
  let finished = false

  const leftCount = h('span', { class: 'review-count' })
  const progress = h('div', { class: 'review-progress-fill' })
  const stage = h('main', { class: 'review-main' })
  const footer = h('footer', { class: 'review-footer' })

  function left() {
    return queue.length + waiting.length + (current ? 1 : 0)
  }

  function updateProgress() {
    const remaining = left()
    leftCount.textContent = remaining > 0 ? `${formatNumber(remaining)} left` : ''
    progress.style.width = `${total === 0 ? 100 : Math.min(100, (reviewed / (reviewed + remaining)) * 100)}%`
  }

  // Next card: a returning card whose step is up, else the queue, else the soonest returning card.
  function next() {
    const now = Date.now()
    waiting.sort((a, b) => a.showAt - b.showAt)
    if (waiting.length > 0 && (waiting[0].showAt <= now || queue.length === 0)) current = waiting.shift()!.card
    else current = queue.shift() ?? null
    if (!current) return void finish()
    options = null
    shownAt = now
    revealed = false
    showCard()
  }

  function showCard() {
    const card = current!
    updateProgress()
    stage.replaceChildren(
      h(
        'div',
        { class: 'review-card' },
        h('div', { class: 'review-front' }, card.front),
        h('div', { class: 'review-back', hidden: true }, h('hr', { class: 'review-divider' }), h('div', { class: 'review-back-text' }, card.back)),
      ),
    )
    footer.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: reveal }, 'Show answer', keyHint('Space')))
  }

  function reveal() {
    if (!current || revealed) return
    revealed = true
    stage.querySelector<HTMLElement>('.review-back')!.hidden = false
    const now = Date.now()
    options = outcomes(current.srs, now, retention)
    const results = options
    footer.replaceChildren(
      h(
        'div',
        { class: 'grade-row' },
        GRADES.map(({ grade, label, key }) =>
          h(
            'button',
            { type: 'button', class: `btn grade grade-${grade}`, onclick: () => answer(grade) },
            h('span', { class: 'grade-label' }, label),
            h('span', { class: 'grade-wait' }, waitLabel(results[grade], now)),
            keyHint(key),
          ),
        ),
      ),
    )
  }

  function answer(grade: Grade) {
    if (!current || !revealed || !options) return
    const now = Date.now()
    const before = current
    const after: Card = { ...before, srs: options[grade], updatedAt: now }
    saving = saving.then(() => recordReview(before, after, grade, now)).catch((err) => console.error('Could not save review', err))
    reviewed++
    cardsSeen.add(before.id)
    studyMs += Math.min(now - shownAt, MAX_SECONDS_PER_CARD * 1000)
    if (after.srs.due - now < COMES_BACK_WITHIN) waiting.push({ card: after, showAt: after.srs.due })
    current = null
    next()
  }

  async function finish() {
    finished = true
    updateProgress()
    await saving
    const now = Date.now()
    const cards = await listCards(deck.id)
    const nextDue = cards.filter((c) => c.srs.due > now).reduce<number | null>((min, c) => (min == null || c.srs.due < min ? c.srs.due : min), null)
    const nextLine = nextDue != null ? `Next review ${formatIn(nextDue - now)}.` : ''
    stage.replaceChildren(
      h(
        'div',
        { class: 'review-done' },
        reviewed > 0
          ? [
              h('h2', {}, 'Session complete'),
              h(
                'p',
                {},
                `You studied ${count(cardsSeen.size, 'card', 'cards')}` +
                  (reviewed > cardsSeen.size ? ` (${count(reviewed, 'review', 'reviews')})` : '') +
                  ` in ${formatDuration(studyMs)}.`,
              ),
            ]
          : h('h2', {}, 'Nothing to study right now'),
        nextLine && h('p', { class: 'review-next' }, nextLine),
      ),
    )
    footer.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: leave }, 'Back to deck'))
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.sheet')) return
    if (e.key === 'Escape' || (finished && e.key === 'Enter')) {
      e.preventDefault()
      leave()
    } else if (finished) {
      return
    } else if (e.key === ' ' && !revealed) {
      e.preventDefault()
      reveal()
    } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault()
      answer((Number(e.key) - 1) as Grade)
    }
  }
  document.addEventListener('keydown', onKey)
  // Stop listening once this screen leaves the page.
  const detachKeys = () => document.removeEventListener('keydown', onKey)
  window.addEventListener('hashchange', detachKeys, { once: true })

  const screen = h(
    'div',
    { class: 'review-screen', style: { '--c': color, '--fg': textColorOn(color) } },
    h(
      'header',
      { class: 'review-bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'End session', onclick: leave }, closeIcon()),
      h('span', { class: 'review-title' }, deck.title),
      leftCount,
    ),
    h('div', { class: 'review-progress' }, progress),
    stage,
    footer,
  )
  next()
  return screen
}

function keyHint(key: string): HTMLElement {
  return h('kbd', { class: 'key-hint' }, key)
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
