// Fixed time zone, so the daylight-saving tests mean the same everywhere:
// in 2026, Europe/Rome leaves summer time on Sunday 25 October (03:00 → 02:00).
process.env.TZ = 'Europe/Rome'

import 'fake-indexeddb/auto'
import '../all'
import { RRule } from 'rrule'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from '../../store/backup'
import { createElement, createLocus, db, deleteLocus } from '../../store/db'
import type { LocusElement, Todo, When } from '../../types'
import { completeTodo, createTodo, deleteTodo, itHappened, skipTodo } from './store'
import { todosType } from './type'
import { dayStartOf, makeRepeat, nextRollover, occurrencesBetween, parseClock, parseTyped, resolveRepeat, todoState } from './when'

const at = (month: number, day: number, h = 0, m = 0) => new Date(2026, month - 1, day, h, m).getTime()
const open = (when: When): Pick<Todo, 'status' | 'when'> => ({ status: 'open', when })

describe('todoState around the 04:00 rollover', () => {
  it('a date-only to-do is due from 04:00 that day and overdue from 04:00 the next', () => {
    const t = open({ kind: 'at', at: dayStartOf(at(10, 21, 12)), hasTime: false })
    expect(todoState(t, at(10, 21, 3, 59))).toBe('upcoming')
    expect(todoState(t, at(10, 21, 4))).toBe('due')
    expect(todoState(t, at(10, 22, 3, 59))).toBe('due')
    expect(todoState(t, at(10, 22, 4))).toBe('overdue')
  })

  it('a timed to-do is due from its time, overdue from the next 04:00', () => {
    const t = open({ kind: 'at', at: at(10, 21, 10), hasTime: true })
    expect(todoState(t, at(10, 21, 9, 59))).toBe('upcoming')
    expect(todoState(t, at(10, 21, 10))).toBe('due')
    expect(todoState(t, at(10, 22, 3, 59))).toBe('due')
    expect(todoState(t, at(10, 22, 4))).toBe('overdue')
  })

  it('across the end of summer time, the rollover is still 04:00 local', () => {
    // Clocks go back at 03:00 on Sunday 25 October, so Saturday 04:00 → Sunday 04:00 is 25 hours.
    const saturday = dayStartOf(at(10, 24, 12))
    const sunday = nextRollover(saturday)
    expect(new Date(saturday).getHours()).toBe(4)
    expect(new Date(sunday).getHours()).toBe(4)
    expect(new Date(sunday).getDate()).toBe(25)
    expect((sunday - saturday) / 3_600_000).toBe(25)
    // A date-only to-do on Saturday is overdue from Sunday 04:00, not 03:00.
    const t = open({ kind: 'at', at: saturday, hasTime: false })
    expect(todoState(t, sunday - 60_000)).toBe('due')
    expect(todoState(t, sunday)).toBe('overdue')
  })

  it('the other kinds', () => {
    expect(todoState(open({ kind: 'someday' }), at(10, 21))).toBe('someday')
    expect(todoState(open({ kind: 'after' }), at(10, 21))).toBe('waiting')
    expect(todoState(open({ kind: 'goal', percent: 50 }), at(10, 21))).toBe('waiting')
    expect(todoState(open({ kind: 'when', condition: 'the package arrives' }), at(10, 21))).toBe('waiting')
    expect(todoState(open({ kind: 'when', condition: 'x', firedAt: at(10, 20) }), at(10, 21))).toBe('due')
    expect(todoState({ status: 'done', when: { kind: 'someday' } }, at(10, 21))).toBe('info')
  })
})

describe('recurrence', () => {
  it('every Monday at 07:30 stays at 07:30 across the clock change', () => {
    const when = makeRepeat({ freq: RRule.WEEKLY, byweekday: [RRule.MO] }, at(10, 14, 12), '07:30') // made Wed 14 Oct
    expect(when.next).toBe(at(10, 19, 7, 30))
    const occ = occurrencesBetween(when, at(10, 19), at(11, 3))
    expect(occ).toEqual([at(10, 19, 7, 30), at(10, 26, 7, 30), at(11, 2, 7, 30)])
    expect(occ.map((t) => new Date(t).getHours())).toEqual([7, 7, 7])
  })

  it('a timed repeat made after today’s time starts tomorrow; without a time, today counts', () => {
    expect(makeRepeat({ freq: RRule.DAILY }, at(10, 21, 10), '07:30').next).toBe(at(10, 22, 7, 30))
    expect(makeRepeat({ freq: RRule.DAILY }, at(10, 21, 10)).next).toBe(at(10, 21, 4))
  })

  it('missed occurrences collapse: one shows, the rest are logged missed, then it jumps ahead', () => {
    const daily = { ...makeRepeat({ freq: RRule.DAILY }, at(10, 1, 7), '08:00') }
    expect(daily.next).toBe(at(10, 1, 8))
    // App closed until 5 October, 10:00: one to-do shows, for today's occurrence.
    expect(todoState({ status: 'open', when: daily }, at(10, 5, 10))).toBe('due')
    const r = resolveRepeat(daily, 'done', at(10, 5, 10))
    expect(r.completions).toEqual([
      { occurrenceAt: at(10, 1, 8), outcome: 'missed' },
      { occurrenceAt: at(10, 2, 8), outcome: 'missed' },
      { occurrenceAt: at(10, 3, 8), outcome: 'missed' },
      { occurrenceAt: at(10, 4, 8), outcome: 'missed' },
      { occurrenceAt: at(10, 5, 8), outcome: 'done' },
    ])
    expect(r.next).toBe(at(10, 6, 8))
  })

  it('done early counts for the coming occurrence', () => {
    const daily = makeRepeat({ freq: RRule.DAILY }, at(10, 1, 7), '08:00')
    const r = resolveRepeat(daily, 'done', at(10, 1, 7, 30))
    expect(r.completions).toEqual([{ occurrenceAt: at(10, 1, 8), outcome: 'done' }])
    expect(r.next).toBe(at(10, 2, 8))
  })

  it('an occurrence left past 04:00 the next day is overdue', () => {
    const daily = makeRepeat({ freq: RRule.WEEKLY, byweekday: [RRule.MO] }, at(10, 19, 7), '08:00')
    expect(todoState({ status: 'open', when: daily }, at(10, 20, 5))).toBe('overdue')
  })
})

describe('typed phrases', () => {
  const now = at(10, 21, 12) // Wednesday 21 October 2026, noon

  it('"Sunday 10am gather receipts"', () => {
    expect(parseTyped('Sunday 10am gather receipts', now)).toEqual({
      title: 'Gather receipts',
      when: { kind: 'at', at: at(10, 25, 10), hasTime: true },
    })
  })

  it('"buy milk tomorrow": a date without a time is due all day', () => {
    expect(parseTyped('buy milk tomorrow', now)).toEqual({
      title: 'Buy milk',
      when: { kind: 'at', at: at(10, 22, 4), hasTime: false },
    })
  })

  it('"Every Monday at 7:30 run"', () => {
    const { title, when } = parseTyped('Every Monday at 7:30 run', now)
    expect(title).toBe('Run')
    expect(when).toMatchObject({ kind: 'repeat', time: '07:30', next: at(10, 26, 7, 30) })
    expect((when as Extract<When, { kind: 'repeat' }>).rrule).toContain('BYDAY=MO')
  })

  it('"every day water plants"', () => {
    const { title, when } = parseTyped('every day water plants', now)
    expect(title).toBe('Water plants')
    expect(when).toMatchObject({ kind: 'repeat', next: at(10, 21, 4) })
  })

  it('"daily" and "weekdays" work like "every day" and "every weekday"', () => {
    const daily = parseTyped('Breakfast daily 8am', now)
    expect(daily.title).toBe('Breakfast')
    expect(daily.when).toMatchObject({ kind: 'repeat', time: '08:00', next: at(10, 22, 8) })
    const weekdays = parseTyped('weekdays 9:15 standup', now)
    expect(weekdays.title).toBe('Standup')
    expect(weekdays.when).toMatchObject({ kind: 'repeat', time: '09:15' })
    expect((weekdays.when as Extract<When, { kind: 'repeat' }>).rrule).toContain('BYDAY=MO,TU,WE,TH,FR')
  })

  it('only the first shorthand word is the repeat; the rest stays in the title', () => {
    expect(parseTyped('Weekly review daily notes', now).title).toBe('Review daily notes')
  })

  it('a 24-hour time after a repeat', () => {
    expect(parseTyped('every day 19:30 stretch', now)).toMatchObject({ title: 'Stretch', when: { kind: 'repeat', time: '19:30' } })
  })

  it('no when in the text: just the action', () => {
    expect(parseTyped('call mom', now)).toEqual({ title: 'Call mom', when: null })
  })
})

describe('typed times', () => {
  it.each([
    ['7', '07:00'],
    ['730', '07:30'],
    ['1930', '19:30'],
    ['7:30', '07:30'],
    ['7.30', '07:30'],
    ['7p', '19:00'],
    ['7:30 PM', '19:30'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    ['noon', '12:00'],
    ['midnight', '00:00'],
  ])('%s → %s', (text, time) => {
    expect(parseClock(text)).toBe(time)
  })

  it.each(['', 'abc', '24', '7:60', '13pm', '0am', '7:5'])('%j is not a time', (text) => {
    expect(parseClock(text)).toBeNull()
  })
})

describe('to-dos', () => {
  let listId: string
  let locusId: string
  const draft = (title: string, when: When) => ({ title, importance: 2 as const, difficulty: 2 as const, when })

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    locusId = (await createLocus({ name: 'Home', color: '#000000', x: 0.5, y: 0.5 })).id
    listId = (await createElement(locusId, 'todos', 'Errands', {})).id
  })

  it('done logs a completion and finishes a one-off to-do', async () => {
    const t = await createTodo(listId, draft('Gather receipts', { kind: 'at', at: at(10, 25, 10), hasTime: true }))
    await completeTodo(t.id, at(10, 25, 11))
    expect(await db.todos.get(t.id)).toMatchObject({ status: 'done', doneAt: at(10, 25, 11) })
    expect(await db.todoCompletions.where('todoId').equals(t.id).toArray()).toMatchObject([{ occurrenceAt: at(10, 25, 10), outcome: 'done', doneAt: at(10, 25, 11) }])
  })

  it('"after" to-dos wait, then fire when the other one is done', async () => {
    const paint = await createTodo(listId, draft('Buy paint', { kind: 'at', at: at(10, 25, 10), hasTime: true }))
    const wall = await createTodo(listId, draft('Paint the wall', { kind: 'after' }), { type: 'todo', id: paint.id })
    expect(todoState(wall, at(10, 25, 12))).toBe('waiting')
    await completeTodo(paint.id, at(10, 25, 12))
    const fired = (await db.todos.get(wall.id))!
    expect(fired.when).toEqual({ kind: 'at', at: at(10, 25, 12), hasTime: true })
    expect(todoState(fired, at(10, 25, 12))).toBe('due')
  })

  it('waiting on a to-do that is already done fires at once', async () => {
    const paint = await createTodo(listId, draft('Buy paint', { kind: 'someday' }))
    await completeTodo(paint.id)
    const wall = await createTodo(listId, draft('Paint the wall', { kind: 'after' }), { type: 'todo', id: paint.id })
    expect((await db.todos.get(wall.id))!.when.kind).toBe('at')
  })

  it('"It happened" makes a waiting to-do due', async () => {
    const t = await createTodo(listId, draft('Unpack', { kind: 'when', condition: 'the package arrives' }))
    const list = (await db.elements.get(listId)) as LocusElement<Record<string, never>>
    const [task] = await todosType.getTasks(list, at(10, 21))
    expect(task).toMatchObject({ state: 'waiting', sublabel: 'Waiting: the package arrives' })
    expect(task.secondary?.label).toBe('It happened')
    await itHappened(t.id, at(10, 21, 9))
    const [after] = await todosType.getTasks(list, at(10, 21, 9))
    expect(after.state).toBe('due')
  })

  it('skip moves a repeat on and logs it', async () => {
    const t = await createTodo(listId, draft('Run', makeRepeat({ freq: RRule.DAILY }, at(10, 21, 6), '07:30')))
    await skipTodo(t.id, at(10, 21, 9))
    expect((await db.todos.get(t.id))!.when).toMatchObject({ next: at(10, 22, 7, 30) })
    expect(await db.todoCompletions.where('todoId').equals(t.id).toArray()).toMatchObject([{ occurrenceAt: at(10, 21, 7, 30), outcome: 'skipped' }])
  })

  it('deleting a to-do wakes what waited on it, and removes its history and links', async () => {
    const paint = await createTodo(listId, draft('Buy paint', { kind: 'someday' }))
    const wall = await createTodo(listId, draft('Paint the wall', { kind: 'after' }), { type: 'todo', id: paint.id })
    await completeTodo((await createTodo(listId, draft('Other', { kind: 'someday' }))).id)
    await deleteTodo(paint.id, at(10, 21, 9))
    expect((await db.todos.get(wall.id))!.when).toEqual({ kind: 'at', at: at(10, 21, 9), hasTime: true })
    expect(await db.links.count()).toBe(0)
  })

  it('deleting the locus deletes its to-dos and their history', async () => {
    const t = await createTodo(listId, draft('Run', { kind: 'someday' }))
    await completeTodo(t.id)
    await deleteLocus(locusId)
    expect([await db.todos.count(), await db.todoCompletions.count()]).toEqual([0, 0])
  })

  it('are in backups', async () => {
    const t = await createTodo(listId, draft('Run', { kind: 'someday' }))
    await completeTodo(t.id)
    const backup = await exportBackup()
    await Promise.all(db.tables.map((x) => x.clear()))
    await importBackup(backup, 'replace')
    expect([await db.todos.count(), await db.todoCompletions.count()]).toEqual([1, 1])
  })
})
