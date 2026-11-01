// Notifications in the Android app (SPEC-v6-android.md, "Notifications"). Loci works out
// what to remind and when, for the next 7 days, and hands the whole list to the phone,
// which shows each at its time even with Loci closed. The list is sent again whenever
// anything changes, so it never goes stale while Loci is open.
//
// - A to-do with a time reminds at that time; a repeat at each occurrence.
// - The daily summary (default 09:00) shows what the Now card will show then.
// Done tapped on a notification is queued on the phone and applied here on the next open.

import { liveQuery } from 'dexie'
import { inAndroidApp, onAppResume, phonePrefs, sendSchedule, takePhoneActions, type Reminder } from './android'
import { announceChange } from './changes'
import { openLooseTodo } from './elements/todos/type'
import { completeTodo, LOOSE } from './elements/todos/store'
import { dueOf, occurrencesBetween } from './elements/todos/when'
import { nowCandidates } from './now/candidates'
import { go, subHash } from './router'
import { db, getElement } from './store/db'
import { allTasks } from './tasks/tasks'
import type { Task } from './elements/registry'
import type { Todo } from './types'

const DAY = 86_400_000
const AHEAD_DAYS = 7
const MAX_REMINDERS = 200 // far more than a week of to-dos; keeps the list small to store

export interface ReminderPrefs {
  todoReminders: boolean
  summaryAt: string | null // "09:00", or null for no summary
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { todoReminders: true, summaryAt: '09:00' }

export async function reminderPrefs(): Promise<ReminderPrefs> {
  const p = (await phonePrefs()) ?? {} // nothing from an app before D2
  return { ...DEFAULT_REMINDER_PREFS, ...(p.reminders as Partial<ReminderPrefs> | undefined) }
}

// The to-dos' reminders from now to `until`, and the occurrence each timed to-do is on.
export async function todoReminders(now: number, until: number): Promise<{ reminders: Reminder[]; pending: Record<string, number> }> {
  const open = await db.todos.where('status').equals('open').toArray()
  const reminders: Reminder[] = []
  const pending: Record<string, number> = {}
  const places = new Map<string, string>()
  async function place(t: Todo): Promise<string> {
    if (t.elementId === LOOSE) return 'To-dos'
    if (!places.has(t.elementId)) {
      const el = await getElement(t.elementId)
      places.set(t.elementId, (el && (await db.loci.get(el.locusId))?.name) || '')
    }
    return places.get(t.elementId)!
  }
  for (const t of open) {
    const when = t.when
    let times: number[]
    if (when.kind === 'at' && when.hasTime) times = [when.at]
    else if (when.kind === 'repeat' && when.time) times = occurrencesBetween(when, Math.max(now + 1, when.next), until)
    else continue // no time of day: the daily summary covers it
    pending[t.id] = dueOf(when, now)!
    const body = [await place(t), t.plan?.firstStep && `Start: ${t.plan.firstStep}`].filter(Boolean).join(' · ')
    for (const at of times) {
      if (at > now && at <= until) reminders.push({ key: `todo:${t.id}:${at}`, at, kind: 'todo', title: t.title, body, todoId: t.id, occurrenceAt: at })
    }
  }
  return { reminders: reminders.sort((a, b) => a.at - b.at), pending }
}

// The daily summary at `at`: the Now card as it will be then, and the cards due. Nothing
// to show (nothing due, no cards) means no summary that day.
export async function summaryAt(at: number): Promise<Reminder | null> {
  const tasks = await allTasks(at)
  const top: Task | undefined = (await nowCandidates(tasks, at))[0]
  const cards = tasks.filter((t) => t.kind === 'review' && (t.state === 'due' || t.state === 'overdue')).reduce((n, t) => n + (t.study?.cards ?? 0), 0)
  if (!top && cards === 0) return null
  const name = top?.kind === 'review' ? `Study · ${(await db.loci.get(top.locusId))?.name ?? ''}` : top?.label
  return {
    key: `summary:${at}`,
    at,
    kind: 'summary',
    title: name ? `Now: ${name}` : 'Cards to study',
    body: [top?.rank?.why, cards > 0 && `${cards} ${cards === 1 ? 'card' : 'cards'} due`].filter(Boolean).join(' · '),
  }
}

// The summary times in the next 7 days, after now.
export function summaryTimes(clock: string, now: number): number[] {
  const [hh, mm] = clock.split(':').map(Number)
  const out: number[] = []
  for (let d = 0; d <= AHEAD_DAYS; d++) {
    const t = new Date(now + d * DAY)
    t.setHours(hh, mm, 0, 0)
    if (t.getTime() > now && t.getTime() <= now + AHEAD_DAYS * DAY) out.push(t.getTime())
  }
  return out
}

export async function buildSchedule(prefs: ReminderPrefs, now = Date.now()): Promise<{ reminders: Reminder[]; pending: Record<string, number> }> {
  const until = now + AHEAD_DAYS * DAY
  const todos = prefs.todoReminders ? await todoReminders(now, until) : { reminders: [], pending: {} }
  const summaries = prefs.summaryAt ? await Promise.all(summaryTimes(prefs.summaryAt, now).map(summaryAt)) : []
  const reminders = [...todos.reminders, ...summaries.filter((s): s is Reminder => s != null)].sort((a, b) => a.at - b.at).slice(0, MAX_REMINDERS)
  return { reminders, pending: todos.pending }
}

// Changes come in bursts (a sheet saving several things): send once they settle.
let timer: ReturnType<typeof setTimeout> | undefined
export function scheduleReminders(delay = 2_000): void {
  if (!inAndroidApp) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    void reminderPrefs()
      .then((prefs) => buildSchedule(prefs))
      .then(sendSchedule)
      .catch((err) => console.error('Reminders not sent', err))
  }, delay)
}

// Keeps the phone's list current: on open, whenever a to-do changes (here or from another
// device), when Loci comes back to the front, and as it goes to the back (the summaries
// then show what's due as of now).
export function watchReminders(): void {
  if (!inAndroidApp) return
  void applyPhoneActions().finally(() => scheduleReminders(0))
  liveQuery(() => db.todos.where('status').equals('open').toArray()).subscribe(() => scheduleReminders())
  onAppResume(() => void applyPhoneActions().finally(() => scheduleReminders(0)))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') scheduleReminders(0)
  })
}

// Done on a notification counts for the occurrence it was about, at the time it was
// tapped, unless that occurrence was already dealt with (here or on another device).
export async function applyQueuedDone(id: string, occurrenceAt: number, at: number): Promise<boolean> {
  const t = await db.todos.get(id)
  if (!t || t.status !== 'open') return false
  if (t.when.kind === 'repeat' ? t.when.next > occurrenceAt : dueOf(t.when, at) !== occurrenceAt) return false
  await completeTodo(id, at)
  return true
}

// Done taps and notification taps from while Loci wasn't looking.
export async function applyPhoneActions(): Promise<void> {
  if (!inAndroidApp) return
  let changed = false
  // An app from before D2 (1.0.x) answers with nothing.
  for (const action of (await takePhoneActions()) ?? []) {
    if (action.type === 'done') changed = (await applyQueuedDone(action.id, action.occurrenceAt, action.at)) || changed
    else if (action.type === 'open') await openFromNotification(action.id)
  }
  if (changed) announceChange()
}

async function openFromNotification(todoId?: string) {
  const todo = todoId ? await db.todos.get(todoId) : undefined
  if (!todo) return go('#/')
  if (todo.elementId === LOOSE) return openLooseTodo(todo.id)
  const el = await getElement(todo.elementId)
  if (el) go(subHash(el, 'todo', todo.id))
}
