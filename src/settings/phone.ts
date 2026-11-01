// The Phone section of Settings, only in the Android app (SPEC-v6-android.md, "Settings →
// Phone"): reminder options, and what each phone feature needs allowed, with a way to the
// screen that allows it.

import { allowOnPhone, appInfo, inAndroidApp, onAppResume, type PhonePermission, type PhonePermissions, phonePermissions, phonePrefs, setPhonePrefs } from '../android'
import { h } from '../dom'
import { parseClock } from '../elements/todos/when'
import { type ReminderPrefs, reminderPrefs, scheduleReminders } from '../notifications'

const LINES: { which: PhonePermission; name: string; why: string }[] = [
  { which: 'notifications', name: 'Notifications', why: 'Reminders for to-dos, and the daily summary.' },
  { which: 'exactAlarms', name: 'Alarms and reminders', why: 'Reminders on the minute, not a few minutes late.' },
  { which: 'battery', name: 'Unrestricted battery', why: 'Keeps reminders coming while Loci is closed.' },
  { which: 'usageAccess', name: 'Usage access', why: 'Seeing when a social app is open, for the timer (next update).' },
  { which: 'overlay', name: 'Display over other apps', why: 'The timer and the sleep filter (next updates).' },
  { which: 'writeSettings', name: 'Modify system settings', why: 'Turning the brightness down in sleep mode (next updates). Optional.' },
]

function segments(label: string, options: { label: string; on: boolean }[], value: boolean, onpick: (on: boolean) => void): HTMLElement {
  const buttons = options.map((o) =>
    h('button', { type: 'button', class: 'segment', role: 'radio', 'aria-checked': String(o.on === value), onclick: () => {
      buttons.forEach((b, i) => b.setAttribute('aria-checked', String(options[i].on === o.on)))
      onpick(o.on)
    } }, o.label),
  )
  return h('div', { class: 'segments segments-2', role: 'radiogroup', 'aria-label': label }, buttons)
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

export async function phoneSection(): Promise<HTMLElement | null> {
  if (!inAndroidApp) return null
  const [info, initial, reminders] = await Promise.all([appInfo(), phonePermissions(), remindersPart()])
  const list = h('ul', { class: 'phone-perms' })
  const samsung = h('p', { class: 'settings-note' })

  function show(state: PhonePermissions) {
    list.replaceChildren(
      ...LINES.map((line) =>
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
    h('span', { class: 'phone-kicker' }, 'Allowed on this phone'),
    list,
    samsung,
    h('p', { class: 'settings-note' }, `Loci for Android ${info.version}`),
  )
  // Back from a system screen: show what's allowed now. Stops once Settings is closed.
  const stop = onAppResume(async () => {
    if (!section.isConnected) return stop()
    show(await phonePermissions())
  })
  return section
}
