// The Wellbeing screen, only in the Android app (SPEC-v7-wellbeing.md, "Wellbeing"):
// today's time in distracting apps, then the blocker, the timer, sleep mode and the list
// of distracting apps, each a glass card with its switch. Everything here is kept on the
// phone, where WatchService reads it, and never synced.

import { appInfo, type BlockerState, blockerState, inAndroidApp, onAppResume, type PhoneApp, phoneApps, type PhonePermissions, phonePermissions, phonePrefs, savePhonePrefs, type SleepState, sleepNow, sleepState, timerToday } from '../android'
import { h } from '../dom'
import { formatTime, parseClock } from '../elements/todos/when'
import { backIcon } from '../icons'
import { back } from '../router'
import { permissionLines, segments } from '../settings/phone'
import { type BlockerPrefs, blockerCard, blockLine, DEFAULT_BLOCKER } from './blocker'
import { card, dayToggles, update } from './parts'

// The timer's settings. `apps` is the list of distracting apps for every part of
// Wellbeing (it was the timer's own list first, hence where it's kept).
export interface TimerPrefs {
  on: boolean
  size: 'normal' | 'small'
  apps: Record<string, boolean> // apps switched on or off by hand; the rest go by default
}

const DEFAULT_TIMER: TimerPrefs = { on: false, size: 'normal', apps: {} }

// Sleep mode's settings.
export interface SleepPrefs {
  on: boolean
  bed: string // "23:30"
  wake: string // "07:00"
  nights: number[] // the days bedtime falls on, 0 = Sunday
  strength: number // the filter, 0–100
  every: number // minutes between reminders while the screen is on
}

const DEFAULT_SLEEP: SleepPrefs = { on: false, bed: '23:30', wake: '07:00', nights: [0, 1, 2, 3, 4, 5, 6], strength: 60, every: 10 }

// "1 h 12 min", "4 min".
export function spent(ms: number): string {
  const min = Math.floor(ms / 60_000)
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`
}

const clockLabel = (clock: string) => {
  const [hh, mm] = clock.split(':').map(Number)
  return formatTime(new Date().setHours(hh, mm, 0, 0))
}

const savePrefs = (key: 'timer' | 'sleep', prefs: object) => savePhonePrefs(key, { ...prefs })

// The large number at the top: time in distracting apps today, and under it the block on
// now or the next one.
function todayCard(timer: TimerPrefs, blocker: BlockerPrefs | null): { el: HTMLElement; refresh(): Promise<void>; showBlock(state: BlockerState): void } {
  const big = h('p', { class: 'wb-today' })
  const note = h('p', { class: 'settings-note' })
  const block = h('p', { class: 'wb-today-block', hidden: true })
  const counted = () => timer.on || (blocker?.on && blocker.rules.some((r) => r.kind === 'limit' && r.on))
  const refresh = async () => {
    big.textContent = spent(await timerToday())
    note.textContent = counted() ? 'In distracting apps today, all of them together. Starts again at midnight.' : 'In distracting apps today. Counted while the timer or a daily limit is on.'
  }
  const showBlock = (state: BlockerState) => {
    block.textContent = blockLine(state)
    block.hidden = !block.textContent
    block.classList.toggle('on', state.blocked != null)
  }
  const el = h('section', { class: 'settings-section wb-card wb-today-card' }, h('span', { class: 'phone-kicker' }, 'Today'), big, block, note)
  return { el, refresh, showBlock }
}

function timerCard(prefs: TimerPrefs, onchange: () => void, permissions: HTMLElement): HTMLElement {
  const save = async (change: Partial<TimerPrefs>) => {
    Object.assign(prefs, change)
    await savePrefs('timer', prefs)
    onchange()
  }
  return card(
    'Timer',
    'A small pill over distracting apps shows your time in them today. Tap it to shrink it to the time; drag it to move it.',
    { on: prefs.on, onchange: (on) => void save({ on }) },
    permissions,
    h('div', { class: 'field-label' }, h('span', {}, 'Size'), segments('Timer size', [{ label: 'Normal', on: true }, { label: 'Small', on: false }], prefs.size === 'normal', (normal) => void save({ size: normal ? 'normal' : 'small' }))),
  )
}

function sleepCard(prefs: SleepPrefs, permissions: HTMLElement): { el: HTMLElement; refresh(): Promise<void>; lock(locked: boolean): void } {
  const save = async (change: Partial<SleepPrefs>) => {
    Object.assign(prefs, change)
    await savePrefs('sleep', prefs)
    await refresh()
  }

  // Where it's at now, with Sleep now or I'm up.
  const status = h('span', { class: 'phone-sleep-status' })
  const button = h('button', { type: 'button', class: 'btn btn-small' })
  function showState(state: SleepState) {
    const asleep = state.phase === 'asleep'
    status.textContent =
      asleep ? `Sleep mode until ${formatTime(state.end)}.`
      : state.phase === 'wind_down' ? `Winding down: bedtime at ${formatTime(state.start)}.`
      : `Bedtime at ${clockLabel(prefs.bed)}.`
    button.textContent = asleep ? 'I’m up' : 'Sleep now'
    button.onclick = async () => showState(await sleepNow(!asleep))
  }
  const refresh = async () => showState(await sleepState())

  const time = (label: string, key: 'bed' | 'wake') => {
    const input = h('input', { class: 'input phone-time', type: 'time', value: prefs[key], 'aria-label': label, onchange: () => {
      const t = parseClock(input.value)
      if (t) void save({ [key]: t })
    } })
    return h('label', { class: 'field-label' }, h('span', {}, label), input)
  }


  const strength = h('input', { type: 'range', min: 0, max: 100, step: 10, class: 'range', 'aria-label': 'Filter strength' })
  strength.value = String(prefs.strength)
  const strengthShown = h('span', { class: 'range-value' })
  const showStrength = () => (strengthShown.textContent = `${strength.value}%`)
  strength.addEventListener('input', showStrength)
  strength.addEventListener('change', () => void save({ strength: Number(strength.value) }))
  showStrength()

  // While a block holds, its bedtime can't move (the blocker's Bedtime follows it).
  const times = h('div', { class: 'phone-sleep-times' }, time('Bedtime', 'bed'), time('Wake time', 'wake'))
  const nights = dayToggles('Nights', prefs.nights, (nights) => void save({ nights }))
  const lock = (locked: boolean) => {
    for (const el of [...times.querySelectorAll('input'), ...nights.querySelectorAll('button')]) el.disabled = locked
  }

  const el = card(
    'Sleep mode',
    'From bedtime to wake time, a warm, dim filter over the screen and a reminder to sleep while it’s on. The filter fades in over the 30 minutes before.',
    { on: prefs.on, onchange: (on) => void save({ on }) },
    h('div', { class: 'phone-sleep-now' }, status, button),
    permissions,
    times,
    h('div', { class: 'field-label' }, h('span', {}, 'Nights'), nights),
    h('div', { class: 'field-label' }, h('span', { class: 'range-head' }, 'Filter strength', strengthShown), strength),
    h('div', { class: 'field-label' }, h('span', {}, 'While the screen is on, a reminder every'), segments('Reminder every', [5, 10, 15, 30].map((m) => ({ label: `${m} min`, on: m })), prefs.every, (every) => void save({ every }))),
  )
  return { el, refresh, lock }
}

// The distracting apps first, then every other app to add, behind a fold. An app ticked
// or unticked stays where it is until the screen is opened again.
function appsCard(prefs: TimerPrefs, onchange: () => void): { el: HTMLElement; lock(locked: boolean): void } {
  const count = h('span', { class: 'phone-apps-count' })
  const mine = h('ul', { class: 'phone-apps' }, h('li', { class: 'settings-note' }, 'Loading apps…'))
  const others = h('ul', { class: 'phone-apps' })
  const more = h('details', { class: 'phone-apps-box', hidden: true }, h('summary', {}, 'Other apps'), others)
  let apps: PhoneApp[] = []
  const counted = (a: PhoneApp) => prefs.apps[a.pkg] ?? a.social
  const showCount = () => (count.textContent = `${apps.filter(counted).length}`)

  const row = (a: PhoneApp) => {
    const box = h('input', { type: 'checkbox', class: 'phone-app-check', 'aria-label': a.name, ...(counted(a) && { checked: true }) })
    box.addEventListener('change', async () => {
      // Only a change from the default is kept, so the default can follow the app.
      const changed = { ...prefs.apps }
      if (box.checked === a.social) delete changed[a.pkg]
      else changed[a.pkg] = box.checked
      prefs.apps = changed
      showCount()
      await savePrefs('timer', prefs)
      onchange()
    })
    return h('li', {}, h('label', { class: 'phone-app' }, h('img', { src: a.icon, alt: '', width: 32, height: 32 }), h('span', { class: 'phone-app-name' }, a.name), box))
  }

  // The icons take a moment: the rest of the screen doesn't wait for them.
  void phoneApps().then((list) => {
    apps = list
    const yes = apps.filter(counted)
    mine.replaceChildren(...(yes.length ? yes.map(row) : [h('li', { class: 'settings-note' }, 'None yet: add some from Other apps.')]))
    others.replaceChildren(...apps.filter((a) => !counted(a)).map(row))
    more.hidden = false
    showCount()
  })

  const lock = (locked: boolean) => {
    for (const box of el.querySelectorAll('input')) box.disabled = locked
  }
  const el = h(
    'section',
    { class: 'settings-section wb-card' },
    h('div', { class: 'wb-head' }, h('h2', {}, 'Distracting apps'), count),
    h('p', { class: 'settings-note' }, 'The apps the timer counts and the blocker blocks. Social apps are in to start with; tick any other app to add it.'),
    mine,
    more,
  )
  return { el, lock }
}

export async function renderWellbeingScreen(): Promise<HTMLElement> {
  const header = h('header', { class: 'locus-header' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back() }, backIcon()), h('div', { class: 'locus-title' }, h('span', { class: 'header-kicker' }, 'Loci'), h('h1', {}, 'Wellbeing')))
  const body = h('main', { class: 'locus-body wb-body' })
  const screen = h('div', { class: 'settings-screen wellbeing-screen' }, header, body)
  if (!inAndroidApp) {
    body.append(h('p', { class: 'settings-note' }, 'Wellbeing is in the Android app.'))
    return screen
  }

  const [info, initial, phone] = await Promise.all([appInfo(), phonePermissions(), phonePrefs()])
  const timerPrefs: TimerPrefs = { ...DEFAULT_TIMER, ...(phone.timer as Partial<TimerPrefs> | undefined) }
  const sleepPrefs: SleepPrefs = { ...DEFAULT_SLEEP, ...(phone.sleep as Partial<SleepPrefs> | undefined) }
  // The blocker is app 1.6 (build 8).
  const blockerPrefs: BlockerPrefs | null = info.build >= 8 ? { ...DEFAULT_BLOCKER, ...(phone.blocker as Partial<BlockerPrefs> | undefined) } : null

  // Each card shows only what it still needs allowed.
  const timerNeeds = permissionLines(['accessibility'], info)
  const sleepNeeds = permissionLines(['accessibility', 'writeSettings'], info)
  const showNeeds = (state: PhonePermissions) => {
    timerNeeds.show(state)
    sleepNeeds.show(state)
  }
  timerNeeds.onchange = sleepNeeds.onchange = showNeeds
  showNeeds(initial)

  // An app from before the timer (1.2) doesn't report Accessibility; sleep mode is 1.3.
  const timerSupported = initial.accessibility !== undefined
  const today = timerSupported ? todayCard(timerPrefs, blockerPrefs) : null
  const sleep = info.build >= 5 ? sleepCard(sleepPrefs, sleepNeeds.el) : null
  const apps = timerSupported ? appsCard(timerPrefs, () => void today!.refresh()) : null
  const blocker = blockerPrefs
    ? blockerCard(blockerPrefs, await blockerState(), (state) => {
        today?.showBlock(state)
        void today?.refresh()
        apps?.lock(state.locked)
        sleep?.lock(state.locked && blockerPrefs.rules.some((r) => r.kind === 'bedtime' && r.on))
      })
    : null
  await Promise.all([today?.refresh(), sleep?.refresh()])

  body.append(
    ...(today ? [today.el] : []),
    blocker?.el ?? update('1.6', 'Blocker', 'the blocker'),
    timerSupported ? timerCard(timerPrefs, () => void today!.refresh(), timerNeeds.el) : update('1.2', 'Timer', 'the timer'),
    sleep?.el ?? update('1.3', 'Sleep mode', 'sleep mode'),
    ...(apps ? [apps.el] : []),
  )

  // Back from a system screen (or Loci brought back later): show what's true now.
  const stop = onAppResume(async () => {
    if (!screen.isConnected) return stop()
    showNeeds(await phonePermissions())
    await Promise.all([today?.refresh(), sleep?.refresh(), blocker?.refresh()])
  })
  return screen
}
