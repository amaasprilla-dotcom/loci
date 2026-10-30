// One review queue for cards, problems and notes (SPEC-v2.md, "One review queue";
// SPEC-v3-coach.md): each study item knows how to show itself and how it's rated.
// A card is self-graded (Again / Hard / Good / Easy), or typed and checked; a
// problem is answered, and its rating derived; a note is recalled onto a blank
// page, compared, and self-graded.
// Each result is saved as soon as it's known, so leaving mid-session loses nothing.

import { h } from '../dom'
import { waitLabel } from '../elements/flashcards/srs'
import { recordReview } from '../elements/flashcards/session'
import { generate, newSeed } from '../elements/problems/engine'
import { presentProblem } from '../elements/problems/present'
import { recordAttempt } from '../elements/problems/schedule'
import { db } from '../store/db'
import { MAX_RECALL_MS, recordRecall } from '../elements/notes/recall'
import { noteTitle } from '../elements/notes/store'
import type { Card, Grade, Note, ProblemTemplate, Srs } from '../types'
import { checkAnswer, typedGrade } from './answer'
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
    s.footer.replaceChildren(gradeRow(results, now, answer))
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

// Again / Hard / Good / Easy, each with how long until it comes back.
function gradeRow(results: Srs[], now: number, onGrade: (g: Grade) => void): HTMLElement {
  return h(
    'div',
    { class: 'grade-row' },
    GRADES.map(({ grade, label, key }) =>
      h('button', { type: 'button', class: `btn grade grade-${grade}`, onclick: () => onGrade(grade) }, h('span', { class: 'grade-label' }, label), h('span', { class: 'grade-wait' }, waitLabel(results[grade], now)), keyHint(key)),
    ),
  )
}

// A flashcard in a Type deck: the front, an answer box, then Loci's verdict and
// the back. The rating is derived (wrong: Again; right: Good; right and quick:
// Easy); "I was right" overrules a wrong verdict, since typos happen.
export function showTypedCard(card: Card, s: Stage, onSaved: (after: Card) => void): Showing {
  const shownAt = Date.now()
  let checked = false
  let gaveUp = false
  let grade: Grade = 0
  let options: Record<Grade, Srs> | null = null
  let ms = 0
  let resolve!: (o: Outcome) => void
  const done = new Promise<Outcome>((r) => (resolve = r))

  const input = h('input', { class: 'input typed-answer', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', 'aria-label': 'Your answer', placeholder: 'Type the answer' })
  const verdict = h('p', { class: 'typed-verdict', 'aria-live': 'polite', hidden: true })
  const backText = h('div', { class: 'review-back', hidden: true }, h('hr', { class: 'review-divider' }), h('div', { class: 'review-back-text' }, card.back))
  s.stage.replaceChildren(h('div', { class: 'review-card' }, h('div', { class: 'review-front' }, card.front), input, verdict, backText))
  s.footer.replaceChildren(
    h(
      'div',
      { class: 'typed-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => void check(true) }, 'Don’t know'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void check(false) }, 'Check', keyHint('Enter')),
    ),
  )
  setTimeout(() => input.isConnected && input.focus(), 0)

  async function check(giveUp: boolean) {
    if (checked) return
    checked = true
    gaveUp = giveUp
    const now = Date.now()
    ms = Math.min(now - shownAt, MAX_CARD_MS)
    const correct = !giveUp && checkAnswer(input.value, card.back)
    input.readOnly = true
    input.blur() // Enter still works (the screen listens); the verdict's colours show without the focus ring
    const previous = (await db.reviews.where('cardId').equals(card.id).toArray()).filter((r) => r.grade >= 2 && r.ms != null).map((r) => r.ms!)
    grade = typedGrade(correct, ms, previous)
    const item = { type: 'card' as const, id: card.id, elementId: card.elementId }
    const results = await Promise.all(GRADES.map((g) => nextState(item, card.srs, g.grade, now, s.retention)))
    options = { 0: results[0], 1: results[1], 2: results[2], 3: results[3] }
    backText.hidden = false
    showVerdict(correct)
    renderFooter()
  }

  function showVerdict(correct: boolean) {
    verdict.hidden = false
    verdict.className = `typed-verdict ${correct ? 'right' : 'wrong'}`
    input.classList.toggle('wrong', !correct && !gaveUp)
    verdict.textContent = correct ? 'Right' : gaveUp ? 'Here’s the answer' : 'Not quite'
  }

  function renderFooter() {
    if (!options) return
    const now = Date.now()
    s.footer.replaceChildren(
      h('p', { class: 'rating-note' }, `${GRADE_NAMES[grade]} · next in ${waitLabel(options[grade], now)}`),
      h(
        'div',
        { class: 'typed-actions' },
        grade === 0 &&
          !gaveUp &&
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: () => {
                grade = 2
                showVerdict(true)
                renderFooter()
              },
            },
            'I was right',
          ),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: finish }, 'Continue', keyHint('Enter')),
      ),
    )
  }

  function finish() {
    if (!options) return
    const now = Date.now()
    const after: Card = { ...card, srs: options[grade], updatedAt: now }
    options = null
    void recordReview(card, after, grade, now, ms).catch((err) => console.error('Could not save review', err))
    onSaved(after)
    resolve({ grade, srs: after.srs, ms })
  }

  return {
    done,
    onKey(e) {
      if (e.key !== 'Enter') return false
      if (!checked) void check(false)
      else finish()
      return true
    },
  }
}

// A note practised by recall: its title and a blank page. Reveal puts what was
// written next to the note; then it's self-graded like a card.
export function showNote(note: Note, s: Stage, onSaved: (after: Note) => void): Showing {
  const shownAt = Date.now()
  let options: Record<Grade, Srs> | null = null
  let typed = ''
  let ms = 0
  let resolve!: (o: Outcome) => void
  const done = new Promise<Outcome>((r) => (resolve = r))

  const area = h('textarea', { class: 'input recall-input', rows: 8, 'aria-label': 'What you remember', placeholder: 'Write down everything you remember about it.' })
  const compare = h('div', { class: 'recall-compare', hidden: true })
  s.stage.replaceChildren(
    h('div', { class: 'review-card recall-card' }, h('p', { class: 'recall-kicker' }, 'Recall onto a blank page'), h('div', { class: 'review-front' }, noteTitle(note)), area, compare),
  )
  const revealButton = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => void reveal() }, 'Compare with the note')
  s.footer.replaceChildren(revealButton)
  setTimeout(() => area.isConnected && area.focus(), 0)

  async function reveal() {
    if (options || revealButton.disabled) return
    revealButton.disabled = true
    const now = Date.now()
    ms = Math.min(now - shownAt, MAX_RECALL_MS)
    typed = area.value.trim()
    area.hidden = true
    compare.replaceChildren(
      h('section', { class: 'recall-side' }, h('h3', {}, 'You wrote'), h('div', { class: typed ? 'recall-text' : 'recall-text empty' }, typed || 'Nothing this time.')),
      h('section', { class: 'recall-side' }, h('h3', {}, 'The note'), h('div', { class: 'recall-text' }, note.plainText)),
    )
    compare.hidden = false
    const item = { type: 'note' as const, id: note.id, elementId: note.elementId }
    const results = await Promise.all(GRADES.map((g) => nextState(item, note.recall!.srs, g.grade, now, s.retention)))
    options = { 0: results[0], 1: results[1], 2: results[2], 3: results[3] }
    s.footer.replaceChildren(h('p', { class: 'rating-note' }, 'How much did you remember?'), gradeRow(results, now, answer))
  }

  function answer(grade: Grade) {
    if (!options) return
    const srs = options[grade]
    options = null
    const now = Date.now()
    void recordRecall(note, srs, grade, typed, ms, now)
      .then(onSaved)
      .catch((err) => console.error('Could not save recall', err))
    resolve({ grade, srs, ms })
  }

  return {
    done,
    onKey(e) {
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
