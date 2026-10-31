// Fixed time zone: the 04:00 rollover and "days late" depend on it.
process.env.TZ = 'Europe/Rome'

import 'fake-indexeddb/auto'
import { RRule } from 'rrule'
import { beforeEach, describe, expect, it } from 'vitest'
import '../elements/all'
import { recordReview } from '../elements/flashcards/session'
import { DAY, MIN, review } from '../elements/flashcards/srs'
import { addCards, DEFAULT_FLASHCARDS_DATA, listCards } from '../elements/flashcards/store'
import { createGoal } from '../elements/goals/store'
import { createTodo, skipTodo } from '../elements/todos/store'
import { dayStartOf, makeRepeat } from '../elements/todos/when'
import { examDate, saveExam } from '../exams/exams'
import { createElement, createLocus, db } from '../store/db'
import { setSplitStudyTasks } from '../study/tasks'
import { allTasks } from '../tasks/tasks'
import type { Grade, Todo, When } from '../types'
import { bubbleWithNewCards, nowCandidates, taskKey } from './candidates'
import { examPace, priority } from './priority'

const at = (month: number, day: number, h = 0, m = 0) => new Date(2026, month - 1, day, h, m).getTime()
const HOUR = 3_600_000

let locusId: string
let todoList: string

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  locusId = (await createLocus({ name: 'Life', color: '#000000', x: 0.5, y: 0.5 })).id
  todoList = (await createElement(locusId, 'todos', 'To-dos', {})).id
})

const todo = (title: string, when: When, importance: Todo['importance'] = 2): Promise<Todo> => createTodo(todoList, { title, importance, difficulty: 2, when })
const find = async (now: number, id: string) => (await allTasks(now)).find((t) => t.itemId === id)!

describe('terms of a to-do', () => {
  it('T2: 84 h past overdue is U = 0.5, score 8, "4 days late"', async () => {
    const t = await todo('Pay rent', { kind: 'at', at: dayStartOf(at(10, 10, 12)), hasTime: false })
    const overdueAt = at(10, 11, 4)
    const task = await find(overdueAt + 84 * HOUR, t.id)
    expect(task.rank!.terms).toMatchObject({ I: 2, B: 0, N: 0, S: 0 })
    expect(task.rank!.terms.U).toBeCloseTo(0.5)
    expect(task.rank!.priority).toBeCloseTo(8)
    expect(task.rank!.why).toBe('4 days late')
    expect(task.rank!.type).toBe('todo')
  })

  it('T1: a Critical to-do due today (not overdue) is U = 0, score 12, "Critical"', async () => {
    const t = await todo('Submit tax form', { kind: 'at', at: dayStartOf(at(10, 21, 12)), hasTime: false }, 4)
    const task = await find(at(10, 21, 12), t.id)
    expect(task.state).toBe('due')
    expect(task.rank).toMatchObject({ priority: 12, why: 'Critical' })
  })

  it('T4: a weekly repeat 24 h overdue with 2 missed is U = 0.143, N = 0.667, score 7.57', async () => {
    // Sundays 4, 11 and 18 October at 10:00 all passed; the last turned overdue on Monday 04:00.
    const when = makeRepeat({ freq: RRule.WEEKLY, byweekday: [RRule.SU] }, at(10, 4, 10), '10:00')
    const t = await todo('Laundry', when)
    const task = await find(at(10, 20, 4), t.id)
    expect(task.state).toBe('overdue')
    expect(task.rank!.type).toBe('repeat')
    expect(task.rank!.terms.U).toBeCloseTo(0.143, 2)
    expect(task.rank!.terms.N).toBeCloseTo(0.667, 2)
    expect(task.rank!.priority).toBeCloseTo(7.57, 2)
    expect(task.rank!.why).toBe('Weekly · not done yet')
  })

  it('a skip is intentional and never counts as missed', async () => {
    const when = makeRepeat({ freq: RRule.WEEKLY, byweekday: [RRule.SU] }, at(10, 4, 10), '10:00')
    const t = await todo('Laundry', when)
    await skipTodo(t.id, at(10, 4, 12)) // skipped the 4th; the 11th is next
    const task = await find(at(10, 12, 12), t.id) // the 11th passed, no older ones
    expect(task.rank!.terms.N).toBe(0)
  })

  it('T6: due today, linked goal 12 points behind pace is B = 0.6, score 7.2', async () => {
    const start = at(10, 1, 12)
    const now = start + 20 * DAY
    const t = await todo('Practice', { kind: 'at', at: dayStartOf(now), hasTime: false })
    const goalsList = (await createElement(locusId, 'goals', 'Goals', {})).id
    const g = await createGoal(goalsList, { title: 'B2 Spanish' }, [{ kind: 'todoCount', title: 'Sessions', todoId: t.id, target: 25, importance: 2, difficulty: 2 }])
    await db.goals.update(g.id, { startAt: start, deadline: start + 100 * DAY })
    await db.goalContributors.where('goalId').equals(g.id).modify({ createdAt: start }) // it existed from the start
    // 2 of 25 done = 8%; a steady rate would be at 20%.
    await db.todoCompletions.bulkAdd(
      [1, 2].map((i) => ({ id: `c${i}`, todoId: t.id, occurrenceAt: start + i * DAY, doneAt: start + i * DAY, outcome: 'done' as const, updatedAt: start })),
    )
    const task = await find(now, t.id)
    expect(task.rank!.terms.B).toBeCloseTo(0.6)
    expect(task.rank!.priority).toBeCloseTo(7.2)
    expect(task.rank!.why).toBe('Moves "B2 Spanish" · 12% behind pace')
  })

  it('a goal with no deadline adds nothing', async () => {
    const t = await todo('Practice', { kind: 'at', at: dayStartOf(at(10, 21, 12)), hasTime: false })
    const goalsList = (await createElement(locusId, 'goals', 'Goals', {})).id
    await createGoal(goalsList, { title: 'Open-ended' }, [{ kind: 'todoCount', title: 'Sessions', todoId: t.id, target: 10, importance: 2, difficulty: 2 }])
    expect((await find(at(10, 21, 12), t.id)).rank!.terms.B).toBe(0)
  })
})

describe('passed over (S)', () => {
  it('T5: passed over 3 h ago is S = 1 and score 5; after 24 h it counts again', async () => {
    const t = await todo('Pay rent', { kind: 'at', at: dayStartOf(at(10, 10, 12)), hasTime: false })
    const now = at(10, 11, 4) + 84 * HOUR
    const base = await find(now, t.id)
    await db.events.add({ ts: now - 3 * HOUR, type: 'pass', key: base.rank!.key, candidateType: 'todo', rank: 1, score: 8, terms: base.rank!.terms })
    const passed = await find(now, t.id)
    expect(passed.rank!.terms.S).toBe(1)
    expect(passed.rank!.priority).toBeCloseTo(5)
    expect((await find(now + 22 * HOUR, t.id)).rank!.terms.S).toBe(0) // the pass is 25 h old by then
  })
})

describe('who competes', () => {
  it('planned and someday items are not ranked', async () => {
    const someday = await todo('Learn Latin', { kind: 'someday' })
    const later = await todo('Dentist', { kind: 'at', at: at(11, 20, 10), hasTime: true })
    const now = at(10, 21, 12)
    expect((await find(now, someday.id)).rank).toBeUndefined()
    expect((await find(now, later.id)).rank).toBeUndefined()
  })

  it('keys are stable and name the candidate', async () => {
    const t = await todo('Pay rent', { kind: 'at', at: dayStartOf(at(10, 21, 12)), hasTime: false })
    expect(taskKey(await find(at(10, 21, 12), t.id))).toBe(`todo:${t.id}`)
  })
})

// ---------- Study ----------

const grade = async (cardId: string, g: Grade, when: number) => {
  const c = (await db.cards.get(cardId))!
  await recordReview(c, { ...c, srs: review(c.srs, g, when), updatedAt: when }, g, when)
}

async function deck(title: string, cards: number) {
  const el = await createElement(locusId, 'flashcards', title, { ...DEFAULT_FLASHCARDS_DATA, maxReviewsPerDay: 500 })
  await addCards(el.id, Array.from({ length: cards }, (_, i) => ({ front: `${title} ${i}`, back: 'x' })))
  for (const c of await listCards(el.id)) {
    await grade(c.id, 2, at(1, 10))
    await grade(c.id, 2, at(1, 10) + 10 * MIN)
  }
  return el
}

describe('study candidates', () => {
  const now = at(10, 21, 10)

  it('T3: 50 due is U = 0.5, and an exam in 10 days adds its readiness gap as B', async () => {
    await deck('Verbs', 50)
    await saveExam(locusId, { title: 'Midterm', date: examDate(new Date(now + 10 * DAY)), targetRecall: 0.9, scope: null }, undefined, now)
    const tasks = await allTasks(now)
    const study = tasks.find((t) => t.kind === 'review')!
    const exam = tasks.find((t) => t.kind === 'exam')!
    expect(study.rank!.type).toBe('study')
    expect(study.rank!.key).toBe(`study:${locusId}`)
    expect(study.rank!.terms.U).toBeCloseTo(0.5)
    expect(study.rank!.terms.B).toBeCloseTo(examPace(exam.progress!))
    expect(study.rank!.terms.B).toBeGreaterThan(0)
    expect(study.rank!.priority).toBeCloseTo(priority({ I: 3, U: 0.5, B: study.rank!.terms.B, N: 0, S: 0 }))
  })

  it('an exam more than 14 days away does not count', async () => {
    await deck('Verbs', 5)
    await saveExam(locusId, { title: 'Final', date: examDate(new Date(now + 30 * DAY)), targetRecall: 0.9, scope: null }, undefined, now)
    expect((await allTasks(now)).find((t) => t.kind === 'review')!.rank!.terms.B).toBe(0)
  })

  it('stays one candidate per bubble when decks are split into their own tasks', async () => {
    await deck('Verbs', 3)
    await deck('Nouns', 2)
    await setSplitStudyTasks(true)
    const tasks = await allTasks(now)
    expect(tasks.filter((t) => t.kind === 'review')).toHaveLength(2)
    const cards = await nowCandidates(tasks, now)
    expect(cards).toHaveLength(1)
    expect(cards[0].rank).toMatchObject({ key: `study:${locusId}`, type: 'study' })
    expect(cards[0].study).toMatchObject({ cards: 5 })
  })
})

describe('nowCandidates', () => {
  it('lists the active ones best first, importance leading', async () => {
    const now = at(10, 21, 12)
    const low = await todo('Water plants', { kind: 'at', at: dayStartOf(now), hasTime: false }, 1)
    const high = await todo('Call the bank', { kind: 'at', at: dayStartOf(now), hasTime: false }, 3)
    await todo('Later', { kind: 'someday' })
    const order = (await nowCandidates(await allTasks(now), now)).map((t) => t.itemId)
    expect(order).toEqual([high.id, low.id])
  })
})

describe('bubbleWithNewCards', () => {
  it('finds the bubble with unstarted cards, or none', async () => {
    expect(await bubbleWithNewCards()).toBeNull()
    const el = await createElement(locusId, 'flashcards', 'New deck', { ...DEFAULT_FLASHCARDS_DATA })
    await addCards(el.id, [{ front: 'q', back: 'a' }])
    expect(await bubbleWithNewCards()).toBe(locusId)
  })
})
