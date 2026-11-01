// The Android app (SPEC-v6-android.md): Loci runs in its WebView, and the native side
// answers messages on window.LociAndroid (android/…/Bridge.kt). In a browser there is
// no LociAndroid and nothing here runs.

interface NativePort {
  postMessage(message: string): void
  addEventListener(type: 'message', listener: (e: MessageEvent<string>) => void): void
}

declare global {
  interface Window {
    LociAndroid?: NativePort
    // Android's back button asks this first; false lets the app leave Loci.
    lociBack?: () => boolean
  }
}

export interface PhonePermissions {
  notifications: boolean
  // Loci's accessibility service is running: the timer sees which app is open. Missing in
  // an app from before the timer (1.1 and earlier).
  accessibility?: boolean
  writeSettings: boolean
  battery: boolean // excluded from battery optimisation
  exactAlarms: boolean // reminders on the minute
  samsung: boolean // a Samsung phone: its sleeping-apps list needs Loci added by hand
}

export type PhonePermission = Exclude<keyof PhonePermissions, 'samsung'>

// One notification for the phone to show at `at` (src/notifications.ts).
export interface Reminder {
  key: string
  at: number
  kind: 'todo' | 'summary'
  title: string
  body: string
  todoId?: string
  occurrenceAt?: number
}

// What happened on the phone while Loci wasn't looking.
export type PhoneAction = { type: 'done'; id: string; occurrenceAt: number; at: number } | { type: 'open'; id?: string }

// (No window at all in the unit tests.)
const port = typeof window === 'undefined' ? undefined : window.LociAndroid
export const inAndroidApp = port != null

let nextId = 1
const waiting = new Map<number, (result: unknown) => void>()
port?.addEventListener('message', (e) => {
  const { id, result } = JSON.parse(e.data) as { id: number; result: unknown }
  waiting.get(id)?.(result)
  waiting.delete(id)
})

function ask<T>(type: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!port) return Promise.reject(new Error('Not in the Android app'))
  const id = nextId++
  return new Promise((resolve) => {
    waiting.set(id, resolve as (result: unknown) => void)
    port.postMessage(JSON.stringify({ id, type, ...args }))
  })
}

export const appInfo = () => ask<{ version: string; build: number; sdk?: number }>('info')
export const phonePermissions = () => ask<PhonePermissions>('permissions')
// Opens the system screen (or pop-up) for it; the answer is the state right after.
export const allowOnPhone = (which: PhonePermission) => ask<PhonePermissions>('allow', { which })

// The phone's own settings (reminders, the timer, sleep mode): kept on the phone, where
// they work with Loci closed, and never synced.
export const phonePrefs = () => ask<Record<string, unknown>>('getPrefs')
export const setPhonePrefs = (prefs: Record<string, unknown>) => ask<boolean>('setPrefs', { prefs })

// An app installed on the phone, for the timer's app list (icon as a data: address).
export interface PhoneApp {
  pkg: string
  name: string
  icon: string
  social: boolean // counted unless switched off: it says it's social, or it's a well-known one
}

export const phoneApps = () => ask<PhoneApp[]>('apps')
// Milliseconds in social apps today.
export const timerToday = () => ask<number>('timerToday')

// Where sleep mode is now: tonight's sleep (or Sleep now's) runs from `start` to `end`.
export interface SleepState {
  phase: 'off' | 'wind_down' | 'asleep'
  start: number
  end: number
}

export const sleepState = () => ask<SleepState>('sleepState')
// true: sleep now, until the next wake time; false: I'm up, until tomorrow night.
export const sleepNow = (on: boolean) => ask<SleepState>('sleepNow', { on })

// Replaces every reminder the phone has with these; `pending` is each timed to-do's
// current occurrence, so a reminder put off for an hour is dropped once that's done.
export const sendSchedule = (schedule: { reminders: Reminder[]; pending: Record<string, number> }) => ask<boolean>('schedule', { schedule })
export const takePhoneActions = () => ask<PhoneAction[]>('takeActions')

// The app came back to the front (e.g. from a system settings screen).
export function onAppResume(listener: () => void): () => void {
  window.addEventListener('loci:resume', listener)
  return () => window.removeEventListener('loci:resume', listener)
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).slice((reader.result as string).indexOf(',') + 1))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// The WebView can't download blob: addresses, so files go across whole.
export async function saveOnPhone(blob: Blob, name: string): Promise<boolean> {
  return ask<boolean>('save', { name, mime: blob.type, data: await base64(blob) })
}

export async function openOnPhone(blob: Blob, name: string): Promise<boolean> {
  return ask<boolean>('open', { name, mime: blob.type, data: await base64(blob) })
}
