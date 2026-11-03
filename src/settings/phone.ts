// The Phone section of Settings, only in the Android app (SPEC-v6-android.md, "Settings →
// Phone"): reminder options, what each phone feature needs allowed (with a way to the
// screen that allows it) and the problems log. The timer and sleep mode are on the
// Wellbeing screen (src/wellbeing/view.ts).

import { allowOnPhone, appInfo, clearPhoneProblems, inAndroidApp, onAppResume, type PhoneProblem, phoneProblems, type PhonePermission, type PhonePermissions, phonePermissions, savePhonePrefs } from '../android'
import { h } from '../dom'
import { formatDay, formatTime, parseClock } from '../elements/todos/when'
import { type ReminderPrefs, reminderPrefs, scheduleReminders } from '../notifications'
import { go } from '../router'
import { button } from '../sheet'
import { toast } from '../toast'

const LINES: { which: PhonePermission; name: string; why: string }[] = [
  { which: 'notifications', name: 'Notifications', why: 'Reminders for to-dos, and the daily summary.' },
  { which: 'exactAlarms', name: 'Alarms and reminders', why: 'Reminders on the minute, not a few minutes late.' },
  { which: 'battery', name: 'Unrestricted battery', why: 'Keeps reminders coming while Loci is closed.' },
  { which: 'accessibility', name: 'Accessibility', why: 'Seeing which app is open, for the timer, and drawing the sleep filter. Android warns this means "full control"; Loci only notes which app is in front.' },
  { which: 'writeSettings', name: 'Modify system settings', why: 'Turning the real brightness down in sleep mode. Optional: without it the filter dims the screen.' },
]

type AppInfo = Awaited<ReturnType<typeof appInfo>>

// A line for each of `which`: Allowed, or Allow, which opens the system screen for it.
// With `missingOnly` (a Wellbeing card) only what still needs allowing shows. `onchange`
// hears the state after an Allow, so other lines on the screen can follow.
export function permissionLines(which: PhonePermission[], info: AppInfo, missingOnly = true) {
  const list = h('ul', { class: 'phone-perms' })
  const accessibility = h('p', { class: 'settings-note' })
  const el = h('div', { class: 'phone-perms-box' }, list, accessibility)
  const part = {
    el,
    onchange: null as ((state: PhonePermissions) => void) | null,
    show(state: PhonePermissions) {
      const lines = LINES.filter((line) => which.includes(line.which) && state[line.which] !== undefined && !(missingOnly && state[line.which]))
      list.replaceChildren(
        ...lines.map((line) =>
          h(
            'li',
            { class: 'phone-perm' },
            h('div', { class: 'phone-perm-text' }, h('span', { class: 'phone-perm-name' }, line.name), h('span', { class: 'settings-note' }, line.why)),
            state[line.which]
              ? h('span', { class: 'phone-perm-allowed' }, 'Allowed')
              : h('button', { type: 'button', class: 'btn btn-small', onclick: async () => {
                  const now = await allowOnPhone(line.which)
                  if (part.onchange) part.onchange(now)
                  else part.show(now)
                } }, 'Allow'),
          ),
        ),
      )
      el.hidden = lines.length === 0
      accessibility.hidden = !which.includes('accessibility') || state.accessibility !== false
      accessibility.textContent =
        ((info.sdk ?? 0) >= 33 ? 'For Accessibility, first allow it in App info for Loci → ⋮ → Allow restricted settings. Then ' : 'For Accessibility, ') +
        'Allow opens the Accessibility screen: find Loci (under Installed apps or Installed services) and switch it on.'
    },
  }
  return part
}

export function segments<T>(label: string, options: { label: string; on: T }[], value: T, onpick: (on: T) => void): HTMLElement {
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
    await savePhonePrefs('reminders', { ...prefs })
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

// What went wrong on this phone (crashes, freezes, errors), to copy and send when something
// misbehaves. Only from the 1.4 app on.
async function problemsPart(): Promise<HTMLElement[]> {
  const list = h('ul', { class: 'phone-problems' })
  const note = h('p', { class: 'settings-note' })
  const actions = h('div', { class: 'settings-actions' })
  let problems: PhoneProblem[] = []
  const when = (at: number) => `${formatDay(at, Date.now())} ${formatTime(at)}`
  const asText = () => problems.map((p) => `${new Date(p.at).toISOString()} · ${p.what} · ${p.version}${p.detail ? `\n${p.detail}` : ''}`).join('\n\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText())
    } catch {
      // Without clipboard access: the old way, through a selected text box.
      const box = h('textarea', { style: { position: 'fixed', opacity: '0' } })
      box.value = asText()
      document.body.append(box)
      box.select()
      document.execCommand('copy')
      box.remove()
    }
    toast('Copied')
  }

  async function show() {
    problems = (await phoneProblems()) ?? []
    note.textContent = problems.length === 0 ? 'Nothing has gone wrong on this phone.' : 'What went wrong on this phone, newest first. Copy it and send it on to get it looked at.'
    list.replaceChildren(...problems.slice(0, 10).map((p) => h('li', {}, h('span', { class: 'phone-problem-when' }, when(p.at)), ' ', p.what)))
    actions.replaceChildren(
      ...(problems.length === 0
        ? []
        : [
            button('Copy', () => void copy()),
            button('Clear', async () => {
              await clearPhoneProblems()
              await show()
            }),
          ]),
    )
  }
  await show()
  return [h('span', { class: 'phone-kicker' }, 'Problems'), note, list, actions]
}

export async function phoneSection(): Promise<HTMLElement | null> {
  if (!inAndroidApp) return null
  const [info, initial, reminders] = await Promise.all([appInfo(), phonePermissions(), remindersPart()])
  const problems = info.build >= 6 ? await problemsPart() : [] // 1.4
  const perms = permissionLines(LINES.map((line) => line.which), info, false)
  const samsung = h('p', { class: 'settings-note' })

  function show(state: PhonePermissions) {
    perms.show(state)
    // Samsung's sleeping-apps list is its own, and no app can see or change it.
    samsung.hidden = !state.samsung
    samsung.textContent =
      'On a Samsung, one more step: Settings → Battery and device care → Battery → Background usage limits → Never sleeping apps → add Loci. Otherwise the phone may pause Loci and hold reminders back.'
  }
  perms.onchange = show
  show(initial)

  const section = h(
    'section',
    { class: 'settings-section' },
    h('h2', {}, 'Phone'),
    ...reminders,
    h('span', { class: 'phone-kicker' }, 'Wellbeing'),
    h('p', { class: 'settings-note' }, 'The timer, sleep mode and your distracting apps have a screen of their own.'),
    button('Open Wellbeing', () => go('#/wellbeing')),
    h('span', { class: 'phone-kicker' }, 'Allowed on this phone'),
    perms.el,
    samsung,
    ...problems,
    h('p', { class: 'settings-note' }, `Loci for Android ${info.version}`),
  )
  // Back from a system screen: show what's allowed now. Stops once Settings is closed.
  const stop = onAppResume(async () => {
    if (!section.isConnected) return stop()
    show(await phonePermissions())
  })
  return section
}
