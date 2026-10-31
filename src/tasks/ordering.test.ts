import { describe, expect, it } from 'vitest'
import type { Task } from '../elements/registry'
import type { Level } from '../types'
import { compareActive, sectionOf, sections } from './tasks'

function task(label: string, o: Partial<Task> = {}): Task {
  return { locusId: 'l', elementId: 'e', kind: 'todo', state: 'due', label, importance: 2, difficulty: 2, open: () => {}, ...o }
}
const p = (importance: Level, difficulty: Level) => ({ importance, difficulty })

describe('ordering (SPEC-v5-now.md, "Priority score")', () => {
  it('importance leads and difficulty no longer changes the order', () => {
    const highHard = task('High/Hard', p(3, 4))
    const highEasy = task('High/Easy', p(3, 1))
    const medium = task('Medium/Easy', p(2, 1))
    // The two High tasks tie on score, so the sort keeps to the key, then input order.
    expect([medium, highHard].sort(compareActive).map((t) => t.label)).toEqual(['High/Hard', 'Medium/Easy'])
    expect([highEasy, highHard].sort(compareActive).map((t) => t.label)).toEqual(['High/Easy', 'High/Hard'])
  })

  it('goes by the priority score when the task has one', () => {
    const rank = (priority: number) => ({ key: 'k', type: 'todo' as const, priority, terms: { I: 2, U: 0, B: 0, N: 0, S: 0 }, why: '' })
    const a = task('lower', { ...p(4, 1), rank: rank(5) })
    const b = task('higher', { ...p(1, 1), rank: rank(8) })
    expect([a, b].sort(compareActive).map((t) => t.label)).toEqual(['higher', 'lower'])
  })

  it('a tie goes to the overdue task, then the earlier one', () => {
    const a = task('High, due', { ...p(3, 1), state: 'due', dueAt: 100 })
    const b = task('High, overdue', { ...p(3, 4), state: 'overdue', dueAt: 500 })
    const c = task('High, due earlier', { ...p(3, 1), state: 'due', dueAt: 50 })
    expect([a, b, c].sort(compareActive).map((t) => t.label)).toEqual(['High, overdue', 'High, due earlier', 'High, due'])
  })
})

describe('sections', () => {
  it('puts each task where SPEC-v2.md says', () => {
    expect(sectionOf(task('x', { state: 'overdue' }))).toBe('now')
    expect(sectionOf(task('x', { state: 'due' }))).toBe('now')
    expect(sectionOf(task('x', { state: 'upcoming' }))).toBe('planned')
    expect(sectionOf(task('x', { state: 'waiting' }))).toBe('planned')
    expect(sectionOf(task('x', { state: 'someday' }))).toBe('someday')
    expect(sectionOf(task('x', { kind: 'goal', state: 'info' }))).toBe('goals')
    expect(sectionOf(task('x', { kind: 'goal', state: 'due' }))).toBe('goals') // goals never go to Now
    expect(sectionOf(task('x', { kind: 'checkin', state: 'due' }))).toBe('now') // their check-ins do
    expect(sectionOf(task('x', { state: 'info' }))).toBeNull() // done: not listed
  })

  it('Now is by score; Planned and Someday by date', () => {
    const s = sections([
      task('later', { state: 'upcoming', dueAt: 300 }),
      task('low', { ...p(1, 1), state: 'due' }),
      task('sooner', { state: 'upcoming', dueAt: 100 }),
      task('high', { ...p(4, 1), state: 'due' }),
      task('someday', { state: 'someday' }),
    ])
    expect(s.now.map((t) => t.label)).toEqual(['high', 'low'])
    expect(s.planned.map((t) => t.label)).toEqual(['sooner', 'later'])
    expect(s.someday.map((t) => t.label)).toEqual(['someday'])
  })
})
