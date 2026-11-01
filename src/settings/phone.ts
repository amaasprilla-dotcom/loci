// The Phone section of Settings, only in the Android app (SPEC-v6-android.md, "Settings →
// Phone"): what each phone feature needs allowed, with a way to the screen that allows it.

import { allowOnPhone, appInfo, inAndroidApp, onAppResume, type PhonePermission, type PhonePermissions, phonePermissions } from '../android'
import { h } from '../dom'

const LINES: { which: PhonePermission; name: string; why: string }[] = [
  { which: 'notifications', name: 'Notifications', why: 'Reminders for to-dos, and the daily summary.' },
  { which: 'usageAccess', name: 'Usage access', why: 'Seeing when a social app is open, for the timer.' },
  { which: 'overlay', name: 'Display over other apps', why: 'The timer, the sleep filter and its reminders.' },
  { which: 'writeSettings', name: 'Modify system settings', why: 'Turning the brightness down in sleep mode. Optional.' },
  { which: 'battery', name: 'Unrestricted battery', why: 'Keeps reminders and the timer going while Loci is closed.' },
]

export async function phoneSection(): Promise<HTMLElement | null> {
  if (!inAndroidApp) return null
  const [info, initial] = await Promise.all([appInfo(), phonePermissions()])
  const list = h('ul', { class: 'phone-perms' })

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
  }
  show(initial)

  const section = h(
    'section',
    { class: 'settings-section' },
    h('h2', {}, 'Phone'),
    h('p', { class: 'settings-text' }, 'The social media timer, reminders and sleep mode come in the next updates of the app. What each one will need on this phone:'),
    list,
    h('p', { class: 'settings-note' }, `Loci for Android ${info.version}`),
  )
  // Back from a system screen: show what's allowed now. Stops once Settings is closed.
  const stop = onAppResume(async () => {
    if (!section.isConnected) return stop()
    show(await phonePermissions())
  })
  return section
}
