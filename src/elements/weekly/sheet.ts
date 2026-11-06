// The sheet for an experimental locus's targets and rules (SPEC-v8-experimental.md,
// "Changing the targets"). What Save does depends on the gate: straight away (first
// setup, review day, or "any time"), or, under the default rule, held as a change to
// confirm after a wait, with the reason written down first.

import { h } from '../../dom'
import { segments } from '../../settings/phone'
import { button, openSheet, sheetActions, submitButton } from '../../sheet'
import type { Todo } from '../../types'
import { formatDay, formatTime, parseClock } from '../todos/when'
import { type ChangeGate, type ChangeRule, type WeeklyData, type WeeklyRules, type WeeklyTarget, rulesOf } from './model'

export interface TargetsResult {
  targets: WeeklyTarget[]
  rules: WeeklyRules
  reason?: string // given under the wait rule
}

const WAITS = [
  { label: '12 h', on: 12 },
  { label: '24 h', on: 24 },
  { label: '3 days', on: 72 },
]

export const waitLabel = (hours: number) => WAITS.find((w) => w.on === hours)?.label ?? `${hours} h`

// "tomorrow at 11:43", "Friday at 09:00": for the middle of a sentence.
export const atText = (t: number, now = Date.now()) => `${formatDay(t, now).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())} at ${formatTime(t)}`

export const dayName = (d: number, style: 'long' | 'short' = 'long') => new Intl.DateTimeFormat(undefined, { weekday: style }).format(new Date(2026, 10, 1 + d)) // 1 Nov 2026 was a Sunday

export function openTargetsSheet(data: WeeklyData, blocks: Todo[], gate: Exclude<ChangeGate, { kind: 'closed' }>): Promise<TargetsResult | null> {
  return openSheet<TargetsResult>('Targets and rules', (api) => {
    const targets: WeeklyTarget[] = data.targets.map((t) => ({ ...t, todoIds: [...t.todoIds] }))
    const rules = rulesOf(data)
    const list = h('div', { class: 'xp-target-edit-list' })
    const error = h('p', { class: 'sheet-error', role: 'alert' })

    const num = (value: number, label: string, set: (n: number) => void) => {
      const input = h('input', { class: 'input xp-num', type: 'number', min: 0, max: 999, step: 1, inputmode: 'numeric', value: String(value), 'aria-label': label, oninput: () => {
        const n = Math.max(0, Math.floor(Number(input.value)))
        if (Number.isFinite(n)) set(n)
      } })
      return h('label', { class: 'xp-num-label' }, h('span', {}, label), input)
    }

    function renderTargets() {
      list.replaceChildren(
        ...targets.map((t, i) => {
          const name = h('input', { class: 'input', type: 'text', maxlength: 60, value: t.name, placeholder: 'e.g. Videos, Gym sessions', 'aria-label': 'Target', oninput: () => (t.name = name.value) })
          const counts = blocks.length
            ? h(
                'div',
                { class: 'xp-counts' },
                h('span', { class: 'field-hint' }, 'Counted from these blocks, as well as by hand:'),
                h(
                  'div',
                  { class: 'chips' },
                  blocks.map((b) =>
                    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(t.todoIds.includes(b.id)), onclick: (e: MouseEvent) => {
                      t.todoIds = t.todoIds.includes(b.id) ? t.todoIds.filter((id) => id !== b.id) : [...t.todoIds, b.id]
                      ;(e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(t.todoIds.includes(b.id)))
                    } }, b.title),
                  ),
                ),
              )
            : null
          return h(
            'div',
            { class: 'xp-target-edit' },
            h('div', { class: 'xp-target-edit-head' }, name, h('button', { type: 'button', class: 'btn btn-small btn-danger-text', onclick: () => {
              targets.splice(i, 1)
              renderTargets()
            } }, 'Remove')),
            h('div', { class: 'xp-range-edit' }, num(t.min, 'Minimum', (n) => (t.min = n)), num(t.good, 'Good week', (n) => (t.good = n))),
            counts,
          )
        }),
      )
    }

    const add = button('+ Add a target', () => {
      targets.push({ id: crypto.randomUUID(), name: '', min: 1, good: 2, todoIds: [] })
      renderTargets()
      list.querySelector<HTMLInputElement>('.xp-target-edit:last-child input')?.focus()
    })

    // ----- Rules -----
    const reviewDay = segments('Review day', [1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: dayName(d, 'short'), on: d })), rules.reviewDay, (d) => (rules.reviewDay = d))
    reviewDay.classList.add('segments-7')
    const reviewAt = h('input', { class: 'input phone-time', type: 'time', value: rules.reviewAt ?? '', 'aria-label': 'Review reminder' })
    const steps = h('textarea', { class: 'input', rows: 3, 'aria-label': 'Review steps', placeholder: 'One step a line' })
    steps.value = rules.reviewSteps.join('\n')

    const waitPick = segments('Wait', WAITS, rules.changeRule.kind === 'wait' ? rules.changeRule.hours : 24, (hours) => (rules.changeRule = { kind: 'wait', hours }))
    waitPick.classList.add('segments-3')
    const ruleNote = h('p', { class: 'field-hint' })
    const showRule = () => {
      waitPick.hidden = rules.changeRule.kind !== 'wait'
      ruleNote.textContent =
        rules.changeRule.kind === 'wait'
          ? 'Outside review day, a change waits this long before you can confirm it, with your reason in front of you.'
          : rules.changeRule.kind === 'reviewDay'
            ? 'Targets and rules can only be changed on review day.'
            : 'Changes apply straight away, any day.'
    }
    const rulePick = segments<ChangeRule['kind']>('Changes', [{ label: 'After a wait', on: 'wait' }, { label: 'Review day', on: 'reviewDay' }, { label: 'Any time', on: 'free' }], rules.changeRule.kind, (kind) => {
      rules.changeRule = kind === 'wait' ? { kind, hours: 24 } : { kind }
      showRule()
    })
    rulePick.classList.add('segments-3')
    showRule()

    // ----- Under the wait rule: a moment to think first -----
    const reason = h('textarea', { class: 'input', rows: 2, placeholder: 'What clearly failed?', 'aria-label': 'Why change it now?' })
    const waiting = gate.kind === 'wait'
    const submit = submitButton(waiting ? `Ask again in ${waitLabel(gate.hours)}` : 'Save')
    const readyAt = waiting ? Date.now() + gate.hours * 3_600_000 : 0

    const reflection = waiting
      ? h(
          'div',
          { class: 'xp-reflect' },
          h('p', { class: 'xp-reflect-q' }, 'Did something clearly fail, or is this just a hard week?'),
          h('p', { class: 'sheet-text' }, `Mid-week changes wait ${waitLabel(gate.hours)}. Write why now: ${atText(readyAt)} you’ll read it again and decide.`),
          data.reviewSteps.length > 0 && h('ul', { class: 'xp-steps-quiet' }, data.reviewSteps.map((s) => h('li', {}, s))),
        )
      : null

    const form = [
      h('h2', {}, 'Targets and rules'),
      reflection,
      h('div', { class: 'field-label' }, 'Weekly targets', h('span', { class: 'field-hint' }, 'Each a range, counted Monday to Sunday. The minimum is a full win.'), list, add),
      h('div', { class: 'field-label' }, 'Review day', reviewDay),
      h('label', { class: 'field-label' }, 'Review reminder (Android app)', reviewAt),
      h('label', { class: 'field-label' }, 'Review steps', h('span', { class: 'field-hint' }, 'In your own words, one a line.'), steps),
      h('div', { class: 'field-label' }, 'When targets can change', rulePick, waitPick, ruleNote),
      waiting && h('label', { class: 'field-label' }, 'Why change it now?', reason),
      error,
      sheetActions(null, button('Cancel', () => api.close(null)), submit),
    ]
    renderTargets()

    return {
      content: form,
      onSubmit: () => {
        const clean = targets.map((t) => ({ ...t, name: t.name.trim() })).filter((t) => t.name)
        const bad = clean.find((t) => t.good < t.min)
        if (bad) return void (error.textContent = `“${bad.name}”: a good week can’t be below the minimum.`)
        if (waiting && !reason.value.trim()) {
          error.textContent = 'Write why first: it’s what you’ll read before confirming.'
          return reason.focus()
        }
        rules.reviewAt = parseClock(reviewAt.value)
        rules.reviewSteps = steps.value.split('\n').map((s) => s.trim()).filter(Boolean)
        api.close({ targets: clean, rules, ...(waiting && { reason: reason.value.trim() }) })
      },
    }
  })
}
