import 'fake-indexeddb/auto'
import '../all'
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement, createLocus, db } from '../../store/db'
import type { Level, TodoPlan, When } from '../../types'
import { checkPlan, namedMinutes } from './plan'
import { cleanPlan, createTodo, updateTodo } from './store'
import { todoTask } from './type'

const at: When = { kind: 'at', at: new Date(2026, 9, 31, 10).getTime(), hasTime: true }
const ids = (title: string, extra: { when?: When | null; difficulty?: Level; plan?: TodoPlan } = {}) =>
  checkPlan({ title, when: extra.when === undefined ? at : extra.when, difficulty: extra.difficulty ?? 2, plan: extra.plan }).map((p) => p.id)

describe('checking an if-then plan', () => {
  it('passes concrete plans', () => {
    for (const title of ['Read 10 pages of Dune', 'Run for 20 min', 'Write 1 paragraph of the essay', 'Gather receipts', 'Call mum', 'Get groceries', 'Read 10 more pages', 'Lay out running shoes', 'Revise chapter 3']) {
      expect(ids(title), title).toEqual([])
    }
  })

  it('flags vague verbs and topics without a verb', () => {
    expect(ids('Work on essay')).toContain('vagueVerb')
    expect(ids('try to run')).toContain('vagueVerb')
    expect(ids('Focus on maths')).toContain('vagueVerb')
    expect(ids('maths')).toEqual(['noVerb'])
  })

  it('flags words that leave how much or when open', () => {
    expect(ids('Read more')).toContain('vagueWords')
    expect(ids('Exercise regularly')).toContain('vagueWords')
    expect(ids('Practise piano if I have time')).toContain('vagueWords')
    expect(ids('Read 10 more pages')).not.toContain('vagueWords') // sized
  })

  it('asks for a size on a bare verb', () => {
    expect(ids('Study')).toEqual(['noSize'])
    expect(ids('Run')).toEqual(['noSize'])
  })

  it('needs a when, but not before one is picked', () => {
    expect(ids('Read 10 pages', { when: { kind: 'someday' } })).toEqual(['noWhen'])
    expect(ids('Read 10 pages', { when: null })).toEqual([])
  })

  it('flags steps too big to start: long, or very hard with no first step', () => {
    expect(namedMinutes('Study for 3 h')).toBe(180)
    expect(namedMinutes('Run 45 min')).toBe(45)
    expect(ids('Study for 3 hours')).toEqual(['tooBig'])
    expect(ids('Write the thesis chapter', { difficulty: 4 })).toEqual(['tooBig'])
    expect(ids('Write the thesis chapter', { difficulty: 4, plan: { firstStep: 'open the outline' } })).toEqual([])
  })

  it('checks the backup action too', () => {
    expect(ids('Run 20 min', { plan: { obstacle: 'it rains', obstacleAction: 'try to do something' } })).toEqual(['vagueBackup'])
    expect(ids('Run 20 min', { plan: { obstacle: 'it rains', obstacleAction: 'do 10 squats indoors' } })).toEqual([])
  })
})

describe('storing a plan', () => {
  beforeEach(() => Promise.all(db.tables.map((t) => t.clear())))

  it('trims it, drops empty parts, and needs both halves of a backup', () => {
    expect(cleanPlan({ cue: '  ', obstacle: 'tired', obstacleAction: '' })).toBeUndefined()
    expect(cleanPlan({ cue: ' after breakfast ', obstacle: 'tired', obstacleAction: ' 5 min ', firstStep: '' })).toEqual({ cue: 'after breakfast', obstacle: 'tired', obstacleAction: '5 min' })
  })

  it('saves with the to-do, shows on its task, and clears when emptied', async () => {
    const locus = await createLocus({ name: 'Home', color: '#000000', x: 0, y: 0 })
    const list = await createElement(locus.id, 'todos', 'Habits', {})
    const draft = { title: 'Read 10 pages', importance: 2 as Level, difficulty: 2 as Level, when: at }
    const todo = await createTodo(list.id, { ...draft, plan: { cue: 'in bed', firstStep: 'open the book' } })
    expect(todo.plan).toEqual({ cue: 'in bed', firstStep: 'open the book' })
    const task = todoTask(list, todo, at.kind === 'at' ? at.at - 3600_000 : 0)
    expect(task.sublabel).toMatch(/^Start: open the book · .+, in bed$/)

    await updateTodo(todo.id, { ...draft, title: 'Read 12 pages' }) // no plan given: unchanged
    expect((await db.todos.get(todo.id))!.plan).toEqual({ cue: 'in bed', firstStep: 'open the book' })
    await updateTodo(todo.id, { ...draft, plan: { cue: '' } })
    expect((await db.todos.get(todo.id))!.plan).toBeUndefined()
  })
})
