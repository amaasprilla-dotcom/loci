// A to-do's work block (SPEC-v8-experimental.md, "Work blocks"): how long its focus timer
// runs, and, in the Android app, whether distracting apps are blocked while it does.

import { inAndroidApp, phonePrefs, savePhonePrefs } from '../../android'
import { h } from '../../dom'
import { segments } from '../../settings/phone'
import { DEFAULT_BLOCKER, type BlockerPrefs } from '../../wellbeing/blocker'
import { type Block, BLOCK_LENGTHS } from './block'

// Blocking distractions needs the blocker on: switching it on for a block turns the
// blocker on too (with no blocks of its own, nothing else changes).
export async function ensureBlockerOn(): Promise<boolean> {
  const prefs = { ...DEFAULT_BLOCKER, ...((await phonePrefs())?.blocker as Partial<BlockerPrefs> | undefined) }
  if (prefs.on) return false
  await savePhonePrefs('blocker', { ...prefs, on: true })
  return true
}

export function blockField(initial: Block | undefined): { el: HTMLElement; value(): Block | undefined } {
  let minutes: number | null = initial?.minutes ?? null
  let noDistractions = initial?.noDistractions ?? false
  const note = h('p', { class: 'field-hint' })
  const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(noDistractions), 'aria-label': 'Block all distractions', onclick: async () => {
    noDistractions = !noDistractions
    sw.setAttribute('aria-checked', String(noDistractions))
    if (noDistractions && (await ensureBlockerOn())) note.textContent = 'The blocker was off: it’s on now (Wellbeing), with no blocks of its own.'
  } }, h('span', { class: 'switch-knob' }))
  const distractions = inAndroidApp ? h('div', { class: 'block-distractions' }, h('span', {}, 'Block all distractions'), sw) : null
  const sync = () => {
    if (distractions) distractions.hidden = minutes == null
    note.hidden = minutes == null || !note.textContent
  }
  const pick = segments('Work block', [{ label: 'None', on: null as number | null }, ...BLOCK_LENGTHS.map((m) => ({ label: `${m}′`, on: m as number | null }))], minutes, (m) => {
    minutes = m
    sync()
  })
  pick.classList.add('segments-6')
  sync()
  return {
    el: h(
      'div',
      { class: 'field-label' },
      'Work block',
      h('span', { class: 'field-hint' }, 'Start runs a timer this long', inAndroidApp ? ', and can keep your distracting apps blocked until it ends.' : '.'),
      pick,
      distractions,
      note,
    ),
    value: () => (minutes == null ? undefined : { minutes, noDistractions: inAndroidApp ? noDistractions : (initial?.noDistractions ?? false) }),
  }
}
