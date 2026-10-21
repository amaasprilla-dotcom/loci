// Showing one problem to answer: the question, four options (or a number to
// type), and then feedback. A wrong option names the mistake behind it, next to
// the worked answer with the actual numbers (SPEC-v2.md, "Feedback").

import { h } from '../../dom'
import { parseNumber } from '../../locale'
import type { ProblemTemplate } from '../../types'
import { formatAnswer, formulaNode, questionNode } from './display'
import { chooseOptions, diagnose, type Explanation, type RuleId } from './distractors'
import { type Instance, isCorrect } from './engine'

export interface Answered {
  correct: boolean
  given: number
  rule?: RuleId // the mistake behind a wrong answer, when known
  ms: number
}

export function explanationNode(why: Explanation): HTMLElement {
  return h('span', { class: 'explanation' }, why.text, why.expr != null && ' ', why.expr != null && formulaNode(why.expr))
}

// The worked answer: the formula with this instance's numbers, = the answer.
export function workedNode(t: ProblemTemplate, inst: Instance): HTMLElement {
  const steps = t.derived.map((d) => h('div', { class: 'worked-line' }, formulaNode(['Equal', d.name, d.expr]), ' = ', formulaNode(d.expr, inst.values), ' = ', h('strong', {}, formatAnswer(inst.values[d.name], {}))))
  return h(
    'div',
    { class: 'worked-answer' },
    ...steps,
    h('div', { class: 'worked-line' }, formulaNode(t.answer, inst.values), ' = ', h('strong', {}, formatAnswer(inst.answer, t.answerFormat))),
  )
}

// The problem, ready to answer. `done` resolves once it's answered; the feedback
// stays on screen for the caller to move on from.
export function presentProblem(t: ProblemTemplate, inst: Instance): { el: HTMLElement; done: Promise<Answered>; focus(): void } {
  const started = performance.now()
  const feedback = h('div', { class: 'problem-feedback', 'aria-live': 'polite' })
  let resolve!: (a: Answered) => void
  const done = new Promise<Answered>((r) => (resolve = r))
  let answered = false

  function finish(a: Omit<Answered, 'ms'>, why?: Explanation) {
    if (answered) return
    answered = true
    const result = { ...a, ms: Math.round(performance.now() - started) }
    feedback.replaceChildren(
      h('p', { class: `verdict ${a.correct ? 'right' : 'wrong'}` }, a.correct ? 'Right.' : 'Not quite.', !a.correct && why && ' ', !a.correct && why && explanationNode(why)),
      workedNode(t, inst),
    )
    resolve(result)
  }

  let answerArea: HTMLElement
  let focusTarget: HTMLElement
  if (t.answerMode === 'typed') {
    const input = h('input', { class: 'input answer-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Your answer' })
    const check = h('button', { type: 'button', class: 'btn btn-primary' }, 'Check')
    const error = h('p', { class: 'sheet-error', role: 'alert' })
    const submit = () => {
      const given = parseNumber(input.value)
      if (given == null) {
        error.textContent = 'Type a number.'
        return
      }
      error.textContent = ''
      input.disabled = true
      check.disabled = true
      const correct = isCorrect(given, inst.answer, t.answerFormat)
      const d = correct ? null : diagnose(t, inst, given)
      finish({ correct, given, ...(d && { rule: d.rule }) }, d?.why)
    }
    check.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    })
    answerArea = h('div', { class: 'typed-answer' }, h('div', { class: 'typed-row' }, input, t.answerFormat.unit && h('span', { class: 'answer-unit' }, t.answerFormat.unit), check), error)
    focusTarget = input
  } else {
    const options = chooseOptions(t, inst)
    const buttons = options.map((o, i) =>
      h(
        'button',
        {
          type: 'button',
          class: 'option',
          onclick: () => {
            if (answered) return
            buttons.forEach((b, j) => {
              b.disabled = true
              if (options[j].correct) b.classList.add('is-correct')
            })
            if (!o.correct) buttons[i].classList.add('is-wrong')
            finish({ correct: o.correct, given: o.value, ...(o.rule && { rule: o.rule }) }, o.why)
          },
        },
        h('span', { class: 'option-letter' }, 'ABCD'[i]),
        h('span', { class: 'option-value' }, formatAnswer(o.value, t.answerFormat)),
      ),
    )
    answerArea = h('div', { class: 'options' }, buttons)
    focusTarget = buttons[0]
  }

  const el = h('div', { class: 'problem' }, questionNode(inst), answerArea, feedback)
  return { el, done, focus: () => focusTarget.focus() }
}
