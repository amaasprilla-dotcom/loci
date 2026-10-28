// A time of day you can type or tap, in place of the phone's time scroller:
// "730", "7:30pm", "19:30" all work, and the chips set the usual times in one tap.
// The ones you used lately come first.

import { h } from '../../dom'
import { formatTime, parseClock } from './when'

const RECENT_KEY = 'loci.recentTimes'
const USUAL = ['06:00', '07:00', '08:00', '12:00', '18:00', '20:00', '22:00']
const MAX_CHIPS = 8

function recentTimes(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string' && parseClock(t) === t) : []
  } catch {
    return []
  }
}

// Called when a time is actually used, so it is offered first next time.
export function rememberTime(time: string | undefined): void {
  if (!time) return
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([time, ...recentTimes().filter((t) => t !== time)].slice(0, 4)))
  } catch {
    // storage may be blocked: the chips just stay as they were
  }
}

const show = (time: string) => formatTime(new Date(`2000-01-01T${time}:00`).getTime())

export interface TimeField {
  el: HTMLElement
  // undefined: left empty. null: something is typed that isn't a time.
  read(): string | undefined | null
}

// `onchange` runs as the time is edited; `onenter` when Enter is pressed in the field.
export function timeField(initial: string | undefined, onchange: () => void = () => {}, onenter: () => void = () => {}): TimeField {
  const echo = h('span', { class: 'time-echo', 'aria-live': 'polite' })
  const input = h('input', {
    class: 'input',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'off',
    placeholder: 'e.g. 7:30am or 19:30',
    oninput: () => update(),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      onenter()
    },
  })
  const clear = h('button', { type: 'button', class: 'chip', hidden: true, onclick: () => set('') }, 'No time')
  const chipsRow = h('div', { class: 'chips' })

  function read(): string | undefined | null {
    if (!input.value.trim()) return undefined
    return parseClock(input.value)
  }

  function update(notify = true) {
    const t = read()
    echo.textContent = t === undefined ? 'Without a time, it’s due all day.' : t === null ? 'Try 7:30am or 19:30' : show(t)
    echo.classList.toggle('bad', t === null)
    clear.hidden = t === undefined
    for (const chip of chipsRow.querySelectorAll('button')) chip.setAttribute('aria-pressed', String(chip.dataset.time === t))
    if (notify) onchange()
  }

  function set(time: string) {
    input.value = time
    update()
  }

  const times = [...new Set([...recentTimes(), ...USUAL])].slice(0, MAX_CHIPS).sort()
  chipsRow.append(...times.map((t) => h('button', { type: 'button', class: 'chip', 'data-time': t, 'aria-pressed': 'false', onclick: () => set(t) }, show(t))))
  chipsRow.append(clear)

  input.value = initial ?? ''
  update(false)
  return { el: h('div', { class: 'time-field' }, h('label', { class: 'field-label' }, 'Time (optional)', input), echo, chipsRow), read }
}
