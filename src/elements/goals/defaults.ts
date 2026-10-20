// Check-in schedules, and the default contributor every goal falls back on.

import { type Options, RRule } from 'rrule'
import type { Contributor, RepeatWhen } from '../../types'
import { makeRepeat, nextOccurrence, nextRollover } from '../todos/when'

// A check-in schedule starting after today: a goal made (or a check-in added) today
// is first asked about next time, not straight away.
export function checkinSchedule(rule: Partial<Options>, now: number, time?: string): RepeatWhen {
  const when = makeRepeat(rule, now, time)
  const tomorrow = nextRollover(now)
  if (when.next < tomorrow) when.next = nextOccurrence(when, tomorrow - 1) ?? when.next
  return when
}

// SPEC-v2.md: a goal can't be saved without a contributor; if the user adds none,
// it gets a weekly "How far along are you?" check-in (0–100%, target 100).
export function defaultCheckin(goalId: string, now: number, order = 0): Contributor {
  return {
    id: crypto.randomUUID(),
    goalId,
    kind: 'slider',
    title: 'How far along are you?',
    start: 0,
    target: 100,
    max: 100,
    unit: '%',
    schedule: checkinSchedule({ freq: RRule.WEEKLY }, now),
    importance: 2,
    difficulty: 2,
    order,
    createdAt: now,
    updatedAt: now,
  }
}
