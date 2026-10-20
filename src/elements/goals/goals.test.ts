import 'fake-indexeddb/auto'
import '../all'
import { RRule } from 'rrule'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from '../../store/backup'
import { createElement, createLocus, db, deleteLocus } from '../../store/db'
import type { Contributor, Goal, GoalEntry, Level, Todo, TodoCompletion } from '../../types'
import { completeTodo, createTodo, deleteTodo } from '../todos/store'
import { makeRepeat, todoState } from '../todos/when'
import { checkinSchedule } from './defaults'
import { contributorProgress, type GoalData, goalProgress, paceText, progressSeries, timeLeft, weight } from './progress'
import { addContributor, createGoal, deleteGoal, dueCheckins, listContributors, loadGoalData, progressOf, removeContributor, saveCheckin, toggleChecklistItem } from './store'

const DAY = 86_400_000
const T0 = new Date(2026, 0, 1, 12).getTime()

// ---------- Pure progress ----------

const goal = (o: Partial<Goal> = {}): Goal => ({ id: 'g', elementId: 'e', title: 'Learn violin', startAt: T0, status: 'open', notifyCheckins: false, createdAt: T0, updatedAt: T0, ...o })
const base = (id: string, importance: Level = 2, difficulty: Level = 2) => ({ id, goalId: 'g', title: id, importance, difficulty, order: 0, createdAt: T0, updatedAt: T0 })
const schedule = makeRepeat({ freq: RRule.WEEKLY }, T0)
const data = (contributors: Contributor[], entries: GoalEntry[] = [], todos: [string, Todo][] = [], completions: [string, TodoCompletion[]][] = []): GoalData => ({
  goal: goal({ deadline: T0 + 100 * DAY }),
  contributors,
  entries,
  todos: new Map(todos),
  completions: new Map(completions),
})
const entry = (contributorId: string, value: number, at: number): GoalEntry => ({ id: `${contributorId}${at}`, contributorId, value, at, updatedAt: at })

describe('contributor progress', () => {
  it('number check-in: (current − start) ÷ (target − start), clamped, going down too', () => {
    const weight80to75: Contributor = { ...base('w'), kind: 'number', start: 80, target: 75, unit: 'kg', schedule }
    const d = data([weight80to75], [entry('w', 78, T0 + DAY)])
    expect(contributorProgress(weight80to75, d)).toBeCloseTo(0.4)
    expect(contributorProgress(weight80to75, data([weight80to75], [entry('w', 70, T0 + DAY)]))).toBe(1) // past the target: 100%
    expect(contributorProgress(weight80to75, data([weight80to75], [entry('w', 82, T0 + DAY)]))).toBe(0) // wrong way: 0%
  })

  it('slider: the latest rating counts', () => {
    const confidence: Contributor = { ...base('c'), kind: 'slider', start: 3, target: 8, max: 10, schedule }
    const d = data([confidence], [entry('c', 4, T0 + DAY), entry('c', 6, T0 + 2 * DAY)])
    expect(contributorProgress(confidence, d)).toBeCloseTo(0.6)
    expect(contributorProgress(confidence, d, T0 + DAY)).toBeCloseTo(0.2) // as it was on day 1
  })

  it('checklist: ticked ÷ target (all, or N of them)', () => {
    const items = [{ id: 'a', text: 'A', doneAt: T0 + 1 }, { id: 'b', text: 'B' }, { id: 'c', text: 'C', doneAt: T0 + 2 }, { id: 'd', text: 'D' }]
    expect(contributorProgress({ ...base('l'), kind: 'checklist', items, target: 'all' }, data([]))).toBe(0.5)
    expect(contributorProgress({ ...base('l'), kind: 'checklist', items, target: 2 }, data([]))).toBe(1)
  })

  it('to-do count: completions since the goal started ÷ target', () => {
    const todo = { id: 't', importance: 3, difficulty: 1 } as Todo
    const done = (at: number): TodoCompletion => ({ id: String(at), todoId: 't', occurrenceAt: at, doneAt: at, outcome: 'done', updatedAt: at })
    const c: Contributor = { ...base('n'), kind: 'todoCount', linkId: 'link', target: 60 }
    const comps: TodoCompletion[] = [done(T0 - DAY), done(T0 + DAY), done(T0 + 2 * DAY), { ...done(T0 + 3 * DAY), outcome: 'skipped' }]
    const d = data([c], [], [['link', todo]], [['t', comps]])
    expect(contributorProgress(c, d)).toBeCloseTo(2 / 60) // the one before the start and the skipped one don't count
    expect(weight(c, d)).toBe(2 * 3 + 1) // importance and difficulty from the to-do
  })
})

describe('goal progress and weights', () => {
  it('is the weighted average, weight = 2 × importance + difficulty unless overridden', () => {
    const a: Contributor = { ...base('a', 4, 2), kind: 'checklist', items: [{ id: 'x', text: 'x', doneAt: T0 }], target: 'all' } // weight 10, 100%
    const b: Contributor = { ...base('b', 1, 1), kind: 'checklist', items: [{ id: 'y', text: 'y' }], target: 'all' } // weight 3, 0%
    expect([weight(a), weight(b)]).toEqual([10, 3])
    expect(goalProgress(data([a, b]))).toBeCloseTo(10 / 13)
    expect(goalProgress(data([a, { ...b, weightOverride: 10 }]))).toBeCloseTo(0.5)
  })

  it('the chart replays the past: one point per event', () => {
    const c: Contributor = { ...base('c'), kind: 'slider', start: 0, target: 10, max: 10, schedule }
    const d = data([c], [entry('c', 5, T0 + DAY), entry('c', 10, T0 + 3 * DAY)])
    expect(progressSeries(d, T0 + 5 * DAY).map((p) => p.value)).toEqual([0, 0.5, 1, 1])
  })
})

describe('time left and pace', () => {
  const g = goal({ deadline: T0 + 100 * DAY })
  it('days left, then Ended', () => {
    expect(timeLeft(g, T0 + 77 * DAY)).toBe('23 days left')
    expect(timeLeft(g, T0 + 100 * DAY + 1)).toBe('Ended')
    expect(timeLeft(goal(), T0)).toBeNull() // no deadline: nothing
  })
  it('on pace, or behind by a plain percentage', () => {
    expect(paceText(g, 0.5, T0 + 50 * DAY)).toBe('On pace')
    expect(paceText(g, 0.38, T0 + 50 * DAY)).toBe('Behind by 12%')
    expect(paceText(goal(), 0.1, T0)).toBeNull()
  })
})

// ---------- Storage ----------

describe('goals', () => {
  let goalsList: string
  let todoList: string
  let locusId: string

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    locusId = (await createLocus({ name: 'Music', color: '#000000', x: 0.5, y: 0.5 })).id
    goalsList = (await createElement(locusId, 'goals', 'Goals', {})).id
    todoList = (await createElement(locusId, 'todos', 'Practice', {})).id
  })

  it('a goal with no contributor gets the default weekly check-in, first due next week', async () => {
    const g = await createGoal(goalsList, { title: 'Learn violin' })
    const [c] = await listContributors(g.id)
    expect(c).toMatchObject({ kind: 'slider', title: 'How far along are you?', start: 0, target: 100, max: 100, unit: '%' })
    if (c.kind !== 'slider') throw new Error()
    expect(c.schedule.next).toBeGreaterThan(Date.now() + 6 * DAY - 2 * 3_600_000)
    expect(dueCheckins([c], Date.now())).toEqual([])
  })

  it('removing the last contributor brings the default back', async () => {
    const g = await createGoal(goalsList, { title: 'Learn violin' }, [{ kind: 'checklist', title: 'Pieces', items: [], target: 'all', importance: 2, difficulty: 2 }])
    const [only] = await listContributors(g.id)
    await removeContributor(only.id)
    expect((await listContributors(g.id)).map((c) => c.title)).toEqual(['How far along are you?'])
  })

  it('a check-in saves the answer and moves on to its next time', async () => {
    const now = Date.now()
    const g = await createGoal(goalsList, { title: 'Lose weight' }, [
      { kind: 'number', title: 'Weight', start: 80, target: 75, unit: 'kg', schedule: { ...checkinSchedule({ freq: RRule.DAILY }, now - 3 * DAY), next: now - DAY }, importance: 2, difficulty: 2 },
    ])
    const [c] = await listContributors(g.id)
    expect(dueCheckins([c], now)).toHaveLength(1) // missed yesterday: still simply due
    await saveCheckin([{ contributorId: c.id, value: 77.5 }], now)
    const [after] = await listContributors(g.id)
    expect(dueCheckins([after], now)).toEqual([])
    expect(await progressOf(g.id)).toBeCloseTo(0.5)
  })

  it('counts a to-do’s completions, and fires a to-do waiting for 50%', async () => {
    const practice = await createTodo(todoList, { title: 'Practice', importance: 3, difficulty: 2, when: { kind: 'someday' } })
    const g = await createGoal(goalsList, { title: 'Learn violin' }, [{ kind: 'todoCount', title: 'Sessions', todoId: practice.id, target: 2, importance: 2, difficulty: 2 }])
    const recital = await createTodo(todoList, { title: 'Book a recital', importance: 2, difficulty: 2, when: { kind: 'goal', percent: 50 } }, { type: 'goal', id: g.id })
    expect(todoState((await db.todos.get(recital.id))!, Date.now())).toBe('waiting')
    await completeTodo(practice.id) // one-off: 1 of 2 = 50%
    expect(await progressOf(g.id)).toBeCloseTo(0.5)
    const fired = (await db.todos.get(recital.id))!
    expect(fired.when.kind).toBe('at')
    expect(todoState(fired, Date.now())).toBe('due')
  })

  it('a checklist tick counts, and so does adding a contributor', async () => {
    const g = await createGoal(goalsList, { title: 'Album' }, [{ kind: 'checklist', title: 'Songs', items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], target: 'all', importance: 2, difficulty: 2 }])
    const [list] = await listContributors(g.id)
    await toggleChecklistItem(list.id, 'a')
    expect(await progressOf(g.id)).toBeCloseTo(0.5)
    await addContributor(g.id, { kind: 'checklist', title: 'More', items: [{ id: 'c', text: 'C' }], target: 'all', importance: 2, difficulty: 2 })
    expect((await loadGoalData((await db.goals.get(g.id))!)).contributors).toHaveLength(2)
  })

  it('deleting a counted to-do removes its contributor (the default takes over if it was the only one)', async () => {
    const practice = await createTodo(todoList, { title: 'Practice', importance: 2, difficulty: 2, when: { kind: 'someday' } })
    const g = await createGoal(goalsList, { title: 'Learn violin' }, [{ kind: 'todoCount', title: 'Sessions', todoId: practice.id, target: 10, importance: 2, difficulty: 2 }])
    await deleteTodo(practice.id)
    expect((await listContributors(g.id)).map((c) => c.kind)).toEqual(['slider'])
    expect(await db.links.count()).toBe(0)
  })

  it('deleting a goal wakes to-dos waiting on it and removes everything on it', async () => {
    const g = await createGoal(goalsList, { title: 'Learn violin' })
    const waiting = await createTodo(todoList, { title: 'Celebrate', importance: 2, difficulty: 2, when: { kind: 'goal', percent: 100 } }, { type: 'goal', id: g.id })
    await deleteGoal(g.id)
    expect((await db.todos.get(waiting.id))!.when.kind).toBe('at')
    expect([await db.goals.count(), await db.goalContributors.count(), await db.goalEntries.count(), await db.links.count()]).toEqual([0, 0, 0, 0])
  })

  it('deleting the locus deletes its goals, contributors and check-ins', async () => {
    const g = await createGoal(goalsList, { title: 'Learn violin' })
    const [c] = await listContributors(g.id)
    await saveCheckin([{ contributorId: c.id, value: 10 }])
    await deleteLocus(locusId)
    expect([await db.goals.count(), await db.goalContributors.count(), await db.goalEntries.count()]).toEqual([0, 0, 0])
  })

  it('are in backups', async () => {
    const g = await createGoal(goalsList, { title: 'Learn violin' })
    const [c] = await listContributors(g.id)
    await saveCheckin([{ contributorId: c.id, value: 10 }])
    const backup = await exportBackup()
    await Promise.all(db.tables.map((t) => t.clear()))
    await importBackup(backup, 'replace')
    expect([await db.goals.count(), await db.goalContributors.count(), await db.goalEntries.count()]).toEqual([1, 1, 1])
  })
})
