// The Phone section of Settings, only in the Android app (SPEC-v6-android.md, "Settings →
// Phone"): reminder, timer and sleep mode options, and what each phone feature needs
// allowed, with a way to the screen that allows it.

import { allowOnPhone, appInfo, inAndroidApp, onAppResume, type PhoneApp, phoneApps, type PhonePermission, type PhonePermissions, phonePermissions, phonePrefs, setPhonePrefs, type SleepState, sleepNow, sleepState, timerToday } from '../android'
import { h } from '../dom'
import { formatTime, parseClock } from '../elements/todos/when'
import { type ReminderPrefs, reminderPrefs, scheduleReminders } from '../notifications'

const LINES: { which: PhonePermission; name: string; why: string }[] = [
  { which: 'notifications', name: 'Notifications', why: 'Reminders for to-dos, and the daily summary.' },
  { which: 'exactAlarms', name: 'Alarms and reminders', why: 'Reminders on the minute, not a few minutes late.' },
  { which: 'battery', name: 'Unrestricted battery', why: 'Keeps reminders coming while Loci is closed.' },
  { which: 'accessibility', name: 'Accessibility', why: 'Seeing which app is open, for the timer, and drawing the sleep filter. Android warns this means "full control"; Loci only notes which app is in front.' },
  { which: 'writeSettings', name: 'Modify system settings', why: 'Turning the real brightness down in sleep mode. Optional: without it the filter dims the screen.' },
]

function segments<T>(label: string, options: { label: string; on: T }[], value: T, onpick: (on: T) => void): HTMLElement {
  const buttons = options.map((o) =>
    h('button', { type: 'button', class: 'segment', role: 'radio', 'aria-checked': String(o.on === value), onclick: () => {
      buttons.forEach((b, i) => b.setAttribute('aria-checked', String(options[i].on === o.on)))
      onpick(o.on)
    } }, o.label),
  )
  return h('div', { class: options.length === 2 ? 'segments segments-2' : 'segments', role: 'radiogroup', 'aria-label': label }, buttons)
}

async function remindersPart(): Promise<HTMLElement[]> {
  const prefs = await reminderPrefs()
  async function save(change: Partial<ReminderPrefs>) {
    Object.assign(prefs, change)
    await setPhonePrefs({ ...(await phonePrefs()), reminders: prefs })
    scheduleReminders(0)
  }

  let lastTime = prefs.summaryAt ?? '09:00'
  const time = h('input', { class: 'input phone-time', type: 'time', value: lastTime, 'aria-label': 'Daily summary time', onchange: () => {
    const t = parseClock(time.value)
    if (!t) return
    lastTime = t
    void save({ summaryAt: t })
  } })
  time.hidden = prefs.summaryAt == null

  return [
    h('span', { class: 'phone-kicker' }, 'Reminders'),
    h('p', { class: 'settings-note' }, 'A to-do with a time reminds you then, with Done and In 1 hour.'),
    segments('To-do reminders', [{ label: 'On', on: true }, { label: 'Off', on: false }], prefs.todoReminders, (on) => void save({ todoReminders: on })),
    h('p', { class: 'settings-note' }, 'The daily summary: what the Now card shows, and the cards due.'),
    segments('Daily summary', [{ label: 'On', on: true }, { label: 'Off', on: false }], prefs.summaryAt != null, (on) => {
      time.hidden = !on
      void save({ summaryAt: on ? lastTime : null })
    }),
    time,
  ]
}

// The social media timer's settings, kept on the phone where WatchService reads them.
export interface TimerPrefs {
  on: boolean
  resetMin: number // away this long and the clock starts again at 0:00
  size: 'normal' | 'small'
  apps: Record<string, boolean> // apps switched on or off by hand; the rest go by default
}

const DEFAULT_TIMER: TimerPrefs = { on: false, resetMin: 5, size: 'normal', apps: {} }

// "1 h 12 min", "4 min".
export function spent(ms: number): string {
  const min = Math.floor(ms / 60_000)
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`
}

async function timerPart(supported: boolean): Promise<{ els: HTMLElement[]; refresh(): Promise<void> }> {
  const kicker = h('span', { class: 'phone-kicker' }, 'Social media timer')
  if (!supported) {
    const update = h('p', { class: 'settings-note' }, 'Install the new Loci app (1.2 or later) over this one for the social media timer.')
    return { els: [kicker, update], refresh: async () => {} }
  }
  const prefs: TimerPrefs = { ...DEFAULT_TIMER, ...((await phonePrefs()).timer as Partial<TimerPrefs> | undefined) }
  async function save(change: Partial<TimerPrefs>) {
    Object.assign(prefs, change)
    await setPhonePrefs({ ...(await phonePrefs()), timer: prefs })
  }

  const about = h('p', { class: 'settings-note' })
  const showAbout = () =>
    (about.textContent = `A small timer over social apps counts your time in them, one clock across all of them. It starts again at 0:00 once you've been away ${prefs.resetMin} min.`)
  showAbout()
  const today = h('p', { class: 'settings-note' })
  const refresh = async () => {
    today.textContent = `Today: ${spent(await timerToday())} in social apps`
  }
  await refresh()

  const reset = h('input', { type: 'range', min: 1, max: 30, step: 1, class: 'range', 'aria-label': 'Starts again after' })
  reset.value = String(prefs.resetMin)
  const resetShown = h('span', { class: 'range-value' })
  const showReset = () => (resetShown.textContent = `${reset.value} min away`)
  reset.addEventListener('input', showReset)
  reset.addEventListener('change', () => {
    void save({ resetMin: Number(reset.value) })
    showAbout()
  })
  showReset()

  const options = h(
    'div',
    { class: 'phone-timer-options' },
    h('div', { class: 'field-label' }, h('span', { class: 'range-head' }, 'Starts again after', resetShown), reset),
    h('p', { class: 'settings-note' }, 'The timer’s size. Tap it to shrink it to just the time; drag it to move it.'),
    segments('Timer size', [{ label: 'Normal', on: true }, { label: 'Small', on: false }], prefs.size === 'normal', (normal) => void save({ size: normal ? 'normal' : 'small' })),
    appList(prefs, (apps) => void save({ apps })),
  )
  options.hidden = !prefs.on

  return {
    els: [
      kicker,
      about,
      segments('Social media timer', [{ label: 'On', on: true }, { label: 'Off', on: false }], prefs.on, (on) => {
        options.hidden = !on
        void save({ on })
      }),
      today,
      options,
    ],
    refresh,
  }
}

// Which apps count, loaded the first time it's opened (the icons take a moment).
function appList(prefs: TimerPrefs, onchange: (apps: Record<string, boolean>) => void): HTMLElement {
  const count = h('span', { class: 'phone-apps-count' })
  const list = h('ul', { class: 'phone-apps' })
  let apps: PhoneApp[] = []
  const counted = (a: PhoneApp) => prefs.apps[a.pkg] ?? a.social
  const showCount = () => (count.textContent = `${apps.filter(counted).length} counted`)

  const details = h('details', { class: 'phone-apps-box' }, h('summary', {}, 'Apps that count', count), list)
  details.addEventListener('toggle', async () => {
    if (!details.open || apps.length) return
    list.replaceChildren(h('li', { class: 'settings-note' }, 'Loading apps…'))
    apps = await phoneApps()
    list.replaceChildren(
      ...apps.map((a) => {
        const box = h('input', { type: 'checkbox', class: 'phone-app-check', 'aria-label': a.name, ...(counted(a) && { checked: true }) })
        box.addEventListener('change', () => {
          // Only a change from the default is kept, so the default can follow the app.
          const changed = { ...prefs.apps }
          if (box.checked === a.social) delete changed[a.pkg]
          else changed[a.pkg] = box.checked
          onchange(changed)
          showCount()
        })
        return h('li', {}, h('label', { class: 'phone-app' }, h('img', { src: a.icon, alt: '', width: 32, height: 32 }), h('span', { class: 'phone-app-name' }, a.name), box))
      }),
    )
    showCount()
  })
  return details
}

// Sleep mode's settings, kept on the phone where WatchService reads them.
export interface SleepPrefs {
  on: boolean
  bed: string // "23:30"
  wake: string // "07:00"
  nights: number[] // the days bedtime falls on, 0 = Sunday
  strength: number // the filter, 0–100
  every: number // minutes between reminders while the screen is on
}

const DEFAULT_SLEEP: SleepPrefs = { on: false, bed: '23:30', wake: '07:00', nights: [0, 1, 2, 3, 4, 5, 6], strength: 60, every: 10 }

const clockLabel = (clock: string) => {
  const [hh, mm] = clock.split(':').map(Number)
  return formatTime(new Date().setHours(hh, mm, 0, 0))
}

async function sleepPart(supported: boolean): Promise<{ els: HTMLElement[]; refresh(): Promise<void> }> {
  const kicker = h('span', { class: 'phone-kicker' }, 'Sleep mode')
  if (!supported) {
    const update = h('p', { class: 'settings-note' }, 'Install the new Loci app (1.3 or later) over this one for sleep mode.')
    return { els: [kicker, update], refresh: async () => {} }
  }
  const prefs: SleepPrefs = { ...DEFAULT_SLEEP, ...((await phonePrefs()).sleep as Partial<SleepPrefs> | undefined) }
  async function save(change: Partial<SleepPrefs>) {
    Object.assign(prefs, change)
    await setPhonePrefs({ ...(await phonePrefs()), sleep: prefs })
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
  await refresh()

  const time = (label: string, key: 'bed' | 'wake') => {
    const input = h('input', { class: 'input phone-time', type: 'time', value: prefs[key], 'aria-label': label, onchange: () => {
      const t = parseClock(input.value)
      if (t) void save({ [key]: t })
    } })
    return h('label', { class: 'field-label' }, h('span', {}, label), input)
  }

  // Monday first; each a toggle.
  const dayName = (d: number) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2026, 10, 1 + d)) // 1 Nov 2026 was a Sunday
  const nights = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const b = h('button', { type: 'button', class: 'segment', 'aria-pressed': String(prefs.nights.includes(d)), onclick: () => {
      const on = !prefs.nights.includes(d)
      b.setAttribute('aria-pressed', String(on))
      void save({ nights: on ? [...prefs.nights, d].sort((x, y) => x - y) : prefs.nights.filter((n) => n !== d) })
    } }, dayName(d))
    return b
  })

  const strength = h('input', { type: 'range', min: 0, max: 100, step: 10, class: 'range', 'aria-label': 'Filter strength' })
  strength.value = String(prefs.strength)
  const strengthShown = h('span', { class: 'range-value' })
  const showStrength = () => (strengthShown.textContent = `${strength.value}%`)
  strength.addEventListener('input', showStrength)
  strength.addEventListener('change', () => void save({ strength: Number(strength.value) }))
  showStrength()

  const options = h(
    'div',
    { class: 'phone-timer-options' },
    h('div', { class: 'phone-sleep-now' }, status, button),
    h('div', { class: 'phone-sleep-times' }, time('Bedtime', 'bed'), time('Wake time', 'wake')),
    h('div', { class: 'field-label' }, h('span', {}, 'Nights'), h('div', { class: 'segments phone-nights', role: 'group', 'aria-label': 'Nights' }, nights)),
    h('div', { class: 'field-label' }, h('span', { class: 'range-head' }, 'Filter strength', strengthShown), strength),
    h('p', { class: 'settings-note' }, 'While the screen is on, a reminder every:'),
    segments('Reminder every', [5, 10, 15, 30].map((m) => ({ label: `${m} min`, on: m })), prefs.every, (every) => void save({ every })),
  )
  options.hidden = !prefs.on

  return {
    els: [
      kicker,
      h('p', { class: 'settings-note' }, 'From bedtime to wake time, a warm, dim filter over the screen and a reminder to sleep while it’s on. The filter fades in over the 30 minutes before.'),
      segments('Sleep mode', [{ label: 'On', on: true }, { label: 'Off', on: false }], prefs.on, (on) => {
        options.hidden = !on
        void save({ on })
      }),
      options,
    ],
    refresh,
  }
}

export async function phoneSection(): Promise<HTMLElement | null> {
  if (!inAndroidApp) return null
  const [info, initial, reminders] = await Promise.all([appInfo(), phonePermissions(), remindersPart()])
  // An app from before the timer doesn't report Accessibility.
  const timer = await timerPart(initial.accessibility !== undefined)
  const sleep = await sleepPart(info.build >= 5) // 1.3
  const list = h('ul', { class: 'phone-perms' })
  const accessibility = h('p', { class: 'settings-note' })
  const samsung = h('p', { class: 'settings-note' })

  function show(state: PhonePermissions) {
    list.replaceChildren(
      ...LINES.filter((line) => state[line.which] !== undefined).map((line) =>
        h(
          'li',
          { class: 'phone-perm' },
          h('div', { class: 'phone-perm-text' }, h('span', { class: 'phone-perm-name' }, line.name), h('span', { class: 'settings-note' }, line.why)),
          state[line.which]
            ? h('span', { class: 'phone-perm-allowed' }, 'Allowed')
            : h('button', { type: 'button', class: 'btn btn-small', onclick: async () => show(await allowOnPhone(line.which)) }, 'Allow'),
        ),
      ),
    )
    accessibility.hidden = state.accessibility !== false
    accessibility.textContent =
      ((info.sdk ?? 0) >= 33 ? 'For Accessibility, first allow it in App info for Loci → ⋮ → Allow restricted settings. Then ' : 'For Accessibility, ') +
      'Allow opens the Accessibility screen: find Loci (under Installed apps or Installed services) and switch it on.'
    // Samsung's sleeping-apps list is its own, and no app can see or change it.
    samsung.hidden = !state.samsung
    samsung.textContent =
      'On a Samsung, one more step: Settings → Battery and device care → Battery → Background usage limits → Never sleeping apps → add Loci. Otherwise the phone may pause Loci and hold reminders back.'
  }
  show(initial)

  const section = h(
    'section',
    { class: 'settings-section' },
    h('h2', {}, 'Phone'),
    ...reminders,
    ...timer.els,
    ...sleep.els,
    h('span', { class: 'phone-kicker' }, 'Allowed on this phone'),
    list,
    accessibility,
    samsung,
    h('p', { class: 'settings-note' }, `Loci for Android ${info.version}`),
  )
  // Back from a system screen: show what's allowed now. Stops once Settings is closed.
  const stop = onAppResume(async () => {
    if (!section.isConnected) return stop()
    show(await phonePermissions())
    await timer.refresh()
    await sleep.refresh()
  })
  return section
}
