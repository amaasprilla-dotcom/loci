// A to-do's "when" (SPEC-v2.md, "To-dos"): its state, its recurrence, typed
// phrases like "Sunday 10am gather receipts", and how it reads on screen.

import * as chrono from 'chrono-node'
import { type Options, RRule } from 'rrule'
import type { Todo, When } from '../../types'

const HOUR = 3_600_000
export const ROLLOVER_HOUR = 4 // a new day starts at 04:00, as for reviews

export type TodoState = 'overdue' | 'due' | 'upcoming' | 'waiting' | 'someday' | 'info'

// The first 04:00 strictly after t: when something due at t turns overdue.
export function nextRollover(t: number): number {
  const d = new Date(t)
  d.setHours(ROLLOVER_HOUR, 0, 0, 0)
  if (d.getTime() <= t) d.setDate(d.getDate() + 1)
  return d.getTime()
}

// 04:00 on the day of t: where a date-only to-do is due from.
export function dayStartOf(t: number): number {
  const d = new Date(t)
  d.setHours(ROLLOVER_HOUR, 0, 0, 0)
  return d.getTime()
}

// When the to-do is (or was last) due. For a repeat: the latest occurrence that has
// come round since the last one was dealt with, else the next one.
export function dueOf(when: When, now: number): number | null {
  if (when.kind === 'at') return when.at
  if (when.kind !== 'repeat') return null
  if (when.next > now) return when.next
  const passed = occurrencesBetween(when, when.next, now)
  return passed.length > 0 ? passed[passed.length - 1] : when.next
}

// SPEC-v2.md's todoState(). Only "due" and "overdue" are active.
export function todoState(t: Pick<Todo, 'status' | 'when'>, now: number): TodoState {
  if (t.status !== 'open') return 'info'
  switch (t.when.kind) {
    case 'someday':
      return 'someday'
    case 'when':
      return t.when.firedAt ? 'due' : 'waiting'
    case 'after':
    case 'goal':
      return 'waiting' // until fired, when it becomes { kind: 'at', at: now }
    default: {
      const due = dueOf(t.when, now)!
      if (now < due) return 'upcoming'
      return now < nextRollover(due) ? 'due' : 'overdue'
    }
  }
}

// ---------- Recurrence ----------
// rrule computes in UTC. To keep "every Monday at 07:30" at 07:30 local time across
// daylight-saving changes, local wall-clock times are handed to it as if they were
// UTC ("floating" times) and read back the same way.

const toFloating = (t: number) => {
  const d = new Date(t)
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()))
}
const fromFloating = (f: Date) => new Date(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes(), f.getUTCSeconds()).getTime()

function ruleOf(when: Extract<When, { kind: 'repeat' }>): RRule {
  return RRule.fromString(when.rrule)
}

// A repeat from the day of `start`, at `time` ("07:30") or, without one, at 04:00
// (due all that day). With a time, an occurrence already past today doesn't count:
// "every day at 7:30", made at 10:00, starts tomorrow. Without one, today counts.
export function makeRepeat(rule: Partial<Options>, start: number, time?: string): Extract<When, { kind: 'repeat' }> {
  const d = new Date(start)
  const [hh, mm] = time ? time.split(':').map(Number) : [ROLLOVER_HOUR, 0]
  d.setHours(hh, mm, 0, 0)
  const anchor = d.getTime()
  const options: Partial<Options> = { ...rule }
  delete options.dtstart
  delete options.until
  delete options.byhour
  delete options.byminute
  delete options.bysecond
  const rrule = new RRule({ ...options, dtstart: toFloating(anchor) }).toString()
  const when = { kind: 'repeat' as const, rrule, ...(time && { time }), next: 0 }
  const from = time ? Math.max(anchor, start) : anchor
  when.next = nextOccurrence(when, from - 1) ?? anchor
  return when
}

// The first occurrence strictly after t (or null if the rule has ended).
export function nextOccurrence(when: Extract<When, { kind: 'repeat' }>, t: number): number | null {
  const f = ruleOf(when).after(toFloating(t), false)
  return f ? fromFloating(f) : null
}

// Occurrences from `from` to `to`, both included.
export function occurrencesBetween(when: Extract<When, { kind: 'repeat' }>, from: number, to: number): number[] {
  return ruleOf(when)
    .between(toFloating(from), toFloating(to), true)
    .map(fromFloating)
}

export interface Resolution {
  completions: { occurrenceAt: number; outcome: 'done' | 'skipped' | 'missed' }[]
  next: number | null
}

// Done or Skip on a repeating to-do. If several occurrences passed while the app was
// closed, only one was shown: it gets this outcome, the older ones are logged as
// missed, and the to-do jumps to its next future occurrence. No pile-ups.
// Done early (before the occurrence) counts for that occurrence.
export function resolveRepeat(when: Extract<When, { kind: 'repeat' }>, outcome: 'done' | 'skipped', now: number): Resolution {
  const passed = when.next <= now ? occurrencesBetween(when, when.next, now) : []
  if (passed.length === 0) {
    return { completions: [{ occurrenceAt: when.next, outcome }], next: nextOccurrence(when, when.next) }
  }
  const latest = passed[passed.length - 1]
  return {
    completions: [...passed.slice(0, -1).map((occurrenceAt) => ({ occurrenceAt, outcome: 'missed' as const })), { occurrenceAt: latest, outcome }],
    next: nextOccurrence(when, Math.max(now, latest)),
  }
}

// ---------- Typed phrases ----------

const REPEAT_PHRASE =
  /\b(?:every|each)\s+(?:other\s+)?(?:\d+\s+)?(?:day|days|weekday|weekdays|week|weeks|month|months|year|years|(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:s)?(?:\s*(?:,|and|&)\s*(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:s)?)*)\b/i
const TIME_PHRASE = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2})(?::(\d{2}))?\b/i

export interface Parsed {
  title: string
  when: When | null
}

// "Sunday 10am gather receipts" → when Sunday 10:00, title "Gather receipts".
// "Every Monday at 7:30 run" → every Monday at 07:30, "Run". Strongest in English;
// the When picker is the main way in.
export function parseTyped(text: string, now: number): Parsed {
  let rest = text
  let when: When | null = null

  const repeat = rest.match(REPEAT_PHRASE)
  if (repeat) {
    try {
      const options = RRule.parseText(repeat[0].replace(/\bother\b/i, '2').replace(/\beach\b/i, 'every'))
      if (options?.freq != null) {
        rest = cut(rest, repeat.index!, repeat[0].length)
        const t = rest.match(TIME_PHRASE)
        let time: string | undefined
        if (t) {
          time = clock(t)
          rest = cut(rest, t.index!, t[0].length)
        }
        when = makeRepeat(options, now, time)
      }
    } catch {
      // not a phrase rrule understands: leave the text as it is
    }
  }

  if (!when) {
    const [hit] = chrono.parse(rest, new Date(now), { forwardDate: true })
    if (hit) {
      const date = hit.start.date().getTime()
      const hasTime = hit.start.isCertain('hour')
      when = { kind: 'at', at: hasTime ? date : dayStartOf(date), hasTime }
      rest = cut(rest, hit.index, hit.text.length)
    }
  }

  return { title: tidy(rest), when }
}

function cut(s: string, index: number, length: number): string {
  return `${s.slice(0, index)} ${s.slice(index + length)}`
}

function clock(m: RegExpMatchArray): string {
  let hours = Number(m[1] ?? m[4])
  const minutes = Number(m[2] ?? m[5] ?? 0)
  const ampm = m[3]?.toLowerCase()
  if (ampm === 'pm' && hours < 12) hours += 12
  if (ampm === 'am' && hours === 12) hours = 0
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

// What's left after the when is cut out: no dangling "at"/"on"/"by", one space, a capital.
function tidy(s: string): string {
  const t = s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:at|on|by|from|in)\s+|\s+(?:at|on|by|from|in)$/gi, '')
    .replace(/^[,;:\-–·]+\s*|\s*[,;:\-–·]+$/g, '')
    .trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// ---------- Reading ----------

const timeFmt = () => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

export function formatTime(t: number): string {
  return timeFmt().format(t)
}

// "Today", "Tomorrow", "Friday", "Sun 2 Nov", "3 Jan 2027"
export function formatDay(t: number, now: number): string {
  const day = (x: number) => Math.round((new Date(x).setHours(12, 0, 0, 0) - new Date(now).setHours(12, 0, 0, 0)) / (24 * HOUR))
  const diff = day(t)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return new Date(t).toLocaleDateString(undefined, { weekday: 'long' })
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear()
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(!sameYear && { year: 'numeric' }) })
}

export function repeatText(when: Extract<When, { kind: 'repeat' }>): string {
  const text = ruleOf(when).toText()
  const time = when.time ? ` at ${formatTime(new Date(`2000-01-01T${when.time}:00`).getTime())}` : ''
  return text.charAt(0).toUpperCase() + text.slice(1) + time
}

// How a when reads under the to-do. `other` names what an after/goal when waits for.
export function whenText(when: When, now: number, other?: string): string {
  switch (when.kind) {
    case 'at':
      return formatDay(when.at, now) + (when.hasTime ? ` ${formatTime(when.at)}` : '')
    case 'repeat': {
      const due = dueOf(when, now)
      return `${repeatText(when)}${due != null && due > now ? ` · next ${formatDay(due, now)}` : ''}`
    }
    case 'after':
      return other ? `After “${other}”` : 'After another to-do'
    case 'goal':
      return other ? `When “${other}” reaches ${when.percent}%` : `When a goal reaches ${when.percent}%`
    case 'when':
      return when.firedAt ? `It happened: ${when.condition}` : `Waiting: ${when.condition}`
    case 'someday':
      return 'Someday'
  }
}
