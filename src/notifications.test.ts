// Fixed time zone, as in the to-do tests.
process.env.TZ = 'Europe/Rome'

import 'fake-indexeddb/auto'
import './elements/all'
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement, createLocus, db } from './store/db'
import type { When } from './types'
import { createTodo, LOOSE } from './elements/todos/store'
import { makeRepeat } from './elements/todos/when'
import { RRule } from 'rrule'
import { applyQueuedDone, buildSchedule, summaryTimes, todoReminders } from './notifications'

const at = (month: number, day: number, h = 0, m = 0) => new Date(2026, month - 1, day, h, m).getTime()
const DAY = 86_400_000
const draft = (title: string, when: When) => ({ title, importance: 2 as const, difficulty: 2 as const, when })

describe('reminders for the phone', () => {
  let listId: string

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    const locusId = (await createLocus({ name: 'Home', color: '#000000', x: 0.5, y: 0.5 })).id
    listId = (await createElement(locusId, 'todos', 'Errands', {})).id
  })

  it('a to-do with a time reminds at that time, named with its locus; one without a time does not', async () => {
    const timed = await createTodo(listId, draft('Gather receipts', { kind: 'at', at: at(11, 3, 10), hasTime: true }))
    await createTodo(listId, draft('Call the bank', { kind: 'at', at: at(11, 3, 4), hasTime: false }))
    await createTodo(LOOSE, draft('Water plants', { kind: 'at', at: at(11, 4, 18), hasTime: true }))
    const { reminders, pending } = await todoReminders(at(11, 1, 12), at(11, 1, 12) + 7 * DAY)
    expect(reminders.map((r) => [r.title, r.body, r.at])).toEqual([
      ['Gather receipts', 'Home', at(11, 3, 10)],
      ['Water plants', 'To-dos', at(11, 4, 18)],
    ])
    expect(pending[timed.id]).toBe(at(11, 3, 10))
  })

  it('a repeat with a time reminds at each occurrence in the next 7 days', async () => {
    const when = makeRepeat({ freq: RRule.DAILY }, at(11, 1, 0), '07:30')
    const t = await createTodo(listId, draft('Stretch', when))
    const { reminders, pending } = await todoReminders(at(11, 1, 12), at(11, 1, 12) + 7 * DAY)
    expect(reminders.map((r) => r.at)).toEqual([2, 3, 4, 5, 6, 7, 8].map((d) => at(11, d, 7, 30)))
    expect(pending[t.id]).toBe(at(11, 1, 7, 30)) // this morning's, not done yet
  })

  it('reminders already past are not sent; to-do reminders can be switched off', async () => {
    await createTodo(listId, draft('Gather receipts', { kind: 'at', at: at(11, 1, 10), hasTime: true }))
    expect((await todoReminders(at(11, 1, 12), at(11, 8, 12))).reminders).toEqual([])
    await createTodo(listId, draft('Post the letter', { kind: 'at', at: at(11, 2, 10), hasTime: true }))
    const off = await buildSchedule({ todoReminders: false, summaryAt: null }, at(11, 1, 12))
    expect(off.reminders).toEqual([])
  })

  it('the daily summary comes each day after now, and only when something is due', async () => {
    expect(summaryTimes('09:00', at(11, 1, 12))).toEqual([2, 3, 4, 5, 6, 7, 8].map((d) => at(11, d, 9)))
    expect((await buildSchedule({ todoReminders: true, summaryAt: '09:00' }, at(11, 1, 12))).reminders).toEqual([])
    await createTodo(listId, draft('Call the bank', { kind: 'at', at: at(11, 3, 4), hasTime: false }))
    const summaries = (await buildSchedule({ todoReminders: true, summaryAt: '09:00' }, at(11, 1, 12))).reminders
    expect(summaries[0]).toMatchObject({ kind: 'summary', at: at(11, 3, 9), title: 'Now: Call the bank' })
  })
})

describe('Done tapped on a notification', () => {
  let listId: string

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    const locusId = (await createLocus({ name: 'Home', color: '#000000', x: 0.5, y: 0.5 })).id
    listId = (await createElement(locusId, 'todos', 'Errands', {})).id
  })

  it('finishes a one-off to-do as of the tap', async () => {
    const t = await createTodo(listId, draft('Gather receipts', { kind: 'at', at: at(11, 3, 10), hasTime: true }))
    expect(await applyQueuedDone(t.id, at(11, 3, 10), at(11, 3, 10, 5))).toBe(true)
    expect(await db.todos.get(t.id)).toMatchObject({ status: 'done', doneAt: at(11, 3, 10, 5) })
    expect(await applyQueuedDone(t.id, at(11, 3, 10), at(11, 3, 10, 6))).toBe(false) // already done
  })

  it('counts for the occurrence it was about, even if Loci opens days later', async () => {
    const t = await createTodo(listId, draft('Stretch', makeRepeat({ freq: RRule.DAILY }, at(11, 1, 0), '07:30')))
    expect(await applyQueuedDone(t.id, at(11, 1, 7, 30), at(11, 1, 7, 35))).toBe(true)
    const after = (await db.todos.get(t.id))!
    expect(after.when.kind === 'repeat' && after.when.next).toBe(at(11, 2, 7, 30))
    expect(await db.todoCompletions.where('todoId').equals(t.id).toArray()).toMatchObject([{ occurrenceAt: at(11, 1, 7, 30), outcome: 'done' }])
    // The same tap again (or one for an occurrence done elsewhere) changes nothing.
    expect(await applyQueuedDone(t.id, at(11, 1, 7, 30), at(11, 1, 7, 36))).toBe(false)
  })
})
