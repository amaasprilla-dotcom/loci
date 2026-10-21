// One review queue for cards and problems (SPEC-v2.md, "One review queue"): each
// study item knows how to show itself and how it's rated. A card is self-graded
// (Again / Hard / Good / Easy); a problem is answered, and its rating derived.
// Each result is saved as soon as it's known, so leaving mid-session loses nothing.

import { h } from '../dom'
import { waitLabel } from '../elements/flashcards/srs'
import { recordReview } from '../elements/flashcards/session'
import { generate, newSeed } from '../elements/problems/engine'
import { presentProblem } from '../elements/problems/present'
import { recordAttempt } from '../elements/problems/schedule'
import type { Card, Grade, ProblemTemplate, Srs } from '../types'
import { nextState } from './schedule'

export const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: 0, label: 'Again', key: '1' },
  { grade: 1, label: 'Hard', key: '2' },
  { grade: 2, label: 'Good', key: '3' },
  { grade: 3, label: 'Easy', key: '4' },
]
const GRADE_NAMES = ['Again', 'Hard', 'Good', 'Easy']

export interface Outcome {
  grade: Grade
  srs: Srs
  ms: number
}

export interface Showing {
  done: Promise<Outcome>
  // Keys while this item is on screen; true if the key was used.
  onKey(e: KeyboardEvent): boolean
}

export interface Stage {
  stage: HTMLElement
  footer: HTMLElement
  retention: number
}

export function keyHint(key: string): HTMLElement {
  return h('kbd', { class: 'key-hint' }, key)
}

const MAX_CARD_MS = 60_000 // a card left on screen while you make tea doesn't count as study time

// A flashcard: front, Show answer, back, then the four grades with their waits.
export function showCard(card: Card, s: Stage, onSaved: (after: Card) => void): Showing {
  const shownAt = Date.now()
  let revealed = false
  let options: Record<Grade, Srs> | null = null
  let resolve!: (o: Outcome) => void
  const done = new Promise<Outcome>((r) => (resolve = r))

  s.stage.replaceChildren(
    h(
      'div',
      { class: 'review-card' },
      h('div', { class: 'review-front' }, card.front),
      h('div', { class: 'review-back', hidden: true }, h('hr', { class: 'review-divider' }), h('div', { class: 'review-back-text' }, card.back)),
    ),
  )
  s.footer.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => void reveal() }, 'Show answer', keyHint('Space')))

  async function reveal() {
    if (revealed) return
    revealed = true
    s.stage.querySelector<HTMLElement>('.review-back')!.hidden = false
    const now = Date.now()
    const item = { type: 'card' as const, id: card.id, elementId: card.elementId }
    const results = await Promise.all(GRADES.map((g) => nextState(item, card.srs, g.grade, now, s.retention)))
    options = { 0: results[0], 1: results[1], 2: results[2], 3: results[3] }
    s.footer.replaceChildren(
      h(
        'div',
        { class: 'grade-row' },
        GRADES.map(({ grade, label, key }) =>
          h('button', { type: 'button', class: `btn grade grade-${grade}`, onclick: () => answer(grade) }, h('span', { class: 'grade-label' }, label), h('span', { class: 'grade-wait' }, waitLabel(results[grade], now)), keyHint(key)),
        ),
      ),
    )
  }

  function answer(grade: Grade) {
    if (!options) return
    const now = Date.now()
    const ms = Math.min(now - shownAt, MAX_CARD_MS)
    const after: Card = { ...card, srs: options[grade], updatedAt: now }
    options = null
    void recordReview(card, after, grade, now, ms).catch((err) => console.error('Could not save review', err))
    onSaved(after)
    resolve({ grade, srs: after.srs, ms })
  }

  return {
    done,
    onKey(e) {
      if (e.key === ' ' && !revealed) {
        void reveal()
        return true
      }
      if (options && ['1', '2', '3', '4'].includes(e.key)) {
        answer((Number(e.key) - 1) as Grade)
        return true
      }
      return false
    },
  }
}

// A problem: fresh numbers each time it comes up. Answered, rated from
// correctness and time, saved; then Continue.
export function showProblem(t: ProblemTemplate, s: Stage, onSaved: (after: ProblemTemplate) => void): Showing {
  let resolve!: (o: Outcome) => void
  const done = new Promise<Outcome>((r) => (resolve = r))
  const g = generate(t, newSeed())
  let next: (() => void) | null = null

  if (!g.ok) {
    // Can't happen for a template that passed its checks; skip it rather than stall.
    s.stage.replaceChildren(h('p', { class: 'review-done' }, 'This problem can’t make numbers right now. Skipping it.'))
    s.footer.replaceChildren()
    setTimeout(() => resolve({ grade: 2, srs: t.srs, ms: 0 }), 1200)
    return { done, onKey: () => false }
  }

  const p = presentProblem(t, g.instance)
  s.stage.replaceChildren(h('div', { class: 'review-card problem-card' }, p.el))
  s.footer.replaceChildren()
  setTimeout(() => p.focus(), 0)

  void p.done.then(async (answered) => {
    const now = Date.now()
    const { grade, template } = await recordAttempt(t, g.instance, answered, now, s.retention)
    onSaved(template)
    const proceed = () => {
      next = null
      resolve({ grade, srs: template.srs, ms: answered.ms })
    }
    next = proceed
    const button = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: proceed }, 'Continue', keyHint('Enter'))
    s.footer.replaceChildren(h('p', { class: 'rating-note' }, `${GRADE_NAMES[grade]} · ${grade === 0 ? `back in ${waitLabel(template.srs, now)} with new numbers` : `next in ${waitLabel(template.srs, now)}`}`), button)
    button.focus()
  })

  return {
    done,
    onKey(e) {
      if (next && e.key === 'Enter') {
        next()
        return true
      }
      // 1–4 pick A–D.
      if (!next && t.answerMode === 'choice' && ['1', '2', '3', '4'].includes(e.key)) {
        s.stage.querySelectorAll<HTMLButtonElement>('.option')[Number(e.key) - 1]?.click()
        return true
      }
      return false
    },
  }
}
