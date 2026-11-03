// The blocker's card on the Wellbeing screen (SPEC-v7-wellbeing.md, "Decisions"): its switch,
// what's blocked now or next, Block now, the blocks, and how firm they are. The rules are
// kept in the phone prefs ("blocker"); the phone (Blocker.kt) works out from them what's
// blocked when, and blocks it.

import { type BlockerState, blockNow, blockerState, endBlock, savePhonePrefs } from '../android'
import { h } from '../dom'
import { formatTime, parseClock } from '../elements/todos/when'
import { segments } from '../settings/phone'
import { card, dayToggles, until } from './parts'

export type Firmness = 'gentle' | 'firm' | 'strict'

export type BlockRule =
  | { id: string; kind: 'hours'; on: boolean; name: string; start: string; end: string; days: number[] }
  | { id: string; kind: 'limit'; on: boolean; minutes: number }
  | { id: string; kind: 'bedtime'; on: boolean }

export interface BlockerPrefs {
  on: boolean
  firmness: Firmness
  rules: BlockRule[]
}

export const DEFAULT_BLOCKER: BlockerPrefs = { on: false, firmness: 'firm', rules: [] }

const FIRMNESS: Record<Firmness, string> = {
  gentle: 'Gentle: the blocked screen has 5 more minutes, 3 times a day.',
  firm: 'Firm: no way past the blocked screen. A block on now can be ended early here, after a 30-second wait.',
  strict: 'Strict: a block on now can’t be ended, changed or switched off until it’s over.',
}

const WAIT_S = 30

// "1 h", "1 h 30 min", "45 min".
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`
  return min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`
}

const clockLabel = (clock: string) => {
  const [hh, mm] = clock.split(':').map(Number)
  return formatTime(new Date().setHours(hh, mm, 0, 0))
}

// "Weekdays", "Every day", "Mon, Wed, Fri".
function daysLabel(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b)
  if (set.length === 7) return 'Every day'
  if (set.join() === '1,2,3,4,5') return 'Weekdays'
  if (set.join() === '0,6') return 'Weekends'
  if (!set.length) return 'No days'
  const name = (d: number) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2026, 10, 1 + d))
  return [...set.filter((d) => d > 0), ...set.filter((d) => d === 0)].map(name).join(', ')
}

function ruleTitle(rule: BlockRule): string {
  return rule.kind === 'hours' ? rule.name || 'Set hours' : rule.kind === 'limit' ? 'Daily limit' : 'Bedtime'
}

function ruleLine(rule: BlockRule): string {
  if (rule.kind === 'hours') return `${daysLabel(rule.days)} · ${clockLabel(rule.start)}–${clockLabel(rule.end)}`
  if (rule.kind === 'limit') return `After ${minutesLabel(rule.minutes)} in distracting apps a day, until midnight`
  return 'Bedtime to wake time, as set in sleep mode'
}

// The line under today's time: the block on now, or the next one.
export function blockLine(state: BlockerState, now = Date.now()): string {
  if (!state.on) return ''
  if (state.blocked) return `Blocked until ${until(state.blocked.end)} · ${state.blocked.reason}`
  if (state.moreUntil > now && state.next) return `5 more minutes, until ${formatTime(state.moreUntil)}`
  if (state.next && state.next.start - now < 24 * 3600_000) return `Next: ${state.next.reason} at ${formatTime(state.next.start)}`
  return ''
}

// `onchange`: the blocker's state may have changed (for Today's line and the other cards).
export function blockerCard(prefs: BlockerPrefs, initial: BlockerState, onchange: (state: BlockerState) => void): { el: HTMLElement; refresh(): Promise<void> } {
  let state = initial
  const save = async () => {
    await savePhonePrefs('blocker', { ...prefs, rules: prefs.rules.map((r) => ({ ...r })) })
    await refresh()
  }

  // What's blocked now, with End early (after the wait, in Firm).
  const status = h('p', { class: 'wb-block-status' })
  const endRow = h('div', { class: 'wb-block-end' })
  let waiting: number | undefined
  function showEnd() {
    window.clearInterval(waiting)
    const blocked = state.blocked
    if (!blocked || state.firmness === 'strict') {
      endRow.replaceChildren(...(blocked ? [h('span', { class: 'settings-note' }, 'Strict: it can’t be ended early.')] : []))
      return
    }
    const end = async () => {
      state = await endBlock(blocked.id)
      show()
    }
    if (state.firmness === 'gentle') {
      endRow.replaceChildren(h('button', { type: 'button', class: 'btn btn-small', onclick: end }, 'End early'))
      return
    }
    // Firm: the reason stays in front of you for 30 seconds first.
    endRow.replaceChildren(
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => {
        // Counted against the clock: timers slow down while Loci is in the background.
        const ready = Date.now() + WAIT_S * 1000
        let left = WAIT_S
        const go = h('button', { type: 'button', class: 'btn btn-small', disabled: true, onclick: end }, `End in ${left} s`)
        const stay = h('button', { type: 'button', class: 'btn btn-small', onclick: showEnd }, 'Keep it')
        endRow.replaceChildren(h('span', { class: 'settings-note' }, `${blocked.reason} is on until ${until(blocked.end)}. Still end it?`), h('div', { class: 'wb-row' }, stay, go))
        waiting = window.setInterval(() => {
          if (!go.isConnected) return window.clearInterval(waiting)
          left = Math.ceil((ready - Date.now()) / 1000)
          go.textContent = left > 0 ? `End in ${left} s` : 'End it now'
          if (left <= 0) {
            window.clearInterval(waiting)
            go.disabled = false
          }
        }, 250)
      } }, 'End early…'),
    )
  }

  // Block now: for a while, or until a time.
  const nowButtons = [15, 30, 60, 120].map((min) =>
    h('button', { type: 'button', class: 'btn btn-small', onclick: async () => {
      state = await blockNow(Date.now() + min * 60_000)
      show()
    } }, minutesLabel(min)),
  )
  const untilInput = h('input', { class: 'input phone-time', type: 'time', 'aria-label': 'Block until' })
  const untilButton = h('button', { type: 'button', class: 'btn btn-small', onclick: async () => {
    const t = parseClock(untilInput.value)
    if (!t) return untilInput.focus()
    const [hh, mm] = t.split(':').map(Number)
    let at = new Date().setHours(hh, mm, 0, 0)
    if (at <= Date.now()) at += 24 * 3600_000
    state = await blockNow(at)
    show()
  } }, 'Block')
  const blockNowPart = h('div', { class: 'field-label' }, h('span', {}, 'Block now, for'), h('div', { class: 'wb-grid4' }, nowButtons), h('div', { class: 'wb-row' }, h('span', { class: 'wb-row-label' }, 'or until'), untilInput, untilButton))

  // The blocks, each with its switch; tap one to change it.
  const list = h('ul', { class: 'wb-rules' })
  const adds = h('div', { class: 'wb-row wb-wrap' })
  let open: string | null = null

  function editor(rule: BlockRule): HTMLElement {
    const remove = h('button', { type: 'button', class: 'btn btn-small btn-danger-text', onclick: () => {
      prefs.rules = prefs.rules.filter((r) => r.id !== rule.id)
      open = null
      void save()
    } }, 'Delete')
    if (rule.kind === 'bedtime') return h('div', { class: 'wb-rule-edit' }, h('p', { class: 'settings-note' }, 'It follows sleep mode’s bedtime, wake time and nights, whether its filter is on or not, and holds during Sleep now. I’m up ends the filter, not the block.'), remove)
    if (rule.kind === 'limit') {
      const options = [30, 60, 90, 120, 180].map((m) => ({ label: minutesLabel(m), on: m }))
      const pick = segments('Daily limit', options, rule.minutes, (minutes) => {
        rule.minutes = minutes
        void save()
      })
      pick.classList.add('segments-5')
      return h('div', { class: 'wb-rule-edit' }, h('p', { class: 'settings-note' }, 'Counted across all your distracting apps, with the timer on or off.'), pick, remove)
    }
    const name = h('input', { class: 'input', type: 'text', value: rule.name, placeholder: 'Name, e.g. Morning', 'aria-label': 'Name', onchange: () => {
      rule.name = name.value.trim()
      void save()
    } })
    const time = (label: string, key: 'start' | 'end') => {
      const input = h('input', { class: 'input phone-time', type: 'time', value: rule[key], 'aria-label': label, onchange: () => {
        const t = parseClock(input.value)
        if (!t || t === rule[key === 'start' ? 'end' : 'start']) return
        rule[key] = t
        void save()
      } })
      return h('label', { class: 'field-label' }, h('span', {}, label), input)
    }
    return h(
      'div',
      { class: 'wb-rule-edit' },
      name,
      h('div', { class: 'phone-sleep-times' }, time('From', 'start'), time('To', 'end')),
      dayToggles('Days', rule.days, (days) => {
        rule.days = days
        void save()
      }),
      remove,
    )
  }

  function showRules() {
    const now = Date.now()
    list.replaceChildren(
      ...prefs.rules.map((rule) => {
        const running = state.blocked?.id === rule.id || (state.next?.id === rule.id && state.moreUntil > now)
        const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(rule.on), 'aria-label': ruleTitle(rule), onclick: () => {
          rule.on = !rule.on
          sw.setAttribute('aria-checked', String(rule.on))
          void save()
        } }, h('span', { class: 'switch-knob' }))
        const head = h(
          'button',
          { type: 'button', class: 'wb-rule-head', 'aria-expanded': String(open === rule.id), onclick: () => {
            open = open === rule.id ? null : rule.id
            showRules()
          } },
          h('span', { class: 'wb-rule-title' }, ruleTitle(rule), running && state.blocked ? h('span', { class: 'wb-now' }, `Now · until ${until(state.blocked.end)}`) : null),
          h('span', { class: 'settings-note' }, ruleLine(rule)),
        )
        return h('li', { class: 'wb-rule' }, h('div', { class: 'wb-rule-row' }, head, sw), open === rule.id ? editor(rule) : null)
      }),
    )
    list.hidden = !prefs.rules.length

    const add = (label: string, rule: () => BlockRule) =>
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => {
        const r = rule()
        prefs.rules = [...prefs.rules, r]
        open = r.id
        void save()
      } }, label)
    adds.replaceChildren(
      add('+ Set hours', () => ({ id: crypto.randomUUID(), kind: 'hours', on: true, name: '', start: '09:00', end: '12:00', days: [1, 2, 3, 4, 5] })),
      ...(prefs.rules.some((r) => r.kind === 'limit') ? [] : [add('+ Daily limit', () => ({ id: crypto.randomUUID(), kind: 'limit', on: true, minutes: 60 }))]),
      ...(prefs.rules.some((r) => r.kind === 'bedtime') ? [] : [add('+ Bedtime', () => ({ id: crypto.randomUUID(), kind: 'bedtime', on: true }))]),
    )
  }

  const firmnessNote = h('p', { class: 'settings-note' })
  const firmness = segments('How firm', [{ label: 'Gentle', on: 'gentle' as Firmness }, { label: 'Firm', on: 'firm' as Firmness }, { label: 'Strict', on: 'strict' as Firmness }], prefs.firmness, (f) => {
    prefs.firmness = f
    firmnessNote.textContent = FIRMNESS[f]
    void save()
  })
  firmness.classList.add('segments-3')
  firmnessNote.textContent = FIRMNESS[prefs.firmness]

  // While Firm or Strict holds a block on, the blocks can't be changed (the phone keeps
  // them as they were anyway): only Block now and End early work.
  const lockedNote = h('p', { class: 'settings-note wb-locked' }, 'A block is on: until it’s over or ended early, the blocks, how firm they are and the list of distracting apps can’t be changed.')
  const editable = h(
    'fieldset',
    { class: 'wb-fieldset' },
    h('div', { class: 'field-label' }, h('span', {}, 'Blocks'), list, adds),
    h('div', { class: 'field-label' }, h('span', {}, 'How firm'), firmness, firmnessNote),
  )

  function show() {
    status.textContent = blockLine(state) || 'Nothing blocked now.'
    showEnd()
    showRules()
    editable.disabled = state.locked
    lockedNote.hidden = !state.locked
    sw.disabled = state.locked
    onchange(state)
  }
  async function refresh() {
    state = await blockerState()
    show()
  }

  const el = card(
    'Blocker',
    'While a block is on, your distracting apps can’t be used: a screen covers them, with why and until when. Loci, the phone and settings are never blocked.',
    { on: prefs.on, onchange: (on) => {
      prefs.on = on
      void save()
    } },
    h('div', { class: 'wb-block-now-status' }, status, endRow),
    lockedNote,
    blockNowPart,
    editable,
  )
  const sw = el.querySelector<HTMLButtonElement>('.switch')!
  show()
  return { el, refresh }
}
